import { resolveFormatBudgets } from "./constants.js";
import { FormatError, isFormatError } from "./errors.js";
import { adaptManifestToMotionGraph } from "./graph-adapter.js";
import { validateCompiledManifestV01 } from "./manifest-schema.js";
import {
  compareAscii,
  exactKeys,
  identifier,
  nonNegativeInteger,
  oneOf,
  owns,
  positiveInteger,
  record
} from "./manifest-validation.js";
import type {
  AccessUnitInputV01,
  CanonicalAssetInputV01,
  CompiledManifestV01,
  FormatBudgets,
  FormatOptions,
  StaticPayloadInputV01
} from "./model.js";
import {
  createCanonicalSamplePlan,
  type CanonicalSamplePlan,
  type CanonicalSampleSpan
} from "./sample-plan.js";

const RENDITION_PROFILES = [
  "reference-rgba-v0",
  "avc-annexb-opaque-v0",
  "avc-annexb-packed-alpha-v0"
] as const;
const RENDITION_CAPABILITIES = ["webcodecs", "webgl2"] as const;
const BINDING_SOURCES = [
  "activate",
  "engagement.off",
  "engagement.on",
  "focus.in",
  "focus.out",
  "hidden",
  "pointer.enter",
  "pointer.leave",
  "visible"
] as const;
const UNIT_KINDS = ["body", "bridge", "reversible", "one-shot"] as const;
const MANIFEST_INPUT_KEYS = [
  "formatVersion",
  "generator",
  "canvas",
  "frameRate",
  "renditions",
  "units",
  "staticFrames",
  "initialState",
  "states",
  "edges",
  "bindings",
  "readiness",
  "fallback",
  "limits"
] as const;

export interface NormalizedWriterInput {
  readonly manifest: CompiledManifestV01;
  readonly accessUnits: readonly AccessUnitInputV01[];
  readonly staticPayloads: readonly StaticPayloadInputV01[];
}

/** Clone, canonicalize, and validate writer metadata without copying payloads. */
export function normalizeWriterInput(
  input: CanonicalAssetInputV01,
  options?: FormatOptions
): Readonly<NormalizedWriterInput> {
  try {
    const budgets = resolveFormatBudgets(options);
    const root = record(input, "writer input");
    exactKeys(root, ["manifest", "accessUnits", "staticPayloads"], "writer input");
    const sourceManifest = record(root.manifest, "manifest input");
    exactKeys(sourceManifest, MANIFEST_INPUT_KEYS, "manifest input");
    const sourceUnits = boundedInputArray(
      sourceManifest.units,
      "manifest.units",
      budgets.maxUnits,
      1
    );
    const sourceStaticFrames = boundedInputArray(
      sourceManifest.staticFrames,
      "manifest.staticFrames",
      budgets.maxStaticFrames,
      1
    );
    const sourceRenditions = boundedInputArray(
      sourceManifest.renditions,
      "manifest.renditions",
      budgets.maxRenditions,
      1
    );
    const sourceStates = boundedInputArray(
      sourceManifest.states,
      "manifest.states",
      budgets.maxStates,
      1
    );
    const sourceEdges = boundedInputArray(
      sourceManifest.edges,
      "manifest.edges",
      budgets.maxEdges
    );
    const sourceBindings = boundedInputArray(
      sourceManifest.bindings,
      "manifest.bindings",
      budgets.maxBindings
    );
    const blobCount =
      sourceUnits.length * sourceRenditions.length + sourceStaticFrames.length;
    if (!Number.isSafeInteger(blobCount) || blobCount > budgets.maxBlobRanges) {
      budget("blob range count");
    }

    const accessInputs = boundedInputArray(
      root.accessUnits,
      "accessUnits",
      budgets.maxSampleRecords,
      1
    );
    const staticInputs = boundedInputArray(
      root.staticPayloads,
      "staticPayloads",
      budgets.maxStaticFrames,
      1
    );

    const renditions = sortById(sourceRenditions, "renditions");
    const normalizedRenditions = normalizeRenditions(renditions);
    const staticPayloads = normalizeStaticPayloads(staticInputs, budgets.maxStaticPngBytes);
    const staticFrames = sortById(sourceStaticFrames, "staticFrames").map(
      (value, index) => {
        exactKeys(
          value,
          ["id", "width", "height", "sha256"],
          `staticFrames[${String(index)}]`
        );
        const id = identifier(value.id, `staticFrames[${String(index)}].id`);
        const payload = staticPayloads.get(id);
        if (payload === undefined) invalid(`missing payload for static frame ${id}`);
        return { ...value, offset: 0, length: payload.bytes.byteLength };
      }
    );
    if (staticPayloads.size !== staticFrames.length) {
      invalid("staticPayloads contains an unknown or duplicate static frame");
    }

    const unitInputs = sortById(sourceUnits, "units");
    const samplePlan = createCanonicalSamplePlan(
      normalizedRenditions.map((rendition, index) => ({
        id: identifier(rendition.id, `renditions[${String(index)}].id`),
        profile: oneOf(
          rendition.profile,
          RENDITION_PROFILES,
          `renditions[${String(index)}].profile`
        )
      })),
      unitInputs.map((unit, index) => ({
        id: identifier(unit.id, `units[${String(index)}].id`),
        frameCount: positiveInteger(
          unit.frameCount,
          `units[${String(index)}].frameCount`
        )
      })),
      budgets.maxSampleRecords,
      budgets.maxTotalUnitFrames
    );

    const units = unitInputs.map((unit, unitIndex) =>
      normalizeUnit(
        unit,
        unitIndex,
        samplePlan.unitSpans[unitIndex] ?? [],
        samplePlan.unitSpans[unitIndex]?.[0]?.sampleCount ?? 0,
        budgets
      )
    );

    const manifestCandidate = {
      ...sourceManifest,
      renditions: normalizedRenditions,
      units,
      staticFrames,
      states: sortById(sourceStates, "states"),
      edges: sortById(sourceEdges, "edges"),
      bindings: normalizeBindings(sourceBindings),
      readiness: normalizeReadiness(sourceManifest.readiness, budgets)
    };
    const manifest = validateCompiledManifestV01(manifestCandidate, options);
    adaptManifestToMotionGraph(manifest);
    const accessUnits = normalizeAccessUnits(
      accessInputs,
      samplePlan,
      budgets.maxSampleBytes
    );
    const orderedStaticPayloads = manifest.staticFrames.map((frame) => {
      const payload = staticPayloads.get(frame.id);
      if (payload === undefined) invalid(`missing payload for static frame ${frame.id}`);
      return payload;
    });

    return Object.freeze({
      manifest,
      accessUnits: Object.freeze(accessUnits),
      staticPayloads: Object.freeze(orderedStaticPayloads)
    });
  } catch (error) {
    if (isFormatError(error)) {
      if (error.code === "BUDGET_EXCEEDED" || error.code === "INTEGER_UNSAFE") {
        throw error;
      }
      throw new FormatError("WRITER_INVALID", error.message, {
        ...(error.path === undefined ? {} : { path: error.path }),
        ...(error.offset === undefined ? {} : { offset: error.offset })
      });
    }
    throw new FormatError("WRITER_INVALID", "writer input could not be normalized");
  }
}

