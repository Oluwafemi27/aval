import {
  FormatError,
  adler32,
  crc32,
  decodePngRgba,
  validatePngProfile
} from "@pixel-point/aval-format";

import { CompilerError } from "../diagnostics.js";

const PNG_SIGNATURE = Uint8Array.of(
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
);
const PNG_UINT32_MAX = 0xffff_ffff;

export interface RgbaPngInput {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

export interface CanonicalPngInspectionInput {
  readonly png: Uint8Array;
  readonly expectedWidth: number;
  readonly expectedHeight: number;
}

export interface CanonicalPngInspection {
  readonly profile: "strict-rgba-png-v0";
  readonly decoder: "format-pure-rfc1950-1951-v0";
  readonly width: number;
  readonly height: number;
  readonly pngBytes: number;
  readonly zlibBytes: number;
  readonly filteredBytes: number;
  readonly rgbaBytes: number;
}

/** Emit deterministic restricted RGBA PNG bytes for authored PNG sources. */
export function encodeCanonicalRgbaPng(input: RgbaPngInput): Uint8Array {
  const { width, height, rgba } = input;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > PNG_UINT32_MAX ||
    height > PNG_UINT32_MAX
  ) {
    throw new CompilerError(
      "SOURCE_LIMIT",
      "PNG dimensions must fit unsigned 32-bit IHDR fields"
    );
  }
  const rowBytes = checkedProduct(width, 4, "PNG row bytes");
  const expected = checkedProduct(rowBytes, height, "PNG RGBA bytes");
  if (!(rgba instanceof Uint8Array) || rgba.byteLength !== expected) {
    throw new CompilerError(
      "INPUT_INVALID",
      `RGBA payload must contain exactly ${String(expected)} bytes`
    );
  }

  const filteredRowBytes = checkedSum(rowBytes, 1, "PNG filtered row");
  const filtered = allocateBytes(
    checkedProduct(height, filteredRowBytes, "PNG filtered bytes"),
    "PNG filtered scanlines"
  );
  for (let row = 0; row < height; row += 1) {
    const target = row * filteredRowBytes;
    filtered[target] = 0;
    filtered.set(
      rgba.subarray(row * rowBytes, (row + 1) * rowBytes),
      target + 1
    );
  }
  const ihdr = new Uint8Array(13);
  writeUint32BE(ihdr, 0, width);
  writeUint32BE(ihdr, 4, height);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const compressed = storedZlib(filtered);
  const png = concatenate([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("sRGB", Uint8Array.of(0)),
    chunk("IDAT", compressed),
    chunk("IEND", new Uint8Array())
  ]);
  selfValidateCanonicalPng(png, width, height, rgba);
  return png;
}

/** Strictly decode compiler PNG bytes and return deterministic report facts. */
export function inspectCanonicalRgbaPng(
  input: Readonly<CanonicalPngInspectionInput>
): Readonly<CanonicalPngInspection> {
  return decodeCanonicalPng(input).facts;
}

/** RFC 1950 zlib wrapper containing only deterministic RFC 1951 stored blocks. */
function storedZlib(bytes: Uint8Array): Uint8Array {
  const blockCount = Math.max(1, Math.ceil(bytes.byteLength / 65_535));
  const blockHeaders = checkedProduct(
    blockCount,
    5,
    "PNG DEFLATE block headers"
  );
  const outputLength = checkedSum(
    checkedSum(2, blockHeaders, "PNG zlib bytes"),
    checkedSum(bytes.byteLength, 4, "PNG zlib bytes"),
    "PNG zlib bytes"
  );
  const output = allocateBytes(outputLength, "PNG zlib stream");
  // CM=deflate, CINFO=32 KiB; FCHECK chosen for fastest/no-compression policy.
  output.set([0x78, 0x01], 0);
  let sourceOffset = 0;
  let targetOffset = 2;
  for (let block = 0; block < blockCount; block += 1) {
    const length = Math.min(65_535, bytes.byteLength - sourceOffset);
    const final = block === blockCount - 1;
    output[targetOffset] = final ? 0x01 : 0x00;
    output[targetOffset + 1] = length & 0xff;
    output[targetOffset + 2] = (length >>> 8) & 0xff;
    const complement = (~length) & 0xffff;
    output[targetOffset + 3] = complement & 0xff;
    output[targetOffset + 4] = (complement >>> 8) & 0xff;
    targetOffset += 5;
    output.set(bytes.subarray(sourceOffset, sourceOffset + length), targetOffset);
    sourceOffset += length;
    targetOffset += length;
  }
  writeUint32BE(output, targetOffset, adler32(bytes));
  return output;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  if (typeBytes.byteLength !== 4) {
    throw new CompilerError("INPUT_INVALID", "PNG chunk type must be four bytes");
  }
  if (data.byteLength > PNG_UINT32_MAX) {
    throw new CompilerError(
      "SOURCE_LIMIT",
      "PNG chunk length exceeds unsigned 32-bit representation"
    );
  }
  const result = allocateBytes(
    checkedSum(12, data.byteLength, "PNG chunk bytes"),
    `PNG ${type} chunk`
  );
  writeUint32BE(result, 0, data.byteLength);
  result.set(typeBytes, 4);
  result.set(data, 8);
  writeUint32BE(
    result,
    8 + data.byteLength,
    crc32(result.subarray(4, 8 + data.byteLength))
  );
  return result;
}

