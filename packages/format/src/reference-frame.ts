import {
  FORMAT_DEFAULT_BUDGETS,
  REFERENCE_FRAME_HEADER_LENGTH,
  REFERENCE_FRAME_MAGIC,
  resolveFormatBudgets
} from "./constants.js";
import {
  checkedAdd,
  checkedMultiply,
  checkedNonNegativeInteger,
  readUint16LE,
  readUint32LE,
  readUint8,
  requireByteRange,
  writeUint16LE,
  writeUint32LE,
  writeUint8
} from "./checked-integer.js";
import { FormatError, isFormatError } from "./errors.js";
import type {
  FormatOptions,
  ReferenceFrameDescriptor,
  ReferenceFrameHeader
} from "./model.js";

const MAX_UINT16 = 0xffff;
const MAX_UINT32 = 0xffff_ffff;

export interface ReferenceFrameInput {
  readonly width: number;
  readonly height: number;
  readonly frameIndex: number;
  readonly rgba: Uint8Array;
}

export interface ReferenceFrameValidationInput {
  readonly sample: Uint8Array;
  readonly expectedWidth: number;
  readonly expectedHeight: number;
  readonly expectedFrameIndex: number;
  readonly options?: FormatOptions | undefined;
}

function fail(message: string, offset?: number): never {
  throw new FormatError(
    "REFERENCE_FRAME_INVALID",
    message,
    offset === undefined ? undefined : { offset }
  );
}

function assertMagic(sample: Uint8Array): void {
  for (let index = 0; index < REFERENCE_FRAME_MAGIC.length; index += 1) {
    if (sample[index] !== REFERENCE_FRAME_MAGIC[index]) {
      fail("reference frame magic must be AVRF", index);
    }
  }
}

function checkedDimension(value: unknown, label: string): number {
  const dimension = checkedNonNegativeInteger(value, label);
  if (dimension < 1 || dimension > MAX_UINT16) {
    fail(`${label} must be in the uint16 range 1..65535`);
  }
  return dimension;
}

function checkedFrameIndex(value: unknown, label: string): number {
  const frameIndex = checkedNonNegativeInteger(value, label);
  if (frameIndex > MAX_UINT32) {
    fail(`${label} must fit uint32`);
  }
  return frameIndex;
}

function expectedRgbaLength(
  width: number,
  height: number,
  maximum: number
): number {
  const pixels = checkedMultiply(width, height, maximum, "reference pixel count");
  return checkedMultiply(pixels, 4, maximum, "reference RGBA length");
}

/** Encode one independently decodable reference-rgba-v0 sample. */
export function encodeReferenceFrame(input: ReferenceFrameInput): Uint8Array {
  try {
    if (typeof input !== "object" || input === null) {
      fail("reference frame input must be an object");
    }
    const width = checkedDimension(input.width, "reference width");
    const height = checkedDimension(input.height, "reference height");
    const frameIndex = checkedFrameIndex(input.frameIndex, "reference frame index");
    if (!(input.rgba instanceof Uint8Array)) {
      fail("reference RGBA pixels must be a Uint8Array");
    }
    const rgbaLength = expectedRgbaLength(
      width,
      height,
      FORMAT_DEFAULT_BUDGETS.maxSampleBytes - REFERENCE_FRAME_HEADER_LENGTH
    );
    if (input.rgba.byteLength !== rgbaLength) {
      fail(
        `reference RGBA byte length must be exactly ${String(rgbaLength)}`
      );
    }
    const sampleLength = checkedAdd(
      REFERENCE_FRAME_HEADER_LENGTH,
      rgbaLength,
      FORMAT_DEFAULT_BUDGETS.maxSampleBytes,
      "reference sample length"
    );
    let sample: Uint8Array;
    try {
      sample = new Uint8Array(sampleLength);
    } catch {
      throw new FormatError(
        "REFERENCE_FRAME_INVALID",
        `reference frame allocation of ${String(sampleLength)} bytes failed`
      );
    }
    sample.set(REFERENCE_FRAME_MAGIC, 0);
    writeUint8(sample, 4, 0, "REFERENCE_FRAME_INVALID", "reference major version");
    writeUint8(sample, 5, 1, "REFERENCE_FRAME_INVALID", "reference minor version");
    writeUint16LE(
      sample,
      6,
      REFERENCE_FRAME_HEADER_LENGTH,
      "REFERENCE_FRAME_INVALID",
      "reference header length"
    );
    writeUint32LE(sample, 8, 0, "REFERENCE_FRAME_INVALID", "reference flags");
    writeUint16LE(sample, 12, width, "REFERENCE_FRAME_INVALID", "reference width");
    writeUint16LE(sample, 14, height, "REFERENCE_FRAME_INVALID", "reference height");
    writeUint32LE(
      sample,
      16,
      frameIndex,
      "REFERENCE_FRAME_INVALID",
      "reference frame index"
    );
    writeUint32LE(
      sample,
      20,
      rgbaLength,
      "REFERENCE_FRAME_INVALID",
      "reference RGBA length"
    );
    sample.set(input.rgba, REFERENCE_FRAME_HEADER_LENGTH);
    return sample;
  } catch (error) {
    if (isFormatError(error)) {
      throw error;
    }
    throw new FormatError(
      "REFERENCE_FRAME_INVALID",
      "reference frame could not be encoded"
    );
  }
}

