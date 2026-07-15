import { deriveAvcRenditionGeometry } from "@aval/format";
import { describe, expect, it } from "vitest";

import {
  createCompositeQualityAccumulator
} from "../src/compile/composite-quality.js";

const geometry = deriveAvcRenditionGeometry({
  profile: "avc-annexb-packed-alpha-v0",
  canvasWidth: 2,
  canvasHeight: 1,
  colorRect: [0, 0, 2, 1],
  alphaRect: [0, 10, 2, 1],
  codedWidth: 16,
  codedHeight: 16
});

describe("report-only composite quality", () => {
  it("aggregates exact RGB error over black, white, and magenta", () => {
    const expected = Uint8Array.of(
      100, 50, 25, 255,
      200, 100, 50, 0
    );
    const decoded = decodedFrame({
      color: [[102, 50, 25], [0, 255, 0]],
      alpha: [255, 0]
    });
    const before = decoded.slice();
    const quality = createCompositeQualityAccumulator({
      rendition: "packed",
      geometry
    });
    quality.includeFrame({
      unit: "body",
      frameIndex: 0,
      expectedRgba: expected,
      decodedRgba: decoded
    });

    const summary = quality.finish();
    expect(decoded).toEqual(before);
    expect(summary).toEqual({
      policy: "report-only",
      rendition: "packed",
      frameCount: 1,
      backgrounds: [
        {
          background: "black",
          rgb: [0, 0, 0],
          sampleCount: 6,
          meanAbsoluteError: 2 / 6 / 255,
          p99AbsoluteError: 2 / 255
        },
        {
          background: "white",
          rgb: [255, 255, 255],
          sampleCount: 6,
          meanAbsoluteError: 2 / 6 / 255,
          p99AbsoluteError: 2 / 255
        },
        {
          background: "magenta",
          rgb: [255, 0, 255],
          sampleCount: 6,
          meanAbsoluteError: 2 / 6 / 255,
          p99AbsoluteError: 2 / 255
        }
      ]
    });
    expect(Object.isFrozen(summary)).toBe(true);
    expect(Object.isFrozen(summary.backgrounds)).toBe(true);
  });

  it("uses source and decoded alpha in rounded straight-alpha compositing", () => {
    const quality = createCompositeQualityAccumulator({
      rendition: "packed",
      geometry
    });
    quality.includeFrame({
      unit: "body",
      frameIndex: 0,
      expectedRgba: Uint8Array.of(
        255, 0, 0, 128,
        0, 0, 0, 255
      ),
      decodedRgba: decodedFrame({
        color: [[255, 0, 0], [0, 0, 0]],
        alpha: [127, 255]
      })
    });
    const black = quality.finish().backgrounds[0];
    expect(black).toMatchObject({
      background: "black",
      sampleCount: 6,
      meanAbsoluteError: 1 / 6 / 255,
      p99AbsoluteError: 1 / 255
    });
  });

  it("accepts report frame indexes beyond the former unit ceiling", () => {
    const quality = createCompositeQualityAccumulator({
      rendition: "packed",
      geometry
    });
    quality.includeFrame({
      unit: "body",
      frameIndex: 900,
      expectedRgba: new Uint8Array(8),
      decodedRgba: decodedFrame({
        color: [[0, 0, 0], [0, 0, 0]],
        alpha: [0, 0]
      })
    });
    expect(quality.finish().frameCount).toBe(1);
  });

  it("rejects duplicate, malformed, opaque, and cancelled inputs", () => {
    expect(() => createCompositeQualityAccumulator({
      rendition: "opaque",
      geometry: deriveAvcRenditionGeometry({
        profile: "avc-annexb-opaque-v0",
        canvasWidth: 2,
        canvasHeight: 1,
        colorRect: [0, 0, 2, 1],
        codedWidth: 16,
        codedHeight: 16
      })
    })).toThrow();

    const quality = createCompositeQualityAccumulator({
      rendition: "packed",
      geometry
    });
    const frame = {
      unit: "body",
      frameIndex: 0,
      expectedRgba: new Uint8Array(8),
      decodedRgba: decodedFrame({
        color: [[0, 0, 0], [0, 0, 0]],
        alpha: [0, 0]
      })
    };
    quality.includeFrame(frame);
    expect(() => quality.includeFrame(frame)).toThrow();

    const controller = new AbortController();
    controller.abort("test");
    expect(() => createCompositeQualityAccumulator({
      rendition: "packed",
      geometry,
      signal: controller.signal
    })).toThrow(expect.objectContaining({ code: "CANCELLED" }));
  });
});

function decodedFrame(input: {
  readonly color: readonly (readonly [number, number, number])[];
  readonly alpha: readonly number[];
}): Uint8Array {
  const width = geometry.decodedStorageRect[2];
  const height = geometry.decodedStorageRect[3];
  const result = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < input.color.length; pixel += 1) {
    result.set([...input.color[pixel]!, 255], pixel * 4);
    result[(geometry.visibleAlphaRect![1] * width + pixel) * 4] =
      input.alpha[pixel]!;
  }
  return result;
}
