import { describe, expect, it } from "vitest";

import { MotionGraphEngine } from "../src/engine.js";
import type { MotionGraphDefinition } from "../src/model.js";

describe("MotionGraphEngine smoke", () => {
  it("presents a portal bridge and commits only at target body zero", () => {
    const engine = preparedHoverEngine();
    const requested = engine.request("hovered");
    expect(requested.effects.map(({ type }) => type)).toEqual([
      "requestedstatechange"
    ]);

    expect(show(engine.tick({ contentOrdinal: 0n }))).toBe("body:idle:1");
    expect(show(engine.tick({ contentOrdinal: 1n }))).toBe("body:idle:2");
    expect(show(engine.tick({ contentOrdinal: 2n }))).toBe(
      "reversible:idle-to-hover:0:forward"
    );
    expect(show(engine.tick({ contentOrdinal: 3n }))).toBe(
      "reversible:idle-to-hover:1:forward"
    );
    expect(show(engine.tick({ contentOrdinal: 4n }))).toBe(
      "reversible:idle-to-hover:2:forward"
    );
    expect(show(engine.tick({ contentOrdinal: 5n }))).toBe(
      "reversible:idle-to-hover:3:forward"
    );
    const committed = engine.tick({ contentOrdinal: 6n });
    expect(show(committed)).toBe("body:hovered:0");
    expect(committed.snapshot).toMatchObject({
      phase: "stable",
      requestedState: "hovered",
      visualState: "hovered",
      isTransitioning: false
    });
    expect(committed.effects.map(({ type }) => type)).toEqual([
      "visualstatechange",
      "transitionend",
      "settle"
    ]);
  });

  it("reverses to the adjacent cached frame on the next tick", () => {
    const engine = preparedHoverEngine();
    engine.request("hovered");
    engine.tick({ contentOrdinal: 0n });
    engine.tick({ contentOrdinal: 1n });
    engine.tick({ contentOrdinal: 2n });
    engine.tick({ contentOrdinal: 3n });

    const inverse = engine.request("idle");
    expect(inverse.snapshot).toMatchObject({
      requestedState: "idle",
      visualState: "idle",
      isTransitioning: true
    });
    expect(inverse.effects.map(({ type }) => type)).toEqual([
      "requestedstatechange",
      "settle"
    ]);

    const adjacent = engine.tick({ contentOrdinal: 4n });
    expect(show(adjacent)).toBe("reversible:hover-to-idle:0:reverse");
    expect(adjacent.effects.map(({ type }) => type)).toEqual([
      "transitionstart"
    ]);
    const returned = engine.tick({ contentOrdinal: 5n });
    expect(show(returned)).toBe("body:idle:0");
    expect(returned.effects.map(({ type }) => type)).toEqual([
      "transitionend",
      "settle"
    ]);
  });
});

function preparedHoverEngine(): MotionGraphEngine {
  const engine = new MotionGraphEngine();
  engine.install(hoverGraph());
  engine.beginAnimated();
  return engine;
}

function hoverGraph(): MotionGraphDefinition {
  return {
    initialState: "idle",
    states: [
      {
        id: "idle",
        body: {
          unitId: "idle-body",
          kind: "loop",
          frameCount: 4,
          ports: [{ id: "neutral", entryFrame: 0, portalFrames: [2] }]
        }
      },
      {
        id: "hovered",
        body: {
          unitId: "hover-body",
          kind: "loop",
          frameCount: 3,
          ports: [{ id: "neutral", entryFrame: 0, portalFrames: [1] }]
        }
      }
    ],
    edges: [
      {
        id: "idle-to-hover",
        from: "idle",
        to: "hovered",
        trigger: { type: "event", name: "hover.enter" },
        start: {
          type: "portal",
          sourcePort: "neutral",
          targetPort: "neutral",
          maxWaitFrames: 3
        },
        transition: {
          kind: "reversible",
          unitId: "hover-clip",
          frameCount: 4,
          direction: "forward"
        },
        continuity: "exact-authored"
      },
      {
        id: "hover-to-idle",
        from: "hovered",
        to: "idle",
        trigger: { type: "event", name: "hover.leave" },
        start: {
          type: "portal",
          sourcePort: "neutral",
          targetPort: "neutral",
          maxWaitFrames: 2
        },
        transition: {
          kind: "reversible",
          unitId: "hover-clip",
          frameCount: 4,
          direction: "reverse",
          reverseOf: "idle-to-hover"
        },
        continuity: "exact-reverse"
      }
    ]
  };
}

function show(result: ReturnType<MotionGraphEngine["tick"]>): string {
  const presentation = result.presentation;
  if (presentation === null) return "none";
  if (presentation.kind === "body") {
    return `body:${presentation.state}:${String(presentation.frameIndex)}`;
  }
  if (presentation.kind === "reversible") {
    return `reversible:${presentation.edgeId}:${String(presentation.frameIndex)}:${presentation.direction}`;
  }
  return presentation.kind;
}
