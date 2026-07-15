import {
  validateMotionGraphDefinition,
  type GraphEdgeDefinition,
  type GraphStateDefinition,
  type GraphTransitionDefinition,
  type MotionGraphDefinition,
  type ValidatedMotionGraph
} from "@aval/graph";

import { FormatError } from "./errors.js";
import type {
  CompiledManifestV01,
  EdgeV01,
  StateV01,
  TransitionV01,
  UnitV01
} from "./model.js";

/** Map a validated compiled manifest into the sole M3 graph representation. */
export function adaptManifestToMotionGraph(
  manifest: CompiledManifestV01
): ValidatedMotionGraph {
  try {
    const unitsById = new Map(manifest.units.map((unit) => [unit.id, unit]));
    const definition: MotionGraphDefinition = {
      initialState: manifest.initialState,
      states: manifest.states.map((state) => adaptState(state, unitsById)),
      edges: manifest.edges.map((edge) => adaptEdge(edge, unitsById))
    };
    return validateMotionGraphDefinition(definition);
  } catch (error) {
    if (error instanceof FormatError && error.code === "GRAPH_INVALID") {
      throw error;
    }
    const detail = error instanceof Error ? `: ${error.message}` : "";
    throw new FormatError(
      "GRAPH_INVALID",
      `compiled manifest does not define a valid motion graph${detail}`
    );
  }
}

function adaptState(
  state: StateV01,
  unitsById: ReadonlyMap<string, UnitV01>
): GraphStateDefinition {
  const body = unitsById.get(state.bodyUnit);
  if (body?.kind !== "body") {
    graphInvalid(`state ${quote(state.id)} has no body unit`);
  }
  const graphBody = Object.freeze({
    unitId: body.id,
    kind:
      body.playback === "loop"
        ? "loop"
        : body.frameCount === 1
          ? "held"
          : "finite",
    frameCount: body.frameCount,
    ports: Object.freeze(
      body.ports.map((port) =>
        Object.freeze({
          id: port.id,
          entryFrame: 0 as const,
          portalFrames: Object.freeze([...port.portalFrames])
        })
      )
    )
  });
  const base = {
    id: state.id,
    body: graphBody
  };
  if (state.initialUnit === undefined) {
    return Object.freeze(base);
  }
  const initial = unitsById.get(state.initialUnit);
  if (initial?.kind !== "one-shot") {
    graphInvalid(`state ${quote(state.id)} has no one-shot initial unit`);
  }
  return Object.freeze({
    ...base,
    initialUnit: Object.freeze({
      unitId: initial.id,
      frameCount: initial.frameCount
    })
  });
}

function adaptEdge(
  edge: EdgeV01,
  unitsById: ReadonlyMap<string, UnitV01>
): GraphEdgeDefinition {
  const trigger =
    edge.trigger === undefined ? undefined : Object.freeze({ ...edge.trigger });
  const start = Object.freeze({ ...edge.start });
  const transition =
    edge.transition === undefined
      ? undefined
      : adaptTransition(edge.transition, unitsById);
  const base = {
    id: edge.id,
    from: edge.from,
    to: edge.to,
    start,
    continuity: edge.continuity
  };
  if (trigger === undefined && transition === undefined) {
    return Object.freeze(base);
  }
  if (trigger === undefined) {
    return Object.freeze({ ...base, transition: transition! });
  }
  if (transition === undefined) {
    return Object.freeze({ ...base, trigger });
  }
  return Object.freeze({ ...base, trigger, transition });
}

function adaptTransition(
  transition: TransitionV01,
  unitsById: ReadonlyMap<string, UnitV01>
): GraphTransitionDefinition {
  const unit = unitsById.get(transition.unit);
  if (transition.kind === "locked") {
    if (unit?.kind !== "bridge") {
      graphInvalid(`locked transition has no bridge unit ${quote(transition.unit)}`);
    }
    return Object.freeze({
      kind: "locked",
      unitId: unit.id,
      frameCount: unit.frameCount
    });
  }
  if (unit?.kind !== "reversible") {
    graphInvalid(
      `reversible transition has no reversible unit ${quote(transition.unit)}`
    );
  }
  const base = {
    kind: "reversible" as const,
    unitId: unit.id,
    frameCount: unit.frameCount,
    direction: transition.direction
  };
  return transition.reverseOf === undefined
    ? Object.freeze(base)
    : Object.freeze({ ...base, reverseOf: transition.reverseOf });
}

function graphInvalid(message: string): never {
  throw new FormatError("GRAPH_INVALID", message);
}

function quote(value: string): string {
  return JSON.stringify(value);
}
