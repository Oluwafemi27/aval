import { resolveFormatBudgets } from "./constants.js";
import { checkedNonNegativeInteger, requireByteRange } from "./checked-integer.js";
import { FormatError, isFormatError } from "./errors.js";
import type { ByteRange, FormatOptions } from "./model.js";

const PNG_SIGNATURE = Object.freeze([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
] as const);
const IHDR_TYPE = Object.freeze([0x49, 0x48, 0x44, 0x52] as const);
const IHDR_DATA_LENGTH = 13;
const IHDR_ENVELOPE_END = 33;

export interface PngEnvelopeValidationInput {
  readonly png: Uint8Array;
  readonly expectedWidth: number;
  readonly expectedHeight: number;
  readonly options?: FormatOptions | undefined;
}

export interface PngEnvelopeDescriptor {
  readonly width: number;
  readonly height: number;
  readonly byteRange: ByteRange;
}

function fail(message: string, offset?: number): never {
  throw new FormatError(
    "PNG_ENVELOPE_INVALID",
    message,
    offset === undefined ? undefined : { offset }
  );
}

function readUint32BE(bytes: Uint8Array, offset: number, label: string): number {
  requireByteRange(bytes, offset, 4, "PNG_ENVELOPE_INVALID", label);
  return (
    (bytes[offset] as number) * 0x100_0000 +
    (bytes[offset + 1] as number) * 0x1_0000 +
    (bytes[offset + 2] as number) * 0x100 +
    (bytes[offset + 3] as number)
  );
}

function positiveExpectedDimension(value: unknown, label: string): number {
  const dimension = checkedNonNegativeInteger(value, label);
  if (dimension === 0 || dimension > 0xffff_ffff) {
    fail(`${label} must be a positive uint32`);
  }
  return dimension;
}

/**
 * Validate only the PNG signature and complete first IHDR chunk envelope.
 *
 * CRCs and every chunk after IHDR are intentionally deferred to M6.
 */
export function validatePngEnvelope(
  input: PngEnvelopeValidationInput
): Readonly<PngEnvelopeDescriptor> {
  try {
    if (typeof input !== "object" || input === null) {
      fail("PNG envelope validation input must be an object");
    }
    const expectedWidth = positiveExpectedDimension(
      input.expectedWidth,
      "expected PNG width"
    );
    const expectedHeight = positiveExpectedDimension(
      input.expectedHeight,
      "expected PNG height"
    );
    const budgets = resolveFormatBudgets(input.options);
    requireByteRange(
      input.png,
      0,
      IHDR_ENVELOPE_END,
      "PNG_ENVELOPE_INVALID",
      "PNG IHDR envelope"
    );
    if (input.png.byteLength > budgets.maxStaticPngBytes) {
      throw new FormatError(
        "BUDGET_EXCEEDED",
        `PNG length exceeds the active limit of ${String(budgets.maxStaticPngBytes)}`
      );
    }
    for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
      if (input.png[index] !== PNG_SIGNATURE[index]) {
        fail("PNG signature is invalid", index);
      }
    }
    if (readUint32BE(input.png, 8, "PNG IHDR length") !== IHDR_DATA_LENGTH) {
      fail("first PNG chunk must have a 13-byte IHDR payload", 8);
    }
    for (let index = 0; index < IHDR_TYPE.length; index += 1) {
      if (input.png[12 + index] !== IHDR_TYPE[index]) {
        fail("first PNG chunk must be IHDR", 12 + index);
      }
    }
    const width = readUint32BE(input.png, 16, "PNG width");
    const height = readUint32BE(input.png, 20, "PNG height");
    if (width === 0 || height === 0) {
      fail("PNG dimensions must be positive", width === 0 ? 16 : 20);
    }
    if (width !== expectedWidth || height !== expectedHeight) {
      fail("PNG dimensions do not match the static descriptor", 16);
    }
    if (input.png[24] !== 8) {
      fail("PNG bit depth must be 8", 24);
    }
    if (input.png[25] !== 6) {
      fail("PNG color type must be RGBA (6)", 25);
    }
    if (input.png[26] !== 0) {
      fail("PNG compression method must be zero", 26);
    }
    if (input.png[27] !== 0) {
      fail("PNG filter method must be zero", 27);
    }
    if (input.png[28] !== 0) {
      fail("PNG must be non-interlaced", 28);
    }

    const byteRange = Object.freeze({ offset: 0, length: input.png.byteLength });
    return Object.freeze({ width, height, byteRange });
  } catch (error) {
    if (isFormatError(error)) {
      throw error;
    }
    throw new FormatError(
      "PNG_ENVELOPE_INVALID",
      "PNG envelope could not be validated"
    );
  }
}
