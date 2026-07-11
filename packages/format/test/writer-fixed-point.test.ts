import { describe, expect, it } from "vitest";

import { FormatError } from "../src/errors.js";
import { resolveByteStableFixedPoint } from "../src/writer-fixed-point.js";

describe("writer fixed-point runner", () => {
  it("returns the first byte-stable value and its associated result", () => {
    const result = resolveByteStableFixedPoint(
      0,
      new Uint8Array([0]),
      4,
      (value) => ({
        value: value + 1,
        bytes: new Uint8Array([Math.min(value + 1, 1)]),
        result: `step-${String(value + 1)}`
      })
    );

    expect(result).toEqual({
      value: 2,
      bytes: new Uint8Array([1]),
      result: "step-2",
      iterations: 2
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("deterministically forces the planned non-convergence branch", () => {
    expect(() =>
      resolveByteStableFixedPoint(
        false,
        new Uint8Array([0]),
        4,
        (value) => ({
          value: !value,
          bytes: new Uint8Array([value ? 0 : 1]),
          result: undefined
        })
      )
    ).toThrowError(
      expect.objectContaining<Partial<FormatError>>({
        code: "WRITER_NONCONVERGENT"
      })
    );
  });
});
