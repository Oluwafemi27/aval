import type { AvcRenditionGeometry } from "@aval/format";

import { CompilerError } from "../diagnostics.js";
import {
  bt709LimitedAlphaLuma,
  bt709LimitedChroma2x2,
  bt709LimitedLuma
} from "./bt709-limited.js";
import { dilateTransparentRgba } from "./rgba-dilation.js";
import { revalidateAvcRenditionGeometry } from "./validated-rendition-geometry.js";

export interface PlanarYuv420Plane {
  readonly offset: number;
  readonly length: number;
  readonly stride: number;
  readonly width: number;
  readonly height: number;
}

export interface PlanarYuv420Planes {
  readonly y: Readonly<PlanarYuv420Plane>;
  readonly cb: Readonly<PlanarYuv420Plane>;
  readonly cr: Readonly<PlanarYuv420Plane>;
}

export interface PackedPlanarYuv420Frame {
  readonly codedWidth: number;
  readonly codedHeight: number;
  readonly data: Uint8Array;
  readonly planes: Readonly<PlanarYuv420Planes>;
}

export interface PackRgbaToPlanarYuv420Input {
  readonly geometry: Readonly<AvcRenditionGeometry>;
  readonly rgba: Uint8Array;
}

/** Pack one visible RGBA frame into deterministic coded planar yuv420p. */
export function packRgbaToPlanarYuv420(
  input: Readonly<PackRgbaToPlanarYuv420Input>
): Readonly<PackedPlanarYuv420Frame> {
  if (typeof input !== "object" || input === null) {
    throw invalid("Planar YUV input must be an object");
  }
  const facts = validateGeometry(input.geometry);
  if (!(input.rgba instanceof Uint8Array)) {
    throw invalid("Planar YUV packing requires RGBA bytes");
  }
  const expectedRgbaBytes = checkedProduct(
    facts.visibleWidth,
    facts.visibleHeight,
    4
  );
  if (input.rgba.byteLength !== expectedRgbaBytes) {
    throw invalid("RGBA byte length does not match the visible color rectangle");
  }

  const layout = createPlaneLayout(facts.codedWidth, facts.codedHeight);
  const data = new Uint8Array(layout.totalLength);
  data.fill(16, layout.planes.y.offset, layout.planes.cb.offset);
  data.fill(128, layout.planes.cb.offset);
  const dilated = dilateTransparentRgba({
    width: facts.visibleWidth,
    height: facts.visibleHeight,
    rgba: input.rgba
  });
  writeColorLuma(data, dilated, facts);
  writeColorChroma(data, dilated, facts, layout.planes);
  if (facts.alphaY !== null) {
    writeAlphaLuma(data, input.rgba, facts);
  }
  return Object.freeze({
    codedWidth: facts.codedWidth,
    codedHeight: facts.codedHeight,
    data,
    planes: layout.planes
  });
}

interface PackingFacts {
  readonly visibleWidth: number;
  readonly visibleHeight: number;
  readonly alphaY: number | null;
  readonly codedWidth: number;
  readonly codedHeight: number;
}

function validateGeometry(
  geometry: Readonly<AvcRenditionGeometry>
): Readonly<PackingFacts> {
  const validated = revalidateAvcRenditionGeometry(geometry, {
    message: "Planar YUV coded dimensions or geometry are invalid",
    details: { phase: "packing" }
  });
  return Object.freeze({
    visibleWidth: validated.visibleColorRect[2],
    visibleHeight: validated.visibleColorRect[3],
    alphaY: validated.visibleAlphaRect?.[1] ?? null,
    codedWidth: validated.codedWidth,
    codedHeight: validated.codedHeight
  });
}

