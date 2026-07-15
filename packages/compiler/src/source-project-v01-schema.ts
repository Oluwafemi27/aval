import {
  FORMAT_DEFAULT_BUDGETS,
  type CanvasV01
} from "@aval/format";

import type {
  OpaqueRenditionTargetV01,
  SourceProjectV01
} from "./model.js";
import {
  boundedArray,
  identifier,
  exactKeys,
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

/** Validate only the exact M5 authoring schema. */
export function validateSourceProjectV01(
  value: unknown
): Readonly<SourceProjectV01> {
  const input = record(value, "project");
  exactKeys(input, PROJECT_KEYS, "project");
  literal(input.projectVersion, "0.1", "project.projectVersion");
  literal(input.profile, "avc-annexb-opaque-v0", "project.profile");
  const canvas = cloneCanvasV01(input.canvas);
  const frameRate = cloneSourceFrameRate(input.frameRate);
  const sources = cloneSourceDescriptors(input.sources);
  const renditions = cloneOpaqueRenditionsV01(input.renditions, canvas);
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
    projectVersion: "0.1" as const,
    profile: "avc-annexb-opaque-v0" as const,
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

function cloneCanvasV01(value: unknown): CanvasV01 {
  const input = record(value, "canvas");
  exactKeys(
    input,
    ["width", "height", "fit", "pixelAspect", "colorSpace"],
    "canvas"
  );
  const width = integer(input.width, "canvas.width", 16, PNG_DIMENSION_MAX);
  const height = integer(input.height, "canvas.height", 16, PNG_DIMENSION_MAX);
  if (width % 16 !== 0 || height % 16 !== 0) {
    invalid("canvas", "dimensions must be multiples of 16 for M5 AVC");
  }
  const aspect = tuple(input.pixelAspect, 2, "canvas.pixelAspect");
  literal(aspect[0], 1, "canvas.pixelAspect[0]");
  literal(aspect[1], 1, "canvas.pixelAspect[1]");
  return Object.freeze({
    width,
    height,
    fit: oneOf(
      input.fit,
      ["contain", "cover", "fill", "none"] as const,
      "canvas.fit"
    ),
    pixelAspect: Object.freeze([1, 1]) as readonly [1, 1],
    colorSpace: literal(input.colorSpace, "srgb", "canvas.colorSpace")
  });
}

function cloneOpaqueRenditionsV01(
  value: unknown,
  canvas: CanvasV01
): readonly OpaqueRenditionTargetV01[] {
  const inputs = boundedArray(
    value,
    "renditions",
    1,
    FORMAT_DEFAULT_BUDGETS.maxRenditions
  );
  return sortUniqueById(inputs.map((entry, index) => {
    const path = `renditions[${String(index)}]`;
    const input = record(entry, path);
    exactKeys(input, ["id", "codedWidth", "codedHeight", "bitrate"], path);
    const codedWidth = integer(input.codedWidth, `${path}.codedWidth`, 16);
    const codedHeight = integer(input.codedHeight, `${path}.codedHeight`, 16);
    if (
      codedWidth % 16 !== 0 ||
      codedHeight % 16 !== 0 ||
      codedWidth > canvas.width ||
      codedHeight > canvas.height ||
      BigInt(codedWidth) * BigInt(canvas.height) !==
        BigInt(codedHeight) * BigInt(canvas.width)
    ) {
      invalid(
        path,
        "dimensions must be 16-aligned, canvas-bounded, and preserve canvas aspect"
      );
    }
    const bitrateInput = record(input.bitrate, `${path}.bitrate`);
    exactKeys(bitrateInput, ["average", "peak"], `${path}.bitrate`);
    const average = integer(
      bitrateInput.average,
      `${path}.bitrate.average`,
      1
    );
    const peak = integer(
      bitrateInput.peak,
      `${path}.bitrate.peak`,
      average
    );
    return Object.freeze({
      id: identifier(input.id, `${path}.id`),
      codedWidth,
      codedHeight,
      bitrate: Object.freeze({ average, peak })
    });
  }), "renditions");
}
