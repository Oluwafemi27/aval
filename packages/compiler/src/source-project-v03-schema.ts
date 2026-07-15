import {
  FORMAT_DEFAULT_BUDGETS,
  type CanvasV01
} from "@aval/format";

import {
  AVC_ENCODER_PRESETS,
  type AvcRateControlV03,
  type SourceProjectV03,
  type SourceRenditionTargetV03
} from "./model.js";
import {
  boundedArray,
  exactKeys,
  identifier,
  integer,
  invalid,
  literal,
  oneOf,
  record,
  sortUniqueById,
  tuple
} from "./schema-validation.js";
import {
  cloneSourceDescriptors,
  cloneSourceFrameRate,
  cloneSourceStates,
  cloneSourceUnits,
  greatestCommonDivisor,
  validateSourceReferences
} from "./source-project-schema-common.js";
import {
  cloneSourceBindings,
  cloneSourceEdges
} from "./source-graph-schema.js";
import { preflightSourceGraph } from "./source-graph-preflight.js";

const PROJECT_KEYS = [
  "projectVersion",
  "profile",
  "canvas",
  "frameRate",
  "sources",
  "renditions",
  "units",
  "initialState",
  "states",
  "edges",
  "bindings"
] as const;
const PNG_DIMENSION_MAX = 0xffff_ffff;

/** Validate only the exact configurable-AVC 0.3 authoring schema. */
export function validateSourceProjectV03(
  value: unknown
): Readonly<SourceProjectV03> {
  const input = record(value, "project");
  exactKeys(input, PROJECT_KEYS, "project");
  literal(input.projectVersion, "0.3", "project.projectVersion");
  const profile = oneOf(input.profile, [
    "avc-annexb-auto-v1",
    "avc-annexb-opaque-v1",
    "avc-annexb-packed-alpha-v1"
  ] as const, "project.profile");
  const canvas = cloneCanvasV03(input.canvas);
  const frameRate = cloneSourceFrameRate(input.frameRate);
  const sources = cloneSourceDescriptors(input.sources);
  const renditions = cloneRenditionsV03(input.renditions, canvas);
  const units = cloneSourceUnits(input.units, sources);
  const states = cloneSourceStates(input.states, units);
  const edges = cloneSourceEdges(input.edges, FORMAT_DEFAULT_BUDGETS.maxEdges);
  const bindings = cloneSourceBindings(
    input.bindings,
    FORMAT_DEFAULT_BUDGETS.maxBindings
  );
  const initialState = identifier(input.initialState, "project.initialState");
  validateSourceReferences({
    initialState,
    sources,
    units,
    states,
    edges,
    bindings
  });
  const project = Object.freeze({
    projectVersion: "0.3" as const,
    profile,
    canvas,
    frameRate,
    sources,
    renditions,
    units,
    initialState,
    states,
    edges,
    bindings
  });
  preflightSourceGraph(project);
  return project;
}

function cloneCanvasV03(value: unknown): CanvasV01 {
  const input = record(value, "canvas");
  exactKeys(
    input,
    ["width", "height", "fit", "pixelAspect", "colorSpace"],
    "canvas"
  );
  const width = integer(input.width, "canvas.width", 1, PNG_DIMENSION_MAX);
  const height = integer(input.height, "canvas.height", 1, PNG_DIMENSION_MAX);
  const aspectInput = tuple(input.pixelAspect, 2, "canvas.pixelAspect");
  const numerator = integer(
    aspectInput[0],
    "canvas.pixelAspect[0]",
    1,
    10_000
  );
  const denominator = integer(
    aspectInput[1],
    "canvas.pixelAspect[1]",
    1,
    10_000
  );
  if (greatestCommonDivisor(numerator, denominator) !== 1) {
    invalid("canvas.pixelAspect", "must be a reduced positive fraction");
  }
  return Object.freeze({
    width,
    height,
    fit: oneOf(
      input.fit,
      ["contain", "cover", "fill", "none"] as const,
      "canvas.fit"
    ),
    pixelAspect: Object.freeze([numerator, denominator]) as readonly [
      number,
      number
    ],
    colorSpace: literal(input.colorSpace, "srgb", "canvas.colorSpace")
  });
}

function cloneRenditionsV03(
  value: unknown,
  canvas: CanvasV01
): readonly SourceRenditionTargetV03[] {
  const inputs = boundedArray(
    value,
    "renditions",
    1,
    FORMAT_DEFAULT_BUDGETS.maxRenditions
  );
  return sortUniqueById(inputs.map((entry, index) => {
    const path = `renditions[${String(index)}]`;
    const input = record(entry, path);
    exactKeys(input, ["id", "width", "height", "encoding"], path);
    const width = integer(input.width, `${path}.width`, 1);
    const height = integer(input.height, `${path}.height`, 1);
    if (
      width > canvas.width ||
      height > canvas.height ||
      BigInt(width) * BigInt(canvas.height) !==
        BigInt(height) * BigInt(canvas.width)
    ) {
      invalid(
        path,
        "visible dimensions must be canvas-bounded and preserve source aspect"
      );
    }
    return Object.freeze({
      id: identifier(input.id, `${path}.id`),
      width,
      height,
      encoding: cloneEncodingV03(input.encoding, `${path}.encoding`)
    });
  }), "renditions");
}

function cloneEncodingV03(
  value: unknown,
  path: string
): SourceRenditionTargetV03["encoding"] {
  const input = record(value, path);
  exactKeys(input, ["codec", "preset", "rateControl"], path);
  return Object.freeze({
    codec: literal(input.codec, "h264", `${path}.codec`),
    preset: oneOf(input.preset, AVC_ENCODER_PRESETS, `${path}.preset`),
    rateControl: cloneRateControlV03(
      input.rateControl,
      `${path}.rateControl`
    )
  });
}

function cloneRateControlV03(
  value: unknown,
  path: string
): AvcRateControlV03 {
  const input = record(value, path);
  if (input.mode === "abr") {
    exactKeys(input, ["mode", "averageBitrate", "maxBitrate"], path);
    const averageBitrate = integer(
      input.averageBitrate,
      `${path}.averageBitrate`,
      1
    );
    const maxBitrate = integer(
      input.maxBitrate,
      `${path}.maxBitrate`,
      averageBitrate
    );
    return Object.freeze({ mode: "abr", averageBitrate, maxBitrate });
  }
  if (input.mode === "crf") {
    exactKeys(input, ["mode", "crf", "maxBitrate"], path);
    return Object.freeze({
      mode: "crf",
      crf: integer(input.crf, `${path}.crf`, 1, 51),
      maxBitrate: integer(input.maxBitrate, `${path}.maxBitrate`, 1)
    });
  }
  invalid(`${path}.mode`, "must be one of abr, crf");
}
