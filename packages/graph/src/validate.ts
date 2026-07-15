import { MotionGraphValidationError } from "./errors.js";
import { GRAPH_IDENTIFIER_PATTERN, GRAPH_LIMITS } from "./limits.js";
import {
  greatestFinishWaitFrames,
  greatestPortalWaitFrames
} from "./portal-search.js";
import type {
  GraphBodyDefinition,
  GraphEdgeDefinition,
  GraphEdgeId,
  GraphEdgeTrigger,
  GraphPortDefinition,
  GraphStartPolicy,
  GraphStateDefinition,
  GraphStateId,
  GraphTransitionDefinition,
  MotionGraphDefinition,
  ValidatedMotionGraph
} from "./model.js";

export interface ValidatedGraphIndexes {
  readonly statesById: ReadonlyMap<GraphStateId, GraphStateDefinition>;
  readonly edgesById: ReadonlyMap<GraphEdgeId, GraphEdgeDefinition>;
  readonly portsByState: ReadonlyMap<
    GraphStateId,
    ReadonlyMap<string, GraphPortDefinition>
  >;
  readonly directEdgesByState: ReadonlyMap<
    GraphStateId,
    ReadonlyMap<GraphStateId, GraphEdgeDefinition>
  >;
  readonly eventEdgesByState: ReadonlyMap<
    GraphStateId,
    ReadonlyMap<string, GraphEdgeDefinition>
  >;
  readonly completionEdgesByState: ReadonlyMap<
    GraphStateId,
    GraphEdgeDefinition
  >;
  readonly inverseEdgesById: ReadonlyMap<GraphEdgeId, GraphEdgeDefinition>;
}

const indexesByGraph = new WeakMap<
  ValidatedMotionGraph,
  ValidatedGraphIndexes
>();

/**
 * Clones and validates an untrusted graph definition. The returned definition
 * shares no arrays or objects with the caller and is recursively frozen.
 */
export function validateMotionGraphDefinition(
  value: MotionGraphDefinition
): ValidatedMotionGraph {
  const input = expectRecord(value, "definition");
  const initialState = expectIdentifier(input.initialState, "initialState");
  const stateInputs = expectArray(input.states, "states");
  const edgeInputs = expectArray(input.edges, "edges");

  if (stateInputs.length === 0 || stateInputs.length > GRAPH_LIMITS.maxStates) {
    invalid(
      `states must contain between 1 and ${String(GRAPH_LIMITS.maxStates)} entries`
    );
  }
  if (edgeInputs.length > GRAPH_LIMITS.maxEdges) {
    invalid(`edges must contain at most ${String(GRAPH_LIMITS.maxEdges)} entries`);
  }

  const stateIds = new Set<string>();
  const reservedUnitIds = new Set<string>();
  const states = Array.from(stateInputs, (state, index) =>
    cloneState(
      state,
      index,
      initialState,
      stateIds,
      reservedUnitIds
    )
  );

  const statesById = new Map(states.map((state) => [state.id, state]));
  const initial = statesById.get(initialState);
  if (initial === undefined) {
    invalid(`initialState ${quote(initialState)} does not reference a state`);
  }

  const edgeIds = new Set<string>();
  const transitionUnitKinds = new Map<
    string,
    "locked" | "reversible"
  >();
  const edges = Array.from(edgeInputs, (edge, index) =>
    cloneEdge(edge, index, edgeIds, reservedUnitIds, transitionUnitKinds)
  );

  const edgesById = new Map(edges.map((edge) => [edge.id, edge]));
  const portsByState = new Map<
    GraphStateId,
    ReadonlyMap<string, GraphPortDefinition>
  >();
  for (const state of states) {
    portsByState.set(
      state.id,
      new Map(state.body.ports.map((port) => [port.id, port]))
    );
  }

  const directMutable = new Map<
    GraphStateId,
    Map<GraphStateId, GraphEdgeDefinition>
  >();
  const eventMutable = new Map<
    GraphStateId,
    Map<string, GraphEdgeDefinition>
  >();
  const completionEdgesByState = new Map<
    GraphStateId,
    GraphEdgeDefinition
  >();

  for (const edge of edges) {
    validateEdgeReferencesAndGeometry(
      edge,
      statesById,
      portsByState,
      directMutable,
      eventMutable,
      completionEdgesByState
    );
  }

  const inverseEdgesById = validateReversiblePairs(edges, edgesById);
  validateImmediateCompletionCycles(completionEdgesByState, statesById);

  const definition = Object.freeze({
    initialState,
    states: Object.freeze(states),
    edges: Object.freeze(edges)
  });
  const validated = Object.freeze({ definition }) as unknown as ValidatedMotionGraph;
  const indexes = Object.freeze({
    statesById,
    edgesById,
    portsByState,
    directEdgesByState: directMutable,
    eventEdgesByState: eventMutable,
    completionEdgesByState,
    inverseEdgesById
  });

  indexesByGraph.set(validated, indexes);
  return validated;
}