/** Parse and validate the fixed 24-byte reference-rgba-v0 header. */
export function parseReferenceFrameHeader(
  sample: Uint8Array,
  options?: FormatOptions
): Readonly<ReferenceFrameHeader> {
  try {
    const budgets = resolveFormatBudgets(options);
    requireByteRange(
      sample,
      0,
      REFERENCE_FRAME_HEADER_LENGTH,
      "REFERENCE_FRAME_INVALID",
      "reference frame header"
    );
    assertMagic(sample);
    if (
      readUint8(sample, 4, "REFERENCE_FRAME_INVALID", "reference major version") !==
      0
    ) {
      fail("reference frame major version must be zero", 4);
    }
    if (
      readUint8(sample, 5, "REFERENCE_FRAME_INVALID", "reference minor version") !==
      1
    ) {
      fail("reference frame minor version must be one", 5);
    }
    if (
      readUint16LE(
        sample,
        6,
        "REFERENCE_FRAME_INVALID",
        "reference header length"
      ) !== REFERENCE_FRAME_HEADER_LENGTH
    ) {
      fail(
        `reference frame header length must be ${String(REFERENCE_FRAME_HEADER_LENGTH)}`,
        6
      );
    }
    if (
      readUint32LE(sample, 8, "REFERENCE_FRAME_INVALID", "reference flags") !== 0
    ) {
      fail("reference frame flags must be zero", 8);
    }
    const width = checkedDimension(
      readUint16LE(sample, 12, "REFERENCE_FRAME_INVALID", "reference width"),
      "reference width"
    );
    const height = checkedDimension(
      readUint16LE(sample, 14, "REFERENCE_FRAME_INVALID", "reference height"),
      "reference height"
    );
    const frameIndex = readUint32LE(
      sample,
      16,
      "REFERENCE_FRAME_INVALID",
      "reference frame index"
    );
    const rgbaLength = readUint32LE(
      sample,
      20,
      "REFERENCE_FRAME_INVALID",
      "reference RGBA length"
    );
    const maximumRgbaLength = Math.max(
      0,
      budgets.maxSampleBytes - REFERENCE_FRAME_HEADER_LENGTH
    );
    const expected = expectedRgbaLength(width, height, maximumRgbaLength);
    if (rgbaLength !== expected) {
      fail(
        `reference RGBA length must be width × height × 4 (${String(expected)})`,
        20
      );
    }
    checkedAdd(
      REFERENCE_FRAME_HEADER_LENGTH,
      rgbaLength,
      budgets.maxSampleBytes,
      "reference sample length"
    );
    return Object.freeze({ width, height, frameIndex, rgbaLength });
  } catch (error) {
    if (isFormatError(error)) {
      throw error;
    }
    throw new FormatError(
      "REFERENCE_FRAME_INVALID",
      "reference frame header could not be parsed"
    );
  }
}

/** Validate a complete reference sample and return only detached byte ranges. */
export function validateReferenceFrame(
  input: ReferenceFrameValidationInput
): Readonly<ReferenceFrameDescriptor> {
  try {
    if (typeof input !== "object" || input === null) {
      fail("reference frame validation input must be an object");
    }
    const expectedWidth = checkedDimension(
      input.expectedWidth,
      "expected reference width"
    );
    const expectedHeight = checkedDimension(
      input.expectedHeight,
      "expected reference height"
    );
    const expectedFrameIndex = checkedFrameIndex(
      input.expectedFrameIndex,
      "expected reference frame index"
    );
    const header = parseReferenceFrameHeader(input.sample, input.options);
    if (header.width !== expectedWidth || header.height !== expectedHeight) {
      fail("reference frame dimensions do not match the rendition", 12);
    }
    if (header.frameIndex !== expectedFrameIndex) {
      fail("reference frame index does not match the access-unit record", 16);
    }
    const expectedSampleLength = checkedAdd(
      REFERENCE_FRAME_HEADER_LENGTH,
      header.rgbaLength,
      resolveFormatBudgets(input.options).maxSampleBytes,
      "reference sample length"
    );
    if (input.sample.byteLength !== expectedSampleLength) {
      fail(
        `reference sample length must be exactly ${String(expectedSampleLength)} bytes`,
        Math.min(input.sample.byteLength, expectedSampleLength)
      );
    }
    const rgbaRange = Object.freeze({
      offset: REFERENCE_FRAME_HEADER_LENGTH,
      length: header.rgbaLength
    });
    return Object.freeze({ ...header, rgbaRange });
  } catch (error) {
    if (isFormatError(error)) {
      throw error;
    }
    throw new FormatError(
      "REFERENCE_FRAME_INVALID",
      "reference frame could not be validated"
    );
  }
}
