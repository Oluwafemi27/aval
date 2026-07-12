import {
  FORMAT_DEFAULT_BUDGETS,
  type PortV01,
  type ResidencyEndpointV01
} from "@rendered-motion/format";

import type {
  SourceDescriptorV01,
  SourceStateV01,
  SourceUnitV01
} from "./model.js";
import {
  boundedArray,
  exactKeys,
  identifier,
  integer,
  invalid,
  literal,
  oneOf,
  optionalIdentifier,
  record,
  sortUniqueById,
  tuple
} from "./schema-validation.js";
import {
  cloneSourceBindings,
  cloneSourceEdges
} from "./source-graph-schema.js";

export function cloneSourceFrameRate(value: unknown): {
  readonly numerator: number;
  readonly denominator: number;
} {
  const input = record(value, "frameRate");
  exactKeys(input, ["numerator", "denominator"], "frameRate");
  const numerator = integer(input.numerator, "frameRate.numerator", 1);
  const denominator = integer(
    input.denominator,
    "frameRate.denominator",
    1,
    1_001
  );
  if (
    numerator > denominator * 60 ||
    greatestCommonDivisor(numerator, denominator) !== 1
  ) {
    invalid("frameRate", "must be reduced and no greater than 60 fps");
  }
  return Object.freeze({ numerator, denominator });
}

export function cloneSourceDescriptors(
  value: unknown
): readonly SourceDescriptorV01[] {
  const inputs = boundedArray(value, "sources", 1, 32);
  return sortUniqueById(inputs.map((entry, index) => {
    const path = `sources[${String(index)}]`;
    const input = record(entry, path);
    const type = oneOf(input.type, ["video", "png-sequence"] as const, `${path}.type`);
    const id = identifier(input.id, `${path}.id`);
    if (type === "video") {
      exactKeys(input, ["id", "type", "path", "timing"], path);
      const sourcePath = localRelativePath(input.path, `${path}.path`);
      if (!/\.(?:m4v|mov|mp4)$/iu.test(sourcePath)) {
        invalid(`${path}.path`, "video sources must use .mov, .mp4, or .m4v");
      }
      const timing = record(input.timing, `${path}.timing`);
      exactKeys(timing, ["mode"], `${path}.timing`);
      return Object.freeze({
        id,
        type,
        path: sourcePath,
        timing: Object.freeze({
          mode: oneOf(
            timing.mode,
            ["exact", "normalize-hold"] as const,
            `${path}.timing.mode`
          )
        })
      });
    }
    exactKeys(
      input,
      [
        "id", "type", "directory", "prefix", "digits", "suffix",
        "firstNumber", "frameCount"
      ],
      path
    );
    const digits = integer(input.digits, `${path}.digits`, 1, 9);
    const firstNumber = integer(input.firstNumber, `${path}.firstNumber`, 0);
    const frameCount = integer(
      input.frameCount,
      `${path}.frameCount`,
      1,
      1_800
    );
    if (firstNumber + frameCount - 1 >= 10 ** digits) {
      invalid(path, "PNG frame numbers do not fit the declared digit width");
    }
    return Object.freeze({
      id,
      type,
      directory: localRelativePath(input.directory, `${path}.directory`),
      prefix: plainFilePart(input.prefix, `${path}.prefix`, false),
      digits,
      suffix: literal(input.suffix, ".png", `${path}.suffix`),
      firstNumber,
      frameCount
    });
  }), "sources");
}

export function cloneSourceUnits(
  value: unknown,
  sources: readonly SourceDescriptorV01[]
): readonly SourceUnitV01[] {
  const inputs = boundedArray(
    value,
    "units",
    1,
    FORMAT_DEFAULT_BUDGETS.maxUnits
  );
  const sourceIds = new Set(sources.map(({ id }) => id));
  let totalFrames = 0;
  const units = inputs.map((entry, index) => {
    const path = `units[${String(index)}]`;
    const input = record(entry, path);
    const kind = oneOf(
      input.kind,
      ["body", "bridge", "reversible", "one-shot"] as const,
      `${path}.kind`
    );
    const common = ["id", "kind", "source", "range"];
    if (kind === "body") {
      exactKeys(input, [...common, "playback", "ports"], path);
    } else if (kind === "reversible") {
      exactKeys(input, [...common, "residency"], path);
    } else {
      exactKeys(input, common, path);
    }
    const source = identifier(input.source, `${path}.source`);
    if (!sourceIds.has(source)) invalid(`${path}.source`, "does not reference a source");
    const rangeInput = tuple(input.range, 2, `${path}.range`);
    const start = integer(rangeInput[0], `${path}.range[0]`, 0, 1_799);
    const end = integer(rangeInput[1], `${path}.range[1]`, start + 1, 1_800);
    totalFrames += end - start;
    if (totalFrames > FORMAT_DEFAULT_BUDGETS.maxTotalUnitFrames) {
      invalid("units", "total unit frames exceed the format budget");
    }
    const base = {
      id: identifier(input.id, `${path}.id`),
      kind,
      source,
      range: Object.freeze([start, end]) as readonly [number, number]
    };
    if (kind === "body") {
      return Object.freeze({
        ...base,
        kind,
        playback: oneOf(input.playback, ["loop", "finite"] as const, `${path}.playback`),
        ports: clonePorts(input.ports, end - start, `${path}.ports`)
      });
    }
    if (kind === "reversible") {
      if (end - start > FORMAT_DEFAULT_BUDGETS.maxReversibleFrames) {
        invalid(`${path}.range`, "reversible unit exceeds the frame budget");
      }
      return Object.freeze({
        ...base,
        kind,
        residency: cloneResidency(input.residency, `${path}.residency`)
      });
    }
    return Object.freeze({ ...base, kind });
  });
  return sortUniqueById(units, "units");
}

