import { describe, expect, it } from "vitest";

import {
  planEventIntent,
  planStateIntent,
  type IntentContext
} from "../src/intent-router.js";
import type {
  GraphEdgeDefinition,
  GraphStateDefinition,
  MotionGraphDefinition,
  MotionGraphPhase
} from "../src/model.js";
import type {
  RoutePlanView,
  SequencedEdge
} from "../src/route-plan.js";
import {
  getValidatedGraphIndexes,
  validateMotionGraphDefinition,
  type ValidatedGraphIndexes
} from "../src/validate.js";

const indexes = validatedIndexes();

describe("planStateIntent", () => {
  it("plans standalone no-ops for settled visual-state requests", () => {
    for (const phase of ["preparing", "intro", "stable", "static"] as const) {
      expect(planStateIntent(context(phase), "idle")).toEqual({
        kind: "standalone-noop"
      });
    }
  });

  it("cancels preparation and intro routes selected by requests or events", () => {
    const pending = edge("idle-hover");

    for (const phase of ["preparing", "intro"] as const) {
      expect(
        planStateIntent(
          context(phase, { pending }, true),
          "idle"
        )
      ).toEqual({ kind: "cancel-before-stable" });

      // An event-owned route has no request group but is still older intent.
      expect(
        planStateIntent(
          context(phase, { pending }, false),
          "idle"
        )
      ).toEqual({ kind: "cancel-before-stable" });
    }
  });

  it("replaces valid pending routes before and after readiness", () => {
    for (const phase of ["preparing", "intro", "stable"] as const) {
      expect(planStateIntent(context(phase), "hover")).toEqual({
        kind: "replace-pending",
        edge: edge("idle-hover")
      });
    }

    expect(
      planStateIntent(
        context("waiting", { pending: edge("idle-hover") }),
        "loading"
      )
    ).toEqual({
      kind: "replace-pending",
      edge: edge("idle-loading")
    });
  });

  it("joins, cancels, or rejects a waiting route without ambiguity", () => {
    const waiting = context("waiting", { pending: edge("idle-hover") });

    expect(planStateIntent(waiting, "hover")).toEqual({
      kind: "join-pending"
    });
    expect(planStateIntent(waiting, "idle")).toEqual({
      kind: "cancel-pending"
    });
    expect(planStateIntent(waiting, "success")).toEqual({ kind: "reject" });
  });

  it("commits only direct edges in static mode", () => {
    expect(planStateIntent(context("static"), "error")).toEqual({
      kind: "static-commit",
      edge: edge("idle-error")
    });
    expect(planStateIntent(context("static"), "success")).toEqual({
      kind: "reject"
    });
  });

  it("treats locked and reversible active targets symmetrically", () => {
    const cases = [
      {
        phase: "locked" as const,
        active: edge("idle-loading"),
        target: "loading",
        followOn: edge("loading-success")
      },
      {
        phase: "reversible" as const,
        active: edge("idle-hover"),
        target: "hover",
        followOn: edge("hover-success")
      }
    ];

    for (const { phase, active, target, followOn } of cases) {
      expect(
        planStateIntent(context(phase, { active }), target)
      ).toEqual({ kind: "continue-active-target" });
      expect(
        planStateIntent(context(phase, { active }), "success")
      ).toEqual({ kind: "queue-follow-on", edge: followOn });
    }
  });

  it("queues an authored inverse only for a reversible transition", () => {
    expect(
      planStateIntent(
        context("reversible", { active: edge("idle-hover") }),
        "idle"
      )
    ).toEqual({
      kind: "queue-reversal",
      edge: edge("hover-idle")
    });

    expect(
      planStateIntent(
        context("locked", { active: edge("idle-loading") }),
        "idle"
      )
    ).toEqual({ kind: "reject" });
  });

  it("routes from a queued reversal target and never from an old follow-on", () => {
    const routes = {
      active: edge("idle-hover"),
      reversal: edge("hover-idle"),
      followOn: edge("idle-error")
    };
    const reversing = context("reversible", routes);

    expect(planStateIntent(reversing, "hover")).toEqual({
      kind: "continue-active-target"
    });
    expect(planStateIntent(reversing, "idle")).toEqual({
      kind: "continue-reversal-target"
    });
    expect(planStateIntent(reversing, "error")).toEqual({
      kind: "queue-follow-on",
      edge: edge("idle-error")
    });

    // success is reachable from the old active target, not the effective
    // reversal target, so it is not a valid direct follow-on.
    expect(planStateIntent(reversing, "success")).toEqual({ kind: "reject" });
  });

  it("rejects invalid direct follow-ons in both transition phases", () => {
    expect(
      planStateIntent(
        context("reversible", { active: edge("idle-hover") }),
        "error"
      )
    ).toEqual({ kind: "reject" });
    expect(
      planStateIntent(
        context("locked", { active: edge("idle-loading") }),
        "error"
      )
    ).toEqual({ kind: "reject" });
  });
});

