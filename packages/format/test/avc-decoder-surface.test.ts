import { describe, expect, it } from "vitest";

import {
  maximumAvcDecodedRgbaBytes,
  maximumAvcDecoderSurfaceDimension
} from "../src/avc/index.js";

describe("AVC decoder surface reserve", () => {
  it("reserves two padded macroblocks beyond aligned coded geometry", () => {
    expect(maximumAvcDecoderSurfaceDimension(32)).toBe(64);
    expect(maximumAvcDecoderSurfaceDimension(33)).toBe(80);
    expect(maximumAvcDecodedRgbaBytes(32, 32)).toBe(64 * 64 * 4);
  });

  it("accepts larger representable dimensions and rejects unsafe arithmetic", () => {
    expect(() => maximumAvcDecoderSurfaceDimension(0)).toThrow();
    expect(maximumAvcDecoderSurfaceDimension(2_049)).toBe(2_096);
    expect(() => maximumAvcDecoderSurfaceDimension(Number.MAX_SAFE_INTEGER))
      .toThrow(/safe-integer/u);
  });
});
