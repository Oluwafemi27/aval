import { IDENTIFIER_PATTERN, type AvcRenditionGeometry } from "@rendered-motion/format";

import { throwIfAborted } from "../cancellation.js";
import { CompilerError } from "../diagnostics.js";
import type {
  AlphaErrorStatistics,
  AlphaFrameQualitySummary,
  AlphaQualitySummary
} from "../model.js";
import {
  packedQualityGeometry,
  type PackedQualityGeometry
} from "./packed-quality-geometry.js";

const MEAN_LIMIT_BYTES = 2n;
const P99_LIMIT_BYTES = 8;
const HISTOGRAM_LENGTH = 256;
const CANCEL_INTERVAL = 4_096;

export interface AlphaQualityAccumulatorInput {
  readonly rendition: string;
  readonly geometry: Readonly<AvcRenditionGeometry>;
  readonly signal?: AbortSignal;
}

export interface AlphaQualityFrameInput {
  readonly unit: string;
  readonly frameIndex: number;
  readonly expectedAlpha: Uint8Array;
  readonly decodedRgba: Uint8Array;
}

export interface AlphaQualityAccumulator {
  readonly includeFrame: (
    frame: Readonly<AlphaQualityFrameInput>
  ) => Readonly<AlphaFrameQualitySummary>;
  readonly finish: () => Readonly<AlphaQualitySummary>;
}

/** Create one streaming per-frame and aggregate packed-alpha quality gate. */
export function createAlphaQualityAccumulator(
  input: Readonly<AlphaQualityAccumulatorInput>
): AlphaQualityAccumulator {
  throwIfAborted(input.signal);
  if (!IDENTIFIER_PATTERN.test(input.rendition)) {
    throw new CompilerError("INPUT_INVALID", "Alpha-quality rendition ID is invalid");
  }
  const facts = qualityGeometry(input.geometry);
  const aggregateHistogram = emptyHistogram();
  let aggregateSum = 0n;
  let aggregateCount = 0n;
  let aggregateMinimum = 255;
  let aggregateMaximum = 0;
  let worst: FrameMeasurement | undefined;
  let frameCount = 0;
  let finished = false;
  const identities = new Set<string>();

  const includeFrame = (
    frame: Readonly<AlphaQualityFrameInput>
  ): Readonly<AlphaFrameQualitySummary> => {
    throwIfAborted(input.signal);
    if (finished) closed();
    validateFrame(frame, facts);
    const identity = `${frame.unit}\u0000${String(frame.frameIndex)}`;
    if (identities.has(identity)) {
      throw new CompilerError("INPUT_INVALID", "Alpha-quality frame is duplicated");
    }
    identities.add(identity);
    const histogram = emptyHistogram();
    let sum = 0n;
    let minimumDecodedAlpha = 255;
    let maximumDecodedAlpha = 0;
    const alpha = facts.alphaRect;
    for (let y = 0; y < alpha.height; y += 1) {
      for (let x = 0; x < alpha.width; x += 1) {
        const pixel = y * alpha.width + x;
        if (pixel % CANCEL_INTERVAL === 0) throwIfAborted(input.signal);
        const decoded = frame.decodedRgba[
          ((alpha.y + y) * facts.storageWidth + alpha.x + x) * 4
        ]!;
        const error = Math.abs(decoded - frame.expectedAlpha[pixel]!);
        histogram[error] = histogram[error]! + 1n;
        aggregateHistogram[error] = aggregateHistogram[error]! + 1n;
        sum += BigInt(error);
        aggregateSum += BigInt(error);
        minimumDecodedAlpha = Math.min(minimumDecodedAlpha, decoded);
        maximumDecodedAlpha = Math.max(maximumDecodedAlpha, decoded);
      }
    }
    const count = BigInt(facts.sampleCount);
    aggregateCount += count;
    aggregateMinimum = Math.min(aggregateMinimum, minimumDecodedAlpha);
    aggregateMaximum = Math.max(aggregateMaximum, maximumDecodedAlpha);
    const measurement: FrameMeasurement = Object.freeze({
      unit: frame.unit,
      frameIndex: frame.frameIndex,
      sum,
      count,
      histogram,
      minimumDecodedAlpha,
      maximumDecodedAlpha,
      p99Byte: nearestRankP99(histogram, count)
    });
    rejectStatistics(measurement, input.rendition);
    if (worst === undefined || compareWorst(measurement, worst) < 0) {
      worst = measurement;
    }
    frameCount += 1;
    return frameSummary(input.rendition, measurement);
  };

  const finish = (): Readonly<AlphaQualitySummary> => {
    throwIfAborted(input.signal);
    if (finished) closed();
    finished = true;
    if (frameCount < 1 || worst === undefined || aggregateCount < 1n) {
      throw new CompilerError("INPUT_INVALID", "Alpha-quality audit is empty");
    }
    const aggregate: Measurement = Object.freeze({
      sum: aggregateSum,
      count: aggregateCount,
      histogram: aggregateHistogram,
      minimumDecodedAlpha: aggregateMinimum,
      maximumDecodedAlpha: aggregateMaximum,
      p99Byte: nearestRankP99(aggregateHistogram, aggregateCount)
    });
    rejectStatistics(aggregate, input.rendition);
    return Object.freeze({
      rendition: input.rendition,
      frameCount,
      aggregate: statistics(aggregate),
      worstFrame: frameSummary(input.rendition, worst)
    });
  };
  return Object.freeze({ includeFrame, finish });
}

