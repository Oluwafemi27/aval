import { FormatError } from "../errors.js";
import type { ByteRange } from "../model.js";

export interface ZlibEnvelope {
  readonly deflateRange: ByteRange;
  readonly declaredAdler32: number;
}

export function validateZlibEnvelope(zlib: Uint8Array): ZlibEnvelope {
  if (!(zlib instanceof Uint8Array)) {
    fail("zlib input must be a Uint8Array");
  }
  if (zlib.byteLength < 7) {
    fail("zlib member is missing DEFLATE data or Adler-32 trailer");
  }
  const cmf = zlib[0]!;
  const flg = zlib[1]!;
  if ((cmf & 0x0f) !== 8) fail("zlib compression method must be DEFLATE", 0);
  if ((cmf >>> 4) > 7) fail("zlib window size exceeds 32 KiB", 0);
  if (((cmf << 8) | flg) % 31 !== 0) fail("zlib FCHECK is invalid", 1);
  if ((flg & 0x20) !== 0) fail("zlib preset dictionaries are forbidden", 1);
  const deflateLength = zlib.byteLength - 6;
  if (deflateLength < 1) fail("zlib member must contain a DEFLATE block", 2);
  const trailerOffset = zlib.byteLength - 4;
  const declaredAdler32 = readUint32Be(zlib, trailerOffset);
  return Object.freeze({
    deflateRange: Object.freeze({ offset: 2, length: deflateLength }),
    declaredAdler32
  });
}

function readUint32Be(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! * 0x100_0000 +
    bytes[offset + 1]! * 0x1_0000 +
    bytes[offset + 2]! * 0x100 +
    bytes[offset + 3]!
  );
}

function fail(message: string, offset?: number): never {
  throw new FormatError(
    "PNG_ENVELOPE_INVALID",
    message,
    offset === undefined ? undefined : { offset }
  );
}
