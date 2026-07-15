import {
  constants as zlibConstants,
  deflateRawSync
} from "node:zlib";

import { describe, expect, it } from "vitest";

import { FormatError } from "../src/errors.js";
import {
  calculateDeflateWorkLimit,
  inflateDeflate,
  inflateDeflateWithLimit
} from "../src/png/deflate.js";

describe("bounded RFC 1951 inflater", () => {
  it.each(["stored", "fixed", "dynamic"] as const)(
    "inflates independently generated %s blocks",
    (kind) => {
      const source = Uint8Array.from({ length: 4_097 }, (_, index) =>
        (index * 37 + Math.floor(index / 11) * 19) & 0xff
      );
      const raw = new Uint8Array(deflateRawSync(source, {
        level: kind === "stored" ? 0 : kind === "dynamic" ? 9 : 6,
        strategy: kind === "fixed"
          ? zlibConstants.Z_FIXED
          : zlibConstants.Z_DEFAULT_STRATEGY
      }));
      expect((raw[0]! >>> 1) & 0b11).toBe(
        kind === "stored" ? 0 : kind === "fixed" ? 1 : 2
      );
      expect(inflateDeflate({
        deflate: raw,
        expectedOutputLength: source.byteLength
      })).toEqual(source);
    }
  );

  it("inflates the compiler's multi-block stored shape beyond 65,535 bytes", () => {
    const source = Uint8Array.from({ length: 70_000 }, (_, index) => index & 0xff);
    const raw = new Uint8Array(deflateRawSync(source, { level: 0 }));
    expect(inflateDeflate({
      deflate: raw,
      expectedOutputLength: source.byteLength
    })).toEqual(source);
  });

  it("inflates output above the former 2 MiB ceiling", () => {
    const source = new Uint8Array(2 * 1024 * 1024 + 1).fill(0x5a);
    const raw = new Uint8Array(deflateRawSync(source, { level: 0 }));
    expect(inflateDeflate({
      deflate: raw,
      expectedOutputLength: source.byteLength
    })).toEqual(source);
  });

  it("rejects invalid stored complements and output overruns", () => {
    const valid = Uint8Array.of(1, 3, 0, 0xfc, 0xff, 1, 2, 3);
    expect(inflateDeflate({ deflate: valid, expectedOutputLength: 3 }))
      .toEqual(Uint8Array.of(1, 2, 3));
    const complement = valid.slice();
    complement[3] = complement[3]! ^ 1;
    expectDeflateError(() => inflateDeflate({
      deflate: complement,
      expectedOutputLength: 3
    }));
    const padding = valid.slice();
    padding[0] = padding[0]! | 0x08;
    expectDeflateError(() => inflateDeflate({
      deflate: padding,
      expectedOutputLength: 3
    }));
    expectDeflateError(() => inflateDeflate({
      deflate: valid,
      expectedOutputLength: 2
    }));
  });

  it("rejects reserved block/literal/distance symbols and missing history", () => {
    expectDeflateError(() => inflateDeflate({
      deflate: Uint8Array.of(0x07),
      expectedOutputLength: 0
    }));
    expectDeflateError(() => inflateDeflate({
      deflate: fixedBlock([286, 256]),
      expectedOutputLength: 0
    }));
    expectDeflateError(() => inflateDeflate({
      deflate: fixedLengthDistanceBlock(257, 30),
      expectedOutputLength: 3
    }));
    expectDeflateError(() => inflateDeflate({
      deflate: fixedLengthDistanceBlock(257, 0),
      expectedOutputLength: 3
    }));
  });

  it("rejects empty, oversubscribed, incomplete, and leading-repeat dynamic trees", () => {
    for (const raw of [
      dynamicHeader([0, 0, 0, 0]),
      dynamicHeader([1, 1, 1, 1]),
      dynamicHeader([2, 2, 0, 0]),
      dynamicLeadingRepeat16(),
      dynamicRepeatOverflow()
    ]) {
      expectDeflateError(() => inflateDeflate({
        deflate: raw,
        expectedOutputLength: 0
      }));
    }
  });

  it("accepts the RFC 1951 empty distance alphabet for a literal-only block", () => {
    const source = new Uint8Array(257);
    expect(inflateDeflate({
      deflate: dynamicLiteralOnlyBlock(source.byteLength),
      expectedOutputLength: source.byteLength
    })).toEqual(source);
  });

  it("rejects a length symbol when the dynamic distance alphabet is empty", () => {
    expectDeflateError(() => inflateDeflate({
      deflate: dynamicLengthWithoutDistanceBlock(),
      expectedOutputLength: 3
    }));
  });

  it("requires EOB, a final block, zero terminal pad bits, and no trailing byte", () => {
    const empty = fixedBlock([256]);
    expect(inflateDeflate({ deflate: empty, expectedOutputLength: 0 }))
      .toEqual(new Uint8Array());

    const missingEob = fixedBlock([65], false);
    expectDeflateError(() => inflateDeflate({
      deflate: missingEob,
      expectedOutputLength: 1
    }));

    const nonfinalStored = Uint8Array.of(0, 0, 0, 0xff, 0xff);
    expectDeflateError(() => inflateDeflate({
      deflate: nonfinalStored,
      expectedOutputLength: 0
    }));

    const nonzeroPad = empty.slice();
    nonzeroPad[nonzeroPad.length - 1] =
      nonzeroPad[nonzeroPad.length - 1]! | 0x80;
    expectDeflateError(() => inflateDeflate({
      deflate: nonzeroPad,
      expectedOutputLength: 0
    }));

    const trailing = new Uint8Array(empty.length + 1);
    trailing.set(empty);
    expectDeflateError(() => inflateDeflate({
      deflate: trailing,
      expectedOutputLength: 0
    }));
  });

  it("rejects short/long output and enforces the frozen work formula", () => {
    const source = new TextEncoder().encode("bounded output");
    const raw = new Uint8Array(deflateRawSync(source));
    expectDeflateError(() => inflateDeflate({
      deflate: raw,
      expectedOutputLength: source.length - 1
    }));
    expectDeflateError(() => inflateDeflate({
      deflate: raw,
      expectedOutputLength: source.length + 1
    }));
    expect(calculateDeflateWorkLimit(10, 20)).toBe(32 * 30 + 4_096);
    expectDeflateError(() =>
      calculateDeflateWorkLimit(Number.MAX_SAFE_INTEGER, 1)
    );
    expectDeflateError(() => inflateDeflateWithLimit({
      deflate: raw,
      expectedOutputLength: source.length
    }, 5));
    expectDeflateError(() => inflateDeflate(
      null as unknown as Parameters<typeof inflateDeflate>[0]
    ));
    expectDeflateError(() => inflateDeflate({
      deflate: null as unknown as Uint8Array,
      expectedOutputLength: 0
    }));
  });
});

