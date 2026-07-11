import { describe, expect, it } from "vitest";

import type { GraphBodyDefinition } from "../src/model.js";
import {
  findFinishBoundary,
  findNextPortalBoundary,
  greatestFinishWaitFrames,
  greatestPortalWaitFrames,
  nextBodyFrame
} from "../src/portal-search.js";

describe("body frame geometry", () => {
  it("advances and wraps a loop, including a one-frame loop", () => {
    const body = loop(6, [0, 3]);
    expect(nextBodyFrame(body, 2)).toEqual({
      frameIndex: 3,
      didAdvance: true,
      wrapped: false,
      isHeld: false
    });
    expect(nextBodyFrame(body, 5)).toEqual({
      frameIndex: 0,
      didAdvance: true,
      wrapped: true,
      isHeld: false
    });
    expect(nextBodyFrame(loop(1, [0]), 0)).toEqual({
      frameIndex: 0,
      didAdvance: true,
      wrapped: true,
      isHeld: false
    });
  });

  it("advances a finite body once and then holds its final frame", () => {
    const body = finite(4, [3]);
    expect(nextBodyFrame(body, 2)).toEqual({
      frameIndex: 3,
      didAdvance: true,
      wrapped: false,
      isHeld: false
    });
    expect(nextBodyFrame(body, 3)).toEqual({
      frameIndex: 3,
      didAdvance: false,
      wrapped: false,
      isHeld: true
    });
  });

  it("never advances a held body", () => {
    expect(nextBodyFrame(held(), 0)).toEqual({
      frameIndex: 0,
      didAdvance: false,
      wrapped: false,
      isHeld: true
    });
  });
});

describe("portal geometry", () => {
  it("treats a currently displayed portal as distance zero", () => {
    const result = findNextPortalBoundary(loop(12, [0, 4, 9]), "handoff", 4);
    expect(result).toEqual({
      boundaryFrame: 4,
      waitFrames: 0,
      eligibleNow: true,
      wraps: false
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("finds the next loop portal without wrapping", () => {
    expect(findNextPortalBoundary(loop(12, [0, 4, 9]), "handoff", 5)).toEqual({
      boundaryFrame: 9,
      waitFrames: 4,
      eligibleNow: false,
      wraps: false
    });
  });

  it("searches a looping body circularly", () => {
    expect(findNextPortalBoundary(loop(12, [0, 4, 9]), "handoff", 10)).toEqual({
      boundaryFrame: 0,
      waitFrames: 2,
      eligibleNow: false,
      wraps: true
    });
  });

  it("computes loop worst-case wait from portal gaps", () => {
    expect(greatestPortalWaitFrames(loop(12, [0, 4, 9]), "handoff")).toBe(4);
    expect(greatestPortalWaitFrames(loop(12, [3]), "handoff")).toBe(11);
    expect(greatestPortalWaitFrames(loop(1, [0]), "handoff")).toBe(0);
  });

  it("searches finite bodies only forward", () => {
    const body = finite(10, [2, 6, 9]);
    expect(findNextPortalBoundary(body, "handoff", 3)).toEqual({
      boundaryFrame: 6,
      waitFrames: 3,
      eligibleNow: false,
      wraps: false
    });
    expect(findNextPortalBoundary(body, "handoff", 9)).toEqual({
      boundaryFrame: 9,
      waitFrames: 0,
      eligibleNow: true,
      wraps: false
    });
    expect(greatestPortalWaitFrames(body, "handoff")).toBe(3);
  });

  it("uses frame zero immediately for a valid held port", () => {
    expect(findNextPortalBoundary(held(), "handoff", 0)).toEqual({
      boundaryFrame: 0,
      waitFrames: 0,
      eligibleNow: true,
      wraps: false
    });
    expect(greatestPortalWaitFrames(held(), "handoff")).toBe(0);
  });
});

describe("finish geometry", () => {
  it("waits through the remaining finite frames and then remains eligible", () => {
    const body = finite(7, [6]);
    expect(findFinishBoundary(body, 2)).toEqual({
      boundaryFrame: 6,
      waitFrames: 4,
      eligibleNow: false,
      wraps: false
    });
    expect(findFinishBoundary(body, 6)).toEqual({
      boundaryFrame: 6,
      waitFrames: 0,
      eligibleNow: true,
      wraps: false
    });
    expect(greatestFinishWaitFrames(body)).toBe(6);
  });

  it("makes a held body immediately finish-eligible", () => {
    expect(findFinishBoundary(held(), 0)).toEqual({
      boundaryFrame: 0,
      waitFrames: 0,
      eligibleNow: true,
      wraps: false
    });
    expect(greatestFinishWaitFrames(held())).toBe(0);
  });

  it("rejects finish geometry for an infinite loop", () => {
    expect(() => findFinishBoundary(loop(4, [0]), 0)).toThrow(
      "cannot use a finish boundary"
    );
    expect(() => greatestFinishWaitFrames(loop(4, [0]))).toThrow(
      "cannot use a finish boundary"
    );
  });
});

describe("geometry validation", () => {
  it("rejects invalid current body frames", () => {
    const body = loop(4, [0]);
    for (const frame of [-1, 4, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => nextBodyFrame(body, frame)).toThrow("out of range");
      expect(() => findNextPortalBoundary(body, "handoff", frame)).toThrow(
        "out of range"
      );
    }
  });

  it("rejects a missing or duplicate named port", () => {
    const body = loop(4, [0]);
    expect(() => findNextPortalBoundary(body, "missing", 0)).toThrow(
      "has no port missing"
    );

    const duplicate = {
      ...body,
      ports: [body.ports[0]!, body.ports[0]!]
    } satisfies GraphBodyDefinition;
    expect(() => greatestPortalWaitFrames(duplicate, "handoff")).toThrow(
      "duplicate port handoff"
    );
  });

  it("rejects empty, unsorted, duplicate, and out-of-range portal frames", () => {
    for (const portalFrames of [[], [2, 1], [1, 1], [-1], [4]]) {
      const body = loop(4, portalFrames);
      expect(() => greatestPortalWaitFrames(body, "handoff")).toThrow();
    }
  });

  it("rejects a finite departure port that omits the held final frame", () => {
    const body = finite(6, [1, 4]);
    expect(() => findNextPortalBoundary(body, "handoff", 5)).toThrow(
      "must include the final frame"
    );
    expect(() => greatestPortalWaitFrames(body, "handoff")).toThrow(
      "must include the final frame"
    );
  });

  it("rejects malformed body geometry", () => {
    expect(() =>
      nextBodyFrame({ ...loop(1, [0]), frameCount: 0 }, 0)
    ).toThrow("positive safe integer");
    expect(() =>
      nextBodyFrame({ ...held(), frameCount: 2 }, 0)
    ).toThrow("exactly one frame");
  });
});

function loop(
  frameCount: number,
  portalFrames: readonly number[]
): GraphBodyDefinition {
  return body("loop", frameCount, portalFrames);
}

function finite(
  frameCount: number,
  portalFrames: readonly number[]
): GraphBodyDefinition {
  return body("finite", frameCount, portalFrames);
}

function held(): GraphBodyDefinition {
  return body("held", 1, [0]);
}

function body(
  kind: GraphBodyDefinition["kind"],
  frameCount: number,
  portalFrames: readonly number[]
): GraphBodyDefinition {
  return {
    unitId: `${kind}-body`,
    kind,
    frameCount,
    ports: [{ id: "handoff", entryFrame: 0, portalFrames }]
  };
}