function clonePorts(
  value: unknown,
  frameCount: number,
  path: string
): readonly PortV01[] {
  const inputs = boundedArray(value, path, 0, FORMAT_DEFAULT_BUDGETS.maxPortsPerBody);
  return sortUniqueById(inputs.map((entry, index) => {
    const portPath = `${path}[${String(index)}]`;
    const input = record(entry, portPath);
    exactKeys(input, ["id", "entryFrame", "portalFrames"], portPath);
    literal(input.entryFrame, 0, `${portPath}.entryFrame`);
    const frames = boundedArray(
      input.portalFrames,
      `${portPath}.portalFrames`,
      1,
      frameCount
    ).map((frame, frameIndex) =>
      integer(
        frame,
        `${portPath}.portalFrames[${String(frameIndex)}]`,
        0,
        frameCount - 1
      )
    ).sort((left, right) => left - right);
    if (new Set(frames).size !== frames.length) {
      invalid(`${portPath}.portalFrames`, "must be unique");
    }
    return Object.freeze({
      id: identifier(input.id, `${portPath}.id`),
      entryFrame: 0 as const,
      portalFrames: Object.freeze(frames)
    });
  }), path);
}

function cloneResidency(
  value: unknown,
  path: string
): { readonly endpoints: readonly [ResidencyEndpointV01, ResidencyEndpointV01] } {
  const input = record(value, path);
  exactKeys(input, ["endpoints"], path);
  const endpoints = tuple(input.endpoints, 2, `${path}.endpoints`).map(
    (entry, index) => {
      const endpointPath = `${path}.endpoints[${String(index)}]`;
      const endpoint = record(entry, endpointPath);
      exactKeys(endpoint, ["state", "port", "frames"], endpointPath);
      return Object.freeze({
        state: identifier(endpoint.state, `${endpointPath}.state`),
        port: identifier(endpoint.port, `${endpointPath}.port`),
        frames: integer(endpoint.frames, `${endpointPath}.frames`, 6, 12)
      });
    }
  ).sort((left, right) =>
    left.state < right.state ? -1 : left.state > right.state ? 1 :
      left.port < right.port ? -1 : left.port > right.port ? 1 : 0
  );
  if (endpoints[0]?.state === endpoints[1]?.state && endpoints[0]?.port === endpoints[1]?.port) {
    invalid(`${path}.endpoints`, "must be distinct");
  }
  return Object.freeze({
    endpoints: Object.freeze(endpoints) as unknown as readonly [
      ResidencyEndpointV01,
      ResidencyEndpointV01
    ]
  });
}

