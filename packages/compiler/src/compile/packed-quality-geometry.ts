import type { AvcRenditionGeometry, Rect } from "@aval/format";

import { CompilerError } from "../diagnostics.js";
import { revalidateAvcRenditionGeometry } from "./validated-rendition-geometry.js";

export interface PackedQualityGeometry {
  readonly storageWidth: number;
  readonly storageHeight: number;
  readonly decodedRgbaBytes: number;
  readonly visibleRgbaBytes: number;
  readonly sampleCount: number;
  readonly colorRect: Readonly<{
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }>;
  readonly alphaRect: Readonly<{
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }>;
}

/** Revalidate packed geometry through the format owner, then expose loop facts. */
export function packedQualityGeometry(
  geometry: Readonly<AvcRenditionGeometry>
): Readonly<PackedQualityGeometry> {
  if (
    geometry?.profile !== "avc-annexb-packed-alpha-v0" &&
    geometry?.profile !== "avc-annexb-packed-alpha-v1"
  ) {
    throw invalid();
  }
  const validated = revalidateAvcRenditionGeometry(geometry, {
    message: "Packed quality geometry is invalid"
  });
  const color = validated.visibleColorRect;
  const alpha = validated.visibleAlphaRect!;
  const storage = validated.decodedStorageRect;
  return Object.freeze({
    storageWidth: storage[2],
    storageHeight: storage[3],
    decodedRgbaBytes: validated.decodedRgbaBytes,
    visibleRgbaBytes: validated.visibleColorArea * 4,
    sampleCount: validated.visibleColorArea,
    colorRect: rectFacts(color),
    alphaRect: rectFacts(alpha)
  });
}

function rectFacts(rect: Rect): PackedQualityGeometry["colorRect"] {
  return Object.freeze({
    x: rect[0],
    y: rect[1],
    width: rect[2],
    height: rect[3]
  });
}

function invalid(): CompilerError {
  return new CompilerError(
    "INPUT_INVALID",
    "Packed quality geometry is invalid"
  );
}
