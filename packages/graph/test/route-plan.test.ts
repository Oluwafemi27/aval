import { describe, expect, it } from "vitest";

import type { GraphEdgeDefinition } from "../src/model.js";
import {
  RoutePlan,
  type RoutePlanView
} from "../src/route-plan.js";

describe("RoutePlan", () => {
  it("keeps a pending edge and sequence in one frozen value", () => {
    const plan = new RoutePlan();

    const pending = plan.replacePending(EDGE_AB, 17);

    expect(pending).toEqual({ edge: EDGE_AB, sequence: 17 });
    expect(plan.pending).toBe(pending);
    expect(Object.isFrozen(pending)).toBe(true);
    expect(plan.prospectiveState("a")).toBe("b");
    expect(plan.hasRoute()).toBe(true);
  });

  it("cancels a pending route without changing its returned value", () => {
    const plan = new RoutePlan();
    const pending = plan.replacePending(EDGE_AB, 2);

    expect(plan.cancelPending()).toBe(pending);
    expect(plan.cancelPending()).toBeNull();
    expect(plan.prospectiveState("a")).toBe("a");
    expect(plan.hasRoute()).toBe(false);
  });

  it("activates a matching pending route without rebuilding its atomic ref", () => {
    const plan = new RoutePlan();
    const pending = plan.replacePending(EDGE_AB, 3);

    const active = plan.activate(EDGE_AB, 3);

    expect(active).toBe(pending);
    expect(plan.pending).toBeNull();
    expect(plan.active).toBe(active);
    expect(plan.recoveryCandidate()).toBe(active);
  });

  it("activates a completion route directly when no edge was pending", () => {
    const plan = new RoutePlan();

    const active = plan.activate(EDGE_AB, 4);

    expect(active).toEqual({ edge: EDGE_AB, sequence: 4 });
    expect(plan.active).toBe(active);
    expect(plan.pending).toBeNull();
  });

  it("queues one follow-on from the effective active target", () => {
    const plan = activePlan();

    const first = plan.queueFollowOn(EDGE_BC, 5);
    const replacement = plan.queueFollowOn(EDGE_BD, 6);

    expect(first).not.toBe(replacement);
    expect(plan.followOn).toBe(replacement);
    expect(plan.prospectiveState("a")).toBe("d");
    expect(plan.clearFollowOn()).toBe(replacement);
    expect(plan.followOn).toBeNull();
  });

  it("queues a reversal atomically and discards an older follow-on", () => {
    const plan = activePlan();
    plan.queueFollowOn(EDGE_BC, 5);

    const reversal = plan.queueReversal(EDGE_BA, 6);

    expect(plan.followOn).toBeNull();
    expect(plan.reversal).toBe(reversal);
    expect(plan.prospectiveState("a")).toBe("a");
    expect(plan.recoveryCandidate()).toBe(reversal);
  });

  it("allows a continuation after a queued reversal and preserves it on activation", () => {
    const plan = activePlan();
    const reversal = plan.queueReversal(EDGE_BA, 7);
    const followOn = plan.queueFollowOn(EDGE_AC, 8);

    expect(plan.prospectiveState("a")).toBe("c");
    expect(plan.recoveryCandidate()).toBe(followOn);

    expect(plan.activateReversal()).toBe(reversal);
    expect(plan.active).toBe(reversal);
    expect(plan.reversal).toBeNull();
    expect(plan.followOn).toBe(followOn);
  });

  it("promotes a follow-on to pending when the active edge completes", () => {
    const plan = activePlan();
    const followOn = plan.queueFollowOn(EDGE_BC, 9);

    const completion = plan.completeActive();

    expect(Object.isFrozen(completion)).toBe(true);
    expect(completion.completed).toEqual({ edge: EDGE_AB, sequence: 1 });
    expect(completion.promoted).toBe(followOn);
    expect(plan.active).toBeNull();
    expect(plan.followOn).toBeNull();
    expect(plan.pending).toBe(followOn);
  });

  it("clears a queued reversal when an active edge completes", () => {
    const plan = activePlan();
    plan.queueReversal(EDGE_BA, 10);

    const completion = plan.completeActive();

    expect(completion.promoted).toBeNull();
    expect(plan.active).toBeNull();
    expect(plan.reversal).toBeNull();
    expect(plan.hasRoute()).toBe(false);
  });

  it("uses follow-on, reversal, active, and pending recovery priority", () => {
    const plan = activePlan();
    const active = plan.active;
    const reversal = plan.queueReversal(EDGE_BA, 11);
    const followOn = plan.queueFollowOn(EDGE_AC, 12);

    expect(plan.recoveryCandidate()).toBe(followOn);
    plan.clearFollowOn();
    expect(plan.recoveryCandidate()).toBe(reversal);
    plan.clearReversal();
    expect(plan.recoveryCandidate()).toBe(active);
    plan.completeActive();
    expect(plan.recoveryCandidate()).toBeNull();

    const pending = plan.replacePending(EDGE_AB, 13);
    expect(plan.recoveryCandidate()).toBe(pending);
  });

  it("exposes structural read-only slots to pure route consumers", () => {
    const plan = activePlan();
    const view: RoutePlanView = plan;

    expect(readIntent(view, "a")).toEqual({
      prospective: "b",
      recoveryEdgeId: "a-to-b"
    });
  });

  it("clears every slot without retaining stale sequences", () => {
    const plan = activePlan();
    plan.queueReversal(EDGE_BA, 14);
    plan.queueFollowOn(EDGE_AC, 15);

    plan.clear();

    expect(plan).toMatchObject({
      pending: null,
      active: null,
      followOn: null,
      reversal: null
    });
    expect(plan.hasRoute()).toBe(false);
    expect(plan.prospectiveState(null)).toBeNull();
  });

  it("rejects cross-slot topology mistakes", () => {
    const pending = new RoutePlan();
    pending.replacePending(EDGE_AB, 1);
    expect(() => pending.activate(EDGE_AB, 2)).toThrow(
      "activated route does not match the pending route"
    );

    const active = activePlan();
    expect(() => active.replacePending(EDGE_AB, 2)).toThrow(
      "active route must complete"
    );
    expect(() => active.queueFollowOn(EDGE_AC, 2)).toThrow(
      "follow-on source must match"
    );
    expect(() => active.queueReversal(EDGE_CA, 2)).toThrow(
      "reversal must invert"
    );
  });

  it("rejects missing slots and invalid route sequences", () => {
    const plan = new RoutePlan();

    expect(() => plan.activateReversal()).toThrow("no active route");
    expect(() => plan.completeActive()).toThrow("no active route");
    expect(() => plan.replacePending(EDGE_AB, -1)).toThrow(RangeError);
    expect(() => plan.replacePending(EDGE_AB, Number.MAX_VALUE)).toThrow(
      RangeError
    );
  });
});

function activePlan(): RoutePlan {
  const plan = new RoutePlan();
  plan.activate(EDGE_AB, 1);
  return plan;
}

function readIntent(view: RoutePlanView, visualState: string) {
  return {
    prospective: view.prospectiveState(visualState),
    recoveryEdgeId: view.recoveryCandidate()?.edge.id ?? null
  };
}

function edge(
  id: string,
  from: string,
  to: string
): Readonly<GraphEdgeDefinition> {
  return Object.freeze({
    id,
    from,
    to,
    start: Object.freeze({
      type: "cut" as const,
      targetPort: "entry",
      maxWaitFrames: 1 as const
    }),
    continuity: "cut" as const
  });
}

const EDGE_AB = edge("a-to-b", "a", "b");
const EDGE_BA = edge("b-to-a", "b", "a");
const EDGE_BC = edge("b-to-c", "b", "c");
const EDGE_BD = edge("b-to-d", "b", "d");
const EDGE_AC = edge("a-to-c", "a", "c");
const EDGE_CA = edge("c-to-a", "c", "a");
