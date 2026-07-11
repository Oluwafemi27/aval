import {
  MAX_RUNWAY_FRAMES,
  MIN_RUNWAY_FRAMES
} from "./manifest-constraints.js";
import {
  boundedArray,
  compareAscii,
  exactKeys,
  identifier,
  integerInRange,
  invalid,
  literal,
  nonNegativeInteger,
  oneOf,
  owns,
  record,
  requireIdOrder,
  requireStringOrder
} from "./manifest-validation.js";
import type {
  BindingSourceV01,
  BindingV01,
  EdgeV01,
  FallbackV01,
  FormatBudgets,
  ReadinessV01,
  StartV01,
  StateV01,
  TransitionV01,
  TriggerV01
} from "./model.js";

const BINDING_SOURCES = new Set<BindingSourceV01>([
  "activate",
  "engagement.off",
  "engagement.on",
  "focus.in",
  "focus.out",
  "hidden",
  "pointer.enter",
  "pointer.leave",
  "visible"
]);

export function cloneStates(
  value: unknown,
  budgets: FormatBudgets,
  path: string
): readonly StateV01[] {
  const inputs = boundedArray(value, path, 1, budgets.maxStates);
  const states = inputs.map((entry, index) => {
    const statePath = `${path}[${String(index)}]`;
    const input = record(entry, statePath);
    exactKeys(input, ["id", "bodyUnit", "staticFrame"], statePath, ["initialUnit"]);
    const base = {
      id: identifier(input.id, `${statePath}.id`),
      bodyUnit: identifier(input.bodyUnit, `${statePath}.bodyUnit`),
      staticFrame: identifier(input.staticFrame, `${statePath}.staticFrame`)
    };
    if (!owns(input, "initialUnit")) {
      return Object.freeze(base);
    }
    return Object.freeze({
      ...base,
      initialUnit: identifier(input.initialUnit, `${statePath}.initialUnit`)
    });
  });
  requireIdOrder(states, path);
  return Object.freeze(states);
}

export function cloneEdges(
  value: unknown,
  budgets: FormatBudgets,
  path: string
): readonly EdgeV01[] {
  const inputs = boundedArray(value, path, 0, budgets.maxEdges);
  const edges = inputs.map((entry, index) =>
    cloneEdge(entry, `${path}[${String(index)}]`)
  );
  requireIdOrder(edges, path);
  return Object.freeze(edges);
}

