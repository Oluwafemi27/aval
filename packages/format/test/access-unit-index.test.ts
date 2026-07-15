import { describe, expect, it } from "vitest";

import {
  encodeAccessUnitIndex,
  parseAccessUnitIndex
} from "../src/access-unit-index.js";
import { writeUint32LE, writeUint64LE } from "../src/checked-integer.js";
import { FormatError } from "../src/errors.js";
import type {
  AccessUnitRecord,
  CompiledManifestV01
} from "../src/model.js";

const AVC_MANIFEST = {
  renditions: [{ id: "avc", profile: "avc-annexb-opaque-v0" }],
  units: [
    {
      id: "body",
      frameCount: 2,
      samples: [
        {
          rendition: "avc",
          sampleStart: 0,
          sampleCount: 2,
          sha256: "0".repeat(64)
        }
      ]
    }
  ]
} as unknown as CompiledManifestV01;

const REFERENCE_MANIFEST = {
  renditions: [{ id: "reference", profile: "reference-rgba-v0" }],
  units: [
    {
      id: "body",
      frameCount: 2,
      samples: [
        {
          rendition: "reference",
          sampleStart: 0,
          sampleCount: 2,
          sha256: "0".repeat(64)
        }
      ]
    }
  ]
} as unknown as CompiledManifestV01;

const RECORDS: readonly AccessUnitRecord[] = Object.freeze([
  Object.freeze({
    payloadOffset: 128,
    payloadLength: 4,
    unitIndex: 0,
    renditionIndex: 0,
    key: true,
    frameIndex: 0
  }),
  Object.freeze({
    payloadOffset: 132,
    payloadLength: 5,
    unitIndex: 0,
    renditionIndex: 0,
    key: false,
    frameIndex: 1
  })
]);

const GOLDEN_HEX =
  "41564c49200000000200000000000000" +
  "8000000000000000040000000000000000000100000000000000000000000000" +
  "8400000000000000050000000000000000000000010000000000000000000000";

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function expectFormatError(
  operation: () => unknown,
  code: FormatError["code"]
): FormatError {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(FormatError);
    expect((error as FormatError).code).toBe(code);
    return error as FormatError;
  }
  throw new Error("expected operation to throw");
}