/** Internal engine access to the indexes associated with a validated clone. */
export function getValidatedGraphIndexes(
  graph: ValidatedMotionGraph
): ValidatedGraphIndexes {
  const indexes = indexesByGraph.get(graph);
  if (indexes === undefined) {
    throw new MotionGraphValidationError(
      "graph was not produced by validateMotionGraphDefinition()"
    );
  }
  return indexes;
}

function cloneState(
  value: unknown,
  index: number,
  initialState: string,
  stateIds: Set<string>,
  reservedUnitIds: Set<string>
): GraphStateDefinition {
  const path = `states[${String(index)}]`;
  const input = expectRecord(value, path);
  const id = expectIdentifier(input.id, `${path}.id`);
  addUnique(stateIds, id, `${path}.id`, "state ID");

  const body = cloneBody(input.body, `${path}.body`);
  reserveUnit(reservedUnitIds, body.unitId, `${path}.body.unitId`);

  if (input.initialUnit === undefined) {
    return Object.freeze({ id, body });
  }
  if (id !== initialState) {
    invalid(`${path}.initialUnit is allowed only on the initial state`);
  }

  const initialInput = expectRecord(input.initialUnit, `${path}.initialUnit`);
  const unitId = expectIdentifier(
    initialInput.unitId,
    `${path}.initialUnit.unitId`
  );
  const frameCount = expectPositiveSafeInteger(
    initialInput.frameCount,
    `${path}.initialUnit.frameCount`
  );
  reserveUnit(reservedUnitIds, unitId, `${path}.initialUnit.unitId`);
  const initialUnit = Object.freeze({ unitId, frameCount });
  return Object.freeze({ id, body, initialUnit });
}

function cloneBody(value: unknown, path: string): GraphBodyDefinition {
  const input = expectRecord(value, path);
  const unitId = expectIdentifier(input.unitId, `${path}.unitId`);
  const kind = input.kind;
  if (kind !== "loop" && kind !== "finite" && kind !== "held") {
    invalid(`${path}.kind must be loop, finite, or held`);
  }
  const frameCount = expectPositiveSafeInteger(
    input.frameCount,
    `${path}.frameCount`
  );
  if (kind === "held" && frameCount !== 1) {
    invalid(`${path}.frameCount must be 1 for a held body`);
  }

  const portInputs = expectArray(input.ports, `${path}.ports`);
  if (portInputs.length > GRAPH_LIMITS.maxPortsPerBody) {
    invalid(
      `${path}.ports must contain at most ${String(GRAPH_LIMITS.maxPortsPerBody)} entries`
    );
  }
  const portIds = new Set<string>();
  const ports = Array.from(portInputs, (port, index) =>
    clonePort(port, `${path}.ports[${String(index)}]`, frameCount, portIds)
  );
  return Object.freeze({
    unitId,
    kind,
    frameCount,
    ports: Object.freeze(ports)
  });
}