function cloneEdge(value: unknown, path: string): EdgeV01 {
  const input = record(value, path);
  const startProbe = record(input.start, `${path}.start`);
  const cut = startProbe.type === "cut";
  exactKeys(
    input,
    cut
      ? ["id", "from", "to", "start", "continuity", "targetRunwayFrames"]
      : ["id", "from", "to", "start", "continuity"],
    path,
    cut ? ["trigger"] : ["trigger", "transition"]
  );
  const id = identifier(input.id, `${path}.id`);
  const from = identifier(input.from, `${path}.from`);
  const to = identifier(input.to, `${path}.to`);
  if (from === to) {
    invalid(`${path}.to`, "must differ from from");
  }
  const trigger = owns(input, "trigger")
    ? cloneTrigger(input.trigger, `${path}.trigger`)
    : undefined;
  const start = cloneStart(input.start, `${path}.start`);

  if (start.type === "cut") {
    literal(input.continuity, "cut", `${path}.continuity`);
    const targetRunwayFrames = integerInRange(
      input.targetRunwayFrames,
      `${path}.targetRunwayFrames`,
      MIN_RUNWAY_FRAMES,
      MAX_RUNWAY_FRAMES
    );
    const base = { id, from, to, start, continuity: "cut", targetRunwayFrames } as const;
    return trigger === undefined
      ? Object.freeze(base)
      : Object.freeze({ ...base, trigger });
  }

  const continuity = oneOf(
    input.continuity,
    ["exact-authored", "exact-reverse"],
    `${path}.continuity`
  );
  const transition = owns(input, "transition")
    ? cloneTransition(input.transition, `${path}.transition`)
    : undefined;
  const base = { id, from, to, start, continuity } as const;
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

function cloneTrigger(value: unknown, path: string): TriggerV01 {
  const input = record(value, path);
  if (input.type === "completion") {
    exactKeys(input, ["type"], path);
    return Object.freeze({ type: "completion" });
  }
  if (input.type === "event") {
    exactKeys(input, ["type", "name"], path);
    return Object.freeze({
      type: "event",
      name: identifier(input.name, `${path}.name`)
    });
  }
  invalid(`${path}.type`, "must be event or completion");
}

function cloneStart(value: unknown, path: string): StartV01 {
  const input = record(value, path);
  if (input.type === "portal") {
    exactKeys(input, ["type", "sourcePort", "targetPort", "maxWaitFrames"], path);
    return Object.freeze({
      type: "portal",
      sourcePort: identifier(input.sourcePort, `${path}.sourcePort`),
      targetPort: identifier(input.targetPort, `${path}.targetPort`),
      maxWaitFrames: nonNegativeInteger(input.maxWaitFrames, `${path}.maxWaitFrames`)
    });
  }
  if (input.type === "finish") {
    exactKeys(input, ["type", "targetPort", "maxWaitFrames"], path);
    return Object.freeze({
      type: "finish",
      targetPort: identifier(input.targetPort, `${path}.targetPort`),
      maxWaitFrames: nonNegativeInteger(input.maxWaitFrames, `${path}.maxWaitFrames`)
    });
  }
  if (input.type === "cut") {
    exactKeys(input, ["type", "targetPort", "maxWaitFrames"], path);
    literal(input.maxWaitFrames, 1, `${path}.maxWaitFrames`);
    return Object.freeze({
      type: "cut",
      targetPort: identifier(input.targetPort, `${path}.targetPort`),
      maxWaitFrames: 1
    });
  }
  invalid(`${path}.type`, "must be portal, finish, or cut");
}

function cloneTransition(value: unknown, path: string): TransitionV01 {
  const input = record(value, path);
  if (input.kind === "locked") {
    exactKeys(input, ["kind", "unit"], path);
    return Object.freeze({
      kind: "locked",
      unit: identifier(input.unit, `${path}.unit`)
    });
  }
  if (input.kind === "reversible") {
    exactKeys(input, ["kind", "unit", "direction"], path, ["reverseOf"]);
    const base = {
      kind: "reversible",
      unit: identifier(input.unit, `${path}.unit`),
      direction: oneOf(
        input.direction,
        ["forward", "reverse"],
        `${path}.direction`
      )
    } as const;
    if (!owns(input, "reverseOf")) {
      return Object.freeze(base);
    }
    return Object.freeze({
      ...base,
      reverseOf: identifier(input.reverseOf, `${path}.reverseOf`)
    });
  }
  invalid(`${path}.kind`, "must be locked or reversible");
}

export function cloneBindings(
  value: unknown,
  budgets: FormatBudgets,
  path: string
): readonly BindingV01[] {
  const inputs = boundedArray(value, path, 0, budgets.maxBindings);
  const bindings = inputs.map((entry, index) => {
    const bindingPath = `${path}[${String(index)}]`;
    const input = record(entry, bindingPath);
    exactKeys(input, ["source", "event"], bindingPath);
    if (typeof input.source !== "string" || !BINDING_SOURCES.has(input.source as BindingSourceV01)) {
      invalid(`${bindingPath}.source`, "is not a supported binding source");
    }
    return Object.freeze({
      source: input.source as BindingSourceV01,
      event: identifier(input.event, `${bindingPath}.event`)
    });
  });
  for (let index = 1; index < bindings.length; index += 1) {
    const previous = bindings[index - 1]!;
    const current = bindings[index]!;
    const order = compareAscii(previous.source, current.source) ||
      compareAscii(previous.event, current.event);
    if (order >= 0) {
      invalid(path, "must be sorted and unique by source then event");
    }
    if (previous.source === current.source) {
      invalid(`${path}[${String(index)}].source`, "duplicates a binding source");
    }
  }
  return Object.freeze(bindings);
}

export function cloneReadiness(
  value: unknown,
  budgets: FormatBudgets,
  path: string
): ReadinessV01 {
  const input = record(value, path);
  exactKeys(input, ["policy", "bootstrapUnits", "immediateEdges"], path);
  literal(input.policy, "all-routes", `${path}.policy`);
  const bootstrapUnits = cloneIdArray(
    input.bootstrapUnits,
    budgets.maxUnits,
    `${path}.bootstrapUnits`
  );
  const immediateEdges = cloneIdArray(
    input.immediateEdges,
    budgets.maxEdges,
    `${path}.immediateEdges`
  );
  return Object.freeze({
    policy: "all-routes",
    bootstrapUnits,
    immediateEdges
  });
}

function cloneIdArray(
  value: unknown,
  maximum: number,
  path: string
): readonly string[] {
  const inputs = boundedArray(value, path, 0, maximum);
  const ids = inputs.map((entry, index) =>
    identifier(entry, `${path}[${String(index)}]`)
  );
  requireStringOrder(ids, path);
  return Object.freeze(ids);
}

export function cloneFallback(value: unknown, path: string): FallbackV01 {
  const input = record(value, path);
  exactKeys(input, ["unsupported", "reducedMotion"], path);
  literal(input.unsupported, "per-state-static", `${path}.unsupported`);
  literal(input.reducedMotion, "per-state-static", `${path}.reducedMotion`);
  return Object.freeze({
    unsupported: "per-state-static",
    reducedMotion: "per-state-static"
  });
}
