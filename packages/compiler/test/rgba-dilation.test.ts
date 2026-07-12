import { describe, expect, it } from "vitest";

import { dilateTransparentRgba } from "../src/compile/rgba-dilation.js";

describe("transparent RGBA dilation", () => {
  it("returns fresh bytes, preserves visible pixels and alpha, and zeros hidden RGB", () => {
    const input = frame(3, 1, [
      [9, 8, 7, 1],
      [200, 201, 202, 0],
      [4, 5, 6, 255]
    ]);
    const before = input.slice();

    const output = dilateTransparentRgba({
      width: 3,
      height: 1,
      rgba: input
    });

    expect(output).not.toBe(input);
    expect(input).toEqual(before);
    expect(pixel(output, 3, 0, 0)).toEqual([9, 8, 7, 1]);
    expect(pixel(output, 3, 1, 0)).toEqual([4, 5, 6, 0]);
    expect(pixel(output, 3, 2, 0)).toEqual([4, 5, 6, 255]);
  });

  it("prefers distance before source alpha", () => {
    const output = dilateTransparentRgba({
      width: 3,
      height: 1,
      rgba: frame(3, 1, [
        [99, 99, 99, 0],
        [255, 0, 0, 1],
        [0, 0, 255, 255]
      ])
    });

    expect(pixel(output, 3, 0, 0)).toEqual([255, 0, 0, 0]);
  });

  it("breaks equal-distance ties by alpha, then source y, then source x", () => {
    const alphaTie = frame(3, 3, Array.from(
      { length: 9 },
      () => [0, 0, 0, 0] as const
    ));
    setPixel(alphaTie, 3, 0, 1, [255, 0, 0, 1]);
    setPixel(alphaTie, 3, 2, 1, [0, 0, 255, 2]);
    expect(pixel(dilateTransparentRgba({
      width: 3,
      height: 3,
      rgba: alphaTie
    }), 3, 1, 1)).toEqual([0, 0, 255, 0]);

    const yTie = alphaTie.slice();
    yTie.fill(0);
    setPixel(yTie, 3, 1, 0, [1, 2, 3, 8]);
    setPixel(yTie, 3, 1, 2, [4, 5, 6, 8]);
    expect(pixel(dilateTransparentRgba({
      width: 3,
      height: 3,
      rgba: yTie
    }), 3, 1, 1)).toEqual([1, 2, 3, 0]);

    const xTie = frame(3, 1, [
      [7, 8, 9, 8],
      [0, 0, 0, 0],
      [10, 11, 12, 8]
    ]);
    expect(pixel(dilateTransparentRgba({
      width: 3,
      height: 1,
      rgba: xTie
    }), 3, 1, 0)).toEqual([7, 8, 9, 0]);
  });

  it("includes distance four, excludes distance five, and never chains fills", () => {
    const input = frame(10, 1, Array.from(
      { length: 10 },
      () => [31, 32, 33, 0] as const
    ));
    setPixel(input, 10, 0, 0, [21, 22, 23, 255]);

    const output = dilateTransparentRgba({
      width: 10,
      height: 1,
      rgba: input
    });

    expect(pixel(output, 10, 4, 0)).toEqual([21, 22, 23, 0]);
    expect(pixel(output, 10, 5, 0)).toEqual([0, 0, 0, 0]);
    expect(pixel(output, 10, 8, 0)).toEqual([0, 0, 0, 0]);
  });

  it("handles odd all-transparent frames deterministically", () => {
    const input = new Uint8Array(3 * 5 * 4);
    for (let offset = 0; offset < input.length; offset += 4) {
      input.set([127, 127, 127, 0], offset);
    }
    const output = dilateTransparentRgba({
      width: 3,
      height: 5,
      rgba: input
    });
    for (let offset = 0; offset < output.length; offset += 4) {
      expect([...output.subarray(offset, offset + 4)]).toEqual([0, 0, 0, 0]);
    }
  });

  it("rejects mismatched and out-of-bound allocation geometry", () => {
    expect(() => dilateTransparentRgba({
      width: 2,
      height: 2,
      rgba: new Uint8Array(15)
    })).toThrow(/RGBA byte length/);
    expect(() => dilateTransparentRgba({
      width: 513,
      height: 1,
      rgba: new Uint8Array(4)
    })).toThrow(/dimensions/);
  });
});

function frame(
  width: number,
  height: number,
  pixels: readonly (readonly [number, number, number, number])[]
): Uint8Array {
  expect(pixels).toHaveLength(width * height);
  return Uint8Array.from(pixels.flat());
}

function pixel(
  rgba: Uint8Array,
  width: number,
  x: number,
  y: number
): number[] {
  const offset = (y * width + x) * 4;
  return [...rgba.subarray(offset, offset + 4)];
}

function setPixel(
  rgba: Uint8Array,
  width: number,
  x: number,
  y: number,
  value: readonly [number, number, number, number]
): void {
  rgba.set(value, (y * width + x) * 4);
}
