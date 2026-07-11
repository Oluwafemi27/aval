import { describe, expect, it } from "vitest";

import {
  FORMAT_DEFAULT_BUDGETS,
  resolveFormatBudgets
} from "../src/constants.js";
import {
  align8,
  bigintToSafeNumber,
  checkedAdd,
  checkedMultiply,
  checkedNonNegativeInteger,
  checkedRangeEnd,
  rangeContains,
  readUint16LE,
  readUint32LE,
  readUint64LE,
  readUint64LEBigInt,
  requireByteRange,
  writeUint16LE,
  writeUint32LE,
  writeUint64LE
} from "../src/checked-integer.js";
import { FormatError } from "../src/errors.js";

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

describe("checked integer arithmetic", () => {
  it("accepts zero and the largest safe integer", () => {
    expect(checkedNonNegativeInteger(0)).toBe(0);
    expect(checkedNonNegativeInteger(Number.MAX_SAFE_INTEGER)).toBe(
      Number.MAX_SAFE_INTEGER
    );
    expect(checkedAdd(Number.MAX_SAFE_INTEGER, 0)).toBe(
      Number.MAX_SAFE_INTEGER
    );
    expect(checkedMultiply(Number.MAX_SAFE_INTEGER, 1)).toBe(
      Number.MAX_SAFE_INTEGER
    );
  });

  it("separates unsafe arithmetic from active-budget failures", () => {
    expectFormatError(
      () => checkedAdd(Number.MAX_SAFE_INTEGER, 1),
      "INTEGER_UNSAFE"
    );
    expectFormatError(
      () => checkedMultiply(Number.MAX_SAFE_INTEGER, 2),
      "INTEGER_UNSAFE"
    );
    expectFormatError(() => checkedAdd(4, 5, 8), "BUDGET_EXCEEDED");
    expectFormatError(() => checkedMultiply(3, 3, 8), "BUDGET_EXCEEDED");
    for (const value of [-1, 1.5, Number.POSITIVE_INFINITY, Number.NaN]) {
      expectFormatError(() => checkedNonNegativeInteger(value), "INTEGER_UNSAFE");
    }
  });

  it("aligns and calculates ranges without overflowing", () => {
    expect(align8(0)).toBe(0);
    expect(align8(1)).toBe(8);
    expect(align8(8)).toBe(8);
    expect(align8(Number.MAX_SAFE_INTEGER - 7)).toBe(
      Number.MAX_SAFE_INTEGER - 7
    );
    expectFormatError(
      () => align8(Number.MAX_SAFE_INTEGER),
      "INTEGER_UNSAFE"
    );
    expect(checkedRangeEnd(10, 5)).toBe(15);
    expect(rangeContains(10, 10, 10, 10)).toBe(true);
    expect(rangeContains(10, 10, 9, 1)).toBe(false);
    expect(rangeContains(10, 10, 20, 0)).toBe(true);
    expect(rangeContains(10, 10, 20, 1)).toBe(false);
  });

  it("converts uint64 values only after bigint safety and budget checks", () => {
    expect(bigintToSafeNumber(BigInt(Number.MAX_SAFE_INTEGER))).toBe(
      Number.MAX_SAFE_INTEGER
    );
    expectFormatError(
      () => bigintToSafeNumber(BigInt(Number.MAX_SAFE_INTEGER) + 1n),
      "INTEGER_UNSAFE"
    );
    expectFormatError(() => bigintToSafeNumber(9n, 8), "BUDGET_EXCEEDED");
  });
});

describe("bounded little-endian byte access", () => {
  it("round-trips values through an unaligned Uint8Array view", () => {
    const storage = new Uint8Array(40);
    const view = storage.subarray(3, 35);

    writeUint16LE(view, 1, 0xabcd);
    writeUint32LE(view, 3, 0xfedc_ba98);
    writeUint64LE(view, 7, 0x12_3456_789a_bcden);

    expect(readUint16LE(view, 1)).toBe(0xabcd);
    expect(readUint32LE(view, 3)).toBe(0xfedc_ba98);
    expect(readUint64LEBigInt(view, 7)).toBe(0x12_3456_789a_bcden);
    expect(storage[2]).toBe(0);
    expect(storage[3]).toBe(0);
  });

  it("reads bigint before rejecting MAX_SAFE_INTEGER + 1", () => {
    const bytes = new Uint8Array(8);
    writeUint64LE(bytes, 0, BigInt(Number.MAX_SAFE_INTEGER) + 1n);
    expect(readUint64LEBigInt(bytes, 0)).toBe(
      BigInt(Number.MAX_SAFE_INTEGER) + 1n
    );
    expectFormatError(() => readUint64LE(bytes, 0), "INTEGER_UNSAFE");
  });

  it("prechecks every complete read and write range", () => {
    for (let length = 0; length < 8; length += 1) {
      const bytes = new Uint8Array(length);
      expectFormatError(
        () => readUint64LEBigInt(bytes, 0, "INDEX_INVALID"),
        "INDEX_INVALID"
      );
      expectFormatError(
        () => writeUint64LE(bytes, 0, 0n, "INDEX_INVALID"),
        "INDEX_INVALID"
      );
    }
    expectFormatError(
      () => requireByteRange(new Uint8Array(4), 3, 2, "LAYOUT_INVALID"),
      "LAYOUT_INVALID"
    );
    expectFormatError(
      () => readUint32LE(null as unknown as Uint8Array, 0),
      "INPUT_INVALID"
    );
  });
});

describe("budgets and stable errors", () => {
  it("merges only lower safe overrides into an immutable result", () => {
    const resolved = resolveFormatBudgets({
      budgets: { maxManifestBytes: 512, maxEdges: 0 }
    });
    expect(resolved.maxManifestBytes).toBe(512);
    expect(resolved.maxEdges).toBe(0);
    expect(resolved.maxFileBytes).toBe(FORMAT_DEFAULT_BUDGETS.maxFileBytes);
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(FORMAT_DEFAULT_BUDGETS)).toBe(true);
  });

  it("rejects raised, fractional, negative, and unknown overrides", () => {
    expectFormatError(
      () =>
        resolveFormatBudgets({
          budgets: {
            maxFileBytes: FORMAT_DEFAULT_BUDGETS.maxFileBytes + 1
          }
        }),
      "INPUT_INVALID"
    );
    expectFormatError(
      () => resolveFormatBudgets({ budgets: { maxEdges: 1.5 } }),
      "INPUT_INVALID"
    );
    expectFormatError(
      () => resolveFormatBudgets({ budgets: { maxEdges: -1 } }),
      "INPUT_INVALID"
    );
    expectFormatError(
      () =>
        resolveFormatBudgets({
          budgets: { unknown: 1 } as never
        }),
      "INPUT_INVALID"
    );
  });

  it("freezes the stable FormatError properties", () => {
    const error = new FormatError("HEADER_INVALID", "bad header", {
      path: "header.magic",
      offset: 3
    });
    expect(error.name).toBe("FormatError");
    expect(error.code).toBe("HEADER_INVALID");
    expect(error.path).toBe("header.magic");
    expect(error.offset).toBe(3);
    expect(Object.isFrozen(error)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(error, "code")?.writable).toBe(false);
    expect(Object.getOwnPropertyDescriptor(error, "name")?.writable).toBe(false);
  });
});