function normalizeUnit(
  value: Record<string, unknown>,
  unitIndex: number,
  expectedSpans: readonly CanonicalSampleSpan[],
  frameCount: number,
  budgets: Readonly<FormatBudgets>
): Record<string, unknown> {
  const path = `units[${String(unitIndex)}]`;
  const kind = oneOf(value.kind, UNIT_KINDS, `${path}.kind`);
  if (kind === "body") {
    exactKeys(
      value,
      ["id", "kind", "playback", "frameCount", "ports", "samples"],
      path
    );
  } else if (kind === "reversible") {
    exactKeys(
      value,
      ["id", "kind", "frameCount", "residency", "samples"],
      path
    );
  } else {
    exactKeys(value, ["id", "kind", "frameCount", "samples"], path);
  }
  const sampleInputs = exactInputArray(
    value.samples,
    `${path}.samples`,
    expectedSpans.length
  );
  const samplesByRendition = new Map<string, Record<string, unknown>>();
  for (let index = 0; index < sampleInputs.length; index += 1) {
    const sample = record(
      sampleInputs[index],
      `${path}.samples[${String(index)}]`
    );
    exactKeys(
      sample,
      ["rendition", "sha256"],
      `${path}.samples[${String(index)}]`
    );
    const rendition = identifier(
      sample.rendition,
      `${path}.samples[${String(index)}].rendition`
    );
    if (samplesByRendition.has(rendition)) {
      invalid(`${path}.samples duplicates rendition ${rendition}`);
    }
    samplesByRendition.set(rendition, sample);
  }
  const samples = expectedSpans.map((expected) => {
    const rendition = expected.renditionId;
    const sample = samplesByRendition.get(rendition);
    if (sample === undefined) invalid(`${path}.samples is missing rendition ${rendition}`);
    return {
      ...sample,
      sampleStart: expected.sampleStart,
      sampleCount: expected.sampleCount
    };
  });
  if (samplesByRendition.size !== expectedSpans.length) {
    invalid(`${path}.samples references an unknown rendition`);
  }

  if (kind === "body") {
    const ports = sortById(
      boundedInputArray(
        value.ports,
        `${path}.ports`,
        budgets.maxPortsPerBody
      ),
      `${path}.ports`
    ).map(
      (port, index) => {
        const portPath = `${path}.ports[${String(index)}]`;
        exactKeys(port, ["id", "entryFrame", "portalFrames"], portPath);
        return {
          ...port,
          portalFrames: numericSort(
            boundedInputArray(
              port.portalFrames,
              `${portPath}.portalFrames`,
              frameCount,
              1
            ),
            `${portPath}.portalFrames`
          )
        };
      }
    );
    return { ...value, kind, ports, samples };
  }
  if (kind === "reversible") {
    const residency = record(value.residency, `${path}.residency`);
    exactKeys(residency, ["endpoints"], `${path}.residency`);
    const endpoints = exactInputArray(
      residency.endpoints,
      `${path}.residency.endpoints`,
      2
    ).map((endpoint, index) =>
      record(endpoint, `${path}.residency.endpoints[${String(index)}]`)
    ).map((endpoint, index) => {
      const endpointPath = `${path}.residency.endpoints[${String(index)}]`;
      exactKeys(endpoint, ["state", "port", "frames"], endpointPath);
      return {
        ...endpoint,
        state: identifier(endpoint.state, `${endpointPath}.state`),
        port: identifier(endpoint.port, `${endpointPath}.port`)
      };
    });
    endpoints.sort((left, right) => {
      const byState = compareAscii(left.state, right.state);
      return byState || compareAscii(left.port, right.port);
    });
    return {
      ...value,
      kind,
      residency: { ...residency, endpoints },
      samples
    };
  }
  return { ...value, kind, samples };
}

