import type { GraphPresentation } from "@pixel-point/aval-graph";

import {
  RuntimePlaybackError,
  normalizeRuntimeFailure,
  type RuntimeFailureCode
} from "./errors.js";
import {
  IntegratedPlaybackInvariantError,
  type IntegratedCandidateAttemptContext
} from "./integrated-player-contracts.js";
import type {
  VideoCandidatePreparedMedia,
  VideoCandidateReadinessSession,
  VideoCandidateRendererReservation,
  VideoCandidateWorker
} from "./video-candidate-model.js";
import { VideoCandidateOperationControl } from "./video-candidate-support.js";
import type { FrameRenderer } from "./frame-renderer.js";

export function validateVideoCandidateAttemptContext(
  context: Readonly<IntegratedCandidateAttemptContext>
): void {
  if (
    context === null ||
    typeof context !== "object" ||
    context.catalog === null ||
    typeof context.catalog !== "object" ||
    context.candidate === null ||
    typeof context.candidate !== "object" ||
    context.inspection === null ||
    typeof context.inspection !== "object" ||
    context.graphSnapshot === null ||
    typeof context.graphSnapshot !== "object"
  ) {
    throw new TypeError("video candidate attempt context is malformed");
  }
  const candidate = context.candidate;
  const rendition = candidate.rendition;
  const inspection = context.inspection;
  if (
    !context.catalog.ownsVideoRendition(candidate) ||
    inspection.family !== context.catalog.manifest.codec ||
    inspection.bitstream !== context.catalog.manifest.bitstream ||
    inspection.bitDepth !== rendition.bitDepth ||
    inspection.decoderConfig.codec !== rendition.codec ||
    inspection.decoderConfig.codedWidth !== rendition.codedWidth ||
    inspection.decoderConfig.codedHeight !== rendition.codedHeight
  ) {
    throw new TypeError(
      "video candidate does not belong to its inspected asset catalog"
    );
  }
}

export function validateVideoCandidateWorker(
  worker: VideoCandidateWorker
): void {
  const methods = [
    "configure",
    "activateGeneration",
    "submit",
    "abortGeneration",
    "takeFrame",
    "waitForFrames",
    "snapshotMetrics"
  ] as const;
  if (worker === null || typeof worker !== "object") {
    throw new TypeError("video candidate worker factory returned no worker");
  }
  for (const method of methods) {
    if (typeof worker[method] !== "function") {
      throw new TypeError(`video candidate worker is missing ${method}`);
    }
  }
}

export function validateVideoRendererReservation(
  reservation: VideoCandidateRendererReservation
): void {
  if (
    reservation === null ||
    typeof reservation !== "object" ||
    reservation.limits === null ||
    typeof reservation.limits !== "object" ||
    typeof reservation.allocate !== "function"
  ) {
    throw new TypeError("video candidate renderer reservation is malformed");
  }
}

export function validateVideoCandidateRenderer(
  renderer: FrameRenderer
): void {
  if (
    renderer === null ||
    typeof renderer !== "object" ||
    typeof renderer.uploadResident !== "function" ||
    typeof renderer.uploadStreaming !== "function" ||
    typeof renderer.draw !== "function"
  ) {
    throw new TypeError("video candidate renderer factory returned no renderer");
  }
}

export function validateVideoReadinessSession(
  readiness: VideoCandidateReadinessSession
): void {
  if (
    readiness === null ||
    typeof readiness !== "object" ||
    readiness.adapters === null ||
    typeof readiness.adapters !== "object" ||
    typeof readiness.prepareActivation !== "function" ||
    (readiness.observeResult !== undefined &&
      typeof readiness.observeResult !== "function")
  ) {
    throw new TypeError("video candidate readiness session is malformed");
  }
}

export function validateVideoPreparedMedia(
  prepared: VideoCandidatePreparedMedia
): void {
  if (
    prepared === null ||
    typeof prepared !== "object" ||
    prepared.playback === null ||
    typeof prepared.playback !== "object" ||
    typeof prepared.drawInitial !== "function"
  ) {
    throw new TypeError("video candidate prepared media is malformed");
  }
}

/** Capture one required owner method and make the resulting authority idempotent. */
export function captureVideoOwnerMethod(
  owner: unknown,
  methodName: string,
  ownerLabel: string
): () => unknown {
  if (owner === null || typeof owner !== "object") {
    throw new TypeError(`video candidate ${ownerLabel} is malformed`);
  }
  let method: unknown;
  try {
    method = Reflect.get(owner, methodName);
  } catch {
    throw new TypeError(
      `video candidate ${ownerLabel} ${methodName} is inaccessible`
    );
  }
  if (typeof method !== "function") {
    throw new TypeError(
      `video candidate ${ownerLabel} is missing ${methodName}`
    );
  }
  let called = false;
  return (): unknown => {
    if (called) return undefined;
    called = true;
    return Reflect.apply(method, owner, []);
  };
}

export function runVideoResourcePhase<T>(
  operation: () => T,
  context: Readonly<IntegratedCandidateAttemptContext>
): T {
  try {
    return operation();
  } catch (error) {
    throw videoPhaseFailure("resource-rejection", error, context);
  }
}

export function stoppedOrVideoPhaseFailure(
  control: VideoCandidateOperationControl,
  code: RuntimeFailureCode,
  error: unknown,
  context: Readonly<IntegratedCandidateAttemptContext>
): unknown {
  try {
    control.throwIfStopped();
  } catch (stopped) {
    return stopped;
  }
  return videoPhaseFailure(code, error, context);
}

export function videoPhaseFailure(
  code: RuntimeFailureCode,
  error: unknown,
  context: Readonly<IntegratedCandidateAttemptContext>
): RuntimePlaybackError {
  if (error instanceof RuntimePlaybackError) return error;
  return new RuntimePlaybackError(normalizeRuntimeFailure(
    code,
    error,
    videoCandidateFailureContext(context)
  ));
}

export function videoCandidateFailureContext(
  context: Readonly<IntegratedCandidateAttemptContext>
): Readonly<{ readonly rendition: string; readonly rank: number }> {
  return Object.freeze({
    rendition: context.candidate.rendition.id,
    rank: context.candidate.authoredIndex
  });
}

export function requireVideoOwner<T>(value: T | null, label: string): T {
  if (value === null) {
    throw new IntegratedPlaybackInvariantError(
      `video candidate lost its ${label}`
    );
  }
  return value;
}

export function cloneVideoPresentation(
  presentation: Readonly<GraphPresentation>
): Readonly<GraphPresentation> {
  switch (presentation.kind) {
    case "static":
      return Object.freeze({
        kind: "static",
        state: presentation.state
      });
    case "intro":
    case "body":
      return Object.freeze({
        kind: presentation.kind,
        state: presentation.state,
        unitId: presentation.unitId,
        frameIndex: presentation.frameIndex
      });
    case "locked":
      return Object.freeze({
        kind: "locked",
        edgeId: presentation.edgeId,
        unitId: presentation.unitId,
        frameIndex: presentation.frameIndex
      });
    case "reversible":
      return Object.freeze({
        kind: "reversible",
        edgeId: presentation.edgeId,
        unitId: presentation.unitId,
        frameIndex: presentation.frameIndex,
        direction: presentation.direction
      });
  }
}
