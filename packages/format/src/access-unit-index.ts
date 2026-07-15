import {
  ACCESS_UNIT_INDEX_HEADER_LENGTH,
  ACCESS_UNIT_INDEX_MAGIC,
  ACCESS_UNIT_RECORD_LENGTH,
  resolveFormatBudgets
} from "./constants.js";
import {
  checkedAdd,
  checkedMultiply,
  readUint16LE,
  readUint32LE,
  readUint64LE,
  requireByteRange,
  writeUint16LE,
  writeUint32LE,
  writeUint64LE
} from "./checked-integer.js";
import { FormatError, isFormatError } from "./errors.js";
import type {
  AccessUnitRecord,
  CompiledManifestV01,
  FormatOptions
} from "./model.js";
import {
  createCanonicalSamplePlan,
  type CanonicalSamplePlan,
  validateCanonicalSampleSpans
} from "./sample-plan.js";

const KEY_FLAG = 0x0001;

function recordByteOffset(ordinal: number, maximum: number): number {
  return checkedAdd(
    ACCESS_UNIT_INDEX_HEADER_LENGTH,
    checkedMultiply(
      ordinal,
      ACCESS_UNIT_RECORD_LENGTH,
      maximum,
      "access-unit record offset"
    ),
    maximum,
    "access-unit record offset"
  );
}

function fail(message: string, offset?: number): never {
  throw new FormatError(
    "INDEX_INVALID",
    message,
    offset === undefined ? undefined : { offset }
  );
}

function assertMagic(bytes: Uint8Array): void {
  for (let index = 0; index < ACCESS_UNIT_INDEX_MAGIC.length; index += 1) {
    if (bytes[index] !== ACCESS_UNIT_INDEX_MAGIC[index]) {
      fail("access-unit index magic must be AVLI", index);
    }
  }
}

function canonicalSamplePlan(
  manifest: CompiledManifestV01,
  maximum: number,
  maximumTotalFrames: number
): Readonly<CanonicalSamplePlan> {
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    !Array.isArray(manifest.renditions) ||
    !Array.isArray(manifest.units)
  ) {
    fail("a validated manifest is required to interpret the access-unit index");
  }

  try {
    const plan = createCanonicalSamplePlan(
      manifest.renditions,
      manifest.units,
      maximum,
      maximumTotalFrames
    );
    validateCanonicalSampleSpans(plan, manifest.units, "INDEX_INVALID");
    return plan;
  } catch (error) {
    if (
      isFormatError(error) &&
      (error.code === "BUDGET_EXCEEDED" || error.code === "INTEGER_UNSAFE")
    ) {
      throw error;
    }
    if (isFormatError(error)) {
      throw new FormatError("INDEX_INVALID", error.message, {
        ...(error.path === undefined ? {} : { path: error.path })
      });
    }
    return fail("manifest sample plan could not be derived");
  }
}

function validateRecordSequence(
  records: readonly AccessUnitRecord[],
  manifest: CompiledManifestV01,
  plan: Readonly<CanonicalSamplePlan>,
  options?: FormatOptions
): void {
  const budgets = resolveFormatBudgets(options);
  const expectedCount = plan.recordCount;
  if (records.length !== expectedCount) {
    fail(
      `access-unit record count must be ${String(expectedCount)}, received ${String(records.length)}`,
      8
    );
  }

  for (const slot of plan.records()) {
    const record = records[slot.ordinal];
    const recordOffset = recordByteOffset(slot.ordinal, budgets.maxIndexBytes);
    if (record === undefined) {
      fail("access-unit record is missing", recordOffset);
    }
    if (
      record.renditionIndex !== slot.renditionIndex ||
      record.unitIndex !== slot.unitIndex ||
      record.frameIndex !== slot.frameIndex
    ) {
      fail(
        "access-unit records must be ordered by rendition, unit, then frame",
        recordOffset + 12
      );
    }
    if (record.payloadLength < 1) {
      fail("access-unit payload length must be positive", recordOffset + 8);
    }
    if (record.payloadLength > budgets.maxSampleBytes) {
      throw new FormatError(
        "BUDGET_EXCEEDED",
        `access-unit payload length exceeds the active limit of ${String(budgets.maxSampleBytes)}`,
        { offset: recordOffset + 8 }
      );
    }
    if (slot.keyRequired && !record.key) {
      fail(
        slot.frameIndex === 0
          ? "frame zero of every unit must be marked key"
          : "every reference-rgba-v0 access unit must be marked key",
        recordOffset + 18
      );
    }
  }
}

