import { deriveAvcRenditionGeometry } from "@aval/format";
import { describe, expect, it } from "vitest";

import {
  createAlphaQualityAccumulator
} from "../src/compile/alpha-quality.js";

const geometry = deriveAvcRenditionGeometry({
  profile: "avc-annexb-packed-alpha-v0",
  canvasWidth: 4,
  canvasHeight: 1,
  colorRect: [0, 0, 4, 1],
  alphaRect: [0, 10, 4, 1],
  codedWidth: 16,
  codedHeight: 16
});
describe("histogram alpha quality", () => {
  it("accepts exact MAE and p99 thresholds and reports normalized statistics", () => {
    const accumulator = createAlphaQualityAccumulator({
      rendition: "packed",
      geometry
    });
    accumulator.includeFrame({
      unit: "body",
      frameIndex: 0,
      expectedAlpha: Uint8Array.of(10, 20, 30, 40),
      decodedRgba: decodedAlpha([12, 22, 32, 42])
    });
    const summary = accumulator.finish();
    expect(summary).toMatchObject({
      rendition: "packed",
      frameCount: 1,
      aggregate: {
        sampleCount: 4,
        meanAbsoluteError: 2 / 255,
        p99AbsoluteError: 2 / 255,
        minimumDecodedAlpha: 12,
        maximumDecodedAlpha: 42
      },
      worstFrame: {
        unit: "body",
        frameIndex: 0,
        meanAbsoluteError: 2 / 255
      }
    });
    expect(Object.isFrozen(summary)).toBe(true);
  });

  it("rejects a per-frame mean or p99 one byte beyond the exact limits", () => {
    const mean = createAlphaQualityAccumulator({ rendition: "packed", geometry });
    expect(() => mean.includeFrame({
      unit: "body",
      frameIndex: 0,
      expectedAlpha: Uint8Array.of(0, 0, 0, 0),
      decodedRgba: decodedAlpha([3, 3, 3, 3])
    })).toThrow(expect.objectContaining({
      code: "ALPHA_QUALITY_REJECTED",
      statistic: "mae",
      value: 3 / 255,
      limit: 2 / 255,
      phase: "quality",
      rendition: "packed",
      unit: "body",
      frame: 0
    }));

    const wideGeometry = deriveAvcRenditionGeometry({
      profile: "avc-annexb-packed-alpha-v0",
      canvasWidth: 5,
      canvasHeight: 1,
      colorRect: [0, 0, 5, 1],
      alphaRect: [0, 10, 5, 1],
      codedWidth: 16,
      codedHeight: 16
    });
    const p99 = createAlphaQualityAccumulator({
      rendition: "packed",
      geometry: wideGeometry
    });
    expect(() => p99.includeFrame({
      unit: "body",
      frameIndex: 0,
      expectedAlpha: Uint8Array.of(0, 0, 0, 0, 0),
      decodedRgba: decodedAlpha([0, 0, 0, 0, 9], wideGeometry)
    })).toThrow(expect.objectContaining({
      code: "ALPHA_QUALITY_REJECTED",
      statistic: "p99"
    }));
  });

  it("uses nearest-rank small-N p99 and stable worst-frame tie ordering", () => {
    const accumulator = createAlphaQualityAccumulator({
      rendition: "packed",
      geometry
    });
    accumulator.includeFrame({
      unit: "z-body",
      frameIndex: 3,
      expectedAlpha: Uint8Array.of(0, 0, 0, 0),
      decodedRgba: decodedAlpha([1, 1, 1, 1])
    });
    accumulator.includeFrame({
      unit: "a-body",
      frameIndex: 7,
      expectedAlpha: Uint8Array.of(0, 0, 0, 0),
      decodedRgba: decodedAlpha([1, 1, 1, 1])
    });
    expect(accumulator.finish().worstFrame).toMatchObject({
      unit: "a-body",
      frameIndex: 7,
      p99AbsoluteError: 1 / 255
    });
  });

  it("accepts quality frame indexes beyond the former unit ceiling", () => {
    const accumulator = createAlphaQualityAccumulator({
      rendition: "packed",
      geometry
    });
    accumulator.includeFrame({
      unit: "body",
      frameIndex: 900,
      expectedAlpha: Uint8Array.of(0, 0, 0, 0),
      decodedRgba: decodedAlpha([0, 0, 0, 0])
    });
    expect(accumulator.finish().worstFrame.frameIndex).toBe(900);
  });

  it("does not mutate inputs and rejects geometry, length, order, and cancellation", () => {
    const expected = Uint8Array.of(0, 0, 0, 0);
    const decoded = decodedAlpha([0, 0, 0, 0]);
    const before = decoded.slice();
    const accumulator = createAlphaQualityAccumulator({
      rendition: "packed",
      geometry
    });
    accumulator.includeFrame({
      unit: "body",
      frameIndex: 0,
      expectedAlpha: expected,
      decodedRgba: decoded
    });
    expect(decoded).toEqual(before);
    expect(() => accumulator.includeFrame({
      unit: "body",
      frameIndex: 0,
      expectedAlpha: expected,
      decodedRgba: decoded
    })).toThrow();

    const controller = new AbortController();
    controller.abort("test");
    expect(() => createAlphaQualityAccumulator({
      rendition: "packed",
      geometry,
      signal: controller.signal
    })).toThrow(expect.objectContaining({ code: "CANCELLED" }));
  });
});

function decodedAlpha(
  values: readonly number[],
  targetGeometry = geometry
): Uint8Array {
  const width = targetGeometry.decodedStorageRect[2];
  const height = targetGeometry.decodedStorageRect[3];
  const rgba = new Uint8Array(width * height * 4);
  const alphaY = targetGeometry.visibleAlphaRect![1];
  for (let x = 0; x < values.length; x += 1) {
    rgba[(alphaY * width + x) * 4] = values[x]!;
  }
  return rgba;
}
