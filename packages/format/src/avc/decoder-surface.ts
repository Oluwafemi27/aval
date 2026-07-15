import { FormatError } from "../errors.js";

/**
 * Browser-owned decoded-frame allocation may extend the exact SPS coded
 * surface by two macroblocks. Chromium 140 has been observed to expose a
 * 16x16 SPS as a 32x34 coded frame while retaining the exact 16x16 visible rectangle.
 * Reserve two complete macroblocks per axis so those implementation pixels
 * remain bounded without becoming part of the wire/profile geometry.
 */
export const AVC_DECODER_SURFACE_PADDING = 32;

/** Conservative browser-decoder coded-surface bound for one AVC dimension. */
export function maximumAvcDecoderSurfaceDimension(dimension: number): number {
  if (!Number.isSafeInteger(dimension) || dimension < 1) {
    throw new FormatError(
      "INPUT_INVALID",
      "AVC decoder surface dimension must be a positive safe integer"
    );
  }
  const aligned = dimension % 16 === 0
    ? dimension
    : checkedAdd(dimension, 16 - dimension % 16);
  return checkedAdd(aligned, AVC_DECODER_SURFACE_PADDING);
}

/** Worst-case logical RGBA lease for a decoder surface, including padding. */
export function maximumAvcDecodedRgbaBytes(
  codedWidth: number,
  codedHeight: number
): number {
  const width = maximumAvcDecoderSurfaceDimension(codedWidth);
  const height = maximumAvcDecoderSurfaceDimension(codedHeight);
  return checkedMultiply(checkedMultiply(width, height), 4);
}

function checkedAdd(left: number, right: number): number {
  if (left > Number.MAX_SAFE_INTEGER - right) {
    throw new FormatError("INPUT_INVALID", "AVC decoder surface size exceeds the safe-integer range");
  }
  return left + right;
}

function checkedMultiply(left: number, right: number): number {
  if (left !== 0 && right > Math.floor(Number.MAX_SAFE_INTEGER / left)) {
    throw new FormatError("INPUT_INVALID", "AVC decoded byte size exceeds the safe-integer range");
  }
  return left * right;
}
