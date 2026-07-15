import { describe, expect, it } from "vitest";

import { MotionGraphValidationError } from "../src/errors.js";
import { GRAPH_LIMITS } from "../src/limits.js";
import type {
  GraphBodyKind,
  GraphEdgeDefinition,
  GraphStateDefinition,
  MotionGraphDefinition,
  ValidatedMotionGraph
} from "../src/model.js";
import {
  getValidatedGraphIndexes,
  validateMotionGraphDefinition
} from "../src/validate.js";

describe("validateMotionGraphDefinition", () => {
  it("returns a detached, recursively frozen definition with WeakMap indexes", () => {
    const input = reversibleGraph();
    const validated = validateMotionGraphDefinition(input);
    const indexes = getValidatedGraphIndexes(validated);

    expect(validated.definition).not.toBe(input);
    expect(validated.definition.states).not.toBe(input.states);
    expect(validated.definition.states[0]).not.toBe(input.states[0]);
    expect(validated.definition.states[0]?.body.ports[0]).not.toBe(
      input.states[0]?.body.ports[0]
    );
    expect(validated.definition.edges[0]).not.toBe(input.edges[0]);
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated.definition)).toBe(true);
    expect(Object.isFrozen(validated.definition.states)).toBe(true);
    expect(Object.isFrozen(validated.definition.states[0]?.body)).toBe(true);
    expect(
      Object.isFrozen(
        validated.definition.states[0]?.body.ports[0]?.portalFrames
      )
    ).toBe(true);
    expect(Object.isFrozen(validated.definition.edges[1]?.transition)).toBe(
      true
    );

    input.states[0] = state("changed", "loop");
    expect(validated.definition.states[0]?.id).toBe("idle");
    expect(indexes.statesById.get("idle")).toBe(
      validated.definition.states[0]
    );
    expect(indexes.edgesById.get("idle-to-hover")).toBe(
      validated.definition.edges[0]
    );
    expect(indexes.portsByState.get("idle")?.get("handoff")?.entryFrame).toBe(
      0
    );
    expect(
      indexes.directEdgesByState.get("idle")?.get("hover")?.id
    ).toBe("idle-to-hover");
    expect(
      indexes.eventEdgesByState.get("hover")?.get("hover.leave")?.id
    ).toBe("hover-to-idle");
    expect(indexes.inverseEdgesById.get("idle-to-hover")?.id).toBe(
      "hover-to-idle"
    );
    expect(indexes.inverseEdgesById.get("hover-to-idle")?.id).toBe(
      "idle-to-hover"
    );
  });

  it("rejects objects that did not cross this validator's trust boundary", () => {
    expect(() =>
      getValidatedGraphIndexes(
        { definition: simpleGraph() } as unknown as ValidatedMotionGraph
      )
    ).toThrow(MotionGraphValidationError);
  });

  it("enforces state and edge count limits", () => {
    const empty = simpleGraph();
    empty.states = [];
    expectInvalid(empty, /states must contain between 1 and 32/);

    const tooManyStates = simpleGraph();
    tooManyStates.states = Array.from(
      { length: GRAPH_LIMITS.maxStates + 1 },
      (_, index) => state(`state-${String(index)}`, "held")
    );
    tooManyStates.initialState = "state-0";
    expectInvalid(tooManyStates, /states must contain between 1 and 32/);

    const tooManyEdges = simpleGraph();
    tooManyEdges.edges = Array.from(
      { length: GRAPH_LIMITS.maxEdges + 1 },
      (_, index) => ({
        id: `edge-${String(index)}`,
        from: "idle",
        to: "hover",
        start: { type: "cut", targetPort: "handoff", maxWaitFrames: 1 },
        continuity: "cut"
      })
    );
    expectInvalid(tooManyEdges, /edges must contain at most 64/);
  });

  it("rejects sparse untrusted arrays with a stable validation error", () => {
    const sparseStates = simpleGraph();
    sparseStates.states = Array(1);
    expectInvalid(sparseStates, /states\[0\] must be an object/);

    const sparseEdges = simpleGraph();
    sparseEdges.edges = Array(1);
    expectInvalid(sparseEdges, /edges\[0\] must be an object/);

    const sparsePorts = simpleGraph();
    sparsePorts.states[0] = {
      ...sparsePorts.states[0]!,
      body: { ...sparsePorts.states[0]!.body, ports: Array(1) }
    };
    expectInvalid(sparsePorts, /states\[0\]\.body\.ports\[0\] must be an object/);
  });

  it("validates IDs, initial ownership, frames, and state-level uniqueness", () => {
    const invalidId = simpleGraph();
    invalidId.states[0] = { ...invalidId.states[0]!, id: "Idle" };
    expectInvalid(invalidId, /must match/);

    const missingInitial = simpleGraph();
    missingInitial.initialState = "missing";
    expectInvalid(missingInitial, /does not reference a state/);

    const duplicateState = simpleGraph();
    duplicateState.states[1] = {
      ...duplicateState.states[1]!,
      id: "idle"
    };
    expectInvalid(duplicateState, /duplicates state ID/);

    const sharedStatic = simpleGraph();
    sharedStatic.states[1] = {
      ...sharedStatic.states[1]!,
    };
    expect(() => validateMotionGraphDefinition(sharedStatic)).not.toThrow();

    const duplicateUnit = simpleGraph();
    duplicateUnit.states[1] = {
      ...duplicateUnit.states[1]!,
      body: { ...duplicateUnit.states[1]!.body, unitId: "idle-body" }
    };
    expectInvalid(duplicateUnit, /duplicates unit ID/);

    const heldLength = simpleGraph();
    heldLength.states[0] = {
      ...heldLength.states[0]!,
      body: { ...heldLength.states[0]!.body, kind: "held", frameCount: 2 }
    };
    expectInvalid(heldLength, /must be 1 for a held body/);

    const nonInitialIntro = simpleGraph();
    nonInitialIntro.states[1] = {
      ...nonInitialIntro.states[1]!,
      initialUnit: { unitId: "wrong-intro", frameCount: 2 }
    };
    expectInvalid(nonInitialIntro, /allowed only on the initial state/);

    const duplicateIntroUnit = simpleGraph();
    duplicateIntroUnit.states[0] = {
      ...duplicateIntroUnit.states[0]!,
      initialUnit: { unitId: "idle-body", frameCount: 2 }
    };
    expectInvalid(duplicateIntroUnit, /duplicates unit ID/);
  });

  it("validates port counts, identities, entry frames, and portal frames", () => {
    const tooMany = simpleGraph();
    tooMany.states[0] = {
      ...tooMany.states[0]!,
      body: {
        ...tooMany.states[0]!.body,
        ports: Array.from(
          { length: GRAPH_LIMITS.maxPortsPerBody + 1 },
          (_, index) => ({
            id: `port-${String(index)}`,
            entryFrame: 0,
            portalFrames: [0]
          })
        )
      }
    };
    expectInvalid(tooMany, /ports must contain at most 16/);

    const duplicate = simpleGraph();
    duplicate.states[0] = {
      ...duplicate.states[0]!,
      body: {
        ...duplicate.states[0]!.body,
        ports: [port(), port()]
      }
    };
    expectInvalid(duplicate, /duplicates port ID/);

    const wrongEntry = simpleGraph();
    wrongEntry.states[0] = {
      ...wrongEntry.states[0]!,
      body: {
        ...wrongEntry.states[0]!.body,
        ports: [{ ...port(), entryFrame: 1 as 0 }]
      }
    };
    expectInvalid(wrongEntry, /entryFrame must be 0/);

    const empty = simpleGraph();
    empty.states[0] = withPortalFrames(empty.states[0]!, []);
    expectInvalid(empty, /must contain at least one frame/);

    const unsorted = simpleGraph();
    unsorted.states[0] = withPortalFrames(unsorted.states[0]!, [2, 1]);
    expectInvalid(unsorted, /sorted and unique/);

    const duplicateFrame = simpleGraph();
    duplicateFrame.states[0] = withPortalFrames(
      duplicateFrame.states[0]!,
      [0, 0]
    );
    expectInvalid(duplicateFrame, /sorted and unique/);

    const outside = simpleGraph();
    outside.states[0] = withPortalFrames(outside.states[0]!, [4]);
    expectInvalid(outside, /must be less than frameCount/);
  });

  it("rejects missing references and ambiguous direct, event, and completion routes", () => {
    const missingSource = simpleGraph();
    missingSource.edges = [cutEdge("missing-source", "missing", "hover")];
    expectInvalid(missingSource, /from does not reference a state/);

    const missingTarget = simpleGraph();
    missingTarget.edges = [cutEdge("missing-target", "idle", "missing")];
    expectInvalid(missingTarget, /to does not reference a state/);

    const self = simpleGraph();
    self.edges = [cutEdge("self", "idle", "idle")];
    expectInvalid(self, /must connect distinct states/);

    const direct = simpleGraph();
    direct.edges = [
      cutEdge("first", "idle", "hover"),
      cutEdge("second", "idle", "hover")
    ];
    expectInvalid(direct, /duplicates direct route/);

    const event = threeStateGraph();
    event.edges = [
      eventCutEdge("first", "idle", "hover", "activate"),
      eventCutEdge("second", "idle", "error", "activate")
    ];
    expectInvalid(event, /duplicates event/);

    const completion = threeStateGraph("finite");
    completion.states[0] = withPortalFrames(completion.states[0]!, [0, 3]);
    completion.edges = [
      completionFinishEdge("first", "idle", "hover", 3),
      completionFinishEdge("second", "idle", "error", 3)
    ];
    expectInvalid(completion, /duplicates completion route/);

    const loopCompletion = simpleGraph();
    loopCompletion.edges = [
      completionFinishEdge("complete", "idle", "hover", 3)
    ];
    expectInvalid(loopCompletion, /completion trigger cannot originate from a loop/);
  });

  it("enforces source and target ports and loop portal wait geometry", () => {
    const missingSourcePort = simpleGraph();
    missingSourcePort.edges = [portalEdge("edge", "idle", "hover", 1)];
    missingSourcePort.edges[0] = {
      ...missingSourcePort.edges[0]!,
      start: {
        type: "portal",
        sourcePort: "missing",
        targetPort: "handoff",
        maxWaitFrames: 1
      }
    };
    expectInvalid(missingSourcePort, /source port .* does not exist/);

    const missingTargetPort = simpleGraph();
    missingTargetPort.edges = [cutEdge("edge", "idle", "hover")];
    missingTargetPort.edges[0] = {
      ...missingTargetPort.edges[0]!,
      start: { type: "cut", targetPort: "missing", maxWaitFrames: 1 }
    };
    expectInvalid(missingTargetPort, /target port .* does not exist/);

    const loopGeometry = simpleGraph();
    loopGeometry.states[0] = withPortalFrames(loopGeometry.states[0]!, [0, 2]);
    loopGeometry.edges = [portalEdge("edge", "idle", "hover", 0)];
    expectInvalid(loopGeometry, /geometric minimum 1/);

    const loopValid = simpleGraph();
    loopValid.states[0] = withPortalFrames(loopValid.states[0]!, [0, 2]);
    loopValid.edges = [portalEdge("edge", "idle", "hover", 1)];
    expect(() => validateMotionGraphDefinition(loopValid)).not.toThrow();
  });

  it("computes loop portal geometry without safe-integer precision loss", () => {
    const graph = simpleGraph();
    graph.states[0] = {
      ...graph.states[0]!,
      body: {
        ...graph.states[0]!.body,
        frameCount: Number.MAX_SAFE_INTEGER,
        ports: [{ id: "handoff", entryFrame: 0, portalFrames: [2] }]
      }
    };
    graph.edges = [
      portalEdge(
        "idle-to-hover",
        "idle",
        "hover",
        Number.MAX_SAFE_INTEGER - 2
      )
    ];
    expectInvalid(graph, /below the geometric minimum 9007199254740990/);
  });

  it("enforces finite portal and finish geometry without wrapping", () => {
    const missingHeldPortal = simpleGraph("finite");
    missingHeldPortal.states[0] = withPortalFrames(
      missingHeldPortal.states[0]!,
      [0, 2]
    );
    missingHeldPortal.edges = [portalEdge("edge", "idle", "hover", 1)];
    expectInvalid(missingHeldPortal, /must include the held final frame/);

    const finiteWait = simpleGraph("finite");
    finiteWait.states[0] = withPortalFrames(finiteWait.states[0]!, [2, 3]);
    finiteWait.edges = [portalEdge("edge", "idle", "hover", 1)];
    expectInvalid(finiteWait, /geometric minimum 2/);

    const finishLoop = simpleGraph();
    finishLoop.edges = [finishEdge("edge", "idle", "hover", 3)];
    expectInvalid(finishLoop, /finish cannot originate from a loop/);

    const finishWait = simpleGraph("finite");
    finishWait.edges = [finishEdge("edge", "idle", "hover", 2)];
    expectInvalid(finishWait, /finish minimum 3/);

    const held = simpleGraph("held");
    held.edges = [finishEdge("edge", "idle", "hover", 0)];
    expect(() => validateMotionGraphDefinition(held)).not.toThrow();
  });

  it("enforces cut and continuity invariants", () => {
    const cutBridge = simpleGraph();
    cutBridge.edges = [
      {
        ...cutEdge("edge", "idle", "hover"),
        transition: { kind: "locked", unitId: "bridge", frameCount: 2 }
      }
    ];
    expectInvalid(cutBridge, /cut cannot own a transition unit/);

    const wrongCutContinuity = simpleGraph();
    wrongCutContinuity.edges = [
      { ...cutEdge("edge", "idle", "hover"), continuity: "exact-authored" }
    ];
    expectInvalid(wrongCutContinuity, /must declare continuity cut/);

    const cutContinuityOnPortal = simpleGraph();
    cutContinuityOnPortal.edges = [
      { ...portalEdge("edge", "idle", "hover", 3), continuity: "cut" }
    ];
    expectInvalid(cutContinuityOnPortal, /requires start policy cut/);

    const wrongCutWait = simpleGraph();
    wrongCutWait.edges = [
      {
        id: "edge",
        from: "idle",
        to: "hover",
        start: {
          type: "cut",
          targetPort: "handoff",
          maxWaitFrames: 2 as 1
        },
        continuity: "cut"
      }
    ];
    expectInvalid(wrongCutWait, /must be 1 for a cut/);
  });

  it("validates complete reversible pairs", () => {
    const unpaired = reversibleGraph();
    unpaired.edges.pop();
    expectInvalid(unpaired, /must be used by exactly two inverse edges/);

    const sameDirection = reversibleGraph();
    sameDirection.edges[1] = replaceReversible(sameDirection.edges[1]!, {
      direction: "forward",
      reverseOf: "idle-to-hover"
    });
    expectInvalid(sameDirection, /must use opposite directions/);

    const wrongEndpoints = threeStateGraph();
    wrongEndpoints.edges = reversibleGraph().edges.map((edge, index) =>
      index === 1 ? { ...edge, from: "error" } : edge
    );
    expectInvalid(wrongEndpoints, /must reverse its endpoints/);

    const wrongCount = reversibleGraph();
    wrongCount.edges[1] = replaceReversible(wrongCount.edges[1]!, {
      frameCount: 4,
      direction: "reverse",
      reverseOf: "idle-to-hover"
    });
    expectInvalid(wrongCount, /must use one frame count/);

    const noDeclaration = reversibleGraph();
    noDeclaration.edges[1] = {
      ...replaceReversible(noDeclaration.edges[1]!, {
        direction: "reverse"
      }),
      continuity: "exact-authored"
    };
    expectInvalid(noDeclaration, /exactly one inverse edge with reverseOf/);

    const twoDeclarations = reversibleGraph();
    twoDeclarations.edges[0] = replaceReversible(twoDeclarations.edges[0]!, {
      direction: "forward",
      reverseOf: "hover-to-idle"
    });
    expectInvalid(twoDeclarations, /exactly one inverse edge with reverseOf/);

    const wrongReference = reversibleGraph();
    wrongReference.edges[1] = replaceReversible(wrongReference.edges[1]!, {
      direction: "reverse",
      reverseOf: "hover-to-idle"
    });
    expectInvalid(wrongReference, /must reference "idle-to-hover"/);

    const wrongContinuity = reversibleGraph();
    wrongContinuity.edges[1] = {
      ...wrongContinuity.edges[1]!,
      continuity: "exact-authored"
    };
    expectInvalid(wrongContinuity, /must declare continuity exact-reverse/);

    const formerlyTooLong = reversibleGraph();
    formerlyTooLong.edges[0] = replaceReversible(formerlyTooLong.edges[0]!, {
      frameCount: 25,
      direction: "forward"
    });
    formerlyTooLong.edges[1] = replaceReversible(formerlyTooLong.edges[1]!, {
      frameCount: 25,
      direction: "reverse",
      reverseOf: "idle-to-hover"
    });
    expect(() => validateMotionGraphDefinition(formerlyTooLong)).not.toThrow();
  });

  it("prevents illegal animation-unit aliases", () => {
    const bodyCollision = reversibleGraph();
    bodyCollision.edges[0] = replaceReversible(bodyCollision.edges[0]!, {
      unitId: "idle-body",
      direction: "forward"
    });
    expectInvalid(bodyCollision, /already used by a body or initial unit/);

    const lockedCollision = threeStateGraph();
    lockedCollision.edges = [
      lockedEdge("first", "idle", "hover", "shared"),
      lockedEdge("second", "hover", "error", "shared")
    ];
    expectInvalid(lockedCollision, /already used by another transition/);

    const mixedCollision = threeStateGraph();
    mixedCollision.edges = [
      lockedEdge("locked", "idle", "error", "shared"),
      reversibleEdge(
        "forward",
        "idle",
        "hover",
        "forward",
        "shared"
      ),
      reversibleEdge(
        "reverse",
        "hover",
        "idle",
        "reverse",
        "shared",
        "forward"
      )
    ];
    expectInvalid(mixedCollision, /already used by a locked transition/);
  });

  it("rejects immediate transitionless completion cycles between held states", () => {
    const graph = simpleGraph("held");
    graph.states[1] = state("hover", "held");
    graph.edges = [
      completionFinishEdge("idle-complete", "idle", "hover", 0),
      completionFinishEdge("hover-complete", "hover", "idle", 0)
    ];
    expectInvalid(graph, /immediate cycle/);
  });

  it("rejects immediate completion cycles between one-frame finite states", () => {
    const graph = simpleGraph("finite");
    graph.states = ["idle", "hover"].map((id) => ({
      ...state(id, "finite"),
      body: {
        ...state(id, "finite").body,
        frameCount: 1,
        ports: [{ id: "handoff", entryFrame: 0, portalFrames: [0] }]
      }
    }));
    graph.edges = [
      completionFinishEdge("idle-complete", "idle", "hover", 0),
      completionFinishEdge("hover-complete", "hover", "idle", 0)
    ];
    expectInvalid(graph, /immediate cycle/);
  });

  it("indexes one valid completion edge per finite source", () => {
    const graph = simpleGraph("finite");
    graph.edges = [
      completionFinishEdge("idle-complete", "idle", "hover", 3)
    ];
    const validated = validateMotionGraphDefinition(graph);
    expect(
      getValidatedGraphIndexes(validated).completionEdgesByState.get("idle")?.id
    ).toBe("idle-complete");
  });
});

