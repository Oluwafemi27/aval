import { describe, expect, it } from "vitest";

import { FormatError } from "../src/errors.js";
import {
  derivePngRgbaLayout,
  unfilterPngRgba
} from "../src/png/unfilter.js";
import {
  filterRgba,
  patternedRgba
} from "./png-test-fixture.js";

describe("PNG RGBA scanline reconstruction", () => {
  it("reconstructs filters 0 through 4 independently and mixed", () => {
    const width = 5;
    const height = 7;
    const rgba = patternedRgba(width, height);
    for (const filters of [[0], [1], [2], [3], [4], [0, 1, 2, 3, 4]]) {
      const filtered = filterRgba(rgba, width, height, filters);
      expect(unfilter(filtered, width, height)).toEqual(rgba);
    }
  });

  it("uses modulo-256 Sub/Average arithmetic and PNG Paeth ties", () => {
    const rgba = Uint8Array.of(
      250, 1, 128, 255, 2, 255, 0, 1,
      1, 250, 255, 0, 255, 2, 128, 254
    );
    for (const filter of [1, 3, 4]) {
      const filtered = filterRgba(rgba, 2, 2, [filter]);
      expect(unfilter(filtered, 2, 2)).toEqual(rgba);
    }

    const tie = new Uint8Array(18);
    tie.set([0, 2, 0, 0, 0, 3, 0, 0, 0], 0);
    tie[9] = 4;
    tie[10] = 254; // up=2 reconstructs current-row left to zero.
    tie[14] = 10; // left=0 and upper-left=2 tie; PNG selects left.
    expect(unfilter(tie, 2, 2)[12])
      .toBe(10);
  });

  it("rejects wrong lengths, dimensions, and filter bytes with scanline code", () => {
    for (const action of [
      () => unfilter(new Uint8Array(17), 2, 2),
      () => unfilter(new Uint8Array(18), 0, 2),
      () => {
        const filtered = new Uint8Array(18);
        filtered[0] = 5;
        return unfilter(filtered, 2, 2);
      }
    ]) {
      expectScanlineError(action);
    }
  });
});

function unfilter(filtered: Uint8Array, width: number, height: number): Uint8Array {
  return unfilterPngRgba({
    filtered,
    layout: derivePngRgbaLayout(width, height)
  });
}

function expectScanlineError(action: () => unknown): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(FormatError);
    expect((error as FormatError).code).toBe("PNG_SCANLINE_INVALID");
    return;
  }
  throw new Error("expected PNG scanline failure");
}