function selfValidateCanonicalPng(
  png: Uint8Array,
  width: number,
  height: number,
  expectedRgba: Uint8Array
): void {
  const decoded = decodeCanonicalPng({
    png,
    expectedWidth: width,
    expectedHeight: height
  });
  if (!equalBytes(decoded.rgba, expectedRgba)) {
    throw new CompilerError(
      "ASSET_INVALID",
      "Generated PNG does not decode to the source RGBA bytes"
    );
  }
}

function decodeCanonicalPng(
  input: Readonly<CanonicalPngInspectionInput>
): Readonly<{
  readonly facts: Readonly<CanonicalPngInspection>;
  readonly rgba: Uint8Array;
}> {
  try {
    const plan = validatePngProfile({
      png: input.png,
      expectedWidth: input.expectedWidth,
      expectedHeight: input.expectedHeight
    });
    const decoded = decodePngRgba(plan);
    return Object.freeze({
      facts: Object.freeze({
        profile: "strict-rgba-png-v0" as const,
        decoder: "format-pure-rfc1950-1951-v0" as const,
        width: plan.width,
        height: plan.height,
        pngBytes: input.png.byteLength,
        zlibBytes: plan.zlibByteLength,
        filteredBytes: plan.expectedFilteredBytes,
        rgbaBytes: plan.expectedRgbaBytes
      }),
      rgba: decoded.rgba
    });
  } catch (error) {
    if (error instanceof FormatError) {
      throw new CompilerError(
        "ASSET_INVALID",
        "PNG failed strict compiler validation",
        { cause: error }
      );
    }
    throw error;
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index]);
}

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce(
    (total, part) => checkedSum(total, part.byteLength, "PNG bytes"),
    0
  );
  const result = allocateBytes(length, "canonical PNG");
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function writeUint32BE(bytes: Uint8Array, offset: number, value: number): void {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > PNG_UINT32_MAX ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > bytes.byteLength - 4
  ) {
    throw new CompilerError("SOURCE_LIMIT", "PNG uint32 write is invalid");
  }
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function checkedProduct(left: number, right: number, label: string): number {
  if (
    !Number.isSafeInteger(left) ||
    !Number.isSafeInteger(right) ||
    left < 0 ||
    right < 0 ||
    (right !== 0 && left > Math.floor(Number.MAX_SAFE_INTEGER / right))
  ) {
    throw new CompilerError("SOURCE_LIMIT", `${label} exceeds safe arithmetic`);
  }
  return left * right;
}

function checkedSum(left: number, right: number, label: string): number {
  if (
    !Number.isSafeInteger(left) ||
    !Number.isSafeInteger(right) ||
    left < 0 ||
    right < 0 ||
    left > Number.MAX_SAFE_INTEGER - right
  ) {
    throw new CompilerError("SOURCE_LIMIT", `${label} exceeds safe arithmetic`);
  }
  return left + right;
}

function allocateBytes(length: number, operation: string): Uint8Array {
  try {
    return new Uint8Array(length);
  } catch (error) {
    throw new CompilerError(
      "SOURCE_LIMIT",
      `Could not allocate ${String(length)} bytes for ${operation}`,
      { cause: error }
    );
  }
}