describe("planEventIntent", () => {
  it("replaces valid event routes in stable, preparing, and intro phases", () => {
    for (const phase of ["stable", "preparing", "intro"] as const) {
      expect(planEventIntent(context(phase), "hover.enter")).toEqual({
        kind: "replace-pending",
        edge: edge("idle-hover")
      });
    }
  });

  it("keeps a duplicate preparation or intro event as an accepted no-op", () => {
    for (const phase of ["preparing", "intro"] as const) {
      expect(
        planEventIntent(
          context(phase, { pending: edge("idle-hover") }),
          "hover.enter"
        )
      ).toEqual({ kind: "accept-noop" });
    }
  });

  it("cancels a waiting route through its inverse before visual lookup", () => {
    const waiting = context("waiting", { pending: edge("idle-hover") });

    expect(planEventIntent(waiting, "hover.leave")).toEqual({
      kind: "cancel-pending",
      edge: edge("hover-idle")
    });
    expect(planEventIntent(waiting, "hover.enter")).toEqual({
      kind: "accept-noop"
    });
    expect(planEventIntent(waiting, "load")).toEqual({
      kind: "replace-pending",
      edge: edge("idle-loading")
    });
  });

  it("cancels a preparation or intro route through its inverse event", () => {
    for (const phase of ["preparing", "intro"] as const) {
      expect(
        planEventIntent(
          context(phase, { pending: edge("idle-hover") }),
          "hover.leave"
        )
      ).toEqual({
        kind: "cancel-pending",
        edge: edge("hover-idle")
      });
    }
  });

  it("commits a direct event immediately in static mode", () => {
    expect(planEventIntent(context("static"), "idle.error")).toEqual({
      kind: "static-commit",
      edge: edge("idle-error")
    });
  });

  it("treats locked and reversible event routing symmetrically", () => {
    const cases = [
      {
        phase: "locked" as const,
        active: edge("idle-loading"),
        activeEvent: "load",
        followOn: edge("loading-success"),
        followOnEvent: "loading.success"
      },
      {
        phase: "reversible" as const,
        active: edge("idle-hover"),
        activeEvent: "hover.enter",
        followOn: edge("hover-success"),
        followOnEvent: "hover.success"
      }
    ];

    for (const testCase of cases) {
      const active = context(testCase.phase, { active: testCase.active });
      expect(planEventIntent(active, testCase.activeEvent)).toEqual({
        kind: "accept-noop"
      });
      expect(planEventIntent(active, testCase.followOnEvent)).toEqual({
        kind: "queue-follow-on",
        edge: testCase.followOn
      });

      const queued = context(testCase.phase, {
        active: testCase.active,
        followOn: testCase.followOn
      });
      expect(planEventIntent(queued, testCase.followOnEvent)).toEqual({
        kind: "accept-noop"
      });
      expect(planEventIntent(queued, testCase.activeEvent)).toEqual({
        kind: "continue-active-target",
        edge: testCase.active
      });
    }
  });

  it("queues an inverse event only while the reversible edge is active", () => {
    expect(
      planEventIntent(
        context("reversible", { active: edge("idle-hover") }),
        "hover.leave"
      )
    ).toEqual({
      kind: "queue-reversal",
      edge: edge("hover-idle")
    });

    expect(
      planEventIntent(
        context("locked", { active: edge("idle-loading") }),
        "hover.leave"
      )
    ).toEqual({ kind: "reject" });
  });

  it("uses active and effective targets when reversal and follow-on are queued", () => {
    const reversing = context("reversible", {
      active: edge("idle-hover"),
      reversal: edge("hover-idle"),
      followOn: edge("idle-error")
    });

    // Reiterating the queued inverse is actionable because it cancels the
    // follow-on when the engine applies this plan.
    expect(planEventIntent(reversing, "hover.leave")).toEqual({
      kind: "queue-reversal",
      edge: edge("hover-idle")
    });
    // The active edge's own trigger remains reachable and cancels both queues.
    expect(planEventIntent(reversing, "hover.enter")).toEqual({
      kind: "continue-active-target",
      edge: edge("idle-hover")
    });
    expect(planEventIntent(reversing, "idle.error")).toEqual({
      kind: "accept-noop"
    });

    // Event lookup must not extend from either the old active target or the
    // queued follow-on target, which would create an invalid multi-hop route.
    expect(planEventIntent(reversing, "hover.success")).toEqual({
      kind: "reject"
    });
    expect(planEventIntent(reversing, "error.done")).toEqual({
      kind: "reject"
    });
  });

  it("rejects missing events and returns frozen decision values", () => {
    const rejected = planEventIntent(context("stable"), "missing");

    expect(rejected).toEqual({ kind: "reject" });
    expect(Object.isFrozen(rejected)).toBe(true);
    expect(Object.isFrozen(planStateIntent(context("stable"), "hover"))).toBe(
      true
    );
  });

  it("throws on structurally impossible waiting and active phases", () => {
    expect(() => planEventIntent(context("waiting"), "hover.enter")).toThrow(
      "graph invariant missing waiting pending edge"
    );
    expect(() =>
      planStateIntent(context("reversible"), "hover")
    ).toThrow("graph invariant missing active transition edge");
  });
});

