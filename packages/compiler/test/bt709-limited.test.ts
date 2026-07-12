import { describe, expect, it } from "vitest";

import {
  bt709LimitedAlphaLuma,
  bt709LimitedChroma2x2,
  bt709LimitedLuma,
  roundSignedRatio
} from "../src/compile/bt709-limited.js";

describe("integer BT.709 limited-range conversion", () => {
  it("rounds signed exact halves away from zero", () => {
    expect(roundSignedRatio(1, 2)).toBe(1);
    expect(roundSignedRatio(-1, 2)).toBe(-1);
    expect(roundSignedRatio(3, 2)).toBe(2);
    expect(roundSignedRatio(-3, 2)).toBe(-2);
    expect(roundSignedRatio(1, 3)).toBe(0);
    expect(roundSignedRatio(-2, 3)).toBe(-1);
  });

  it("maps black, white, alpha endpoints, and primaries exactly", () => {
    expect(bt709LimitedLuma(0, 0, 0)).toBe(16);
    expect(bt709LimitedLuma(255, 255, 255)).toBe(235);
    expect(bt709LimitedAlphaLuma(0)).toBe(16);
    expect(bt709LimitedAlphaLuma(255)).toBe(235);

    for (const [red, green, blue] of [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [127, 127, 127],
      [128, 128, 128]
    ] as const) {
      expect(bt709LimitedLuma(red, green, blue)).toBe(
        oracleLuma(red, green, blue)
      );
    }
  });

  it("averages one 2x2 block before signed chroma rounding and clamps", () => {
    const blue = new Uint8Array(12);
    for (let offset = 0; offset < blue.length; offset += 3) blue[offset + 2] = 255;
    expect(bt709LimitedChroma2x2(blue)).toEqual({ cb: 240, cr: 118 });

    const red = new Uint8Array(12);
    for (let offset = 0; offset < red.length; offset += 3) red[offset] = 255;
    expect(bt709LimitedChroma2x2(red)).toEqual({ cb: 102, cr: 240 });

    const cyan = new Uint8Array(12);
    const yellow = new Uint8Array(12);
    for (let offset = 0; offset < 12; offset += 3) {
      cyan.set([0, 255, 255], offset);
      yellow.set([255, 255, 0], offset);
    }
    expect(bt709LimitedChroma2x2(cyan)).toEqual({ cb: 154, cr: 16 });
    expect(bt709LimitedChroma2x2(yellow)).toEqual({ cb: 16, cr: 138 });

    const mixed = Uint8Array.from([
      255, 0, 0,
      0, 255, 0,
      0, 0, 255,
      255, 255, 255
    ]);
    expect(bt709LimitedChroma2x2(mixed)).toEqual(oracleChroma(mixed));
  });

  it("matches an independent BigInt oracle over fixed-seed samples", () => {
    const random = mulberry32(0x709420);
    for (let sample = 0; sample < 2_000; sample += 1) {
      const block = new Uint8Array(12);
      for (let index = 0; index < block.length; index += 1) {
        block[index] = Math.floor(random() * 256);
      }
      for (let pixel = 0; pixel < 4; pixel += 1) {
        const offset = pixel * 3;
        expect(bt709LimitedLuma(
          block[offset]!,
          block[offset + 1]!,
          block[offset + 2]!
        )).toBe(oracleLuma(
          block[offset]!,
          block[offset + 1]!,
          block[offset + 2]!
        ));
      }
      expect(bt709LimitedChroma2x2(block)).toEqual(oracleChroma(block));
      const alpha = Math.floor(random() * 256);
      expect(bt709LimitedAlphaLuma(alpha)).toBe(oracleAlphaLuma(alpha));
    }
  });

  it("rejects unsafe ratios, invalid bytes, and incomplete chroma blocks", () => {
    expect(() => roundSignedRatio(Number.MAX_SAFE_INTEGER, 1)).not.toThrow();
    expect(() => roundSignedRatio(1, 0)).toThrow(/denominator/);
    expect(() => bt709LimitedLuma(-1, 0, 0)).toThrow(/8-bit/);
    expect(() => bt709LimitedAlphaLuma(256)).toThrow(/8-bit/);
    expect(() => bt709LimitedChroma2x2(new Uint8Array(11))).toThrow(/12/);
  });
});

function oracleLuma(red: number, green: number, blue: number): number {
  const weighted = 2126n * BigInt(red) + 7152n * BigInt(green) +
    722n * BigInt(blue);
  return clamp(16, 235, 16 + Number(roundBig(219n * weighted, 2_550_000n)));
}

function oracleAlphaLuma(alpha: number): number {
  return 16 + Number(roundBig(219n * BigInt(alpha), 255n));
}

function oracleChroma(block: Uint8Array): { readonly cb: number; readonly cr: number } {
  let blueDifference = 0n;
  let redDifference = 0n;
  for (let offset = 0; offset < 12; offset += 3) {
    const red = BigInt(block[offset]!);
    const green = BigInt(block[offset + 1]!);
    const blue = BigInt(block[offset + 2]!);
    const weighted = 2126n * red + 7152n * green + 722n * blue;
    blueDifference += 10_000n * blue - weighted;
    redDifference += 10_000n * red - weighted;
  }
  return {
    cb: clamp(16, 240, 128 + Number(roundBigSigned(
      224n * blueDifference,
      18_927_120n
    ))),
    cr: clamp(16, 240, 128 + Number(roundBigSigned(
      224n * redDifference,
      16_062_960n
    )))
  };
}

function roundBig(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return quotient + (remainder * 2n >= denominator ? 1n : 0n);
}

function roundBigSigned(numerator: bigint, denominator: bigint): bigint {
  const sign = numerator < 0n ? -1n : 1n;
  return sign * roundBig(numerator < 0n ? -numerator : numerator, denominator);
}

function clamp(minimum: number, maximum: number, value: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}
