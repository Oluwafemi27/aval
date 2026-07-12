import { FormatError } from "../errors.js";

const CRC_TABLE = buildCrcTable();
const ADLER_MODULUS = 65_521;

/** Unsigned PNG/IEEE CRC-32 over one bounded byte view. */
export function crc32(bytes: Uint8Array): number {
  requireBytes(bytes, "CRC-32 input");
  let crc = 0xffff_ffff;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[index]!) & 0xff]!;
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

/** Unsigned RFC 1950 Adler-32 over one bounded byte view. */
export function adler32(bytes: Uint8Array): number {
  requireBytes(bytes, "Adler-32 input");
  let a = 1;
  let b = 0;
  for (let offset = 0; offset < bytes.byteLength; offset += 5_552) {
    const end = Math.min(bytes.byteLength, offset + 5_552);
    for (let index = offset; index < end; index += 1) {
      a += bytes[index]!;
      b += a;
    }
    a %= ADLER_MODULUS;
    b %= ADLER_MODULUS;
  }
  return ((b << 16) | a) >>> 0;
}

function requireBytes(value: unknown, label: string): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new FormatError("INPUT_INVALID", `${label} must be a Uint8Array`);
  }
}

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 0
        ? value >>> 1
        : 0xedb8_8320 ^ (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
}
