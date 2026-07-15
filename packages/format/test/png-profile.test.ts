import { describe, expect, it } from "vitest";

import { FormatError } from "../src/errors.js";
import { adler32, crc32 } from "../src/png/crc32.js";
import { validatePngProfile } from "../src/png/profile.js";
import {
  chunk,
  concatenate,
  makeTestPng,
  patternedRgba,
  readUint32Be,
  storedZlib,
  testAdler32,
  testCrc32,
  writeUint32Be
} from "./png-test-fixture.js";

const SIGNATURE = Uint8Array.of(
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
);

describe("strict restricted PNG profile", () => {
  it.each(["stored", "fixed", "dynamic"] as const)(
    "accepts %s zlib and returns one immutable owned decode plan",
    (compression) => {
      const source = makeTestPng({
        width: 3,
        height: 2,
        compression,
        idatSplits: [1, 2, 0]
      });
      const original = source.slice();
      const plan = validatePngProfile({
        png: source,
        expectedWidth: 3,
        expectedHeight: 2
      });

      expect(plan).toMatchObject({
        width: 3,
        height: 2,
        byteRange: { offset: 0, length: source.byteLength },
        expectedFilteredBytes: 26,
        expectedRgbaBytes: 24,
        deflateRange: { offset: 2 },
        zlibByteLength: expect.any(Number),
        declaredAdler32: expect.any(Number)
      });
      expect(plan.deflateRange.length).toBe(plan.zlibByteLength - 6);
      expect(Object.isFrozen(plan)).toBe(true);
      expect(Object.isFrozen(plan.byteRange)).toBe(true);
      expect(Object.isFrozen(plan.deflateRange)).toBe(true);

      const firstCopy = plan.copyZlibBytes();
      source.fill(0);
      firstCopy.fill(0);
      expect(plan.copyZlibBytes()).not.toEqual(firstCopy);
      expect(original.some((byte) => byte !== 0)).toBe(true);
    }
  );

  it("accepts the optional canonical sRGB only immediately after IHDR", () => {
    expect(() => validate(makeTestPng({ width: 2, height: 2 }))).not.toThrow();
    expect(() => validate(makeTestPng({
      width: 2,
      height: 2,
      includeSrgb: false
    }))).not.toThrow();

    const parts = canonicalParts();
    for (const png of [
      concatenate([SIGNATURE, parts.ihdr, parts.srgb, parts.srgb, parts.idat, parts.iend]),
      concatenate([SIGNATURE, parts.ihdr, parts.idat, parts.srgb, parts.iend]),
      concatenate([SIGNATURE, parts.ihdr, chunk("sRGB", Uint8Array.of(1)), parts.idat, parts.iend])
    ]) {
      expectPngError(() => validate(png));
    }
  });

  it("rejects every whole-file truncation and trailing byte", () => {
    const png = makeTestPng({ width: 2, height: 2 });
    for (let length = 0; length < png.byteLength; length += 1) {
      expectPngError(() => validate(png.subarray(0, length)));
    }
    const trailing = new Uint8Array(png.byteLength + 1);
    trailing.set(png);
    expectPngError(() => validate(trailing));
  });

  it("rejects CRC, chunk length/count/order/type, and terminal-shape violations", () => {
    const badCrc = makeTestPng({ width: 2, height: 2 });
    badCrc[29] = badCrc[29]! ^ 1;
    expectPngError(() => validate(badCrc));

    const crcParts = canonicalParts();
    for (const key of ["ihdr", "srgb", "idat", "iend"] as const) {
      const corrupted = {
        ihdr: crcParts.ihdr.slice(),
        srgb: crcParts.srgb.slice(),
        idat: crcParts.idat.slice(),
        iend: crcParts.iend.slice()
      };
      const target = corrupted[key];
      target[target.length - 1] = target[target.length - 1]! ^ 1;
      expectPngError(() => validate(concatenate([
        SIGNATURE,
        corrupted.ihdr,
        corrupted.srgb,
        corrupted.idat,
        corrupted.iend
      ])));
    }

    const hugeLength = makeTestPng({ width: 2, height: 2 });
    writeUint32Be(hugeLength, 8, 0xffff_ffff);
    expectPngError(() => validate(hugeLength));

    const parts = canonicalParts();
    for (const png of [
      concatenate([SIGNATURE, parts.idat, parts.ihdr, parts.iend]),
      concatenate([SIGNATURE, parts.ihdr, parts.idat, chunk("tEXt", new Uint8Array()), parts.iend]),
      concatenate([SIGNATURE, parts.ihdr, parts.idat, chunk("IEND", Uint8Array.of(0))]),
      concatenate([SIGNATURE, parts.ihdr, parts.iend]),
      concatenate([SIGNATURE, parts.ihdr, parts.idat, parts.iend, parts.iend])
    ]) {
      expectPngError(() => validate(png));
    }

    const tooManyIdat = Array.from({ length: 255 }, (_, index) =>
      chunk("IDAT", index === 0 ? parts.zlib : new Uint8Array())
    );
    const exactIdat = tooManyIdat.slice(0, 254);
    expect(() => validate(concatenate([
      SIGNATURE,
      parts.ihdr,
      ...exactIdat,
      parts.iend
    ]))).not.toThrow();
    expectPngError(() => validate(concatenate([
      SIGNATURE,
      parts.ihdr,
      ...tooManyIdat,
      parts.iend
    ])));
  });

  it("rejects IHDR fields, descriptor mismatch, and noncanonical sRGB", () => {
    const offsets = [16, 20, 24, 25, 26, 27, 28] as const;
    for (const offset of offsets) {
      const png = makeTestPng({ width: 2, height: 2 });
      if (offset === 16 || offset === 20) {
        writeUint32Be(png, offset, 0);
      } else {
        png[offset] = png[offset]! ^ 1;
      }
      rewriteChunkCrc(png, 8);
      expectPngError(() => validate(png));
    }
    expectPngError(() => validatePngProfile({
      png: makeTestPng({ width: 2, height: 2 }),
      expectedWidth: 3,
      expectedHeight: 2
    }));
  });

  it("rejects unrepresentable IHDR products with checked arithmetic", () => {
    const png = makeTestPng({ width: 1, height: 1 });
    writeUint32Be(png, 16, 0xffff_ffff);
    writeUint32Be(png, 20, 0xffff_ffff);
    rewriteChunkCrc(png, 8);

    expectPngError(() => validatePngProfile({
      png,
      expectedWidth: 0xffff_ffff,
      expectedHeight: 0xffff_ffff
    }), "INTEGER_UNSAFE");
  });

  it("rejects invalid zlib method/window/check/dictionary and a missing trailer", () => {
    const filtered = new Uint8Array(18);
    const validZlib = storedZlib(filtered);
    const mutations = [
      (zlib: Uint8Array) => { zlib[0] = 0x79; },
      (zlib: Uint8Array) => { zlib[0] = 0x88; },
      (zlib: Uint8Array) => { zlib[1] = zlib[1]! ^ 1; },
      (zlib: Uint8Array) => {
        zlib[1] = zlib[1]! | 0x20;
        zlib[1] = (zlib[1]! + (31 - ((zlib[0]! * 256 + zlib[1]!) % 31))) & 0xff;
      }
    ];
    for (const mutate of mutations) {
      const zlib = validZlib.slice();
      mutate(zlib);
      expectPngError(() => validate(makeTestPng({ width: 2, height: 2, zlib })));
    }
    expectPngError(() => validate(makeTestPng({
      width: 2,
      height: 2,
      zlib: validZlib.subarray(0, 5)
    })));
  });

  it("honors a caller-lowered byte budget and validates checksum authorities", () => {
    const png = makeTestPng({ width: 2, height: 2 });
    expectPngError(
      () => validatePngProfile({
        png,
        expectedWidth: 2,
        expectedHeight: 2,
        options: { budgets: { maxPngBytes: png.byteLength - 1 } }
      }),
      "BUDGET_EXCEEDED"
    );
    const vector = new TextEncoder().encode("123456789");
    expect(crc32(vector)).toBe(0xcbf4_3926);
    expect(crc32(vector)).toBe(testCrc32(vector));
    expect(adler32(vector)).toBe(testAdler32(vector));
  });
});

