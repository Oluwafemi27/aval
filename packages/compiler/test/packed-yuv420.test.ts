import { deriveAvcRenditionGeometry } from "@aval/format";
import { describe, expect, it } from "vitest";

import {
  bt709LimitedAlphaLuma,
  bt709LimitedChroma2x2,
  bt709LimitedLuma
} from "../src/compile/bt709-limited.js";
import {
  packRgbaToPlanarYuv420
} from "../src/compile/packed-yuv420.js";

describe("opaque and stacked planar YUV420 packing", () => {
  it("packs a 1x1 opaque frame into exact Y, Cb, and Cr planes", () => {
    const geometry = deriveAvcRenditionGeometry({
      profile: "avc-annexb-opaque-v0",
      canvasWidth: 1,
      canvasHeight: 1,
      colorRect: [0, 0, 1, 1],
      codedWidth: 16,
      codedHeight: 16
    });
    const input = Uint8Array.from([255, 0, 0, 255]);
    const before = input.slice();

    const packed = packRgbaToPlanarYuv420({ geometry, rgba: input });

    expect(input).toEqual(before);
    expect(Object.isFrozen(packed)).toBe(true);
    expect(Object.isFrozen(packed.planes)).toBe(true);
    expect(packed.planes).toEqual({
      y: { offset: 0, length: 256, stride: 16, width: 16, height: 16 },
      cb: { offset: 256, length: 64, stride: 8, width: 8, height: 8 },
      cr: { offset: 320, length: 64, stride: 8, width: 8, height: 8 }
    });
    expect(packed.data).toHaveLength(384);
    expect(packed.data[0]).toBe(bt709LimitedLuma(255, 0, 0));
    expect([...packed.data.subarray(1, 256)].every((value) => value === 16))
      .toBe(true);
    const chroma = bt709LimitedChroma2x2(Uint8Array.from([
      255, 0, 0,
      0, 0, 0,
      0, 0, 0,
      0, 0, 0
    ]));
    expect(packed.data[packed.planes.cb.offset]).toBe(chroma.cb);
    expect(packed.data[packed.planes.cr.offset]).toBe(chroma.cr);
    expect([...packed.data.subarray(257, 320)].every((value) => value === 128))
      .toBe(true);
    expect([...packed.data.subarray(321)].every((value) => value === 128))
      .toBe(true);
  });

  it("uses dilated RGB for color and original alpha for the stacked pane", () => {
    const geometry = deriveAvcRenditionGeometry({
      profile: "avc-annexb-packed-alpha-v0",
      canvasWidth: 3,
      canvasHeight: 1,
      colorRect: [0, 0, 3, 1],
      alphaRect: [0, 10, 3, 1],
      codedWidth: 16,
      codedHeight: 16
    });
    const rgba = Uint8Array.from([
      255, 0, 0, 255,
      0, 255, 0, 0,
      0, 0, 255, 128
    ]);

    const packed = packRgbaToPlanarYuv420({ geometry, rgba });
    const y = packed.planes.y;
    expect(packed.data[y.offset]).toBe(bt709LimitedLuma(255, 0, 0));
    expect(packed.data[y.offset + 1]).toBe(bt709LimitedLuma(255, 0, 0));
    expect(packed.data[y.offset + 2]).toBe(bt709LimitedLuma(0, 0, 255));
    expect(packed.data[y.offset + 3]).toBe(16);
    for (let row = 2; row < 10; row += 1) {
      expect([...packed.data.subarray(row * 16, row * 16 + 16)])
        .toEqual(new Array<number>(16).fill(16));
    }
    expect([...packed.data.subarray(10 * 16, 10 * 16 + 4)]).toEqual([
      bt709LimitedAlphaLuma(255),
      bt709LimitedAlphaLuma(0),
      bt709LimitedAlphaLuma(128),
      16
    ]);
    expect([...packed.data.subarray(11 * 16, 12 * 16)])
      .toEqual(new Array<number>(16).fill(16));

    const cb = packed.data.subarray(
      packed.planes.cb.offset,
      packed.planes.cr.offset
    );
    const cr = packed.data.subarray(packed.planes.cr.offset);
    const first = bt709LimitedChroma2x2(Uint8Array.from([
      255, 0, 0,
      255, 0, 0,
      0, 0, 0,
      0, 0, 0
    ]));
    const second = bt709LimitedChroma2x2(Uint8Array.from([
      0, 0, 255,
      0, 0, 0,
      0, 0, 0,
      0, 0, 0
    ]));
    expect([...cb.subarray(0, 2)]).toEqual([first.cb, second.cb]);
    expect([...cr.subarray(0, 2)]).toEqual([first.cr, second.cr]);
    expect([...cb.subarray(2)].every((value) => value === 128)).toBe(true);
    expect([...cr.subarray(2)].every((value) => value === 128)).toBe(true);
  });

  it("keeps gutter and macroblock padding neutral for maximum geometry", () => {
    const geometry = deriveAvcRenditionGeometry({
      profile: "avc-annexb-packed-alpha-v0",
      canvasWidth: 512,
      canvasHeight: 512,
      colorRect: [0, 0, 512, 512],
      alphaRect: [0, 520, 512, 512],
      codedWidth: 512,
      codedHeight: 1040
    });
    const rgba = new Uint8Array(512 * 512 * 4).fill(255);

    const packed = packRgbaToPlanarYuv420({ geometry, rgba });

    expect(packed.data).toHaveLength(512 * 1040 * 3 / 2);
    expect(packed.data[512 * 512]).toBe(16);
    expect(packed.data[512 * 519 + 511]).toBe(16);
    expect(packed.data[512 * 1032]).toBe(16);
    expect(packed.data[packed.planes.cb.offset - 1]).toBe(16);
    expect(packed.data[packed.planes.cb.offset]).toBe(128);
    expect(packed.data.at(-1)).toBe(128);
  });

  it("rejects nonexact bytes and malformed structural geometry before allocation", () => {
    const geometry = deriveAvcRenditionGeometry({
      profile: "avc-annexb-opaque-v0",
      canvasWidth: 1,
      canvasHeight: 1,
      colorRect: [0, 0, 1, 1],
      codedWidth: 16,
      codedHeight: 16
    });
    expect(() => packRgbaToPlanarYuv420({
      geometry,
      rgba: new Uint8Array(3)
    })).toThrow(/RGBA byte length/);
    expect(() => packRgbaToPlanarYuv420({
      geometry: { ...geometry, codedWidth: 15 },
      rgba: new Uint8Array(4)
    })).toThrow(/coded dimensions/);
  });
});