interface Measurement {
  readonly sum: bigint;
  readonly count: bigint;
  readonly histogram: readonly bigint[];
  readonly minimumDecodedAlpha: number;
  readonly maximumDecodedAlpha: number;
  readonly p99Byte: number;
}

interface FrameMeasurement extends Measurement {
  readonly unit: string;
  readonly frameIndex: number;
}

function qualityGeometry(
  geometry: Readonly<AvcRenditionGeometry>
): Readonly<PackedQualityGeometry> {
  return packedQualityGeometry(geometry);
}

function validateFrame(
  frame: Readonly<AlphaQualityFrameInput>,
  facts: Readonly<PackedQualityGeometry>
): void {
  if (
    typeof frame !== "object" ||
    frame === null ||
    !IDENTIFIER_PATTERN.test(frame.unit) ||
    !Number.isSafeInteger(frame.frameIndex) ||
    frame.frameIndex < 0 ||
    frame.frameIndex >= 900 ||
    !(frame.expectedAlpha instanceof Uint8Array) ||
    frame.expectedAlpha.byteLength !== facts.sampleCount ||
    !(frame.decodedRgba instanceof Uint8Array) ||
    frame.decodedRgba.byteLength !== facts.decodedRgbaBytes
  ) {
    throw new CompilerError("INPUT_INVALID", "Alpha-quality frame input is invalid");
  }
}

function emptyHistogram(): bigint[] {
  return Array.from({ length: HISTOGRAM_LENGTH }, () => 0n);
}

function nearestRankP99(histogram: readonly bigint[], count: bigint): number {
  const rank = (99n * count + 99n) / 100n;
  let cumulative = 0n;
  for (let error = 0; error < histogram.length; error += 1) {
    cumulative += histogram[error]!;
    if (cumulative >= rank) return error;
  }
  throw new CompilerError("IO_FAILED", "Alpha-quality histogram is incomplete");
}

function rejectStatistics(measurement: Measurement, rendition: string): void {
  const frame = "unit" in measurement
    ? measurement as FrameMeasurement
    : undefined;
  const context = {
    rendition,
    ...(frame === undefined
      ? {}
      : { unit: frame.unit, frame: frame.frameIndex })
  };
  if (measurement.sum > MEAN_LIMIT_BYTES * measurement.count) {
    throw new CompilerError(
      "ALPHA_QUALITY_REJECTED",
      "Decoded alpha mean absolute error exceeds the quality limit",
      {
        statistic: "mae",
        value: normalizedMean(measurement.sum, measurement.count),
        limit: 2 / 255,
        phase: "quality",
        ...context
      }
    );
  }
  if (measurement.p99Byte > P99_LIMIT_BYTES) {
    throw new CompilerError(
      "ALPHA_QUALITY_REJECTED",
      "Decoded alpha p99 error exceeds the quality limit",
      {
        statistic: "p99",
        value: measurement.p99Byte / 255,
        limit: P99_LIMIT_BYTES / 255,
        phase: "quality",
        ...context
      }
    );
  }
}

function statistics(measurement: Measurement): Readonly<AlphaErrorStatistics> {
  const count = Number(measurement.count);
  if (!Number.isSafeInteger(count)) {
    throw new CompilerError("SOURCE_LIMIT", "Alpha sample count exceeds safe range");
  }
  return Object.freeze({
    sampleCount: count,
    meanAbsoluteError: normalizedMean(measurement.sum, measurement.count),
    p99AbsoluteError: measurement.p99Byte / 255,
    minimumDecodedAlpha: measurement.minimumDecodedAlpha,
    maximumDecodedAlpha: measurement.maximumDecodedAlpha
  });
}

function frameSummary(
  rendition: string,
  measurement: FrameMeasurement
): Readonly<AlphaFrameQualitySummary> {
  return Object.freeze({
    rendition,
    unit: measurement.unit,
    frameIndex: measurement.frameIndex,
    ...statistics(measurement)
  });
}

function normalizedMean(sum: bigint, count: bigint): number {
  return Number(sum) / Number(count) / 255;
}

/** Return negative when left is the stable worse frame. */
function compareWorst(left: FrameMeasurement, right: FrameMeasurement): number {
  const leftScaled = left.sum * right.count;
  const rightScaled = right.sum * left.count;
  if (leftScaled !== rightScaled) return leftScaled > rightScaled ? -1 : 1;
  if (left.p99Byte !== right.p99Byte) return left.p99Byte > right.p99Byte ? -1 : 1;
  if (left.unit !== right.unit) return left.unit < right.unit ? -1 : 1;
  return left.frameIndex - right.frameIndex;
}

function closed(): never {
  throw new CompilerError("INPUT_INVALID", "Alpha-quality audit is closed");
}