function validate(png: Uint8Array) {
  return validatePngProfile({ png, expectedWidth: 2, expectedHeight: 2 });
}

function canonicalParts() {
  const width = 2;
  const height = 2;
  const ihdrPayload = new Uint8Array(13);
  writeUint32Be(ihdrPayload, 0, width);
  writeUint32Be(ihdrPayload, 4, height);
  ihdrPayload.set([8, 6, 0, 0, 0], 8);
  const filtered = new Uint8Array(height * (1 + width * 4));
  const zlib = storedZlib(filtered);
  return {
    ihdr: chunk("IHDR", ihdrPayload),
    srgb: chunk("sRGB", Uint8Array.of(0)),
    idat: chunk("IDAT", zlib),
    iend: chunk("IEND", new Uint8Array()),
    zlib
  };
}

function rewriteChunkCrc(png: Uint8Array, chunkOffset: number): void {
  const length = readUint32Be(png, chunkOffset);
  writeUint32Be(
    png,
    chunkOffset + 8 + length,
    testCrc32(png.subarray(chunkOffset + 4, chunkOffset + 8 + length))
  );
}

function expectPngError(
  action: () => unknown,
  code: FormatError["code"] = "PNG_ENVELOPE_INVALID"
): FormatError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(FormatError);
    expect((error as FormatError).code).toBe(code);
    return error as FormatError;
  }
  throw new Error("expected PNG validation failure");
}