function dynamicHeader(codeLengths: readonly number[]): Uint8Array {
  const writer = new LsbBitWriter();
  writer.bits(1, 1).bits(2, 2); // final dynamic block
  writer.bits(0, 5).bits(0, 5).bits(0, 4); // 257, 1, 4
  for (const length of codeLengths) writer.bits(length, 3);
  return writer.finish();
}

function dynamicLeadingRepeat16(): Uint8Array {
  const writer = new LsbBitWriter();
  writer.bits(1, 1).bits(2, 2);
  writer.bits(0, 5).bits(0, 5).bits(0, 4);
  // Order is 16,17,18,0: symbols 16 and 0 form a complete one-bit tree.
  writer.bits(1, 3).bits(0, 3).bits(0, 3).bits(1, 3);
  writer.bits(1, 1); // symbol 16 before any prior length
  return writer.finish();
}

function dynamicRepeatOverflow(): Uint8Array {
  const writer = new LsbBitWriter();
  writer.bits(1, 1).bits(2, 2);
  writer.bits(0, 5).bits(0, 5).bits(0, 4);
  // Symbols 18 and 0 form a complete one-bit code-length tree.
  writer.bits(0, 3).bits(0, 3).bits(1, 3).bits(1, 3);
  writer.bits(1, 1).bits(127, 7); // 138 zeros
  writer.bits(1, 1).bits(110, 7); // 121 more exceeds total 258
  return writer.finish();
}