function normalizeRenditions(
  renditions: readonly Record<string, unknown>[]
): readonly Record<string, unknown>[] {
  return renditions.map((rendition) => {
    const profile = oneOf(
      rendition.profile,
      RENDITION_PROFILES,
      `rendition ${String(rendition.id)} profile`
    );
    exactKeys(
      rendition,
      profile === "reference-rgba-v0"
        ? [
            "id",
            "profile",
            "codec",
            "codedWidth",
            "codedHeight",
            "alphaLayout",
            "capabilities"
          ]
        : [
            "id",
            "profile",
            "codec",
            "codedWidth",
            "codedHeight",
            "alphaLayout",
            "bitrate",
            "capabilities"
          ],
      `rendition ${String(rendition.id)}`
    );
    const capabilities = boundedInputArray(
      rendition.capabilities,
      `rendition ${String(rendition.id)} capabilities`,
      2
    ).map((value) => {
      return oneOf(
        value,
        RENDITION_CAPABILITIES,
        `rendition ${String(rendition.id)} capability`
      );
    });
    capabilities.sort(compareAscii);
    return { ...rendition, profile, capabilities };
  });
}

function normalizeBindings(
  values: readonly unknown[]
): readonly Record<string, unknown>[] {
  const bindings = values.map((value, index) => {
    const path = `bindings[${String(index)}]`;
    const binding = record(value, path);
    exactKeys(binding, ["source", "event"], path);
    return {
      ...binding,
      source: oneOf(binding.source, BINDING_SOURCES, `${path}.source`),
      event: identifier(binding.event, `${path}.event`)
    };
  });
  bindings.sort((left, right) => {
    const source = compareAscii(left.source, right.source);
    return source || compareAscii(left.event, right.event);
  });
  return bindings;
}

function normalizeReadiness(
  value: unknown,
  budgets: Readonly<FormatBudgets>
): Record<string, unknown> {
  const readiness = record(value, "manifest.readiness");
  exactKeys(
    readiness,
    ["policy", "bootstrapUnits", "immediateEdges"],
    "manifest.readiness"
  );
  const bootstrapUnits = stringArray(
    boundedInputArray(
      readiness.bootstrapUnits,
      "readiness.bootstrapUnits",
      budgets.maxUnits
    ),
    "readiness.bootstrapUnits"
  );
  const immediateEdges = stringArray(
    boundedInputArray(
      readiness.immediateEdges,
      "readiness.immediateEdges",
      budgets.maxEdges
    ),
    "readiness.immediateEdges"
  );
  bootstrapUnits.sort(compareAscii);
  immediateEdges.sort(compareAscii);
  return { ...readiness, bootstrapUnits, immediateEdges };
}

function normalizeStaticPayloads(
  values: readonly unknown[],
  maxBytes: number
): Map<string, StaticPayloadInputV01> {
  const result = new Map<string, StaticPayloadInputV01>();
  for (let index = 0; index < values.length; index += 1) {
    const payloadRecord = record(
      values[index],
      `staticPayloads[${String(index)}]`
    );
    exactKeys(
      payloadRecord,
      ["staticFrame", "bytes"],
      `staticPayloads[${String(index)}]`
    );
    const id = identifier(
      payloadRecord.staticFrame,
      `staticPayloads[${String(index)}].staticFrame`
    );
    const bytes = byteArray(
      payloadRecord.bytes,
      maxBytes,
      `static payload ${id}`
    );
    if (result.has(id)) invalid(`duplicate static payload ${id}`);
    result.set(id, Object.freeze({ staticFrame: id, bytes }));
  }
  return result;
}