function simpleGraph(
  initialKind: GraphBodyKind = "loop"
): {
  initialState: string;
  states: GraphStateDefinition[];
  edges: GraphEdgeDefinition[];
} {
  return {
    initialState: "idle",
    states: [state("idle", initialKind), state("hover", "loop")],
    edges: []
  };
}

function threeStateGraph(
  initialKind: GraphBodyKind = "loop"
): ReturnType<typeof simpleGraph> {
  const graph = simpleGraph(initialKind);
  graph.states.push(state("error", "held"));
  return graph;
}

function reversibleGraph(): ReturnType<typeof simpleGraph> {
  const graph = simpleGraph();
  graph.edges = [
    {
      ...portalEdge("idle-to-hover", "idle", "hover", 1),
      trigger: { type: "event", name: "hover.enter" },
      transition: {
        kind: "reversible",
        unitId: "hover-clip",
        frameCount: 3,
        direction: "forward"
      }
    },
    {
      ...portalEdge("hover-to-idle", "hover", "idle", 1),
      trigger: { type: "event", name: "hover.leave" },
      transition: {
        kind: "reversible",
        unitId: "hover-clip",
        frameCount: 3,
        direction: "reverse",
        reverseOf: "idle-to-hover"
      },
      continuity: "exact-reverse"
    }
  ];
  return graph;
}