function clonePort(
  value: unknown,
  path: string,
  frameCount: number,
  portIds: Set<string>
): GraphPortDefinition {
  const input = expectRecord(value, path);
  const id = expectIdentifier(input.id, `${path}.id`);
  addUnique(portIds, id, `${path}.id`, "port ID in one body");
  if (input.entryFrame !== 0) {
    invalid(`${path}.entryFrame must be 0`);
  }

  const portalInputs = expectArray(input.portalFrames, `${path}.portalFrames`);
  if (portalInputs.length === 0) {
    invalid(`${path}.portalFrames must contain at least one frame`);
  }
  const portalFrames: number[] = [];
  let previous = -1;
  for (let index = 0; index < portalInputs.length; index += 1) {
    const frame = expectNonNegativeSafeInteger(
      portalInputs[index],
      `${path}.portalFrames[${String(index)}]`
    );
    if (frame >= frameCount) {
      invalid(
        `${path}.portalFrames[${String(index)}] must be less than frameCount`
      );
    }
    if (frame <= previous) {
      invalid(`${path}.portalFrames must be sorted and unique`);
    }
    portalFrames.push(frame);
    previous = frame;
  }

  return Object.freeze({
    id,
    entryFrame: 0,
    portalFrames: Object.freeze(portalFrames)
  });
}

function cloneEdge(
  value: unknown,
  index: number,
  edgeIds: Set<string>,
  reservedUnitIds: Set<string>,
  transitionUnitKinds: Map<string, "locked" | "reversible">
): GraphEdgeDefinition {
  const path = `edges[${String(index)}]`;
  const input = expectRecord(value, path);
  const id = expectIdentifier(input.id, `${path}.id`);
  addUnique(edgeIds, id, `${path}.id`, "edge ID");
  const from = expectIdentifier(input.from, `${path}.from`);
  const to = expectIdentifier(input.to, `${path}.to`);
  if (from === to) {
    invalid(`${path} must connect distinct states`);
  }

  const trigger =
    input.trigger === undefined
      ? undefined
      : cloneTrigger(input.trigger, `${path}.trigger`);
  const start = cloneStart(input.start, `${path}.start`);
  const transition =
    input.transition === undefined
      ? undefined
      : cloneTransition(input.transition, `${path}.transition`);
  const continuity = input.continuity;
  if (
    continuity !== "exact-authored" &&
    continuity !== "exact-reverse" &&
    continuity !== "cut"
  ) {
    invalid(`${path}.continuity is invalid`);
  }

  if (transition !== undefined) {
    if (reservedUnitIds.has(transition.unitId)) {
      invalid(
        `${path}.transition.unitId ${quote(transition.unitId)} is already used by a body or initial unit`
      );
    }
    const existingKind = transitionUnitKinds.get(transition.unitId);
    if (transition.kind === "locked") {
      if (existingKind !== undefined) {
        invalid(
          `${path}.transition.unitId ${quote(transition.unitId)} is already used by another transition`
        );
      }
      transitionUnitKinds.set(transition.unitId, "locked");
    } else {
      if (existingKind === "locked") {
        invalid(
          `${path}.transition.unitId ${quote(transition.unitId)} is already used by a locked transition`
        );
      }
      transitionUnitKinds.set(transition.unitId, "reversible");
    }
  }

  const base = { id, from, to, start, continuity } as const;
  if (trigger === undefined) {
    if (transition === undefined) {
      // Transitionless state requests are valid.
      return Object.freeze(base);
    }
    return Object.freeze({ ...base, transition });
  }
  if (transition === undefined) {
    return Object.freeze({ ...base, trigger });
  }
  return Object.freeze({ ...base, trigger, transition });
}

function cloneTrigger(value: unknown, path: string): GraphEdgeTrigger {
  const input = expectRecord(value, path);
  if (input.type === "completion") {
    return Object.freeze({ type: "completion" });
  }
  if (input.type === "event") {
    return Object.freeze({
      type: "event",
      name: expectIdentifier(input.name, `${path}.name`)
    });
  }
  invalid(`${path}.type must be event or completion`);
}

