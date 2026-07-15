import { describe, expect, it } from "vitest";

import { FormatError } from "../src/errors.js";
import {
  decodePngRgba,
  decodePngRgbaFromInflated
} from "../src/png/decode.js";
import { validatePngProfile } from "../src/png/profile.js";
import {
  filterRgba,
  makeTestPng,
  patternedRgba,
  storedZlib
} from "./png-test-fixture.js";

describe("pure restricted PNG decode", () => {
  it.each(["stored", "fixed", "dynamic"] as const)(
    "decodes %s DEFLATE into caller-owned RGBA",
    (compression) => {
      const width = 7;
      const height = 6;
      const rgba = patternedRgba(width, height);
      const plan = validatePngProfile({
        png: makeTestPng({
          width,
          height,
          rgba,
          filters: [0, 1, 2, 3, 4],
          compression
        }),
        expectedWidth: width,
        expectedHeight: height
      });
      const decoded = decodePngRgba(plan);
      expect(decoded).toMatchObject({ width, height });
      expect(decoded.rgba).toEqual(rgba);
      expect(Object.isFrozen(decoded)).toBe(true);
      decoded.rgba.fill(0);
      expect(decodePngRgba(plan).rgba).toEqual(rgba);
    }
  );

  it("validates independently inflated bytes for the later native adapter", () => {
    const width = 3;
    const height = 3;
    const rgba = patternedRgba(width, height);
    const filtered = filterRgba(rgba, width, height, [4, 3, 2]);
    const plan = validatePngProfile({
      png: makeTestPng({ width, height, rgba, filters: [4, 3, 2] }),
      expectedWidth: width,
      expectedHeight: height
    });
    expect(decodePngRgbaFromInflated(plan, filtered).rgba).toEqual(rgba);

    const corrupt = filtered.slice();
    corrupt[1] = corrupt[1]! ^ 1;
    expectDecodeError(() => decodePngRgbaFromInflated(plan, corrupt));
    expectDecodeError(() =>
      decodePngRgbaFromInflated(plan, filtered.subarray(1))
    );
  });

  it("rejects short/long inflate, Adler mismatch, and invalid scanline filters", () => {
    for (const filteredLength of [17, 19]) {
      const plan = validatePngProfile({
        png: makeTestPng({
          width: 2,
          height: 2,
          zlib: storedZlib(new Uint8Array(filteredLength))
        }),
        expectedWidth: 2,
        expectedHeight: 2
      });
      expectDecodeError(() => decodePngRgba(plan));
    }

    const wrongAdler = storedZlib(new Uint8Array(18));
    wrongAdler[wrongAdler.length - 1] = wrongAdler[wrongAdler.length - 1]! ^ 1;
    const adlerPlan = validatePngProfile({
      png: makeTestPng({ width: 2, height: 2, zlib: wrongAdler }),
      expectedWidth: 2,
      expectedHeight: 2
    });
    expectDecodeError(() => decodePngRgba(adlerPlan));

    const invalidFilter = new Uint8Array(18);
    invalidFilter[0] = 5;
    const filterPlan = validatePngProfile({
      png: makeTestPng({
        width: 2,
        height: 2,
        zlib: storedZlib(invalidFilter)
      }),
      expectedWidth: 2,
      expectedHeight: 2
    });
    expectDecodeError(() => decodePngRgba(filterPlan));
  });

  it("decodes exact authored geometry and payloads above the former limits", () => {
    const width = 1_024;
    const height = 513;
    const rgba = patternedRgba(width, height);
    const plan = validatePngProfile({
      png: makeTestPng({ width, height, rgba, compression: "stored" }),
      expectedWidth: width,
      expectedHeight: height
    });
    expect(plan.byteRange.length).toBeGreaterThan(2 * 1024 * 1024);
    expect(decodePngRgba(plan).rgba).toEqual(rgba);
  });
});

function expectDecodeError(action: () => unknown): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(FormatError);
    expect(["PNG_DEFLATE_INVALID", "PNG_SCANLINE_INVALID"])
      .toContain((error as FormatError).code);
    return;
  }
  throw new Error("expected PNG decode failure");
}
