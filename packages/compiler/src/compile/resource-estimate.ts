import type {
  AccessUnitInputV01,
  AvcRenditionGeometry,
  DeclaredLimitsV01
} from "@aval/format";
import { FORMAT_DEFAULT_BUDGETS } from "@aval/format";

import { CompilerError } from "../diagnostics.js";
import type { NormalizedSourceProject } from "../model.js";

/** Compute diagnostic runtime terms without inventing a hard host policy. */
export function estimateRuntimeLimits(
  project: NormalizedSourceProject,
  accessUnits: readonly AccessUnitInputV01[],
  geometries: readonly Readonly<AvcRenditionGeometry>[]
): DeclaredLimitsV01 {
  if (geometries.length !== project.renditions.length || geometries.length < 1) {
    throw new CompilerError("INPUT_INVALID", "Rendition geometry set is incomplete");
  }
  const decodedPixelBytes = Math.max(
    ...geometries.map(({ codedRgbaBytes }) => codedRgbaBytes)
  );
  const reversibleFrames = project.units.reduce((total, unit) =>
    checkedSum(
      total,
      unit.kind === "reversible" ? unit.range[1] - unit.range[0] : 0,
      "reversible frame count"
    ), 0);
  const runwayFrames = project.units.reduce((total, unit) => {
    if (unit.kind !== "reversible") return total;
    return unit.residency.endpoints.reduce(
      (subtotal, endpoint) =>
        checkedSum(subtotal, endpoint.frames, "residency runway frames"),
      total
    );
  }, 0);
  const cutFrames = project.edges.reduce(
    (total, edge) => checkedSum(
      total,
      edge.start.type === "cut" ? (edge.targetRunwayFrames ?? 0) : 0,
      "cut runway frames"
    ),
    0
  );
  const persistentFrames = checkedSum(
    checkedSum(reversibleFrames, runwayFrames, "persistent frame count"),
    cutFrames,
    "persistent frame count"
  );
  const persistentCacheBytes = checkedProduct(
    [persistentFrames, decodedPixelBytes],
    "persistent cache bytes"
  );

  const encodedByRendition = new Map<string, number>();
  for (const sample of accessUnits) {
    encodedByRendition.set(
      sample.rendition,
      checkedSum(
        encodedByRendition.get(sample.rendition) ?? 0,
        sample.bytes.byteLength,
        "encoded rendition bytes"
      )
    );
  }
  const largestEncodedRendition = Math.max(0, ...encodedByRendition.values());
  const canvasPixelBytes = checkedProduct(
    [project.canvas.width, project.canvas.height, 4],
    "canvas pixel bytes"
  );
  const decoderRingBytes = checkedProduct(
    [12, decodedPixelBytes],
    "decoder ring bytes"
  );
  const runtimeWorkingSetBytes = [
    persistentCacheBytes,
    decoderRingBytes,
    largestEncodedRendition,
    canvasPixelBytes
  ].reduce((total, value) =>
    checkedSum(total, value, "runtime working-set bytes"), 0);
  return Object.freeze({
    maxCompiledBytes: FORMAT_DEFAULT_BUDGETS.maxFileBytes,
    maxRuntimeBytes: Number.MAX_SAFE_INTEGER,
    decodedPixelBytes,
    persistentCacheBytes,
    runtimeWorkingSetBytes
  });
}

function checkedSum(left: number, right: number, label: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new CompilerError("SOURCE_LIMIT", `${label} exceeds safe arithmetic`);
  }
  return result;
}

function checkedProduct(values: readonly number[], label: string): number {
  return values.reduce((result, value) => {
    if (
      !Number.isSafeInteger(value) ||
      value < 0 ||
      (value !== 0 && result > Math.floor(Number.MAX_SAFE_INTEGER / value))
    ) {
      throw new CompilerError("SOURCE_LIMIT", `${label} exceeds safe arithmetic`);
    }
    return result * value;
  }, 1);
}