function createPlaneLayout(
  codedWidth: number,
  codedHeight: number
): {
  readonly planes: Readonly<PlanarYuv420Planes>;
  readonly totalLength: number;
} {
  const yLength = checkedProduct(codedWidth, codedHeight);
  const chromaWidth = codedWidth / 2;
  const chromaHeight = codedHeight / 2;
  const chromaLength = checkedProduct(chromaWidth, chromaHeight);
  const cbOffset = yLength;
  const crOffset = checkedSum(cbOffset, chromaLength);
  const totalLength = checkedSum(crOffset, chromaLength);
  const y = freezePlane(0, yLength, codedWidth, codedWidth, codedHeight);
  const cb = freezePlane(
    cbOffset,
    chromaLength,
    chromaWidth,
    chromaWidth,
    chromaHeight
  );
  const cr = freezePlane(
    crOffset,
    chromaLength,
    chromaWidth,
    chromaWidth,
    chromaHeight
  );
  return Object.freeze({
    planes: Object.freeze({ y, cb, cr }),
    totalLength
  });
}

function writeColorLuma(
  output: Uint8Array,
  rgba: Uint8Array,
  facts: Readonly<PackingFacts>
): void {
  for (let y = 0; y < facts.visibleHeight; y += 1) {
    for (let x = 0; x < facts.visibleWidth; x += 1) {
      const source = (y * facts.visibleWidth + x) * 4;
      output[y * facts.codedWidth + x] = bt709LimitedLuma(
        rgba[source]!,
        rgba[source + 1]!,
        rgba[source + 2]!
      );
    }
  }
}

function writeColorChroma(
  output: Uint8Array,
  rgba: Uint8Array,
  facts: Readonly<PackingFacts>,
  planes: Readonly<PlanarYuv420Planes>
): void {
  const block = new Uint8Array(12);
  for (let y = 0; y < facts.visibleHeight; y += 2) {
    for (let x = 0; x < facts.visibleWidth; x += 2) {
      block.fill(0);
      for (let deltaY = 0; deltaY < 2; deltaY += 1) {
        for (let deltaX = 0; deltaX < 2; deltaX += 1) {
          const sourceX = x + deltaX;
          const sourceY = y + deltaY;
          if (
            sourceX >= facts.visibleWidth ||
            sourceY >= facts.visibleHeight
          ) continue;
          const source = (
            sourceY * facts.visibleWidth + sourceX
          ) * 4;
          const target = (deltaY * 2 + deltaX) * 3;
          block[target] = rgba[source]!;
          block[target + 1] = rgba[source + 1]!;
          block[target + 2] = rgba[source + 2]!;
        }
      }
      const chroma = bt709LimitedChroma2x2(block);
      const index = (y / 2) * planes.cb.stride + x / 2;
      output[planes.cb.offset + index] = chroma.cb;
      output[planes.cr.offset + index] = chroma.cr;
    }
  }
}

function writeAlphaLuma(
  output: Uint8Array,
  rgba: Uint8Array,
  facts: Readonly<PackingFacts>
): void {
  const alphaY = facts.alphaY;
  if (alphaY === null) return;
  for (let y = 0; y < facts.visibleHeight; y += 1) {
    for (let x = 0; x < facts.visibleWidth; x += 1) {
      const source = (y * facts.visibleWidth + x) * 4;
      output[(alphaY + y) * facts.codedWidth + x] =
        bt709LimitedAlphaLuma(rgba[source + 3]!);
    }
  }
}

function freezePlane(
  offset: number,
  length: number,
  stride: number,
  width: number,
  height: number
): Readonly<PlanarYuv420Plane> {
  return Object.freeze({ offset, length, stride, width, height });
}

function checkedProduct(...values: number[]): number {
  let product = 1;
  for (const value of values) {
    product *= value;
    if (!Number.isSafeInteger(product) || product < 0) {
      throw invalid("Planar YUV size product exceeds the safe integer range");
    }
  }
  return product;
}

function checkedSum(left: number, right: number): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum) || sum < 0) {
    throw invalid("Planar YUV size sum exceeds the safe integer range");
  }
  return sum;
}

function invalid(message: string): CompilerError {
  return new CompilerError("INPUT_INVALID", message, { phase: "packing" });
}