export function cloneSourceStates(
  value: unknown,
  units: readonly SourceUnitV01[],
  sources: readonly SourceDescriptorV01[]
): readonly SourceStateV01[] {
  const inputs = boundedArray(
    value,
    "states",
    1,
    FORMAT_DEFAULT_BUDGETS.maxStates
  );
  const bodyIds = new Set(
    units.filter(({ kind }) => kind === "body").map(({ id }) => id)
  );
  const oneShotIds = new Set(
    units.filter(({ kind }) => kind === "one-shot").map(({ id }) => id)
  );
  const sourceIds = new Set(sources.map(({ id }) => id));
  return sortUniqueById(inputs.map((entry, index) => {
    const path = `states[${String(index)}]`;
    const input = record(entry, path);
    exactKeys(input, ["id", "bodyUnit"], path, ["initialUnit", "poster"]);
    const bodyUnit = identifier(input.bodyUnit, `${path}.bodyUnit`);
    if (!bodyIds.has(bodyUnit)) invalid(`${path}.bodyUnit`, "must reference a body unit");
    const initialUnit = optionalIdentifier(input.initialUnit, `${path}.initialUnit`);
    if (initialUnit !== undefined && !oneShotIds.has(initialUnit)) {
      invalid(`${path}.initialUnit`, "must reference a one-shot unit");
    }
    let poster: SourceStateV01["poster"];
    if (input.poster !== undefined) {
      const posterInput = record(input.poster, `${path}.poster`);
      exactKeys(posterInput, ["source", "frame"], `${path}.poster`);
      const source = identifier(posterInput.source, `${path}.poster.source`);
      if (!sourceIds.has(source)) invalid(`${path}.poster.source`, "does not reference a source");
      poster = Object.freeze({
        source,
        frame: integer(posterInput.frame, `${path}.poster.frame`, 0, 1_799)
      });
    }
    return Object.freeze({
      id: identifier(input.id, `${path}.id`),
      bodyUnit,
      ...(initialUnit === undefined ? {} : { initialUnit }),
      ...(poster === undefined ? {} : { poster })
    });
  }), "states");
}

export function validateSourceReferences(input: {
  readonly initialState: string;
  readonly sources: readonly SourceDescriptorV01[];
  readonly units: readonly SourceUnitV01[];
  readonly states: readonly SourceStateV01[];
  readonly edges: ReturnType<typeof cloneSourceEdges>;
  readonly bindings: ReturnType<typeof cloneSourceBindings>;
}): void {
  const stateIds = new Set(input.states.map(({ id }) => id));
  if (!stateIds.has(input.initialState)) {
    invalid("initialState", "does not reference a state");
  }
  const edgeIds = new Set(input.edges.map(({ id }) => id));
  const unitById = new Map(input.units.map((unit) => [unit.id, unit]));
  const uses = new Map(input.units.map(({ id }) => [id, 0]));
  const increment = (id: string, path: string): void => {
    if (!uses.has(id)) invalid(path, "does not reference a unit");
    uses.set(id, (uses.get(id) ?? 0) + 1);
  };
  for (const state of input.states) {
    increment(state.bodyUnit, `states.${state.id}.bodyUnit`);
    if (state.initialUnit !== undefined) {
      if (state.id !== input.initialState) {
        invalid(`states.${state.id}.initialUnit`, "is allowed only on initialState");
      }
      increment(state.initialUnit, `states.${state.id}.initialUnit`);
    }
  }
  const eventNames = new Set<string>();
  for (const edge of input.edges) {
    if (!stateIds.has(edge.from) || !stateIds.has(edge.to)) {
      invalid(`edges.${edge.id}`, "references an unknown state");
    }
    if (edge.trigger?.type === "event") eventNames.add(edge.trigger.name);
    if (edge.transition !== undefined) {
      increment(edge.transition.unit, `edges.${edge.id}.transition.unit`);
    }
  }
  for (const binding of input.bindings) {
    if (!eventNames.has(binding.event)) {
      invalid(`bindings.${binding.source}`, "references an unused event");
    }
  }
  if (edgeIds.size !== input.edges.length) invalid("edges", "contains duplicate IDs");
  for (const [id, count] of uses) {
    const expected = unitById.get(id)?.kind === "reversible" ? 2 : 1;
    if (count !== expected) {
      invalid("units", `${id} must be referenced exactly ${String(expected)} time(s)`);
    }
  }
  const usedSources = new Set(input.units.map(({ source }) => source));
  for (const state of input.states) {
    if (state.poster !== undefined) usedSources.add(state.poster.source);
  }
  for (const source of input.sources) {
    if (!usedSources.has(source.id)) invalid(`sources.${source.id}`, "is unused");
  }
}

function localRelativePath(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    new TextEncoder().encode(value).byteLength > 4_096 ||
    value.startsWith("/") ||
    value.startsWith("\\") ||
    /^[a-z]:/iu.test(value) ||
    /^[a-z][a-z0-9+.-]*:/iu.test(value) ||
    value.split(/[\\/]/u).some((part) => part === "" || part === "." || part === "..")
  ) {
    invalid(path, "must be a confined relative local path");
  }
  return value;
}

function plainFilePart(value: unknown, path: string, allowEmpty: boolean): string {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.length === 0) ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    new TextEncoder().encode(value).byteLength > 128 ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("%")
  ) {
    invalid(path, "must be a plain filename component");
  }
  return value;
}

export function greatestCommonDivisor(left: number, right: number): number {
  let a = left;
  let b = right;
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}
