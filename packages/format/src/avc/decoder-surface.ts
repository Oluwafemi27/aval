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
  if (!Number.isSafeInteger(dimension) || dimension < 1 || dimension > 2_048) {
    throw new FormatError(
      "INPUT_INVALID",
      "AVC decoder surface dimension must be between 1 and 2048"
    );
  }
  return Math.ceil(dimension / 16) * 16 + AVC_DECODER_SURFACE_PADDING;
}

/** Worst-case logical RGBA lease for a decoder surface, including padding. */
export function maximumAvcDecodedRgbaBytes(
  codedWidth: number,
  codedHeight: number
): number {
  return maximumAvcDecoderSurfaceDimension(codedWidth) *
    maximumAvcDecoderSurfaceDimension(codedHeight) * 4;
}
