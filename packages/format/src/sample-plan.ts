import { checkedAdd } from "./checked-integer.js";
import { FormatError, type FormatErrorCode } from "./errors.js";
import type { RenditionV01, UnitV01 } from "./model.js";

type PlanRendition = Pick<RenditionV01, "id"> & { readonly profile: string };
type PlanUnit = Pick<UnitV01, "id" | "frameCount">;
const UINT32_MAX = 0xffff_ffff;

export interface CanonicalSampleSlot {
  readonly ordinal: number;
  readonly renditionIndex: number;
  readonly renditionId: string;
  readonly unitIndex: number;
  readonly unitId: string;
  readonly frameIndex: number;
  readonly keyRequired: boolean;
}

export interface CanonicalSampleSpan {
  readonly renditionIndex: number;
  readonly renditionId: string;
  readonly unitIndex: number;
  readonly unitId: string;
  readonly sampleStart: number;
  readonly sampleCount: number;
  readonly keyEveryFrame: boolean;
}

export interface CanonicalSamplePlan {
  readonly renditionCount: number;
  readonly unitCount: number;
  readonly totalFrameCount: number;
  readonly recordCount: number;
  readonly spans: readonly CanonicalSampleSpan[];
  readonly unitSpans: readonly (readonly CanonicalSampleSpan[])[];
  records(): IterableIterator<CanonicalSampleSlot>;
  recordAt(index: number): CanonicalSampleSlot;
}