function state(id: string, kind: GraphBodyKind): GraphStateDefinition {
  const frameCount = kind === "held" ? 1 : 4;
  return {
    id,
    body: {
      unitId: `${id}-body`,
      kind,
      frameCount,
      ports: [
        {
          id: "handoff",
          entryFrame: 0,
          portalFrames:
            kind === "loop"
              ? [0, 2]
              : kind === "finite"
                ? [0, frameCount - 1]
                : [0]
        }
      ]
    }
  };
}

function port(): GraphStateDefinition["body"]["ports"][number] {
  return { id: "handoff", entryFrame: 0, portalFrames: [0] };
}

function withPortalFrames(
  current: GraphStateDefinition,
  portalFrames: readonly number[]
): GraphStateDefinition {
  return {
    ...current,
    body: {
      ...current.body,
      ports: [{ ...current.body.ports[0]!, portalFrames }]
    }
  };
}

function portalEdge(
  id: string,
  from: string,
  to: string,
  maxWaitFrames: number
): GraphEdgeDefinition {
  return {
    id,
    from,
    to,
    start: {
      type: "portal",
      sourcePort: "handoff",
      targetPort: "handoff",
      maxWaitFrames
    },
    continuity: "exact-authored"
  };
}

function finishEdge(
  id: string,
  from: string,
  to: string,
  maxWaitFrames: number
): GraphEdgeDefinition {
  return {
    id,
    from,
    to,
    start: { type: "finish", targetPort: "handoff", maxWaitFrames },
    continuity: "exact-authored"
  };
}

