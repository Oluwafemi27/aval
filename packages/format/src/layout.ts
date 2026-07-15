import { align8, checkedAdd, checkedMultiply } from "./checked-integer.js";
import {
  ACCESS_UNIT_INDEX_HEADER_LENGTH,
  ACCESS_UNIT_RECORD_LENGTH,
  FORMAT_HEADER_LENGTH,
  resolveFormatBudgets
} from "./constants.js";
import { FormatError, isFormatError } from "./errors.js";
import type {
  AccessUnitRecord,
  ByteRange,
  CompiledManifestV01,
  FormatHeader,
  FormatOptions,
  UnitBlobRange
} from "./model.js";
import {
  createCanonicalSamplePlan,
  validateCanonicalSampleSpans
} from "./sample-plan.js";

/** Internal canonical geometry shared by the reader and writer. */
export interface CanonicalAssetLayout {
  readonly frontIndexRange: ByteRange;
  readonly unitBlobs: readonly UnitBlobRange[];
  readonly paddingRanges: readonly ByteRange[];
  readonly fileRange: ByteRange;
}

interface SamplePayloadShape {
  readonly payloadLength: number;
  readonly key: boolean;
}

/** Complete deterministic plan from which both index records and files derive. */
export interface CanonicalAssetPlan extends CanonicalAssetLayout {
  readonly indexOffset: number;
  readonly indexLength: number;
  readonly records: readonly AccessUnitRecord[];
}

function fail(
  message: string,
  details?: { readonly offset?: number; readonly path?: string }
): never {
  throw new FormatError("LAYOUT_INVALID", message, details);
}

function freezeRange(offset: number, length: number): ByteRange {
  return Object.freeze({ offset, length });
}

function addPaddingRange(
  ranges: ByteRange[],
  offset: number,
  end: number
): void {
  if (end > offset) ranges.push(freezeRange(offset, end - offset));
}

function checkedEnd(
  offset: number,
  length: number,
  limit: number,
  label: string
): number {
  return checkedAdd(offset, length, limit, label);
}

/**
 * Produce the sole legal version-0.1 layout from bounded payload descriptors.
 * This is the canonical owner of header/index geometry, sample order, unit
 * alignment and final file length.
 */
export function planCanonicalAssetLayout(
  manifestLength: number,
  manifest: CompiledManifestV01,
  samples: readonly SamplePayloadShape[],
  options?: FormatOptions
): Readonly<CanonicalAssetPlan> {
  const sampleCount = safeArrayLength(samples);
  try {
    return planCanonicalAssetLayoutUnchecked(
      manifestLength,
      manifest,
      samples,
      options
    );
  } catch (error) {
    if (isFormatError(error)) throw error;
    throw new FormatError(
      "LAYOUT_INVALID",
      `canonical layout allocation for ${sampleCount} samples failed`
    );
  }
}

function planCanonicalAssetLayoutUnchecked(
  manifestLength: number,
  manifest: CompiledManifestV01,
  samples: readonly SamplePayloadShape[],
  options?: FormatOptions
): Readonly<CanonicalAssetPlan> {
  const budgets = resolveFormatBudgets(options);
  const samplePlan = createCanonicalSamplePlan(
    manifest.renditions,
    manifest.units,
    budgets.maxSampleRecords,
    budgets.maxTotalUnitFrames
  );
  validateCanonicalSampleSpans(samplePlan, manifest.units);

  if (samples.length !== samplePlan.recordCount) {
    fail(
      `sample payload count must be ${String(samplePlan.recordCount)}, received ${String(samples.length)}`
    );
  }
  const blobRangeCount = samplePlan.spans.length;
  if (blobRangeCount > budgets.maxBlobRanges) {
    throw new FormatError(
      "BUDGET_EXCEEDED",
      "canonical blob range count exceeds the active budget"
    );
  }

  const manifestEnd = checkedEnd(
    FORMAT_HEADER_LENGTH,
    manifestLength,
    budgets.maxFileBytes,
    "manifest end"
  );
  if (manifestLength > budgets.maxManifestBytes) {
    throw new FormatError(
      "BUDGET_EXCEEDED",
      `manifest length exceeds the active limit of ${String(budgets.maxManifestBytes)}`
    );
  }
  const indexOffset = align8(
    manifestEnd,
    budgets.maxFileBytes,
    "access-unit index offset"
  );
  const indexLength = checkedAdd(
    ACCESS_UNIT_INDEX_HEADER_LENGTH,
    checkedMultiply(
      samplePlan.recordCount,
      ACCESS_UNIT_RECORD_LENGTH,
      budgets.maxIndexBytes,
      "access-unit records length"
    ),
    budgets.maxIndexBytes,
    "access-unit index length"
  );
  const frontIndexEnd = checkedEnd(
    indexOffset,
    indexLength,
    budgets.maxFileBytes,
    "front index end"
  );

  const paddingRanges: ByteRange[] = [];
  addPaddingRange(paddingRanges, manifestEnd, indexOffset);
  const records: AccessUnitRecord[] = [];
  const unitBlobs: UnitBlobRange[] = [];
  let cursor = frontIndexEnd;

  for (const span of samplePlan.spans) {
    const aligned = align8(cursor, budgets.maxFileBytes, "unit blob offset");
    addPaddingRange(paddingRanges, cursor, aligned);
    cursor = aligned;
    const blobOffset = cursor;
    const unit = manifest.units[span.unitIndex];
    const descriptor = unit?.samples[span.renditionIndex];
    if (unit === undefined || descriptor === undefined) {
      fail("canonical unit sample descriptor is missing");
    }

    const spanEnd = checkedAdd(
      span.sampleStart,
      span.sampleCount,
      samplePlan.recordCount,
      "sample span end"
    );
    for (let ordinal = span.sampleStart; ordinal < spanEnd; ordinal += 1) {
      const slot = samplePlan.recordAt(ordinal);
      const sample = samples[ordinal];
      if (slot === undefined || sample === undefined) {
        fail("canonical sample payload is missing");
      }
      if (typeof sample.key !== "boolean") {
        fail("sample key marker must be boolean");
      }
      if (!Number.isSafeInteger(sample.payloadLength) || sample.payloadLength < 1) {
        fail("sample payload length must be a positive safe integer");
      }
      if (sample.payloadLength > budgets.maxSampleBytes) {
        throw new FormatError(
          "BUDGET_EXCEEDED",
          `sample payload length exceeds the active limit of ${String(budgets.maxSampleBytes)}`
        );
      }
      if (slot.keyRequired && !sample.key) {
        fail("canonical sample requiring random access must be marked key");
      }
      records.push(Object.freeze({
        payloadOffset: cursor,
        payloadLength: sample.payloadLength,
        unitIndex: slot.unitIndex,
        renditionIndex: slot.renditionIndex,
        key: sample.key,
        frameIndex: slot.frameIndex
      }));
      cursor = checkedEnd(
        cursor,
        sample.payloadLength,
        budgets.maxFileBytes,
        "access-unit payload end"
      );
    }

    unitBlobs.push(Object.freeze({
      rendition: span.renditionId,
      unit: span.unitId,
      sampleStart: span.sampleStart,
      sampleCount: span.sampleCount,
      sha256: descriptor.sha256,
      offset: blobOffset,
      length: cursor - blobOffset
    }));
  }

  if (cursor > manifest.limits.maxCompiledBytes) {
    throw new FormatError(
      "BUDGET_EXCEEDED",
      "compiled file exceeds manifest limits.maxCompiledBytes",
      { path: "limits.maxCompiledBytes" }
    );
  }

  return Object.freeze({
    indexOffset,
    indexLength,
    records: Object.freeze(records),
    frontIndexRange: freezeRange(0, frontIndexEnd),
    unitBlobs: Object.freeze(unitBlobs),
    paddingRanges: Object.freeze(paddingRanges),
    fileRange: freezeRange(0, cursor)
  });
}