/** Own the sole rendition → unit → frame traversal for version 0.1. */
export function createCanonicalSamplePlan(
  renditions: readonly PlanRendition[],
  units: readonly PlanUnit[],
  maximumRecords: number,
  maximumTotalFrames: number = maximumRecords
): Readonly<CanonicalSamplePlan> {
  if (!Number.isSafeInteger(maximumRecords) || maximumRecords < 0) {
    throw new FormatError(
      "INTEGER_UNSAFE",
      "maximum sample records must be a nonnegative safe integer"
    );
  }
  if (!Number.isSafeInteger(maximumTotalFrames) || maximumTotalFrames < 0) {
    throw new FormatError(
      "INTEGER_UNSAFE",
      "maximum total frames must be a nonnegative safe integer"
    );
  }
  // Every legal unit contributes at least one record per rendition. Reject
  // hostile array lengths before traversing either array.
  if (renditions.length < 1) {
    throw new FormatError(
      "MANIFEST_INVALID",
      "at least one rendition is required",
      { path: "renditions" }
    );
  }
  if (renditions.length > maximumRecords) {
    throw new FormatError(
      "BUDGET_EXCEEDED",
      "rendition count cannot fit the sample record budget",
      { path: "renditions" }
    );
  }
  if (units.length < 1) {
    throw new FormatError(
      "MANIFEST_INVALID",
      "at least one unit is required",
      { path: "units" }
    );
  }
  if (units.length > Math.min(maximumRecords, maximumTotalFrames)) {
    throw new FormatError(
      "BUDGET_EXCEEDED",
      "unit count cannot fit the sample record budget",
      { path: "units" }
    );
  }
  let totalFrameCount = 0;
  for (let unitIndex = 0; unitIndex < units.length; unitIndex += 1) {
    const unit = units[unitIndex];
    if (
      unit === undefined ||
      !Number.isSafeInteger(unit.frameCount) ||
      unit.frameCount <= 0
    ) {
      throw new FormatError(
        "MANIFEST_INVALID",
        `units[${String(unitIndex)}].frameCount must be a positive safe integer`,
        { path: `units[${String(unitIndex)}].frameCount` }
      );
    }
    const nextTotalFrameCount = totalFrameCount + unit.frameCount;
    if (!Number.isSafeInteger(nextTotalFrameCount) || nextTotalFrameCount > UINT32_MAX) {
      throw new FormatError(
        "INTEGER_UNSAFE",
        "total unit frames cannot fit the uint32 sample-index representation"
      );
    }
    if (nextTotalFrameCount > maximumTotalFrames) {
      throw new FormatError(
        "BUDGET_EXCEEDED",
        "total unit frames exceed the active budget"
      );
    }
    totalFrameCount = nextTotalFrameCount;
  }
  const recordCountBigInt = BigInt(totalFrameCount) * BigInt(renditions.length);
  if (recordCountBigInt > BigInt(UINT32_MAX)) {
    throw new FormatError(
      "INTEGER_UNSAFE",
      "sample record count cannot fit the uint32 sample-index representation"
    );
  }
  const recordCount = Number(recordCountBigInt);
  if (recordCount > maximumRecords) {
    throw new FormatError(
      "BUDGET_EXCEEDED",
      "sample record count exceeds the active budget"
    );
  }
  const spans: CanonicalSampleSpan[] = [];
  const unitSpans: CanonicalSampleSpan[][] = Array.from(
    { length: units.length },
    () => []
  );
  let ordinal = 0;
  for (
    let renditionIndex = 0;
    renditionIndex < renditions.length;
    renditionIndex += 1
  ) {
    const rendition = renditions[renditionIndex];
    if (rendition === undefined) {
      throw new FormatError("MANIFEST_INVALID", "rendition array is sparse");
    }
    for (let unitIndex = 0; unitIndex < units.length; unitIndex += 1) {
      const unit = units[unitIndex];
      if (unit === undefined) {
        throw new FormatError("MANIFEST_INVALID", "unit array is sparse");
      }
      const span = Object.freeze({
        renditionIndex,
        renditionId: rendition.id,
        unitIndex,
        unitId: unit.id,
        sampleStart: ordinal,
        sampleCount: unit.frameCount,
        keyEveryFrame: rendition.profile === "reference-rgba-v0"
      });
      spans.push(span);
      unitSpans[unitIndex]?.push(span);
      ordinal = checkedAdd(
        ordinal,
        unit.frameCount,
        recordCount,
        "sample span end"
      );
    }
  }
  if (ordinal !== recordCount) {
    throw new FormatError("INTEGER_UNSAFE", "canonical sample count drifted");
  }
  const frozenSpans = Object.freeze(spans);

  function recordAt(index: number): CanonicalSampleSlot {
    if (!Number.isSafeInteger(index) || index < 0 || index >= recordCount) {
      throw new FormatError(
        "INTEGER_UNSAFE",
        "sample record index is outside the canonical plan"
      );
    }
    let lower = 0;
    let upper = frozenSpans.length - 1;
    while (lower <= upper) {
      const middle = lower + Math.floor((upper - lower) / 2);
      const span = frozenSpans[middle];
      if (span === undefined) break;
      if (index < span.sampleStart) {
        upper = middle - 1;
        continue;
      }
      const spanEnd = checkedAdd(
        span.sampleStart,
        span.sampleCount,
        recordCount,
        "sample span end"
      );
      if (index >= spanEnd) {
        lower = middle + 1;
        continue;
      }
      const frameIndex = index - span.sampleStart;
      return Object.freeze({
        ordinal: index,
        renditionIndex: span.renditionIndex,
        renditionId: span.renditionId,
        unitIndex: span.unitIndex,
        unitId: span.unitId,
        frameIndex,
        keyRequired: frameIndex === 0 || span.keyEveryFrame
      });
    }
    throw new FormatError("INTEGER_UNSAFE", "canonical sample span lookup failed");
  }

  function* records(): IterableIterator<CanonicalSampleSlot> {
    for (const span of frozenSpans) {
      for (let frameIndex = 0; frameIndex < span.sampleCount; frameIndex += 1) {
        yield Object.freeze({
          ordinal: span.sampleStart + frameIndex,
          renditionIndex: span.renditionIndex,
          renditionId: span.renditionId,
          unitIndex: span.unitIndex,
          unitId: span.unitId,
          frameIndex,
          keyRequired: frameIndex === 0 || span.keyEveryFrame
        });
      }
    }
  }

  return Object.freeze({
    renditionCount: renditions.length,
    unitCount: units.length,
    totalFrameCount,
    recordCount,
    spans: frozenSpans,
    unitSpans: Object.freeze(
      unitSpans.map((unitSamples) => Object.freeze(unitSamples))
    ),
    records,
    recordAt
  });
}

/** Assert that on-wire span descriptors exactly match a canonical plan. */
export function validateCanonicalSampleSpans(
  plan: Readonly<CanonicalSamplePlan>,
  units: readonly Pick<UnitV01, "samples">[],
  code: Extract<FormatErrorCode, "MANIFEST_INVALID" | "INDEX_INVALID"> =
    "MANIFEST_INVALID"
): void {
  for (const expected of plan.spans) {
    const unit = units[expected.unitIndex];
    const span = unit?.samples[expected.renditionIndex];
    if (
      span === undefined ||
      span.rendition !== expected.renditionId ||
      span.sampleStart !== expected.sampleStart ||
      span.sampleCount !== expected.sampleCount
    ) {
      throw new FormatError(
        code,
        `unit ${expected.unitId} sample span does not match canonical ordinals`,
        {
          path: `units[${String(expected.unitIndex)}].samples[${String(expected.renditionIndex)}]`
        }
      );
    }
  }
  for (let unitIndex = 0; unitIndex < units.length; unitIndex += 1) {
    const unit = units[unitIndex];
    const expectedCount = plan.renditionCount;
    if (unit === undefined || unit.samples.length !== expectedCount) {
      throw new FormatError(
        code,
        `unit ${String(unitIndex)} must declare exactly ${String(expectedCount)} sample spans`,
        { path: `units[${String(unitIndex)}].samples` }
      );
    }
  }
}