function dynamicLiteralOnlyBlock(literalCount: number): Uint8Array {
  const writer = dynamicZeroOneLengthHeader(257);
  writeZeroOneCodeLengths(
    writer,
    Array.from({ length: 257 }, (_, symbol) =>
      symbol === 0 || symbol === 256 ? 1 : 0
    ),
    [0]
  );
  for (let index = 0; index < literalCount; index += 1) {
    writer.bits(0, 1); // literal zero
  }
  writer.bits(1, 1); // end-of-block 256
  return writer.finish();
}

function dynamicLengthWithoutDistanceBlock(): Uint8Array {
  const writer = dynamicZeroOneLengthHeader(258);
  writeZeroOneCodeLengths(
    writer,
    Array.from({ length: 258 }, (_, symbol) =>
      symbol === 256 || symbol === 257 ? 1 : 0
    ),
    [0]
  );
  writer.bits(1, 1); // length symbol 257; no distance alphabet follows
  return writer.finish();
}

function dynamicZeroOneLengthHeader(literalCodeCount: number): LsbBitWriter {
  const writer = new LsbBitWriter();
  writer.bits(1, 1).bits(2, 2); // final dynamic block
  writer.bits(literalCodeCount - 257, 5).bits(0, 5).bits(14, 4);
  const order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1];
  for (const symbol of order) {
    writer.bits(symbol === 0 || symbol === 1 ? 1 : 0, 3);
  }
  return writer;
}

function writeZeroOneCodeLengths(
  writer: LsbBitWriter,
  literalLengths: readonly number[],
  distanceLengths: readonly number[]
): void {
  // Code-length symbols zero and one form the complete one-bit alphabet.
  for (const length of [...literalLengths, ...distanceLengths]) {
    writer.bits(length, 1);
  }
}

function fixedBlock(symbols: readonly number[], includeEob = true): Uint8Array {
  const writer = new LsbBitWriter();
  writer.bits(1, 1).bits(1, 2);
  for (const symbol of symbols) writeFixedLiteral(writer, symbol);
  if (includeEob && symbols.at(-1) !== 256) writeFixedLiteral(writer, 256);
  return writer.finish();
}

function fixedLengthDistanceBlock(
  lengthSymbol: number,
  distanceSymbol: number
): Uint8Array {
  const writer = new LsbBitWriter();
  writer.bits(1, 1).bits(1, 2);
  writeFixedLiteral(writer, lengthSymbol);
  writer.bits(reverseBits(distanceSymbol, 5), 5);
  writeFixedLiteral(writer, 256);
  return writer.finish();
}

function writeFixedLiteral(writer: LsbBitWriter, symbol: number): void {
  let code: number;
  let length: number;
  if (symbol <= 143) {
    code = 0x30 + symbol;
    length = 8;
  } else if (symbol <= 255) {
    code = 0x190 + symbol - 144;
    length = 9;
  } else if (symbol <= 279) {
    code = symbol - 256;
    length = 7;
  } else {
    code = 0xc0 + symbol - 280;
    length = 8;
  }
  writer.bits(reverseBits(code, length), length);
}

function reverseBits(value: number, width: number): number {
  let result = 0;
  for (let index = 0; index < width; index += 1) {
    result = (result << 1) | ((value >>> index) & 1);
  }
  return result;
}

class LsbBitWriter {
  readonly #bits: number[] = [];

  public bits(value: number, count: number): this {
    for (let bit = 0; bit < count; bit += 1) {
      this.#bits.push((value >>> bit) & 1);
    }
    return this;
  }

  public finish(): Uint8Array {
    const bytes = new Uint8Array(Math.ceil(this.#bits.length / 8));
    for (let index = 0; index < this.#bits.length; index += 1) {
      bytes[Math.floor(index / 8)]! |= this.#bits[index]! << (index & 7);
    }
    return bytes;
  }
}

function expectDeflateError(action: () => unknown): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(FormatError);
    expect((error as FormatError).code).toBe("PNG_DEFLATE_INVALID");
    return;
  }
  throw new Error("expected DEFLATE failure");
}