function parseRecord(
  bytes: Uint8Array,
  ordinal: number,
  options?: FormatOptions
): Readonly<AccessUnitRecord> {
  const budgets = resolveFormatBudgets(options);
  const offset = recordByteOffset(ordinal, budgets.maxIndexBytes);
  const payloadOffset = readUint64LE(
    bytes,
    offset,
    budgets.maxFileBytes,
    "INDEX_INVALID",
    "access-unit payload offset"
  );
  const payloadLength = readUint32LE(
    bytes,
    offset + 8,
    "INDEX_INVALID",
    "access-unit payload length"
  );
  const unitIndex = readUint32LE(
    bytes,
    offset + 12,
    "INDEX_INVALID",
    "access-unit unit index"
  );
  const renditionIndex = readUint16LE(
    bytes,
    offset + 16,
    "INDEX_INVALID",
    "access-unit rendition index"
  );
  const flags = readUint16LE(
    bytes,
    offset + 18,
    "INDEX_INVALID",
    "access-unit flags"
  );
  if ((flags & ~KEY_FLAG) !== 0) {
    fail("access-unit record uses unknown flag bits", offset + 18);
  }
  const frameIndex = readUint32LE(
    bytes,
    offset + 20,
    "INDEX_INVALID",
    "access-unit frame index"
  );
  for (let reserved = offset + 24; reserved < offset + 32; reserved += 1) {
    if (bytes[reserved] !== 0) {
      fail("access-unit record reserved bytes must be zero", reserved);
    }
  }

  return Object.freeze({
    payloadOffset,
    payloadLength,
    unitIndex,
    renditionIndex,
    key: (flags & KEY_FLAG) !== 0,
    frameIndex
  });
}

/**
 * Parse one exact version-0.1 access-unit index view.
 *
 * The supplied view must contain the index and nothing else. The returned
 * records are detached numeric metadata and retain no input bytes.
 */
export function parseAccessUnitIndex(
  bytes: Uint8Array,
  manifest: CompiledManifestV01,
  options?: FormatOptions
): readonly AccessUnitRecord[] {
  try {
    const budgets = resolveFormatBudgets(options);
    requireByteRange(
      bytes,
      0,
      ACCESS_UNIT_INDEX_HEADER_LENGTH,
      "INDEX_INVALID",
      "access-unit index header"
    );
    assertMagic(bytes);

    const recordSize = readUint16LE(
      bytes,
      4,
      "INDEX_INVALID",
      "access-unit record size"
    );
    if (recordSize !== ACCESS_UNIT_RECORD_LENGTH) {
      fail(
        `access-unit record size must be ${String(ACCESS_UNIT_RECORD_LENGTH)}`,
        4
      );
    }
    if (
      readUint16LE(bytes, 6, "INDEX_INVALID", "index reserved field") !== 0
    ) {
      fail("access-unit index reserved field must be zero", 6);
    }
    const sampleCount = readUint32LE(
      bytes,
      8,
      "INDEX_INVALID",
      "access-unit sample count"
    );
    if (
      readUint32LE(bytes, 12, "INDEX_INVALID", "index reserved field") !== 0
    ) {
      fail("access-unit index reserved field must be zero", 12);
    }
    if (sampleCount > budgets.maxSampleRecords) {
      throw new FormatError(
        "BUDGET_EXCEEDED",
        `access-unit sample count exceeds the active limit of ${String(budgets.maxSampleRecords)}`,
        { offset: 8 }
      );
    }

    const recordsLength = checkedMultiply(
      sampleCount,
      ACCESS_UNIT_RECORD_LENGTH,
      budgets.maxIndexBytes,
      "access-unit records length"
    );
    const expectedLength = checkedAdd(
      ACCESS_UNIT_INDEX_HEADER_LENGTH,
      recordsLength,
      budgets.maxIndexBytes,
      "access-unit index length"
    );
    if (bytes.byteLength !== expectedLength) {
      fail(
        `access-unit index length must be exactly ${String(expectedLength)} bytes`,
        Math.min(bytes.byteLength, expectedLength)
      );
    }

    const plan = canonicalSamplePlan(
      manifest,
      budgets.maxSampleRecords,
      budgets.maxTotalUnitFrames
    );
    if (sampleCount !== plan.recordCount) {
      fail(
        `access-unit sample count must match the manifest count of ${String(plan.recordCount)}`,
        8
      );
    }

    const records: AccessUnitRecord[] = [];
    try {
      for (let ordinal = 0; ordinal < sampleCount; ordinal += 1) {
        records.push(parseRecord(bytes, ordinal, options));
      }
    } catch (error) {
      if (isFormatError(error)) throw error;
      throw new FormatError(
        "INDEX_INVALID",
        `access-unit index allocation for ${String(sampleCount)} records failed`
      );
    }
    validateRecordSequence(records, manifest, plan, options);
    return Object.freeze(records);
  } catch (error) {
    if (isFormatError(error)) {
      throw error;
    }
    throw new FormatError(
      "INDEX_INVALID",
      "access-unit index could not be parsed"
    );
  }
}