function cloneStart(value: unknown, path: string): GraphStartPolicy {
  const input = expectRecord(value, path);
  if (input.type === "portal") {
    return Object.freeze({
      type: "portal",
      sourcePort: expectIdentifier(input.sourcePort, `${path}.sourcePort`),
      targetPort: expectIdentifier(input.targetPort, `${path}.targetPort`),
      maxWaitFrames: expectNonNegativeSafeInteger(
        input.maxWaitFrames,
        `${path}.maxWaitFrames`
      )
    });
  }
  if (input.type === "finish") {
    return Object.freeze({
      type: "finish",
      targetPort: expectIdentifier(input.targetPort, `${path}.targetPort`),
      maxWaitFrames: expectNonNegativeSafeInteger(
        input.maxWaitFrames,
        `${path}.maxWaitFrames`
      )
    });
  }
  if (input.type === "cut") {
    if (input.maxWaitFrames !== 1) {
      invalid(`${path}.maxWaitFrames must be 1 for a cut`);
    }
    return Object.freeze({
      type: "cut",
      targetPort: expectIdentifier(input.targetPort, `${path}.targetPort`),
      maxWaitFrames: 1
    });
  }
  invalid(`${path}.type must be portal, finish, or cut`);
}

function cloneTransition(
  value: unknown,
  path: string
): GraphTransitionDefinition {
  const input = expectRecord(value, path);
  const unitId = expectIdentifier(input.unitId, `${path}.unitId`);
  const frameCount = expectPositiveSafeInteger(
    input.frameCount,
    `${path}.frameCount`
  );
  if (input.kind === "locked") {
    return Object.freeze({ kind: "locked", unitId, frameCount });
  }
  if (input.kind === "reversible") {
    if (input.direction !== "forward" && input.direction !== "reverse") {
      invalid(`${path}.direction must be forward or reverse`);
    }
    if (input.reverseOf === undefined) {
      return Object.freeze({
        kind: "reversible",
        unitId,
        frameCount,
        direction: input.direction
      });
    }
    return Object.freeze({
      kind: "reversible",
      unitId,
      frameCount,
      direction: input.direction,
      reverseOf: expectIdentifier(input.reverseOf, `${path}.reverseOf`)
    });
  }
  invalid(`${path}.kind must be locked or reversible`);
}

function validateEdgeReferencesAndGeometry(
  edge: GraphEdgeDefinition,
  statesById: ReadonlyMap<GraphStateId, GraphStateDefinition>,
  portsByState: ReadonlyMap<
    GraphStateId,
    ReadonlyMap<string, GraphPortDefinition>
  >,
  directEdgesByState: Map<
    GraphStateId,
    Map<GraphStateId, GraphEdgeDefinition>
  >,
  eventEdgesByState: Map<
    GraphStateId,
    Map<string, GraphEdgeDefinition>
  >,
  completionEdgesByState: Map<GraphStateId, GraphEdgeDefinition>
): void {
  const source = statesById.get(edge.from);
  const target = statesById.get(edge.to);
  if (source === undefined) {
    invalid(`${edgePath(edge)}.from does not reference a state`);
  }
  if (target === undefined) {
    invalid(`${edgePath(edge)}.to does not reference a state`);
  }

  const direct = getOrCreate(directEdgesByState, edge.from);
  const duplicateDirect = direct.get(edge.to);
  if (duplicateDirect !== undefined) {
    invalid(
      `${edgePath(edge)} duplicates direct route ${quote(duplicateDirect.id)} from ${quote(edge.from)} to ${quote(edge.to)}`
    );
  }
  direct.set(edge.to, edge);

  if (edge.trigger?.type === "event") {
    const events = getOrCreate(eventEdgesByState, edge.from);
    const duplicateEvent = events.get(edge.trigger.name);
    if (duplicateEvent !== undefined) {
      invalid(
        `${edgePath(edge)} duplicates event ${quote(edge.trigger.name)} from ${quote(edge.from)}`
      );
    }
    events.set(edge.trigger.name, edge);
  } else if (edge.trigger?.type === "completion") {
    if (source.body.kind === "loop") {
      invalid(`${edgePath(edge)} completion trigger cannot originate from a loop`);
    }
    const duplicateCompletion = completionEdgesByState.get(edge.from);
    if (duplicateCompletion !== undefined) {
      invalid(
        `${edgePath(edge)} duplicates completion route ${quote(duplicateCompletion.id)} from ${quote(edge.from)}`
      );
    }
    completionEdgesByState.set(edge.from, edge);
  }

  const targetPorts = portsByState.get(target.id);
  if (targetPorts?.has(edge.start.targetPort) !== true) {
    invalid(
      `${edgePath(edge)} target port ${quote(edge.start.targetPort)} does not exist on ${quote(target.id)}`
    );
  }

  if (edge.start.type === "portal") {
    const sourcePorts = portsByState.get(source.id);
    const port = sourcePorts?.get(edge.start.sourcePort);
    if (port === undefined) {
      invalid(
        `${edgePath(edge)} source port ${quote(edge.start.sourcePort)} does not exist on ${quote(source.id)}`
      );
    }
    if (
      source.body.kind !== "loop" &&
      port.portalFrames.at(-1) !== source.body.frameCount - 1
    ) {
      invalid(
        `${edgePath(edge)} finite/held source port must include the held final frame`
      );
    }
    const minimum = greatestPortalWaitFrames(
      source.body,
      edge.start.sourcePort
    );
    if (edge.start.maxWaitFrames < minimum) {
      invalid(
        `${edgePath(edge)} maxWaitFrames ${String(edge.start.maxWaitFrames)} is below the geometric minimum ${String(minimum)}`
      );
    }
  } else if (edge.start.type === "finish") {
    if (source.body.kind === "loop") {
      invalid(`${edgePath(edge)} finish cannot originate from a loop`);
    }
    const minimum = greatestFinishWaitFrames(source.body);
    if (edge.start.maxWaitFrames < minimum) {
      invalid(
        `${edgePath(edge)} maxWaitFrames ${String(edge.start.maxWaitFrames)} is below the finish minimum ${String(minimum)}`
      );
    }
  } else {
    if (edge.transition !== undefined) {
      invalid(`${edgePath(edge)} cut cannot own a transition unit`);
    }
    if (edge.continuity !== "cut") {
      invalid(`${edgePath(edge)} cut must declare continuity cut`);
    }
  }

  if (edge.start.type !== "cut" && edge.continuity === "cut") {
    invalid(`${edgePath(edge)} continuity cut requires start policy cut`);
  }
  if (
    edge.continuity === "exact-reverse" &&
    (edge.transition?.kind !== "reversible" ||
      edge.transition.reverseOf === undefined)
  ) {
    invalid(
      `${edgePath(edge)} exact-reverse requires a reversible transition with reverseOf`
    );
  }
}