function safeArrayLength(value: unknown): string {
  try {
    const length = (value as { readonly length?: unknown })?.length;
    return typeof length === "number" && Number.isSafeInteger(length) && length >= 0
      ? String(length)
      : "an unknown number of";
  } catch {
    return "an unknown number of";
  }
}

/** Derive and validate the one legal version-0.1 byte layout. */
export function deriveCanonicalAssetLayout(
  header: FormatHeader,
  manifest: CompiledManifestV01,
  records: readonly AccessUnitRecord[],
  options?: FormatOptions
): Readonly<CanonicalAssetLayout> {
  try {
    if (!Array.isArray(records)) fail("access-unit records must be an array");
    const plan = planCanonicalAssetLayout(
      header.manifestLength,
      manifest,
      records,
      options
    );

    if (header.manifestOffset !== FORMAT_HEADER_LENGTH) {
      fail("manifest offset is not canonical", { offset: header.manifestOffset });
    }
    if (header.indexOffset !== plan.indexOffset) {
      fail("access-unit index offset is not canonical", { offset: header.indexOffset });
    }
    if (header.indexLength !== plan.indexLength) {
      fail("access-unit index length is not canonical", { offset: header.indexOffset });
    }
    if (header.declaredFileLength !== plan.fileRange.length) {
      fail(
        header.declaredFileLength > plan.fileRange.length
          ? "declared file contains trailing bytes"
          : "payload layout extends beyond the declared file",
        { offset: Math.min(header.declaredFileLength, plan.fileRange.length) }
      );
    }

    for (let index = 0; index < plan.records.length; index += 1) {
      const actual = records[index];
      const expected = plan.records[index];
      if (
        actual === undefined ||
        expected === undefined ||
        actual.payloadOffset !== expected.payloadOffset ||
        actual.payloadLength !== expected.payloadLength ||
        actual.unitIndex !== expected.unitIndex ||
        actual.renditionIndex !== expected.renditionIndex ||
        actual.key !== expected.key ||
        actual.frameIndex !== expected.frameIndex
      ) {
        fail("access-unit record is not canonical", {
          offset: actual?.payloadOffset ?? header.indexOffset
        });
      }
    }
    return Object.freeze({
      frontIndexRange: plan.frontIndexRange,
      unitBlobs: plan.unitBlobs,
      paddingRanges: plan.paddingRanges,
      fileRange: plan.fileRange
    });
  } catch (error) {
    if (isFormatError(error)) throw error;
    throw new FormatError("LAYOUT_INVALID", "asset layout could not be derived");
  }
}

/** Require every byte in the supplied numeric ranges to be canonical zero. */
export function validateZeroPadding(
  bytes: Uint8Array,
  ranges: readonly ByteRange[]
): void {
  try {
    if (!(bytes instanceof Uint8Array)) {
      throw new FormatError("INPUT_INVALID", "asset bytes must be a Uint8Array");
    }
    for (const range of ranges) {
      const end = checkedEnd(
        range.offset,
        range.length,
        bytes.byteLength,
        "padding range end"
      );
      for (let offset = range.offset; offset < end; offset += 1) {
        if (bytes[offset] !== 0) {
          fail("alignment padding must contain only zero bytes", { offset });
        }
      }
    }
  } catch (error) {
    if (isFormatError(error)) throw error;
    throw new FormatError("LAYOUT_INVALID", "asset padding could not be validated");
  }
}