function cutEdge(
  id: string,
  from: string,
  to: string
): GraphEdgeDefinition {
  return {
    id,
    from,
    to,
    start: { type: "cut", targetPort: "handoff", maxWaitFrames: 1 },
    continuity: "cut"
  };
}

function eventCutEdge(
  id: string,
  from: string,
  to: string,
  name: string
): GraphEdgeDefinition {
  return { ...cutEdge(id, from, to), trigger: { type: "event", name } };
}

function completionFinishEdge(
  id: string,
  from: string,
  to: string,
  maxWaitFrames: number
): GraphEdgeDefinition {
  return {
    ...finishEdge(id, from, to, maxWaitFrames),
    trigger: { type: "completion" }
  };
}

function lockedEdge(
  id: string,
  from: string,
  to: string,
  unitId: string
): GraphEdgeDefinition {
  return {
    ...portalEdge(id, from, to, 1),
    transition: { kind: "locked", unitId, frameCount: 2 }
  };
}

function reversibleEdge(
  id: string,
  from: string,
  to: string,
  direction: "forward" | "reverse",
  unitId: string,
  reverseOf?: string
): GraphEdgeDefinition {
  const transition =
    reverseOf === undefined
      ? { kind: "reversible" as const, unitId, frameCount: 3, direction }
      : {
          kind: "reversible" as const,
          unitId,
          frameCount: 3,
          direction,
          reverseOf
        };
  return {
    ...portalEdge(id, from, to, 1),
    transition,
    continuity: reverseOf === undefined ? "exact-authored" : "exact-reverse"
  };
}

function replaceReversible(
  edge: GraphEdgeDefinition,
  replacement: {
    readonly unitId?: string;
    readonly frameCount?: number;
    readonly direction: "forward" | "reverse";
    readonly reverseOf?: string;
  }
): GraphEdgeDefinition {
  const current = edge.transition;
  if (current?.kind !== "reversible") {
    throw new Error("test fixture edge is not reversible");
  }
  const unitId = replacement.unitId ?? current.unitId;
  const frameCount = replacement.frameCount ?? current.frameCount;
  const transition =
    replacement.reverseOf === undefined
      ? {
          kind: "reversible" as const,
          unitId,
          frameCount,
          direction: replacement.direction
        }
      : {
          kind: "reversible" as const,
          unitId,
          frameCount,
          direction: replacement.direction,
          reverseOf: replacement.reverseOf
        };
  return { ...edge, transition };
}

function expectInvalid(
  graph: MotionGraphDefinition,
  message: RegExp
): void {
  expect(() => validateMotionGraphDefinition(graph)).toThrowError(message);
}