function validateReversiblePairs(
  edges: readonly GraphEdgeDefinition[],
  edgesById: ReadonlyMap<GraphEdgeId, GraphEdgeDefinition>
): ReadonlyMap<GraphEdgeId, GraphEdgeDefinition> {
  const groups = new Map<string, GraphEdgeDefinition[]>();
  for (const edge of edges) {
    if (edge.transition?.kind !== "reversible") {
      continue;
    }
    const group = groups.get(edge.transition.unitId);
    if (group === undefined) {
      groups.set(edge.transition.unitId, [edge]);
    } else {
      group.push(edge);
    }
  }

  const inverseEdgesById = new Map<GraphEdgeId, GraphEdgeDefinition>();
  for (const [unitId, group] of groups) {
    if (group.length !== 2) {
      invalid(
        `reversible unit ${quote(unitId)} must be used by exactly two inverse edges`
      );
    }
    const first = group[0];
    const second = group[1];
    if (first === undefined || second === undefined) {
      invalid(`reversible unit ${quote(unitId)} has an incomplete inverse pair`);
    }
    const firstTransition = first.transition;
    const secondTransition = second.transition;
    if (
      firstTransition?.kind !== "reversible" ||
      secondTransition?.kind !== "reversible"
    ) {
      invalid(`reversible unit ${quote(unitId)} has an invalid inverse pair`);
    }
    if (first.from !== second.to || first.to !== second.from) {
      invalid(`reversible unit ${quote(unitId)} must reverse its endpoints`);
    }
    if (firstTransition.frameCount !== secondTransition.frameCount) {
      invalid(`reversible unit ${quote(unitId)} must use one frame count`);
    }
    if (firstTransition.direction === secondTransition.direction) {
      invalid(`reversible unit ${quote(unitId)} must use opposite directions`);
    }

    const declaring = [first, second].filter(
      (edge) =>
        edge.transition?.kind === "reversible" &&
        edge.transition.reverseOf !== undefined
    );
    if (declaring.length !== 1) {
      invalid(
        `reversible unit ${quote(unitId)} must have exactly one inverse edge with reverseOf`
      );
    }
    const inverse = declaring[0];
    if (inverse?.transition?.kind !== "reversible") {
      invalid(`reversible unit ${quote(unitId)} has no inverse declaration`);
    }
    const base = inverse === first ? second : first;
    if (inverse.transition.reverseOf !== base.id) {
      invalid(
        `${edgePath(inverse)}.transition.reverseOf must reference ${quote(base.id)}`
      );
    }
    if (edgesById.get(inverse.transition.reverseOf) !== base) {
      invalid(`${edgePath(inverse)}.transition.reverseOf is invalid`);
    }
    if (inverse.continuity !== "exact-reverse") {
      invalid(`${edgePath(inverse)} must declare continuity exact-reverse`);
    }
    if (base.continuity === "exact-reverse") {
      invalid(`${edgePath(base)} cannot declare exact-reverse without reverseOf`);
    }
    inverseEdgesById.set(first.id, second);
    inverseEdgesById.set(second.id, first);
  }
  return inverseEdgesById;
}

