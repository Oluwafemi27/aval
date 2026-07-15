import { checkedAdd } from "../checked-integer.js";
import { FormatError } from "../errors.js";
import { crc32 } from "./crc32.js";

const PNG_SIGNATURE = Object.freeze([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
] as const);
const MAX_CHUNKS = 256;

interface IdatRange {
  readonly offset: number;
  readonly length: number;
}

export interface ParsedPngChunks {
  readonly width: number;
  readonly height: number;
  readonly zlibBytes: Uint8Array;
  readonly chunkCount: number;
}

export function parseRestrictedPngChunks(input: {
  readonly png: Uint8Array;
  readonly expectedWidth: number;
  readonly expectedHeight: number;
  readonly maximumPngBytes: number;
}): ParsedPngChunks {
  const { png, expectedWidth, expectedHeight, maximumPngBytes } = input;
  if (!(png instanceof Uint8Array)) {
    fail("PNG input must be a Uint8Array");
  }
  if (png.byteLength > maximumPngBytes) {
    throw new FormatError(
      "BUDGET_EXCEEDED",
      `PNG length exceeds the active limit of ${String(maximumPngBytes)}`
    );
  }
  requireRange(png, 0, PNG_SIGNATURE.length, "PNG signature");
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (png[index] !== PNG_SIGNATURE[index]) {
      fail("PNG signature is invalid", index);
    }
  }

  let cursor: number = PNG_SIGNATURE.length;
  let chunkCount = 0;
  let width = 0;
  let height = 0;
  let sawIhdr = false;
  let sawSrgb = false;
  let sawIdat = false;
  let ended = false;
  let idatBytes = 0;
  const idatRanges: IdatRange[] = [];

  while (cursor < png.byteLength) {
    chunkCount += 1;
    if (chunkCount > MAX_CHUNKS) {
      fail(`PNG must contain at most ${String(MAX_CHUNKS)} chunks`, cursor);
    }
    requireRange(png, cursor, 8, "PNG chunk header");
    const length = readUint32Be(png, cursor);
    const dataOffset = checkedAdd(
      cursor,
      8,
      Number.MAX_SAFE_INTEGER,
      "PNG chunk data offset"
    );
    const payloadAndCrcLength = checkedAdd(
      length,
      4,
      Number.MAX_SAFE_INTEGER,
      "PNG chunk payload and CRC length"
    );
    requireRange(
      png,
      dataOffset,
      payloadAndCrcLength,
      "PNG chunk payload and CRC"
    );
    const dataEnd = checkedAdd(
      dataOffset,
      length,
      png.byteLength,
      "PNG chunk data end"
    );
    const chunkEnd = checkedAdd(dataEnd, 4, png.byteLength, "PNG chunk end");
    const expectedCrc = readUint32Be(png, dataEnd);
    if (crc32(png.subarray(cursor + 4, dataEnd)) !== expectedCrc) {
      fail("PNG chunk CRC-32 is invalid", dataEnd);
    }
    const type = readChunkType(png, cursor + 4);

    if (!sawIhdr) {
      if (type !== "IHDR") fail("first PNG chunk must be IHDR", cursor + 4);
      if (length !== 13) fail("IHDR payload must contain 13 bytes", cursor);
      width = readUint32Be(png, dataOffset);
      height = readUint32Be(png, dataOffset + 4);
      if (width === 0 || height === 0) {
        fail("PNG dimensions must be positive", width === 0 ? dataOffset : dataOffset + 4);
      }
      if (width !== expectedWidth || height !== expectedHeight) {
        fail("PNG dimensions do not match the static descriptor", dataOffset);
      }
      if (png[dataOffset + 8] !== 8) fail("PNG bit depth must be 8", dataOffset + 8);
      if (png[dataOffset + 9] !== 6) fail("PNG color type must be RGBA (6)", dataOffset + 9);
      if (png[dataOffset + 10] !== 0) fail("PNG compression method must be zero", dataOffset + 10);
      if (png[dataOffset + 11] !== 0) fail("PNG filter method must be zero", dataOffset + 11);
      if (png[dataOffset + 12] !== 0) fail("PNG must be non-interlaced", dataOffset + 12);
      sawIhdr = true;
    } else if (type === "sRGB") {
      if (sawSrgb || sawIdat || chunkCount !== 2) {
        fail("sRGB is allowed once immediately after IHDR", cursor + 4);
      }
      if (length !== 1 || png[dataOffset] !== 0) {
        fail("sRGB must declare only perceptual rendering intent zero", dataOffset);
      }
      sawSrgb = true;
    } else if (type === "IDAT") {
      if (ended) fail("IDAT cannot follow IEND", cursor + 4);
      sawIdat = true;
      idatRanges.push(Object.freeze({ offset: dataOffset, length }));
      idatBytes = checkedAdd(
        idatBytes,
        length,
        maximumPngBytes,
        "combined PNG IDAT bytes"
      );
    } else if (type === "IEND") {
      if (!sawIdat) fail("IEND must follow one or more IDAT chunks", cursor + 4);
      if (length !== 0) fail("IEND payload must be empty", cursor);
      if (ended) fail("PNG must contain exactly one IEND", cursor + 4);
      ended = true;
      if (chunkEnd !== png.byteLength) {
        fail("PNG contains bytes after terminal IEND", chunkEnd);
      }
    } else {
      fail("PNG contains a chunk outside the restricted profile", cursor + 4);
    }

    cursor = chunkEnd;
    if (ended) break;
  }

  if (!ended) fail("PNG is missing terminal IEND", cursor);
  if (!sawIdat) fail("PNG must contain at least one IDAT chunk", cursor);
  let zlibBytes: Uint8Array;
  try {
    zlibBytes = new Uint8Array(idatBytes);
  } catch {
    fail(`combined PNG IDAT allocation failed for ${String(idatBytes)} bytes`);
  }
  let target = 0;
  for (const range of idatRanges) {
    const rangeEnd = checkedAdd(
      range.offset,
      range.length,
      png.byteLength,
      "PNG IDAT range end"
    );
    zlibBytes.set(png.subarray(range.offset, rangeEnd), target);
    target = checkedAdd(target, range.length, idatBytes, "PNG IDAT copy end");
  }
  return Object.freeze({ width, height, zlibBytes, chunkCount });
}

function requireRange(
  bytes: Uint8Array,
  offset: number,
  length: number,
  label: string
): void {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset > bytes.byteLength - length
  ) {
    fail(`${label} is truncated`, Math.min(Math.max(offset, 0), bytes.byteLength));
  }
}

function readUint32Be(bytes: Uint8Array, offset: number): number {
  requireRange(bytes, offset, 4, "PNG uint32");
  return (
    bytes[offset]! * 0x100_0000 +
    bytes[offset + 1]! * 0x1_0000 +
    bytes[offset + 2]! * 0x100 +
    bytes[offset + 3]!
  );
}

function readChunkType(bytes: Uint8Array, offset: number): string {
  requireRange(bytes, offset, 4, "PNG chunk type");
  let result = "";
  for (let index = 0; index < 4; index += 1) {
    const byte = bytes[offset + index]!;
    if (!(
      (byte >= 0x41 && byte <= 0x5a) ||
      (byte >= 0x61 && byte <= 0x7a)
    )) {
      fail("PNG chunk type must contain ASCII letters", offset + index);
    }
    result += String.fromCharCode(byte);
  }
  return result;
}

function fail(message: string, offset?: number): never {
  throw new FormatError(
    "PNG_ENVELOPE_INVALID",
    message,
    offset === undefined ? undefined : { offset }
  );
}