function context(
  phase: Exclude<MotionGraphPhase, "unready" | "disposed" | "error">,
  slots: RouteSlots = {},
  hasPendingRequests = false
): Readonly<IntentContext> {
  return Object.freeze({
    phase,
    visualState: "idle",
    routes: routeView(slots),
    indexes,
    hasPendingRequests
  });
}

interface RouteSlots {
  readonly pending?: Readonly<GraphEdgeDefinition>;
  readonly active?: Readonly<GraphEdgeDefinition>;
  readonly followOn?: Readonly<GraphEdgeDefinition>;
  readonly reversal?: Readonly<GraphEdgeDefinition>;
}

function routeView(slots: RouteSlots): Readonly<RoutePlanView> {
  const pending = sequenced(slots.pending, 1);
  const active = sequenced(slots.active, 2);
  const reversal = sequenced(slots.reversal, 3);
  const followOn = sequenced(slots.followOn, 4);
  return Object.freeze({
    pending,
    active,
    reversal,
    followOn,
    recoveryCandidate: () => followOn ?? reversal ?? active ?? pending,
    prospectiveState: (visualState: string | null) =>
      followOn?.edge.to ??
      reversal?.edge.to ??
      active?.edge.to ??
      pending?.edge.to ??
      visualState,
    hasRoute: () =>
      pending !== null ||
      active !== null ||
      reversal !== null ||
      followOn !== null
  });
}

function sequenced(
  edgeDefinition: Readonly<GraphEdgeDefinition> | undefined,
  sequence: number
): Readonly<SequencedEdge> | null {
  return edgeDefinition === undefined
    ? null
    : Object.freeze({ edge: edgeDefinition, sequence });
}

function edge(id: string): Readonly<GraphEdgeDefinition> {
  const found = indexes.edgesById.get(id);
  if (found === undefined) throw new Error(`missing fixture edge ${id}`);
  return found;
}

function validatedIndexes(): ValidatedGraphIndexes {
  return getValidatedGraphIndexes(validateMotionGraphDefinition(graph()));
}

function graph(): MotionGraphDefinition {
  return {
    initialState: "idle",
    states: [
      state("idle"),
      state("hover"),
      state("loading"),
      state("success"),
      state("error"),
      state("done")
    ],
    edges: [
      reversibleEdge(
        "idle-hover",
        "idle",
        "hover",
        "forward",
        "hover.enter"
      ),
      reversibleEdge(
        "hover-idle",
        "hover",
        "idle",
        "reverse",
        "hover.leave",
        "idle-hover"
      ),
      lockedEdge("idle-loading", "idle", "loading", "load"),
      cutEdge("idle-error", "idle", "error", "idle.error"),
      cutEdge("hover-success", "hover", "success", "hover.success"),
      cutEdge(
        "loading-success",
        "loading",
        "success",
        "loading.success"
      ),
      cutEdge("error-done", "error", "done", "error.done")
    ]
  };
}

function state(id: string): GraphStateDefinition {
  return {
    id,
    body: {
      unitId: `${id}-body`,
      kind: "loop",
      frameCount: 2,
      ports: [
        {
          id: "handoff",
          entryFrame: 0,
          portalFrames: [0, 1]
        }
      ]
    }
  };
}

function reversibleEdge(
  id: string,
  from: string,
  to: string,
  direction: "forward" | "reverse",
  event: string,
  reverseOf?: string
): GraphEdgeDefinition {
  return {
    id,
    from,
    to,
    trigger: { type: "event", name: event },
    start: {
      type: "portal",
      sourcePort: "handoff",
      targetPort: "handoff",
      maxWaitFrames: 1
    },
    transition: {
      kind: "reversible",
      unitId: "hover-motion",
      frameCount: 3,
      direction,
      ...(reverseOf === undefined ? {} : { reverseOf })
    },
    continuity: reverseOf === undefined ? "exact-authored" : "exact-reverse"
  };
}

function lockedEdge(
  id: string,
  from: string,
  to: string,
  event: string
): GraphEdgeDefinition {
  return {
    id,
    from,
    to,
    trigger: { type: "event", name: event },
    start: {
      type: "portal",
      sourcePort: "handoff",
      targetPort: "handoff",
      maxWaitFrames: 1
    },
    transition: {
      kind: "locked",
      unitId: "loading-motion",
      frameCount: 2
    },
    continuity: "exact-authored"
  };
}

function cutEdge(
  id: string,
  from: string,
  to: string,
  event: string
): GraphEdgeDefinition {
  return {
    id,
    from,
    to,
    trigger: { type: "event", name: event },
    start: { type: "cut", targetPort: "handoff", maxWaitFrames: 1 },
    continuity: "cut"
  };
}