/** Encode one exact version-0.1 access-unit index into a fresh byte array. */
export function encodeAccessUnitIndex(
  records: readonly AccessUnitRecord[],
  manifest: CompiledManifestV01,
  options?: FormatOptions
): Uint8Array {
  try {
    if (!Array.isArray(records)) {
      fail("access-unit records must be an array");
    }
    const budgets = resolveFormatBudgets(options);
    if (records.length > budgets.maxSampleRecords) {
      throw new FormatError(
        "BUDGET_EXCEEDED",
        `access-unit sample count exceeds the active limit of ${String(budgets.maxSampleRecords)}`,
        { offset: 8 }
      );
    }
    const length = checkedAdd(
      ACCESS_UNIT_INDEX_HEADER_LENGTH,
      checkedMultiply(
        records.length,
        ACCESS_UNIT_RECORD_LENGTH,
        budgets.maxIndexBytes,
        "access-unit records length"
      ),
      budgets.maxIndexBytes,
      "access-unit index length"
    );
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(length);
    } catch {
      throw new FormatError(
        "INDEX_INVALID",
        `access-unit index allocation of ${String(length)} bytes failed`
      );
    }
    bytes.set(ACCESS_UNIT_INDEX_MAGIC, 0);
    writeUint16LE(
      bytes,
      4,
      ACCESS_UNIT_RECORD_LENGTH,
      "INDEX_INVALID",
      "access-unit record size"
    );
    writeUint16LE(bytes, 6, 0, "INDEX_INVALID", "index reserved field");
    writeUint32LE(
      bytes,
      8,
      records.length,
      "INDEX_INVALID",
      "access-unit sample count"
    );
    writeUint32LE(bytes, 12, 0, "INDEX_INVALID", "index reserved field");

    for (let ordinal = 0; ordinal < records.length; ordinal += 1) {
      const record = records[ordinal];
      const offset = recordByteOffset(ordinal, budgets.maxIndexBytes);
      if (typeof record !== "object" || record === null) {
        fail("access-unit record must be an object", offset);
      }
      if (typeof record.key !== "boolean") {
        fail("access-unit key marker must be boolean", offset + 18);
      }
      writeUint64LE(
        bytes,
        offset,
        record.payloadOffset,
        "INDEX_INVALID",
        "access-unit payload offset"
      );
      writeUint32LE(
        bytes,
        offset + 8,
        record.payloadLength,
        "INDEX_INVALID",
        "access-unit payload length"
      );
      writeUint32LE(
        bytes,
        offset + 12,
        record.unitIndex,
        "INDEX_INVALID",
        "access-unit unit index"
      );
      writeUint16LE(
        bytes,
        offset + 16,
        record.renditionIndex,
        "INDEX_INVALID",
        "access-unit rendition index"
      );
      writeUint16LE(
        bytes,
        offset + 18,
        record.key ? KEY_FLAG : 0,
        "INDEX_INVALID",
        "access-unit flags"
      );
      writeUint32LE(
        bytes,
        offset + 20,
        record.frameIndex,
        "INDEX_INVALID",
        "access-unit frame index"
      );
    }

    // Reuse the parser as the one semantic validation path for writer input.
    parseAccessUnitIndex(bytes, manifest, options);
    return bytes;
  } catch (error) {
    if (isFormatError(error)) {
      throw error;
    }
    throw new FormatError(
      "INDEX_INVALID",
      "access-unit index could not be encoded"
    );
  }
}
