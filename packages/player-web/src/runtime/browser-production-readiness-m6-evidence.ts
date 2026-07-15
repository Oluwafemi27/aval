import type {
  AvcCandidateReadinessSessionInput
} from "./avc-candidate-factory.js";
import type { FrameRendererSnapshot } from "./frame-renderer.js";
import {
  MotionPolicyCoordinator,
  type MotionPolicySnapshot
} from "./motion-policy.js";

export interface BrowserProductionProfileEvidence {
  readonly profile:
    | "avc-annexb-opaque-v0"
    | "avc-annexb-packed-alpha-v0"
    | "avc-annexb-opaque-v1"
    | "avc-annexb-packed-alpha-v1";
  readonly visibleColorRect: readonly [number, number, number, number];
  readonly visibleAlphaRect:
    | readonly [number, number, number, number]
    | null;
  readonly decodedStorageRect: readonly [number, number, number, number];
  readonly codedWidth: number;
  readonly codedHeight: number;
  readonly alphaPaneAvailable: boolean;
  readonly renderer: Readonly<Pick<
    FrameRendererSnapshot,
    | "state"
    | "allocatedLayers"
    | "uploadedResidentLayers"
    | "residentUploads"
    | "streamingUploads"
    | "draws"
    | "errors"
  >>;
  readonly uploadReady: boolean;
  /** Alpha/pixel quality is certified only by the real browser readback proof. */
  readonly pixelEvidence: "not-claimed-by-readiness-rehearsal";
  readonly passed: boolean;
}

export interface BrowserProductionMotionPhaseEvidence {
  readonly phase:
    | "animated-installed"
    | "reducing"
    | "reduced"
    | "restoring"
    | "restored"
    | "superseded-reduction"
    | "sticky-failure"
    | "disposed";
  readonly policy: MotionPolicySnapshot["policy"];
  readonly hostReducedMotion: boolean;
  readonly desiredMode: MotionPolicySnapshot["desiredMode"];
  readonly actualMode: MotionPolicySnapshot["actualMode"];
  readonly generation: number;
  readonly transition: MotionPolicySnapshot["transition"];
  readonly staticOrigin: MotionPolicySnapshot["staticOrigin"];
  readonly stickyFailure: boolean;
}

export interface BrowserProductionMotionPolicyEvidence {
  readonly passed: boolean;
  readonly staleTransitionRejected: boolean;
  readonly stickyFailureRejectedReentry: boolean;
  readonly phases: readonly Readonly<BrowserProductionMotionPhaseEvidence>[];
}

export function createProductionProfileEvidence(input: Readonly<Pick<
  AvcCandidateReadinessSessionInput,
  "context" | "renderer" | "interactionCache"
>>): Readonly<BrowserProductionProfileEvidence> {
  const { geometry, rendition } = input.context.candidate;
  const renderer = input.renderer.snapshot();
  const packed = rendition.profile === "avc-annexb-packed-alpha-v0" ||
    rendition.profile === "avc-annexb-packed-alpha-v1";
  const alphaRect = geometry.visibleAlphaRect ?? null;
  const alphaPaneAvailable = alphaRect !== null;
  const rendererEvidence = Object.freeze({
    state: renderer.state,
    allocatedLayers: renderer.allocatedLayers,
    uploadedResidentLayers: renderer.uploadedResidentLayers,
    residentUploads: renderer.residentUploads,
    streamingUploads: renderer.streamingUploads,
    draws: renderer.draws,
    errors: renderer.errors
  });
  const uploadReady =
    renderer.state === "active" &&
    renderer.errors === 0 &&
    renderer.allocatedLayers === input.interactionCache.layerCount &&
    renderer.uploadedResidentLayers === input.interactionCache.layerCount &&
    renderer.residentUploads >= input.interactionCache.layerCount &&
    renderer.streamingUploads > 0 &&
    renderer.draws > 0;
  const profileReady = packed === alphaPaneAvailable;
  return Object.freeze({
    profile: rendition.profile,
    visibleColorRect: freezeRect(geometry.visibleColorRect),
    visibleAlphaRect: alphaRect === null
      ? null
      : freezeRect(alphaRect),
    decodedStorageRect: freezeRect(geometry.decodedStorageRect),
    codedWidth: geometry.codedWidth,
    codedHeight: geometry.codedHeight,
    alphaPaneAvailable,
    renderer: rendererEvidence,
    uploadReady,
    pixelEvidence: "not-claimed-by-readiness-rehearsal",
    passed: profileReady && uploadReady
  });
}

export function rehearseProductionMotionPolicy(): Readonly<
  BrowserProductionMotionPolicyEvidence
> {
  const coordinator = new MotionPolicyCoordinator();
  const phases: BrowserProductionMotionPhaseEvidence[] = [];
  const record = (
    phase: BrowserProductionMotionPhaseEvidence["phase"]
  ): void => {
    phases.push(freezeMotionPhase(phase, coordinator.snapshot()));
  };

  coordinator.installAnimated();
  record("animated-installed");
  coordinator.setHostReducedMotion(true);
  const reduce = coordinator.nextTransition();
  record("reducing");
  const reduced = reduce !== null && coordinator.commitStatic(reduce);
  record("reduced");

  coordinator.setPolicy("full");
  const restore = coordinator.nextTransition();
  record("restoring");
  const restored = restore !== null && coordinator.commitAnimated(restore);
  record("restored");

  coordinator.setPolicy("auto");
  const stale = coordinator.nextTransition();
  coordinator.setHostReducedMotion(false);
  const staleTransitionRejected = stale !== null &&
    stale.signal.aborted &&
    !coordinator.commitStatic(stale);
  record("superseded-reduction");

  coordinator.failToStatic("animation-failure");
  coordinator.setPolicy("reduce");
  coordinator.setPolicy("full");
  const stickyFailureRejectedReentry =
    coordinator.snapshot().stickyFailure &&
    coordinator.nextTransition() === null;
  record("sticky-failure");
  coordinator.dispose();
  record("disposed");

  const passed = reduced && restored && staleTransitionRejected &&
    stickyFailureRejectedReentry &&
    phases.every((value, index) =>
      index === 0 || value.generation >= phases[index - 1]!.generation
    ) &&
    phases.at(-1)?.actualMode === "disposed";
  return Object.freeze({
    passed,
    staleTransitionRejected,
    stickyFailureRejectedReentry,
    phases: Object.freeze(phases)
  });
}

function freezeRect(
  rect: readonly [number, number, number, number]
): readonly [number, number, number, number] {
  return Object.freeze([rect[0], rect[1], rect[2], rect[3]]);
}

function freezeMotionPhase(
  phase: BrowserProductionMotionPhaseEvidence["phase"],
  snapshot: Readonly<MotionPolicySnapshot>
): Readonly<BrowserProductionMotionPhaseEvidence> {
  return Object.freeze({
    phase,
    policy: snapshot.policy,
    hostReducedMotion: snapshot.hostReducedMotion,
    desiredMode: snapshot.desiredMode,
    actualMode: snapshot.actualMode,
    generation: snapshot.generation,
    transition: snapshot.transition,
    staticOrigin: snapshot.staticOrigin,
    stickyFailure: snapshot.stickyFailure
  });
}
