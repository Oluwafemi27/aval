import { describe, expect, it } from "vitest";

import {
  planReadinessGroup,
  readinessOutstandingFrames
} from "./readiness-group-planner.js";

const LIMITS = Object.freeze({
  maxDecodeQueueSize: 8,
  maxPendingSamples: 8,
  maxOutstandingFrames: 8,
  maxDecodedBytes: 1_024
});

describe("readiness group planner", () => {
  it("closes a codec-safe dependency group and reports its exact credit cost", () => {
    const plan = planReadinessGroup({
      first: frame(0),
      requirement: requirement(0, 3, 2, 2),
      requested: [frame(0)],
      requestedOffset: 0,
      unitFrameCount: 5,
      pendingSamples: 1,
      outstandingFrames: 2,
      limits: LIMITS
    });

    expect(plan).toEqual({
      requests: [frame(0), frame(1), frame(2)],
      measured: [true, false, false],
      nextRequestedOffset: 1,
      nextRequest: frame(3),
      chunkCost: 2,
      frameCost: 3,
      fits: true,
      reorderLookahead: true
    });
  });

  it("returns a bounded no-fit decision without changing the dependency plan", () => {
    const plan = planReadinessGroup({
      first: frame(0),
      requirement: requirement(0, 2, 2, 0),
      requested: [frame(0), frame(1)],
      requestedOffset: 0,
      unitFrameCount: 2,
      pendingSamples: LIMITS.maxPendingSamples - 1,
      outstandingFrames: 0,
      limits: LIMITS
    });

    expect(plan.fits).toBe(false);
    expect(plan.requests).toEqual([frame(0), frame(1)]);
    expect(plan.nextRequest).toBeNull();
  });

  it("rejects a requested sequence that diverges inside an atomic group", () => {
    expect(() => planReadinessGroup({
      first: frame(0),
      requirement: requirement(0, 2, 1, 0),
      requested: [frame(0), frame(3)],
      requestedOffset: 0,
      unitFrameCount: 4,
      pendingSamples: 0,
      outstandingFrames: 0,
      limits: LIMITS
    })).toThrow("diverges inside a codec presentation group");
  });

  it("checks worker metric addition before using it as credit", () => {
    expect(readinessOutstandingFrames({
      submittedFrames: 3,
      leasedFrames: 2
    })).toBe(5);
    expect(() => readinessOutstandingFrames({
      submittedFrames: Number.MAX_SAFE_INTEGER,
      leasedFrames: 1
    })).toThrow("worker frame metrics are invalid");
  });
});

function frame(unitFrame: number) {
  return Object.freeze({ unitId: "clip", unitFrame });
}

function requirement(
  firstUnitFrame: number,
  frameCount: number,
  chunkCount: number,
  reorderFrameCount: number
) {
  return Object.freeze({
    unitId: "clip",
    firstUnitFrame,
    frameCount,
    chunkCount,
    reorderFrameCount
  });
}
