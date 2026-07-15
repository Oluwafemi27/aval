import { checkedAdd } from "../checked-integer.js";
import { FormatError, isFormatError } from "../errors.js";
import { adler32 } from "./crc32.js";
import { inflateDeflate } from "./deflate.js";
import {
  readOwnedPngLayout,
  readOwnedPngZlib,
  type PngDecodePlan
} from "./profile.js";
import { unfilterPngRgba } from "./unfilter.js";

export interface PngRgbaDecodeResult {
  readonly width: number;
  readonly height: number;
  /** Fresh caller-owned straight RGBA bytes. */
  readonly rgba: Uint8Array;
}

/** Decode through the bounded platform-free RFC 1950/1951 implementation. */
export function decodePngRgba(plan: PngDecodePlan): PngRgbaDecodeResult {
  try {
    const zlib = readOwnedPngZlib(plan);
    const deflateEnd = checkedAdd(
      plan.deflateRange.offset,
      plan.deflateRange.length,
      zlib.byteLength,
      "PNG DEFLATE range end"
    );
    const filtered = inflateDeflate({
      deflate: zlib.subarray(plan.deflateRange.offset, deflateEnd),
      expectedOutputLength: plan.expectedFilteredBytes
    });
    return decodePngRgbaFromInflated(plan, filtered);
  } catch (error) {
    if (isFormatError(error)) throw error;
    throw new FormatError(
      "PNG_DEFLATE_INVALID",
      "PNG could not be decoded"
    );
  }
}

/** Validate already-inflated bytes before the later native adapter may use them. */
export function decodePngRgbaFromInflated(
  plan: PngDecodePlan,
  filtered: Uint8Array
): PngRgbaDecodeResult {
  try {
    // Also authenticates the plan brand without retaining or cloning its bytes.
    readOwnedPngZlib(plan);
    if (!(filtered instanceof Uint8Array)) {
      deflateFail("inflated PNG bytes must be a Uint8Array");
    }
    if (filtered.byteLength !== plan.expectedFilteredBytes) {
      deflateFail("inflated PNG length does not match the decode plan");
    }
    if (adler32(filtered) !== plan.declaredAdler32) {
      deflateFail("inflated PNG Adler-32 does not match the zlib trailer");
    }
    const rgba = unfilterPngRgba({
      filtered,
      layout: readOwnedPngLayout(plan)
    });
    if (rgba.byteLength !== plan.expectedRgbaBytes) {
      deflateFail("decoded RGBA length does not match the decode plan");
    }
    return Object.freeze({ width: plan.width, height: plan.height, rgba });
  } catch (error) {
    if (isFormatError(error)) throw error;
    throw new FormatError(
      "PNG_DEFLATE_INVALID",
      "inflated PNG bytes could not be validated"
    );
  }
}

function deflateFail(message: string): never {
  throw new FormatError("PNG_DEFLATE_INVALID", message);
}
