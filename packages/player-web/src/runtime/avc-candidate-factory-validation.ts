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
  AvcCandidatePreparedMedia,
  AvcCandidateReadinessSession,
  AvcCandidateRendererReservation,
  AvcCandidateWorker
} from "./avc-candidate-factory-model.js";
import { AvcCandidateOperationControl } from "./avc-candidate-factory-support.js";
import type { FrameRenderer } from "./frame-renderer.js";

export function validateAvcCandidateAttemptContext(
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
    throw new TypeError("AVC candidate attempt context is malformed");
  }
}

export function validateAvcCandidateWorker(
  worker: AvcCandidateWorker
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
    throw new TypeError("AVC candidate worker factory returned no worker");
  }
  for (const method of methods) {
    if (typeof worker[method] !== "function") {
      throw new TypeError(`AVC candidate worker is missing ${method}`);
    }
  }
}

export function validateAvcRendererReservation(
  reservation: AvcCandidateRendererReservation
): void {
  if (
    reservation === null ||
    typeof reservation !== "object" ||
    reservation.limits === null ||
    typeof reservation.limits !== "object" ||
    typeof reservation.allocate !== "function"
  ) {
    throw new TypeError("AVC candidate renderer reservation is malformed");
  }
}

export function validateAvcCandidateRenderer(
  renderer: FrameRenderer
): void {
  if (
    renderer === null ||
    typeof renderer !== "object" ||
    typeof renderer.uploadResident !== "function" ||
    typeof renderer.uploadStreaming !== "function" ||
    typeof renderer.draw !== "function"
  ) {
    throw new TypeError("AVC candidate renderer factory returned no renderer");
  }
}

export function validateAvcReadinessSession(
  readiness: AvcCandidateReadinessSession
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
    throw new TypeError("AVC candidate readiness session is malformed");
  }
}

export function validateAvcPreparedMedia(
  prepared: AvcCandidatePreparedMedia
): void {
  if (
    prepared === null ||
    typeof prepared !== "object" ||
    prepared.playback === null ||
    typeof prepared.playback !== "object" ||
    typeof prepared.drawInitial !== "function"
  ) {
    throw new TypeError("AVC candidate prepared media is malformed");
  }
}

/** Capture one required owner method and make the resulting authority idempotent. */
export function captureAvcOwnerMethod(
  owner: unknown,
  methodName: string,
  ownerLabel: string
): () => unknown {
  if (owner === null || typeof owner !== "object") {
    throw new TypeError(`AVC candidate ${ownerLabel} is malformed`);
  }
  let method: unknown;
  try {
    method = Reflect.get(owner, methodName);
  } catch {
    throw new TypeError(
      `AVC candidate ${ownerLabel} ${methodName} is inaccessible`
    );
  }
  if (typeof method !== "function") {
    throw new TypeError(
      `AVC candidate ${ownerLabel} is missing ${methodName}`
    );
  }
  let called = false;
  return (): unknown => {
    if (called) return undefined;
    called = true;
    return Reflect.apply(method, owner, []);
  };
}

export function runAvcResourcePhase<T>(
  operation: () => T,
  context: Readonly<IntegratedCandidateAttemptContext>
): T {
  try {
    return operation();
  } catch (error) {
    throw avcPhaseFailure("resource-rejection", error, context);
  }
}

export function stoppedOrAvcPhaseFailure(
  control: AvcCandidateOperationControl,
  code: RuntimeFailureCode,
  error: unknown,
  context: Readonly<IntegratedCandidateAttemptContext>
): unknown {
  try {
    control.throwIfStopped();
  } catch (stopped) {
    return stopped;
  }
  return avcPhaseFailure(code, error, context);
}

export function avcPhaseFailure(
  code: RuntimeFailureCode,
  error: unknown,
  context: Readonly<IntegratedCandidateAttemptContext>
): RuntimePlaybackError {
  if (error instanceof RuntimePlaybackError) return error;
  return new RuntimePlaybackError(normalizeRuntimeFailure(
    code,
    error,
    avcCandidateFailureContext(context)
  ));
}

export function avcCandidateFailureContext(
  context: Readonly<IntegratedCandidateAttemptContext>
): Readonly<{ readonly rendition: string; readonly rank: number }> {
  return Object.freeze({
    rendition: context.candidate.rendition.id,
    rank: context.candidate.rank
  });
}

export function requireAvcOwner<T>(value: T | null, label: string): T {
  if (value === null) {
    throw new IntegratedPlaybackInvariantError(
      `AVC candidate lost its ${label}`
    );
  }
  return value;
}

export function cloneAvcPresentation(
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

/** @deprecated Compatibility aliases for the pre-M6 opaque candidate API. */
export const validateOpaqueCandidateAttemptContext =
  validateAvcCandidateAttemptContext;
export const validateOpaqueCandidateWorker = validateAvcCandidateWorker;
export const validateOpaqueRendererReservation = validateAvcRendererReservation;
export const validateOpaqueCandidateRenderer = validateAvcCandidateRenderer;
export const validateOpaqueReadinessSession = validateAvcReadinessSession;
export const validateOpaquePreparedMedia = validateAvcPreparedMedia;
export const runOpaqueResourcePhase = runAvcResourcePhase;
export const stoppedOrOpaquePhaseFailure = stoppedOrAvcPhaseFailure;
export const opaquePhaseFailure = avcPhaseFailure;
export const opaqueCandidateFailureContext = avcCandidateFailureContext;
export const requireOpaqueOwner = requireAvcOwner;
export const cloneOpaquePresentation = cloneAvcPresentation;