function normalizeAccessUnits(
  values: readonly unknown[],
  plan: Readonly<CanonicalSamplePlan>,
  maxBytes: number
): AccessUnitInputV01[] {
  const supplied = new Map<string, AccessUnitInputV01>();
  for (let index = 0; index < values.length; index += 1) {
    const payloadRecord = record(
      values[index],
      `accessUnits[${String(index)}]`
    );
    exactKeys(
      payloadRecord,
      ["rendition", "unit", "frameIndex", "key", "bytes"],
      `accessUnits[${String(index)}]`
    );
    const rendition = identifier(
      payloadRecord.rendition,
      "access unit rendition"
    );
    const unit = identifier(payloadRecord.unit, "access unit unit");
    const frameIndex = nonNegativeInteger(
      payloadRecord.frameIndex,
      "access unit frameIndex"
    );
    if (typeof payloadRecord.key !== "boolean") {
      invalid("access unit key must be boolean");
    }
    const bytes = byteArray(
      payloadRecord.bytes,
      maxBytes,
      "access unit payload"
    );
    const key = accessKey(rendition, unit, frameIndex);
    if (supplied.has(key)) invalid(`duplicate access unit ${key}`);
    supplied.set(
      key,
      Object.freeze({
        rendition,
        unit,
        frameIndex,
        key: payloadRecord.key,
        bytes
      })
    );
  }

  const ordered: AccessUnitInputV01[] = [];
  for (const slot of plan.slots) {
    const key = accessKey(slot.renditionId, slot.unitId, slot.frameIndex);
    const payload = supplied.get(key);
    if (payload === undefined) invalid(`missing access unit ${key}`);
    if (slot.keyRequired && !payload.key) {
      invalid(
        slot.frameIndex === 0
          ? `${key} frame zero must be key`
          : `${key} reference frame must be key`
      );
    }
    ordered.push(payload);
  }
  if (ordered.length !== supplied.size) invalid("accessUnits contains an unknown payload");
  return ordered;
}

function sortById(
  values: readonly unknown[],
  path: string
): Record<string, unknown>[] {
  const identified = values.map((value, index) => {
    const entry = record(value, `${path}[${String(index)}]`);
    return {
      entry,
      id: identifier(entry.id, `${path}[${String(index)}].id`)
    };
  });
  identified.sort((left, right) =>
    compareAscii(left.id, right.id)
  );
  return identified.map(({ entry }) => entry);
}

function numericSort(values: readonly unknown[], path: string): number[] {
  const numbers = values.map((value, index) =>
    nonNegativeInteger(value, `${path}[${String(index)}]`)
  );
  numbers.sort((left, right) => left - right);
  return numbers;
}

function stringArray(value: unknown, path: string): string[] {
  return requireArray(value, path).map((item, index) =>
    identifier(item, `${path}[${String(index)}]`)
  );
}

function byteArray(value: unknown, maximum: number, label: string): Uint8Array {
  if (!(value instanceof Uint8Array)) invalid(`${label} must be a Uint8Array`);
  if (value.byteLength === 0) invalid(`${label} must not be empty`);
  if (value.byteLength > maximum) {
    throw new FormatError("BUDGET_EXCEEDED", `${label} exceeds its byte budget`);
  }
  return value;
}

function requireArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) invalid(`${path} must be an array`);
  return value;
}

function boundedInputArray(
  value: unknown,
  path: string,
  maximum: number,
  minimum = 0
): readonly unknown[] {
  const array = requireArray(value, path);
  if (array.length > maximum) budget(`${path} count`);
  if (array.length < minimum) {
    invalid(`${path} must contain at least ${String(minimum)} entries`);
  }
  requireDenseArray(array, path);
  return array;
}

function exactInputArray(
  value: unknown,
  path: string,
  expectedLength: number
): readonly unknown[] {
  const array = requireArray(value, path);
  if (array.length !== expectedLength) {
    invalid(`${path} must contain exactly ${String(expectedLength)} entries`);
  }
  requireDenseArray(array, path);
  return array;
}

function requireDenseArray(value: readonly unknown[], path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    if (!owns(value, String(index))) {
      invalid(`${path}[${String(index)}] must not be sparse`);
    }
  }
}

function accessKey(rendition: string, unit: string, frameIndex: number): string {
  return `${rendition}\u0000${unit}\u0000${String(frameIndex)}`;
}

function budget(label: string): never {
  throw new FormatError("BUDGET_EXCEEDED", `${label} exceeds the active budget`);
}

function invalid(message: string): never {
  throw new FormatError("WRITER_INVALID", message);
}
