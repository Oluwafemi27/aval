import {
  constants as zlibConstants,
  deflateSync
} from "node:zlib";

const PNG_SIGNATURE = Uint8Array.of(
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
);

export type PngCompression = "stored" | "fixed" | "dynamic";

export interface TestPngInput {
  readonly width: number;
  readonly height: number;
  readonly rgba?: Uint8Array;
  readonly filters?: readonly number[];
  readonly compression?: PngCompression;
  readonly includeSrgb?: boolean;
  readonly idatSplits?: readonly number[];
  readonly zlib?: Uint8Array;
}

export function makeTestPng(input: TestPngInput): Uint8Array {
  const rgba = input.rgba ?? patternedRgba(input.width, input.height);
  const filtered = filterRgba(
    rgba,
    input.width,
    input.height,
    input.filters ?? [0]
  );
  const zlib = input.zlib ?? compress(filtered, input.compression ?? "stored");
  const ihdr = new Uint8Array(13);
  writeUint32Be(ihdr, 0, input.width);
  writeUint32Be(ihdr, 4, input.height);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const chunks: Uint8Array[] = [chunk("IHDR", ihdr)];
  if (input.includeSrgb !== false) {
    chunks.push(chunk("sRGB", Uint8Array.of(0)));
  }
  const segments = splitBytes(zlib, input.idatSplits);
  for (const segment of segments) chunks.push(chunk("IDAT", segment));
  chunks.push(chunk("IEND", new Uint8Array()));
  return concatenate([PNG_SIGNATURE, ...chunks]);
}

export function makeSizedTestPng(
  width: number,
  height: number,
  minimumLength: number,
  marker = 0
): Uint8Array {
  const rgba = patternedRgba(width, height);
  if (rgba.byteLength > 0) rgba[0] = marker & 0xff;
  const filtered = filterRgba(rgba, width, height, [0]);
  const base = makeTestPng({ width, height, rgba, zlib: storedZlib(filtered) });
  const extraEmptyBlocks = Math.max(
    0,
    Math.ceil((minimumLength - base.byteLength) / 5)
  );
  return makeTestPng({
    width,
    height,
    rgba,
    zlib: storedZlib(filtered, extraEmptyBlocks)
  });
}

export function patternedRgba(width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < rgba.length; index += 1) {
    rgba[index] = (index * 73 + Math.floor(index / 4) * 29 + 17) & 0xff;
  }
  return rgba;
}

export function filterRgba(
  rgba: Uint8Array,
  width: number,
  height: number,
  filters: readonly number[]
): Uint8Array {
  const stride = width * 4;
  if (rgba.byteLength !== stride * height) {
    throw new Error("test RGBA length mismatch");
  }
  const result = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    const filter = filters[y % filters.length];
    if (filter === undefined || filter < 0 || filter > 4) {
      throw new Error("test filter is invalid");
    }
    const target = y * (stride + 1);
    result[target] = filter;
    for (let x = 0; x < stride; x += 1) {
      const raw = rgba[y * stride + x]!;
      const left = x >= 4 ? rgba[y * stride + x - 4]! : 0;
      const up = y > 0 ? rgba[(y - 1) * stride + x]! : 0;
      const upperLeft = y > 0 && x >= 4
        ? rgba[(y - 1) * stride + x - 4]!
        : 0;
      const predictor = filter === 0
        ? 0
        : filter === 1
          ? left
          : filter === 2
            ? up
            : filter === 3
              ? Math.floor((left + up) / 2)
              : paeth(left, up, upperLeft);
      result[target + 1 + x] = (raw - predictor) & 0xff;
    }
  }
  return result;
}

export function storedZlib(
  bytes: Uint8Array,
  extraEmptyBlocks = 0
): Uint8Array {
  const blockLengths: number[] = [];
  let remaining = bytes.byteLength;
  while (remaining > 65_535) {
    blockLengths.push(65_535);
    remaining -= 65_535;
  }
  for (let index = 0; index < extraEmptyBlocks; index += 1) {
    blockLengths.push(0);
  }
  blockLengths.push(remaining);
  const result = new Uint8Array(
    2 + blockLengths.length * 5 + bytes.byteLength + 4
  );
  result.set([0x78, 0x01], 0);
  let source = 0;
  let target = 2;
  for (let index = 0; index < blockLengths.length; index += 1) {
    const length = blockLengths[index]!;
    result[target] = index === blockLengths.length - 1 ? 1 : 0;
    result[target + 1] = length & 0xff;
    result[target + 2] = (length >>> 8) & 0xff;
    const complement = (~length) & 0xffff;
    result[target + 3] = complement & 0xff;
    result[target + 4] = (complement >>> 8) & 0xff;
    target += 5;
    result.set(bytes.subarray(source, source + length), target);
    source += length;
    target += length;
  }
  writeUint32Be(result, target, testAdler32(bytes));
  return result;
}

export function rebuildPngWithZlib(source: Uint8Array, zlib: Uint8Array): Uint8Array {
  const width = readUint32Be(source, 16);
  const height = readUint32Be(source, 20);
  return makeTestPng({ width, height, zlib });
}

export function chunk(type: string, payload: Uint8Array): Uint8Array {
  if (type.length !== 4) throw new Error("test chunk type must have four bytes");
  const result = new Uint8Array(payload.byteLength + 12);
  writeUint32Be(result, 0, payload.byteLength);
  for (let index = 0; index < 4; index += 1) {
    result[4 + index] = type.charCodeAt(index);
  }
  result.set(payload, 8);
  writeUint32Be(
    result,
    8 + payload.byteLength,
    testCrc32(result.subarray(4, 8 + payload.byteLength))
  );
  return result;
}

export function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

export function readUint32Be(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! * 0x100_0000 +
    bytes[offset + 1]! * 0x1_0000 +
    bytes[offset + 2]! * 0x100 +
    bytes[offset + 3]!
  );
}

export function writeUint32Be(
  bytes: Uint8Array,
  offset: number,
  value: number
): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

export function testCrc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 0
        ? crc >>> 1
        : (crc >>> 1) ^ 0xedb8_8320;
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

export function testAdler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65_521;
    b = (b + a) % 65_521;
  }
  return ((b << 16) | a) >>> 0;
}

function compress(bytes: Uint8Array, compression: PngCompression): Uint8Array {
  if (compression === "stored") return storedZlib(bytes);
  const output = deflateSync(bytes, {
    level: compression === "fixed" ? 6 : 9,
    strategy: compression === "fixed"
      ? zlibConstants.Z_FIXED
      : zlibConstants.Z_DEFAULT_STRATEGY
  });
  return new Uint8Array(output.buffer, output.byteOffset, output.byteLength).slice();
}

function splitBytes(
  bytes: Uint8Array,
  requested: readonly number[] | undefined
): readonly Uint8Array[] {
  if (requested === undefined) return [bytes];
  const result: Uint8Array[] = [];
  let offset = 0;
  for (const length of requested) {
    if (!Number.isSafeInteger(length) || length < 0 || offset + length > bytes.length) {
      throw new Error("test IDAT split is invalid");
    }
    result.push(bytes.slice(offset, offset + length));
    offset += length;
  }
  result.push(bytes.slice(offset));
  return result;
}

function paeth(left: number, up: number, upperLeft: number): number {
  const prediction = left + up - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const upDistance = Math.abs(prediction - up);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  return leftDistance <= upDistance && leftDistance <= upperLeftDistance
    ? left
    : upDistance <= upperLeftDistance
      ? up
      : upperLeft;
}
