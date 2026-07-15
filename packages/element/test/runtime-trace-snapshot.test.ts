import type { RuntimeTraceRecord } from "@pixel-point/aval-player-web";
import { describe, expect, it } from "vitest";

import { snapshotRuntimeTrace } from "../src/runtime-trace-snapshot.js";

describe("runtime trace public snapshot", () => {
  it("preserves the complete handle-free ledger and stringifies bigint ordinals", () => {
    const record = {
      index: 4,
      kind: "content-tick",
      presentationOrdinal: 9n,
      rationalDeadlineUs: 300_000,
      callbackStartMicroseconds: 300_120,
      canvasSubmissionCompleteMicroseconds: 300_480,
      eligibleAnimationFrameOrdinal: 22,
      graph: {
        operation: "tick",
        snapshot: {
          readiness: "interactiveReady",
          phase: "body",
          initialUnitPending: false,
          requestedState: "idle",
          visualState: "idle",
          prospectiveState: "idle",
          isTransitioning: false,
          presentation: { kind: "body", state: "idle", unitId: "body", frameIndex: 2 },
          pendingEdgeId: null,
          activeEdgeId: null,
          followOnEdgeId: null,
          direction: null,
          contentOrdinal: 9n,
          inputSequence: 2,
          pendingRequestCount: 0,
          inputsSinceTick: 0,
          routeOperationsLastTick: 1
        },
        presentation: { kind: "body", state: "idle", unitId: "body", frameIndex: 2 },
        effects: []
      },
      routeReady: true,
      selectedBoundary: "body:loop",
      scheduler: {
        generation: 1,
        activePath: "body",
        sourceCursor: { path: "body", unit: "body", unitInstance: 1, localFrame: 2 },
        submittedCursor: null,
        decodedCursor: null,
        displayedCursor: null,
        ringSize: 2,
        ringCapacity: 4,
        smoothSession: true
      },
      submitted: [{ path: "body", unit: "body", unitInstance: 1, localFrame: 3 }],
      media: {
        kind: "frame",
        graphKind: "body",
        state: "idle",
        edge: null,
        path: "body",
        frame: { rendition: "r", unit: "body", localFrame: 2 },
        drawSource: "streaming",
        generation: 1,
        unitInstance: 1,
        decodeOrdinal: 3,
        timestamp: 99,
        intendedPresentationOrdinal: 9n
      },
      readbackTag: "pixel:idle:2",
      readiness: "interactiveReady",
      decodeLeadFrames: 2,
      settledRequestIds: [7],
      counters: { underflows: 0, fallbacks: 0, settledRequests: 1, cleanedFrames: 3 }
    } as unknown as RuntimeTraceRecord;
    const [snapshot] = snapshotRuntimeTrace([record]);
    expect(snapshot).toMatchObject({
      presentationOrdinal: "9",
      rationalDeadlineUs: 300_000,
      callbackStartMicroseconds: 300_120,
      canvasSubmissionCompleteMicroseconds: 300_480,
      eligibleAnimationFrameOrdinal: 22,
      readbackTag: "pixel:idle:2",
      graph: {
        snapshot: { initialUnitPending: false, contentOrdinal: "9" }
      },
      media: { intendedPresentationOrdinal: "9" }
    });
    expect(() => JSON.stringify(snapshot)).not.toThrow();
    expect(Object.isFrozen(snapshot?.graph)).toBe(true);
    expect(Object.isFrozen(snapshot?.scheduler)).toBe(true);
  });
});