function validateImmediateCompletionCycles(
  completionEdgesByState: ReadonlyMap<GraphStateId, GraphEdgeDefinition>,
  statesById: ReadonlyMap<GraphStateId, GraphStateDefinition>
): void {
  const immediate = new Map<GraphStateId, GraphStateId>();
  for (const [stateId, edge] of completionEdgesByState) {
    const source = statesById.get(stateId);
    if (
      source !== undefined &&
      isImmediateCompletionSource(source) &&
      edge.transition === undefined
    ) {
      immediate.set(stateId, edge.to);
    }
  }

  for (const start of immediate.keys()) {
    const path = new Set<GraphStateId>();
    let cursor: GraphStateId | undefined = start;
    while (cursor !== undefined) {
      if (path.has(cursor)) {
        invalid(`completion routes contain an immediate cycle at ${quote(cursor)}`);
      }
      path.add(cursor);
      cursor = immediate.get(cursor);
    }
  }
}

function isImmediateCompletionSource(state: GraphStateDefinition): boolean {
  return (
    state.body.kind === "held" ||
    (state.body.kind === "finite" && state.body.frameCount === 1)
  );
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function expectArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    invalid(`${path} must be an array`);
  }
  return value;
}

function expectIdentifier(value: unknown, path: string): string {
  if (typeof value !== "string" || !GRAPH_IDENTIFIER_PATTERN.test(value)) {
    invalid(`${path} must match ${String(GRAPH_IDENTIFIER_PATTERN)}`);
  }
  return value;
}

function expectPositiveSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || typeof value !== "number" || value <= 0) {
    invalid(`${path} must be a positive safe integer`);
  }
  return value;
}

function expectNonNegativeSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || typeof value !== "number" || value < 0) {
    invalid(`${path} must be a nonnegative safe integer`);
  }
  return value;
}

function addUnique(
  values: Set<string>,
  value: string,
  path: string,
  label: string
): void {
  if (values.has(value)) {
    invalid(`${path} duplicates ${label} ${quote(value)}`);
  }
  values.add(value);
}

function reserveUnit(
  reservedUnitIds: Set<string>,
  unitId: string,
  path: string
): void {
  if (reservedUnitIds.has(unitId)) {
    invalid(`${path} duplicates unit ID ${quote(unitId)}`);
  }
  reservedUnitIds.add(unitId);
}

function getOrCreate<TKey, TValue>(
  map: Map<TKey, Map<TValue, GraphEdgeDefinition>>,
  key: TKey
): Map<TValue, GraphEdgeDefinition> {
  const current = map.get(key);
  if (current !== undefined) {
    return current;
  }
  const created = new Map<TValue, GraphEdgeDefinition>();
  map.set(key, created);
  return created;
}

function edgePath(edge: GraphEdgeDefinition): string {
  return `edge ${quote(edge.id)}`;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function invalid(message: string): never {
  throw new MotionGraphValidationError(message);
}
