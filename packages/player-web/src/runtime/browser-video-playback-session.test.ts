import type {
  GraphEdgeDefinition,
  GraphPresentation
} from "@pixel-point/aval-graph";
import { describe, expect, it } from "vitest";

import type { CutResidentHandoff } from "./cut-presentation-coordinator.js";
import {
  handoffBrowserVisibleEndpointToInverse
} from "./browser-video-playback-session.js";
import type { BrowserNormalReady } from "./browser-playback-types.js";

describe("browser visible-endpoint inverse handoff", () => {
  it("materializes the resident inverse before releasing endpoint ownership", () => {
    const calls: string[] = [];
    const ready = inverseReady();
    const checkpoint = endpointCheckpoint();
    let inversePrepared = false;
    const resident = {
      visibleEndpoint: true,
      canEnterReversible(
        candidate: Readonly<GraphEdgeDefinition>,
        presentation: BodyPresentation
      ): boolean {
        calls.push("check-eligibility");
        expect(candidate).toBe(INVERSE_EDGE);
        expect(presentation).toBe(ENGAGED_BODY_ZERO);
        return true;
      },
      reversibleEntryReady(
        candidate: Readonly<GraphEdgeDefinition>,
        generation: number,
        ordinal: bigint
      ): Readonly<BrowserNormalReady> {
        calls.push("prepare-inverse");
        expect(candidate).toBe(INVERSE_EDGE);
        expect(generation).toBe(3);
        expect(ordinal).toBe(8n);
        inversePrepared = true;
        return ready;
      },
      takeResidentHandoff(): Readonly<CutResidentHandoff> {
        calls.push("take-checkpoint");
        return checkpoint;
      },
      retireCutAndSupersede(): boolean {
        calls.push("retire-endpoint");
        expect(inversePrepared).toBe(true);
        return true;
      }
    };

    const handoff = handoffBrowserVisibleEndpointToInverse({
      resident,
      edge: INVERSE_EDGE,
      presentation: ENGAGED_BODY_ZERO,
      generation: 3,
      ordinal: 8n
    });

    expect(calls).toEqual([
      "check-eligibility",
      "prepare-inverse",
      "take-checkpoint",
      "retire-endpoint"
    ]);
    expect(handoff).toEqual({ ready, checkpoint });
    if (handoff === null) throw new Error("eligible inverse was not handed off");
    expect(handoff.ready).toMatchObject({
      routeReady: true,
      media: {
        graphKind: "reversible",
        edge: "engaged.idle",
        drawSource: "resident",
        intendedPresentationOrdinal: 8n
      }
    });
  });

  it("keeps endpoint ownership until the authored portal is eligible", () => {
    const calls: string[] = [];
    const resident = {
      visibleEndpoint: true,
      canEnterReversible(
        candidate: Readonly<GraphEdgeDefinition>,
        presentation: BodyPresentation
      ): boolean {
        calls.push("check-eligibility");
        expect(candidate).toBe(INVERSE_EDGE);
        expect(presentation).toBe(ENGAGED_BODY_FOUR);
        return false;
      },
      reversibleEntryReady(): Readonly<BrowserNormalReady> {
        calls.push("prepare-inverse");
        return inverseReady();
      },
      takeResidentHandoff(): Readonly<CutResidentHandoff> {
        calls.push("take-checkpoint");
        return endpointCheckpoint();
      },
      retireCutAndSupersede(): boolean {
        calls.push("retire-endpoint");
        return true;
      }
    };

    const handoff = handoffBrowserVisibleEndpointToInverse({
      resident,
      edge: INVERSE_EDGE,
      presentation: ENGAGED_BODY_FOUR,
      generation: 3,
      ordinal: 8n
    });

    expect(handoff).toBeNull();
    expect(calls).toEqual(["check-eligibility"]);
  });
});

type BodyPresentation = Extract<
  GraphPresentation,
  { readonly kind: "body" }
>;

const ENGAGED_BODY_ZERO: BodyPresentation = Object.freeze({
  kind: "body",
  state: "engaged",
  unitId: "engaged.body",
  frameIndex: 0
});

const ENGAGED_BODY_FOUR: BodyPresentation = Object.freeze({
  ...ENGAGED_BODY_ZERO,
  frameIndex: 4
});

const INVERSE_EDGE: Readonly<GraphEdgeDefinition> = Object.freeze({
  id: "engaged.idle",
  from: "engaged",
  to: "idle",
  start: Object.freeze({
    type: "portal" as const,
    sourcePort: "default",
    targetPort: "default",
    maxWaitFrames: 1
  }),
  transition: Object.freeze({
    kind: "reversible" as const,
    unitId: "engage.shift",
    frameCount: 6,
    direction: "reverse" as const,
    reverseOf: "idle.engaged"
  }),
  continuity: "exact-reverse" as const
});

function inverseReady(): Readonly<BrowserNormalReady> {
  return Object.freeze({
    media: Object.freeze({
      kind: "frame" as const,
      graphKind: "reversible" as const,
      state: null,
      edge: INVERSE_EDGE.id,
      path: `reversible:${INVERSE_EDGE.id}`,
      frame: Object.freeze({
        rendition: "motion.1x",
        unit: "engage.shift",
        localFrame: 5
      }),
      drawSource: "resident" as const,
      generation: 3,
      unitInstance: 0,
      decodeOrdinal: 5,
      timestamp: 5,
      intendedPresentationOrdinal: 8n
    }),
    handle: Object.freeze({
      kind: "resident" as const,
      layer: 5,
      resourceGeneration: 1
    }),
    routeReady: true,
    purpose: "source" as const,
    schedulerReservation: false,
    heldPresentation: false,
    scheduler: null
  });
}

function endpointCheckpoint(): Readonly<CutResidentHandoff> {
  return Object.freeze({
    media: Object.freeze({
      kind: "frame" as const,
      graphKind: "body" as const,
      state: "engaged",
      edge: "idle.engaged",
      path: "endpoint:idle.engaged",
      frame: Object.freeze({
        rendition: "motion.1x",
        unit: "engaged.body",
        localFrame: 0
      }),
      drawSource: "resident" as const,
      generation: 3,
      unitInstance: 0,
      decodeOrdinal: 0,
      timestamp: 0,
      intendedPresentationOrdinal: 7n
    }),
    handle: Object.freeze({
      kind: "resident" as const,
      layer: 6,
      resourceGeneration: 1
    })
  });
}
