import { IDENTIFIER_PATTERN, type AvcRenditionGeometry } from "@pixel-point/aval-format";

import { throwIfAborted } from "../cancellation.js";
import { CompilerError } from "../diagnostics.js";
import type {
  CompositeBackgroundQualitySummary,
  CompositeQualitySummary
} from "../model.js";
import {
  packedQualityGeometry,
  type PackedQualityGeometry
} from "./packed-quality-geometry.js";

const HISTOGRAM_LENGTH = 256;
const CANCEL_INTERVAL = 4_096;
const BACKGROUNDS = Object.freeze([
  Object.freeze({ background: "black" as const, rgb: Object.freeze([0, 0, 0] as const) }),
  Object.freeze({ background: "white" as const, rgb: Object.freeze([255, 255, 255] as const) }),
  Object.freeze({ background: "magenta" as const, rgb: Object.freeze([255, 0, 255] as const) })
]);

export interface CompositeQualityAccumulatorInput {
  readonly rendition: string;
  readonly geometry: Readonly<AvcRenditionGeometry>;
  readonly signal?: AbortSignal;
}

export interface CompositeQualityFrameInput {
  readonly unit: string;
  readonly frameIndex: number;
  readonly expectedRgba: Uint8Array;
  readonly decodedRgba: Uint8Array;
}

export interface CompositeQualityAccumulator {
  readonly includeFrame: (frame: Readonly<CompositeQualityFrameInput>) => void;
  readonly finish: () => Readonly<CompositeQualitySummary>;
}

interface BackgroundMeasurement {
  sum: bigint;
  count: bigint;
  readonly histogram: bigint[];
}

/** Measure decoded straight-alpha compositing without introducing a color gate. */
export function createCompositeQualityAccumulator(
  input: Readonly<CompositeQualityAccumulatorInput>
): CompositeQualityAccumulator {
  throwIfAborted(input.signal);
  if (!IDENTIFIER_PATTERN.test(input.rendition)) {
    throw new CompilerError(
      "INPUT_INVALID",
      "Composite-quality rendition ID is invalid"
    );
  }
  const geometry = packedQualityGeometry(input.geometry);
  const measurements = BACKGROUNDS.map((): BackgroundMeasurement => ({
    sum: 0n,
    count: 0n,
    histogram: Array.from({ length: HISTOGRAM_LENGTH }, () => 0n)
  }));
  const identities = new Set<string>();
  let frameCount = 0;
  let finished = false;

  const includeFrame = (frame: Readonly<CompositeQualityFrameInput>): void => {
    throwIfAborted(input.signal);
    if (finished) closed();
    validateFrame(frame, geometry);
    const identity = `${frame.unit}\u0000${String(frame.frameIndex)}`;
    if (identities.has(identity)) {
      throw new CompilerError(
        "INPUT_INVALID",
        "Composite-quality frame is duplicated"
      );
    }
    identities.add(identity);
    for (let pixel = 0; pixel < geometry.sampleCount; pixel += 1) {
      if (pixel % CANCEL_INTERVAL === 0) throwIfAborted(input.signal);
      const x = pixel % geometry.colorRect.width;
      const y = Math.floor(pixel / geometry.colorRect.width);
      const expectedOffset = pixel * 4;
      const decodedColorOffset = (
        (geometry.colorRect.y + y) * geometry.storageWidth +
        geometry.colorRect.x + x
      ) * 4;
      const decodedAlpha = frame.decodedRgba[
        ((geometry.alphaRect.y + y) * geometry.storageWidth +
          geometry.alphaRect.x + x) * 4
      ]!;
      const expectedAlpha = frame.expectedRgba[expectedOffset + 3]!;
      for (let backgroundIndex = 0;
        backgroundIndex < BACKGROUNDS.length;
        backgroundIndex += 1) {
        const background = BACKGROUNDS[backgroundIndex]!;
        const measurement = measurements[backgroundIndex]!;
        for (let channel = 0; channel < 3; channel += 1) {
          const expected = compositeByte(
            frame.expectedRgba[expectedOffset + channel]!,
            expectedAlpha,
            background.rgb[channel]!
          );
          const decoded = compositeByte(
            frame.decodedRgba[decodedColorOffset + channel]!,
            decodedAlpha,
            background.rgb[channel]!
          );
          const error = Math.abs(decoded - expected);
          measurement.sum += BigInt(error);
          measurement.count += 1n;
          measurement.histogram[error] =
            measurement.histogram[error]! + 1n;
        }
      }
    }
    frameCount += 1;
  };

  const finish = (): Readonly<CompositeQualitySummary> => {
    throwIfAborted(input.signal);
    if (finished) closed();
    finished = true;
    if (frameCount < 1) {
      throw new CompilerError("INPUT_INVALID", "Composite-quality audit is empty");
    }
    const backgrounds = BACKGROUNDS.map((background, index) => {
      const measurement = measurements[index]!;
      const count = Number(measurement.count);
      if (!Number.isSafeInteger(count) || count < 1) {
        throw new CompilerError(
          "SOURCE_LIMIT",
          "Composite-quality sample count exceeds the safe range"
        );
      }
      return Object.freeze({
        background: background.background,
        rgb: background.rgb,
        sampleCount: count,
        meanAbsoluteError:
          Number(measurement.sum) / Number(measurement.count) / 255,
        p99AbsoluteError:
          nearestRankP99(measurement.histogram, measurement.count) / 255
      }) satisfies Readonly<CompositeBackgroundQualitySummary>;
    });
    return Object.freeze({
      policy: "report-only" as const,
      rendition: input.rendition,
      frameCount,
      backgrounds: Object.freeze(backgrounds)
    });
  };
  return Object.freeze({ includeFrame, finish });
}

function validateFrame(
  frame: Readonly<CompositeQualityFrameInput>,
  geometry: Readonly<PackedQualityGeometry>
): void {
  if (
    typeof frame !== "object" ||
    frame === null ||
    !IDENTIFIER_PATTERN.test(frame.unit) ||
    !Number.isSafeInteger(frame.frameIndex) ||
    frame.frameIndex < 0 ||
    !(frame.expectedRgba instanceof Uint8Array) ||
    frame.expectedRgba.byteLength !== geometry.visibleRgbaBytes ||
    !(frame.decodedRgba instanceof Uint8Array) ||
    frame.decodedRgba.byteLength !== geometry.decodedRgbaBytes
  ) {
    throw new CompilerError(
      "INPUT_INVALID",
      "Composite-quality frame input is invalid"
    );
  }
}

function compositeByte(color: number, alpha: number, background: number): number {
  return Math.floor((color * alpha + background * (255 - alpha) + 127) / 255);
}

function nearestRankP99(histogram: readonly bigint[], count: bigint): number {
  const rank = (99n * count + 99n) / 100n;
  let cumulative = 0n;
  for (let error = 0; error < histogram.length; error += 1) {
    cumulative += histogram[error]!;
    if (cumulative >= rank) return error;
  }
  throw new CompilerError(
    "IO_FAILED",
    "Composite-quality histogram is incomplete"
  );
}

function closed(): never {
  throw new CompilerError("INPUT_INVALID", "Composite-quality audit is closed");
}
