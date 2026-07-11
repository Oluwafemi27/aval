import { checkedAdd, checkedMultiply } from "./checked-integer.js";
import { FormatError, type FormatErrorCode } from "./errors.js";
import type { RenditionV01, UnitV01 } from "./model.js";

type PlanRendition = Pick<RenditionV01, "id"> & { readonly profile: string };
type PlanUnit = Pick<UnitV01, "id" | "frameCount">;

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
}

export interface CanonicalSamplePlan {
  readonly renditionCount: number;
  readonly unitCount: number;
  readonly totalFrameCount: number;
  readonly slots: readonly CanonicalSampleSlot[];
  readonly spans: readonly CanonicalSampleSpan[];
  readonly unitSpans: readonly (readonly CanonicalSampleSpan[])[];
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
    if (unit === undefined || !Number.isSafeInteger(unit.frameCount) || unit.frameCount <= 0) {
      throw new FormatError(
        "MANIFEST_INVALID",
        `units[${String(unitIndex)}].frameCount must be a positive safe integer`,
        { path: `units[${String(unitIndex)}].frameCount` }
      );
    }
    totalFrameCount = checkedAdd(
      totalFrameCount,
      unit.frameCount,
      maximumTotalFrames,
      "total unit frames"
    );
  }
  const recordCount = checkedMultiply(
    totalFrameCount,
    renditions.length,
    maximumRecords,
    "sample record count"
  );
  const slots: CanonicalSampleSlot[] = [];
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
        sampleCount: unit.frameCount
      });
      spans.push(span);
      unitSpans[unitIndex]?.push(span);
      for (let frameIndex = 0; frameIndex < unit.frameCount; frameIndex += 1) {
        slots.push(Object.freeze({
          ordinal,
          renditionIndex,
          renditionId: rendition.id,
          unitIndex,
          unitId: unit.id,
          frameIndex,
          keyRequired:
            frameIndex === 0 || rendition.profile === "reference-rgba-v0"
        }));
        ordinal += 1;
      }
    }
  }
  if (ordinal !== recordCount) {
    throw new FormatError("INTEGER_UNSAFE", "canonical sample count drifted");
  }
  return Object.freeze({
    renditionCount: renditions.length,
    unitCount: units.length,
    totalFrameCount,
    slots: Object.freeze(slots),
    spans: Object.freeze(spans),
    unitSpans: Object.freeze(
      unitSpans.map((unitSamples) => Object.freeze(unitSamples))
    )
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
