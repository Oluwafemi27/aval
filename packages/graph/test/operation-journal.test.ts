import { describe, expect, it } from "vitest";

import { MotionGraphError } from "../src/errors.js";
import { GRAPH_LIMITS } from "../src/limits.js";
import type {
  GraphPresentation,
  MotionGraphEffect,
  MotionGraphSnapshot
} from "../src/model.js";
import { OperationJournal } from "../src/operation-journal.js";

describe("OperationJournal", () => {
  it("admits the bounded input window while every input consumes a sequence", () => {
    const journal = new OperationJournal();

    for (let index = 1; index <= GRAPH_LIMITS.maxInputsPerTick; index += 1) {
      expect(journal.beginInput()).toEqual({
        sequence: index,
        withinLimit: true
      });
    }

    expect(journal.beginInput()).toEqual({ sequence: 33, withinLimit: false });
    expect(journal.beginInput()).toEqual({ sequence: 34, withinLimit: false });
    expect(journal.inputsSinceTick).toBe(GRAPH_LIMITS.maxInputsPerTick);
    expect(journal.allocateInternalSequence()).toBe(35);
    expect(journal.inputSequence).toBe(35);
    expect(journal.inputsSinceTick).toBe(GRAPH_LIMITS.maxInputsPerTick);
  });

  it("validates consecutive ordinals without resetting inputs on failed work", () => {
    const journal = new OperationJournal();
    journal.beginInput();
    journal.beginTick(0n);
    journal.incrementRouteOperations();

    expect(() => journal.beginTick(2n)).toThrowError(
      new MotionGraphError(
        "NON_CONSECUTIVE_TICK",
        "content ordinal must be 1"
      )
    );
    expect(journal.contentOrdinal).toBe(0n);
    expect(journal.inputsSinceTick).toBe(1);
    expect(journal.routeOperationsLastTick).toBe(1);

    journal.beginTick(1n);
    expect(journal.routeOperationsLastTick).toBe(0);
    expect(journal.inputsSinceTick).toBe(1);
    journal.beginInput();
    expect(journal.inputsSinceTick).toBe(2);

    journal.completeTick();
    expect(journal.inputsSinceTick).toBe(0);
    expect(journal.contentOrdinal).toBe(1n);
  });

  it("enforces the exact per-tick route-operation cap and error", () => {
    const journal = new OperationJournal();
    journal.beginTick(0n);

    for (
      let count = 0;
      count < GRAPH_LIMITS.maxRoutingOperationsPerTick;
      count += 1
    ) {
      journal.incrementRouteOperations();
    }
    expect(journal.routeOperationsLastTick).toBe(
      GRAPH_LIMITS.maxRoutingOperationsPerTick
    );

    expect(() => journal.incrementRouteOperations()).toThrowError(
      new MotionGraphError(
        "GRAPH_VALIDATION",
        "graph exceeded the per-tick routing-operation bound"
      )
    );
    expect(journal.routeOperationsLastTick).toBe(
      GRAPH_LIMITS.maxRoutingOperationsPerTick + 1
    );

    journal.beginTick(1n);
    expect(journal.routeOperationsLastTick).toBe(0);
  });

  it("records the completed presentation and snapshot in a frozen result", () => {
    const journal = new OperationJournal();
    const presentation = Object.freeze<GraphPresentation>({
      kind: "body",
      state: "idle",
      unitId: "idle-loop",
      frameIndex: 3
    });
    const snapshot = frozenSnapshot(presentation);
    const effect = Object.freeze<MotionGraphEffect>({
      type: "requestedstatechange",
      from: "idle",
      to: "hovered",
      sequence: 1
    });

    const result = journal.record({
      operation: "request",
      presentation,
      effects: [effect],
      snapshot,
      metadata: {
        accepted: true,
        joined: false,
        sequence: 1,
        requestId: 1
      }
    });

    expect(result).toEqual({
      operation: "request",
      accepted: true,
      joined: false,
      sequence: 1,
      requestId: 1,
      presentation,
      effects: [effect],
      snapshot
    });
    expect(result.presentation).toBe(presentation);
    expect(result.snapshot).toBe(snapshot);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.effects)).toBe(true);
    expect(journal.getTrace()).toEqual([{ index: 1, result }]);
    expect(Object.isFrozen(journal.getTrace()[0])).toBe(true);
  });

  it("retains only the newest frozen trace window with absolute indices", () => {
    const journal = new OperationJournal();
    const snapshot = frozenSnapshot(null);
    const total = GRAPH_LIMITS.maxTraceRecords + 4;

    for (let index = 0; index < total; index += 1) {
      journal.record({
        operation: "tick",
        effects: [],
        presentation: null,
        snapshot
      });
    }

    const trace = journal.getTrace();
    expect(trace).toHaveLength(GRAPH_LIMITS.maxTraceRecords);
    expect(trace[0]?.index).toBe(5);
    expect(trace.at(-1)?.index).toBe(total);
    expect(Object.isFrozen(trace)).toBe(true);
    expect(trace.every(Object.isFrozen)).toBe(true);
    expect(trace.every(({ result }) => Object.isFrozen(result))).toBe(true);
    expect(Reflect.set(trace, "0", trace[0])).toBe(false);
  });
});

function frozenSnapshot(
  presentation: Readonly<GraphPresentation> | null
): Readonly<MotionGraphSnapshot> {
  return Object.freeze({
    readiness: "animated",
    phase: "stable",
    initialUnitPending: false,
    requestedState: "idle",
    visualState: "idle",
    prospectiveState: "idle",
    isTransitioning: false,
    presentation,
    pendingEdgeId: null,
    activeEdgeId: null,
    followOnEdgeId: null,
    direction: null,
    contentOrdinal: null,
    inputSequence: 0,
    pendingRequestCount: 0,
    inputsSinceTick: 0,
    routeOperationsLastTick: 0
  });
}
