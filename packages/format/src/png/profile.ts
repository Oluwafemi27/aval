import { resolveFormatBudgets } from "../constants.js";
import { FormatError, isFormatError } from "../errors.js";
import type { ByteRange, FormatOptions } from "../model.js";
import { parseRestrictedPngChunks } from "./chunks.js";
import { validateZlibEnvelope } from "./zlib-envelope.js";

const MAX_PNG_BYTES = 2 * 1024 * 1024;
const MAX_DIMENSION = 512;

export interface PngProfileValidationInput {
  readonly png: Uint8Array;
  readonly expectedWidth: number;
  readonly expectedHeight: number;
  readonly options?: FormatOptions | undefined;
}

export interface PngDecodePlan {
  readonly width: number;
  readonly height: number;
  readonly byteRange: ByteRange;
  readonly expectedFilteredBytes: number;
  readonly expectedRgbaBytes: number;
  readonly zlibByteLength: number;
  readonly deflateRange: ByteRange;
  readonly declaredAdler32: number;
  readonly copyZlibBytes: () => Uint8Array;
}

const OWNED_ZLIB = new WeakMap<PngDecodePlan, Uint8Array>();

export function validatePngProfile(
  input: PngProfileValidationInput
): PngDecodePlan {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      fail("PNG profile validation input must be an object");
    }
    const expectedWidth = expectedDimension(
      input.expectedWidth,
      "expected PNG width"
    );
    const expectedHeight = expectedDimension(
      input.expectedHeight,
      "expected PNG height"
    );
    const budgets = resolveFormatBudgets(input.options);
    const maximumPngBytes = Math.min(MAX_PNG_BYTES, budgets.maxStaticPngBytes);
    const chunks = parseRestrictedPngChunks({
      png: input.png,
      expectedWidth,
      expectedHeight,
      maximumPngBytes
    });
    const expectedRgbaBytes = expectedWidth * expectedHeight * 4;
    const expectedFilteredBytes = expectedHeight * (1 + expectedWidth * 4);
    const zlib = validateZlibEnvelope(chunks.zlibBytes);
    let plan: PngDecodePlan;
    plan = Object.freeze({
      width: chunks.width,
      height: chunks.height,
      byteRange: Object.freeze({ offset: 0, length: input.png.byteLength }),
      expectedFilteredBytes,
      expectedRgbaBytes,
      zlibByteLength: chunks.zlibBytes.byteLength,
      deflateRange: zlib.deflateRange,
      declaredAdler32: zlib.declaredAdler32,
      copyZlibBytes: () => readOwnedPngZlib(plan).slice()
    });
    OWNED_ZLIB.set(plan, chunks.zlibBytes);
    return plan;
  } catch (error) {
    if (isFormatError(error)) throw error;
    throw new FormatError(
      "PNG_ENVELOPE_INVALID",
      "PNG profile could not be validated"
    );
  }
}

/** Package-internal zero-copy access to the detached zlib member. */
export function readOwnedPngZlib(plan: PngDecodePlan): Uint8Array {
  const bytes = OWNED_ZLIB.get(plan);
  if (bytes === undefined) {
    throw new FormatError(
      "PNG_ENVELOPE_INVALID",
      "PNG decode plan was not produced by the format validator"
    );
  }
  return bytes;
}

function expectedDimension(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_DIMENSION
  ) {
    fail(`${label} must be from 1 through ${String(MAX_DIMENSION)}`);
  }
  return value;
}

function fail(message: string): never {
  throw new FormatError("PNG_ENVELOPE_INVALID", message);
}
