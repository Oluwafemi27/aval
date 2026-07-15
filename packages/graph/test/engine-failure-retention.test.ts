import { describe, expect, it } from "vitest";

import { MotionGraphEngine } from "../src/engine.js";

describe("MotionGraphEngine failed presentation retention", () => {
  it("restores the host's last drawn state when a committed cut cannot recover", () => {
    const engine = new MotionGraphEngine();
    engine.install({
      initialState: "idle",
      states: [state("idle"), state("hover")],
      edges: [{
        id: "idle-hover",
        from: "idle",
        to: "hover",
        start: { type: "cut", targetPort: "default", maxWaitFrames: 1 },
        continuity: "cut"
      }]
    });
    engine.beginAnimated();
    engine.request("hover");
    const committed = engine.tick({ contentOrdinal: 0n });
    expect(committed.snapshot.visualState).toBe("hover");

    const failed = engine.failStatic("recovery failed", {
      retainedVisualState: "idle"
    });
    expect(failed).toMatchObject({
      presentation: {
        kind: "static",
        state: "idle"
      },
      snapshot: {
        readiness: "error",
        phase: "error",
        requestedState: "hover",
        visualState: "idle",
        isTransitioning: false
      }
    });
    const failedSnapshot = engine.snapshot();
    const failedTrace = engine.getTrace();
    expect(() => engine.resumeAnimated()).toThrowError(/requires phase static/);
    expect(engine.snapshot()).toEqual(failedSnapshot);
    expect(engine.getTrace()).toEqual(failedTrace);
    expect(() => engine.failStatic("again", {
      retainedVisualState: "missing"
    })).toThrow("retained visual state");
  });

  it("recovers from the pixels actually retained after a superseded failed cut", () => {
    const engine = new MotionGraphEngine();
    engine.install({
      initialState: "idle",
      states: [state("idle"), state("hover")],
      edges: [
        cut("idle-hover", "idle", "hover"),
        cut("hover-idle", "hover", "idle")
      ]
    });
    engine.beginAnimated();
    engine.request("hover");
    engine.tick({ contentOrdinal: 0n });
    const latest = engine.request("idle");
    expect(latest.accepted).toBe(true);

    const recovered = engine.recoverStatic("animation-failure", {
      retainedVisualState: "idle"
    });

    expect(recovered.presentation).toMatchObject({
      kind: "static",
      state: "idle"
    });
    expect(recovered.snapshot).toMatchObject({
      readiness: "static",
      requestedState: "idle",
      visualState: "idle",
      isTransitioning: false
    });
    expect(recovered.effects.map(({ type }) => type)).toEqual([
      "readinesschange",
      "fallback",
      "settle"
    ]);

    const resumed = engine.resumeAnimated();
    expect(resumed).toMatchObject({
      operation: "resume-animated",
      presentation: {
        kind: "body",
        state: "idle",
        unitId: "idle-body",
        frameIndex: 0
      },
      snapshot: {
        readiness: "animated",
        phase: "stable",
        requestedState: "idle",
        visualState: "idle",
        contentOrdinal: recovered.snapshot.contentOrdinal,
        inputSequence: recovered.snapshot.inputSequence,
        inputsSinceTick: recovered.snapshot.inputsSinceTick
      }
    });
    expect(resumed.effects).toEqual([{
      type: "readinesschange",
      from: "static",
      to: "animated"
    }]);
  });

  it("does not resume or clear a disposed terminal graph", () => {
    const engine = new MotionGraphEngine();
    engine.install({
      initialState: "idle",
      states: [state("idle")],
      edges: []
    });
    engine.beginStatic("reduced-motion");
    engine.dispose();
    const snapshot = engine.snapshot();
    const trace = engine.getTrace();

    expect(() => engine.resumeAnimated()).toThrowError(/requires phase static/);
    expect(engine.snapshot()).toEqual(snapshot);
    expect(engine.getTrace()).toEqual(trace);
  });
});

function cut(id: string, from: string, to: string) {
  return {
    id,
    from,
    to,
    start: {
      type: "cut" as const,
      targetPort: "default",
      maxWaitFrames: 1 as const
    },
    continuity: "cut" as const
  };
}

function state(id: string) {
  return {
    id,
    body: {
      unitId: `${id}-body`,
      kind: "loop" as const,
      frameCount: 2,
      ports: [{ id: "default", entryFrame: 0 as const, portalFrames: [0, 1] }]
    }
  };
}
