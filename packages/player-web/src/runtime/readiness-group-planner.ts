import type {
  DecoderWorkerLimits,
  DecoderWorkerMetrics
} from "../decoder-worker/protocol.js";
import {
  planWorkerSampleGroupCredit,
  type WorkerSampleFrameRequest,
  type WorkerSampleGroupRequirement
} from "./worker-samples.js";

export interface WorkerGroupPlan {
  readonly requests: readonly Readonly<WorkerSampleFrameRequest>[];
  readonly chunkCost: number;
  readonly frameCost: number;
  readonly fits: boolean;
  readonly reorderLookahead: boolean;
}

export interface ReadinessGroupPlan extends WorkerGroupPlan {
  readonly measured: readonly boolean[];
  readonly nextRequestedOffset: number;
  readonly nextRequest: Readonly<WorkerSampleFrameRequest> | null;
}

export function planReadinessGroup(input: Readonly<{
  readonly first: Readonly<WorkerSampleFrameRequest>;
  readonly requirement: Readonly<WorkerSampleGroupRequirement>;
  readonly requested: readonly Readonly<WorkerSampleFrameRequest>[];
  readonly requestedOffset: number;
  readonly unitFrameCount: number;
  readonly pendingSamples: number;
  readonly outstandingFrames: number;
  readonly limits: Readonly<DecoderWorkerLimits>;
}>): Readonly<ReadinessGroupPlan> {
  validatePlanEnvelope(input);
  const requests: WorkerSampleFrameRequest[] = [];
  const measured: boolean[] = [];
  let offset = input.requestedOffset;
  for (let index = 0; index < input.requirement.frameCount; index += 1) {
    const dependency = Object.freeze({
      unitId: input.first.unitId,
      unitFrame: input.first.unitFrame + index
    });
    const desired = input.requested[offset];
    if (desired !== undefined) {
      if (
        desired.unitId !== dependency.unitId ||
        desired.unitFrame !== dependency.unitFrame
      ) {
        throw new RangeError(
          "readiness request diverges inside a codec presentation group"
        );
      }
      requests.push(desired);
      measured.push(true);
      offset += 1;
    } else {
      requests.push(dependency);
      measured.push(false);
    }
  }

  const groupEnd = input.first.unitFrame + input.requirement.frameCount;
  const nextRequest = groupEnd < input.unitFrameCount
    ? Object.freeze({
        unitId: input.first.unitId,
        unitFrame: groupEnd
      })
    : input.requested[offset] ?? null;
  const credit = planWorkerSampleGroupCredit(
    input.requirement,
    {
      pendingSamples: input.pendingSamples,
      outstandingFrames: input.outstandingFrames
    },
    input.limits
  );
  return Object.freeze({
    requests: Object.freeze(requests),
    measured: Object.freeze(measured),
    nextRequestedOffset: offset,
    nextRequest,
    chunkCost: credit.chunkCost,
    frameCost: credit.frameCost,
    fits: credit.fits,
    reorderLookahead:
      nextRequest !== null &&
      nextRequest.unitId === input.requirement.unitId &&
      groupEnd < input.unitFrameCount &&
      input.requirement.reorderFrameCount > 0
  });
}

export function readinessOutstandingFrames(
  metrics: Readonly<
    Pick<DecoderWorkerMetrics, "submittedFrames" | "leasedFrames">
  >
): number {
  const { submittedFrames, leasedFrames } = metrics;
  if (
    !Number.isSafeInteger(submittedFrames) ||
    submittedFrames < 0 ||
    !Number.isSafeInteger(leasedFrames) ||
    leasedFrames < 0 ||
    submittedFrames > Number.MAX_SAFE_INTEGER - leasedFrames
  ) {
    throw new RangeError("readiness worker frame metrics are invalid");
  }
  return submittedFrames + leasedFrames;
}

function validatePlanEnvelope(input: Readonly<{
  readonly first: Readonly<WorkerSampleFrameRequest>;
  readonly requirement: Readonly<WorkerSampleGroupRequirement>;
  readonly requested: readonly Readonly<WorkerSampleFrameRequest>[];
  readonly requestedOffset: number;
  readonly unitFrameCount: number;
  readonly limits: Readonly<DecoderWorkerLimits>;
}>): void {
  if (
    input.requirement.unitId !== input.first.unitId ||
    input.requirement.firstUnitFrame !== input.first.unitFrame
  ) {
    throw new RangeError("readiness codec requirement starts at the wrong frame");
  }
  if (
    !Number.isSafeInteger(input.requestedOffset) ||
    input.requestedOffset < 0 ||
    input.requestedOffset > input.requested.length
  ) {
    throw new RangeError("readiness request offset is invalid");
  }
  if (!Number.isSafeInteger(input.unitFrameCount) || input.unitFrameCount < 1) {
    throw new RangeError("readiness codec unit frame count is invalid");
  }
  if (
    !Number.isSafeInteger(input.requirement.frameCount) ||
    input.requirement.frameCount < 1 ||
    !Number.isSafeInteger(input.requirement.chunkCount) ||
    input.requirement.chunkCount < 1 ||
    !Number.isSafeInteger(input.requirement.reorderFrameCount) ||
    input.requirement.reorderFrameCount < 0 ||
    input.requirement.frameCount > input.limits.maxOutstandingFrames ||
    input.requirement.chunkCount > input.limits.maxPendingSamples ||
    input.requirement.reorderFrameCount > input.limits.maxOutstandingFrames
  ) {
    throw new RangeError("readiness codec group exceeds worker limits");
  }
  if (
    input.first.unitFrame < 0 ||
    !Number.isSafeInteger(input.first.unitFrame) ||
    input.first.unitFrame >
      input.unitFrameCount - input.requirement.frameCount
  ) {
    throw new RangeError("readiness codec group exceeds its unit");
  }
}
