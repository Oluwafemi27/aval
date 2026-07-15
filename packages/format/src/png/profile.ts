import { resolveFormatBudgets } from "../constants.js";
import { FormatError, isFormatError } from "../errors.js";
import type { ByteRange, FormatOptions } from "../model.js";
import { parseRestrictedPngChunks } from "./chunks.js";
import {
  derivePngRgbaLayout,
  type PngRgbaLayout
} from "./unfilter.js";
import { validateZlibEnvelope } from "./zlib-envelope.js";

const UINT32_MAX = 0xffff_ffff;

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
const OWNED_LAYOUT = new WeakMap<PngDecodePlan, Readonly<PngRgbaLayout>>();

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
    const chunks = parseRestrictedPngChunks({
      png: input.png,
      expectedWidth,
      expectedHeight,
      maximumPngBytes: budgets.maxPngBytes
    });
    const layout = derivePngRgbaLayout(expectedWidth, expectedHeight);
    const zlib = validateZlibEnvelope(chunks.zlibBytes);
    let plan: PngDecodePlan;
    plan = Object.freeze({
      width: chunks.width,
      height: chunks.height,
      byteRange: Object.freeze({ offset: 0, length: input.png.byteLength }),
      expectedFilteredBytes: layout.filteredBytes,
      expectedRgbaBytes: layout.rgbaBytes,
      zlibByteLength: chunks.zlibBytes.byteLength,
      deflateRange: zlib.deflateRange,
      declaredAdler32: zlib.declaredAdler32,
      copyZlibBytes: () => copyOwnedPngZlib(plan)
    });
    OWNED_ZLIB.set(plan, chunks.zlibBytes);
    OWNED_LAYOUT.set(plan, layout);
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

function copyOwnedPngZlib(plan: PngDecodePlan): Uint8Array {
  const bytes = readOwnedPngZlib(plan);
  try {
    return bytes.slice();
  } catch {
    throw new FormatError(
      "PNG_ENVELOPE_INVALID",
      `PNG zlib copy allocation failed for ${String(bytes.byteLength)} bytes`
    );
  }
}

/** Package-internal access to the checked layout associated with a plan. */
export function readOwnedPngLayout(
  plan: PngDecodePlan
): Readonly<PngRgbaLayout> {
  const layout = OWNED_LAYOUT.get(plan);
  if (layout === undefined) {
    throw new FormatError(
      "PNG_ENVELOPE_INVALID",
      "PNG decode plan was not produced by the format validator"
    );
  }
  return layout;
}

function expectedDimension(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > UINT32_MAX
  ) {
    fail(`${label} must be from 1 through ${String(UINT32_MAX)}`);
  }
  return value;
}

function fail(message: string): never {
  throw new FormatError("PNG_ENVELOPE_INVALID", message);
}