describe("version-0.1 access-unit index", () => {
  it("encodes the exact 16 + 32N canonical bytes", () => {
    const bytes = encodeAccessUnitIndex(RECORDS, AVC_MANIFEST);
    expect(bytes).toHaveLength(80);
    expect(hex(bytes)).toBe(GOLDEN_HEX);
  });

  it("parses detached, recursively frozen numeric records", () => {
    const bytes = encodeAccessUnitIndex(RECORDS, AVC_MANIFEST);
    const parsed = parseAccessUnitIndex(bytes, AVC_MANIFEST);
    expect(parsed).toEqual(RECORDS);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(parsed.every(Object.isFrozen)).toBe(true);

    bytes.fill(0);
    expect(parsed).toEqual(RECORDS);
  });

  it("supports an unaligned view and reads no adjacent bytes", () => {
    const index = encodeAccessUnitIndex(RECORDS, AVC_MANIFEST);
    const storage = new Uint8Array(index.length + 7).fill(0xa5);
    const view = storage.subarray(3, 3 + index.length);
    view.set(index);
    expect(parseAccessUnitIndex(view, AVC_MANIFEST)).toEqual(RECORDS);
    expect([...storage.subarray(0, 3)]).toEqual([0xa5, 0xa5, 0xa5]);
    expect([...storage.subarray(3 + index.length)]).toEqual([
      0xa5,
      0xa5,
      0xa5,
      0xa5
    ]);
  });

  it("rejects every truncation and any trailing byte before record allocation", () => {
    const bytes = encodeAccessUnitIndex(RECORDS, AVC_MANIFEST);
    for (let length = 0; length < bytes.length; length += 1) {
      expectFormatError(
        () => parseAccessUnitIndex(bytes.subarray(0, length), AVC_MANIFEST),
        "INDEX_INVALID"
      );
    }
    const trailing = new Uint8Array(bytes.length + 1);
    trailing.set(bytes);
    expectFormatError(
      () => parseAccessUnitIndex(trailing, AVC_MANIFEST),
      "INDEX_INVALID"
    );
  });

  it("rejects magic, record-size, header-reserved, and record-reserved mutations", () => {
    const offsets = [0, 4, 6, 12, 16 + 24];
    for (const offset of offsets) {
      const bytes = encodeAccessUnitIndex(RECORDS, AVC_MANIFEST);
      bytes[offset] = (bytes[offset] ?? 0) ^ 1;
      expectFormatError(
        () => parseAccessUnitIndex(bytes, AVC_MANIFEST),
        "INDEX_INVALID"
      );
    }
  });

  it("rejects unknown flag bits and non-key unit entry frames", () => {
    const unknownFlag = encodeAccessUnitIndex(RECORDS, AVC_MANIFEST);
    unknownFlag[16 + 18] = 2;
    expectFormatError(
      () => parseAccessUnitIndex(unknownFlag, AVC_MANIFEST),
      "INDEX_INVALID"
    );

    const nonKeyEntry = encodeAccessUnitIndex(RECORDS, AVC_MANIFEST);
    nonKeyEntry[16 + 18] = 0;
    expectFormatError(
      () => parseAccessUnitIndex(nonKeyEntry, AVC_MANIFEST),
      "INDEX_INVALID"
    );
  });

  it("requires every reference-rgba-v0 record to be key", () => {
    expectFormatError(
      () => encodeAccessUnitIndex(RECORDS, REFERENCE_MANIFEST),
      "INDEX_INVALID"
    );
    const allKey = RECORDS.map((record) => ({ ...record, key: true }));
    expect(parseAccessUnitIndex(
      encodeAccessUnitIndex(allKey, REFERENCE_MANIFEST),
      REFERENCE_MANIFEST
    )).toEqual(allKey);
  });

  it("rejects zero and lower-budget sample lengths without a product ceiling", () => {
    const zero = encodeAccessUnitIndex(RECORDS, AVC_MANIFEST);
    writeUint32LE(zero, 16 + 8, 0);
    expectFormatError(() => parseAccessUnitIndex(zero, AVC_MANIFEST), "INDEX_INVALID");

    const formerlyOversized = encodeAccessUnitIndex(RECORDS, AVC_MANIFEST);
    writeUint32LE(formerlyOversized, 16 + 8, 2 * 1024 * 1024 + 1);
    expect(parseAccessUnitIndex(formerlyOversized, AVC_MANIFEST)[0]?.payloadLength)
      .toBe(2 * 1024 * 1024 + 1);

    const lowered = encodeAccessUnitIndex(RECORDS, AVC_MANIFEST);
    expectFormatError(
      () =>
        parseAccessUnitIndex(lowered, AVC_MANIFEST, {
          budgets: { maxSampleBytes: 4 }
        }),
      "BUDGET_EXCEEDED"
    );
  });

  it("rejects unsafe and caller-over-budget payload offsets", () => {
    const unsafe = encodeAccessUnitIndex(RECORDS, AVC_MANIFEST);
    writeUint64LE(unsafe, 16, BigInt(Number.MAX_SAFE_INTEGER) + 1n);
    expectFormatError(
      () => parseAccessUnitIndex(unsafe, AVC_MANIFEST),
      "INTEGER_UNSAFE"
    );

    const overFormerBudget = encodeAccessUnitIndex(RECORDS, AVC_MANIFEST);
    writeUint64LE(overFormerBudget, 16, 32 * 1024 * 1024 + 1);
    expect(parseAccessUnitIndex(overFormerBudget, AVC_MANIFEST)[0]?.payloadOffset)
      .toBe(32 * 1024 * 1024 + 1);
    expectFormatError(
      () => parseAccessUnitIndex(overFormerBudget, AVC_MANIFEST, {
        budgets: { maxFileBytes: 32 * 1024 * 1024 }
      }),
      "BUDGET_EXCEEDED"
    );
  });

  it("cross-checks record count, canonical order, frame coverage, and manifest spans", () => {
    const wrongCount = encodeAccessUnitIndex(RECORDS, AVC_MANIFEST).subarray(0, 48);
    writeUint32LE(wrongCount, 8, 1);
    expectFormatError(
      () => parseAccessUnitIndex(wrongCount, AVC_MANIFEST),
      "INDEX_INVALID"
    );

    const wrongFrame = encodeAccessUnitIndex(RECORDS, AVC_MANIFEST);
    writeUint32LE(wrongFrame, 16 + 20, 1);
    expectFormatError(
      () => parseAccessUnitIndex(wrongFrame, AVC_MANIFEST),
      "INDEX_INVALID"
    );

    const wrongUnit = encodeAccessUnitIndex(RECORDS, AVC_MANIFEST);
    writeUint32LE(wrongUnit, 16 + 12, 1);
    expectFormatError(
      () => parseAccessUnitIndex(wrongUnit, AVC_MANIFEST),
      "INDEX_INVALID"
    );

    const wrongSpan = {
      ...AVC_MANIFEST,
      units: [
        {
          ...AVC_MANIFEST.units[0]!,
          samples: [
            { ...AVC_MANIFEST.units[0]!.samples[0]!, sampleStart: 1 }
          ]
        }
      ]
    } as CompiledManifestV01;
    expectFormatError(
      () =>
        parseAccessUnitIndex(
          encodeAccessUnitIndex(RECORDS, AVC_MANIFEST),
          wrongSpan
        ),
      "INDEX_INVALID"
    );
  });

  it("allows later AVC samples to carry or omit the structural key bit", () => {
    const allKey = RECORDS.map((record) => ({ ...record, key: true }));
    expect(parseAccessUnitIndex(
      encodeAccessUnitIndex(allKey, AVC_MANIFEST),
      AVC_MANIFEST
    )).toEqual(allKey);
  });

  it("round-trips an index above the former 4 MiB scale", () => {
    const recordCount = 131_073;
    const manifest = {
      renditions: [{ id: "avc", profile: "avc-annexb-opaque-v0" }],
      units: [{
        id: "body",
        frameCount: recordCount,
        samples: [{
          rendition: "avc",
          sampleStart: 0,
          sampleCount: recordCount,
          sha256: "0".repeat(64)
        }]
      }]
    } as unknown as CompiledManifestV01;
    const records = Array.from({ length: recordCount }, (_, frameIndex) => ({
      payloadOffset: 8_000_000 + frameIndex,
      payloadLength: 1,
      unitIndex: 0,
      renditionIndex: 0,
      key: frameIndex === 0,
      frameIndex
    }));

    const bytes = encodeAccessUnitIndex(records, manifest);
    const parsed = parseAccessUnitIndex(bytes, manifest);

    expect(bytes.byteLength).toBeGreaterThan(4 * 1024 * 1024);
    expect(parsed).toHaveLength(recordCount);
    expect(parsed.at(-1)?.frameIndex).toBe(recordCount - 1);
  }, 20_000);

  it("honors record/index budgets before allocating record results", () => {
    const bytes = encodeAccessUnitIndex(RECORDS, AVC_MANIFEST);
    expectFormatError(
      () =>
        parseAccessUnitIndex(bytes, AVC_MANIFEST, {
          budgets: { maxSampleRecords: 1 }
        }),
      "BUDGET_EXCEEDED"
    );
    expectFormatError(
      () =>
        parseAccessUnitIndex(bytes, AVC_MANIFEST, {
          budgets: { maxIndexBytes: 79 }
        }),
      "BUDGET_EXCEEDED"
    );
  });

  it("never leaks built-in exceptions for hostile runtime inputs", () => {
    expectFormatError(
      () =>
        parseAccessUnitIndex(
          null as unknown as Uint8Array,
          AVC_MANIFEST
        ),
      "INDEX_INVALID"
    );
    expectFormatError(
      () =>
        encodeAccessUnitIndex(
          null as unknown as readonly AccessUnitRecord[],
          AVC_MANIFEST
        ),
      "INDEX_INVALID"
    );
    expectFormatError(
      () =>
        encodeAccessUnitIndex(
          [null as unknown as AccessUnitRecord, RECORDS[1]!],
          AVC_MANIFEST
        ),
      "INDEX_INVALID"
    );
  });
});
