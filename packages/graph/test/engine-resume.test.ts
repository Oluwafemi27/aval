import { describe, expect, it } from "vitest";

import { MotionGraphEngine } from "../src/engine.js";
import type {
  GraphBodyKind,
  MotionGraphDefinition
} from "../src/model.js";

describe("MotionGraphEngine animated reentry", () => {
  it("resumes the initial state at body zero without replaying its intro", () => {
    const engine = new MotionGraphEngine();
    engine.install(graph("loop", 2));
    const reduced = engine.beginStatic("reduced-motion");

    const resumed = engine.resumeAnimated();

    expect(resumed).toEqual({
      operation: "resume-animated",
      presentation: bodyFrame("idle", 0),
      effects: [readiness("static", "animated")],
      snapshot: {
        ...reduced.snapshot,
        readiness: "animated",
        phase: "stable",
        presentation: bodyFrame("idle", 0)
      }
    });
  });

  it.each<GraphBodyKind>(["loop", "finite", "held"])(
    "resumes a noninitial %s state at body frame zero",
    (bodyKind) => {
      const engine = new MotionGraphEngine();
      engine.install(graph(bodyKind));
      engine.request("hover");
      const reduced = engine.beginStatic("reduced-motion");
      expect(reduced.snapshot).toMatchObject({
        requestedState: "hover",
        visualState: "hover",
        pendingRequestCount: 0,
        pendingEdgeId: null,
        activeEdgeId: null,
        followOnEdgeId: null
      });

      const resumed = engine.resumeAnimated();

      expect(resumed.operation).toBe("resume-animated");
      expect(resumed.presentation).toEqual(bodyFrame("hover", 0));
      expect(resumed.effects).toEqual([readiness("static", "animated")]);
      expect(resumed.snapshot).toMatchObject({
        readiness: "animated",
        phase: "stable",
        requestedState: "hover",
        visualState: "hover",
        prospectiveState: "hover",
        isTransitioning: false,
        pendingRequestCount: 0,
        inputSequence: 1,
        inputsSinceTick: 1,
        contentOrdinal: null
      });
    }
  );

  it("rejects resume outside static phase without mutating state", () => {
    const unready = new MotionGraphEngine();
    expect(() => unready.resumeAnimated()).toThrow(/requires graph metadata/);

    const engine = new MotionGraphEngine();
    engine.install(graph("loop"));
    const preparing = engine.snapshot();
    const preparingTrace = engine.getTrace();
    expect(() => engine.resumeAnimated()).toThrow(/requires phase static/);
    expect(engine.snapshot()).toEqual(preparing);
    expect(engine.getTrace()).toEqual(preparingTrace);

    engine.beginStatic("reduced-motion");
    engine.resumeAnimated();
    const animated = engine.snapshot();
    const animatedTrace = engine.getTrace();
    expect(() => engine.resumeAnimated()).toThrow(/requires phase static/);
    expect(engine.snapshot()).toEqual(animated);
    expect(engine.getTrace()).toEqual(animatedTrace);
  });
});

function graph(
  hoverKind: GraphBodyKind,
  introFrames?: number
): MotionGraphDefinition {
  const hoverFrames = hoverKind === "held" ? 1 : 4;
  return {
    initialState: "idle",
    states: [{
      id: "idle",
      staticFrameId: "idle-static",
      body: {
        unitId: "idle-body",
        kind: "loop",
        frameCount: 4,
        ports: [{ id: "handoff", entryFrame: 0, portalFrames: [0, 2] }]
      },
      ...(introFrames === undefined
        ? {}
        : { initialUnit: { unitId: "idle-intro", frameCount: introFrames } })
    }, {
      id: "hover",
      staticFrameId: "hover-static",
      body: {
        unitId: "hover-body",
        kind: hoverKind,
        frameCount: hoverFrames,
        ports: [{
          id: "handoff",
          entryFrame: 0,
          portalFrames: hoverKind === "held" ? [0] : [0, hoverFrames - 1]
        }]
      }
    }],
    edges: [{
      id: "idle-to-hover",
      from: "idle",
      to: "hover",
      start: { type: "cut", targetPort: "handoff", maxWaitFrames: 1 },
      continuity: "cut"
    }]
  };
}

function bodyFrame(state: "idle" | "hover", frameIndex: number) {
  return {
    kind: "body",
    state,
    unitId: `${state}-body`,
    frameIndex
  } as const;
}

function readiness(from: string, to: string) {
  return { type: "readinesschange", from, to };
}
