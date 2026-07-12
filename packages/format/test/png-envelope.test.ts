import { describe, expect, it } from "vitest";

import { FormatError } from "../src/errors.js";
import { validatePngEnvelope } from "../src/png-envelope.js";
import { makeTestPng } from "./png-test-fixture.js";

describe("strict PNG envelope compatibility facade", () => {
  it("returns the frozen legacy descriptor after complete strict validation", () => {
    const png = makeTestPng({ width: 2, height: 3 });
    const descriptor = validatePngEnvelope({
      png,
      expectedWidth: 2,
      expectedHeight: 3
    });
    expect(descriptor).toEqual({
      width: 2,
      height: 3,
      byteRange: { offset: 0, length: png.byteLength }
    });
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(Object.isFrozen(descriptor.byteRange)).toBe(true);
    png.fill(0);
    expect(descriptor.width).toBe(2);
  });

  it("supports an unaligned view without reading adjacent bytes", () => {
    const png = makeTestPng({ width: 2, height: 3 });
    const storage = new Uint8Array(png.length + 3).fill(0xa5);
    const view = storage.subarray(1, 1 + png.length);
    view.set(png);
    expect(validatePngEnvelope({
      png: view,
      expectedWidth: 2,
      expectedHeight: 3
    }).byteRange.length).toBe(png.byteLength);
    expect(storage[0]).toBe(0xa5);
    expect([...storage.subarray(1 + png.length)]).toEqual([0xa5, 0xa5]);
  });

  it("rejects every complete-file truncation", () => {
    const png = makeTestPng({ width: 2, height: 3 });
    for (let length = 0; length < png.byteLength; length += 1) {
      expectFormatError(() => validatePngEnvelope({
        png: png.subarray(0, length),
        expectedWidth: 2,
        expectedHeight: 3
      }));
    }
  });

  it("now rejects bad CRCs and absent IDAT/IEND tails formerly accepted by M4", () => {
    const badCrc = makeTestPng({ width: 2, height: 3 });
    badCrc[29] = badCrc[29]! ^ 1;
    expectFormatError(() => validatePngEnvelope({
      png: badCrc,
      expectedWidth: 2,
      expectedHeight: 3
    }));

    const ihdrOnly = makeTestPng({ width: 2, height: 3 }).subarray(0, 33);
    expectFormatError(() => validatePngEnvelope({
      png: ihdrOnly,
      expectedWidth: 2,
      expectedHeight: 3
    }));
  });

  it("honors the lower static-PNG byte budget", () => {
    const png = makeTestPng({ width: 2, height: 3 });
    expectFormatError(
      () => validatePngEnvelope({
        png,
        expectedWidth: 2,
        expectedHeight: 3,
        options: { budgets: { maxStaticPngBytes: png.byteLength - 1 } }
      }),
      "BUDGET_EXCEEDED"
    );
  });

  it("never leaks built-in exceptions for hostile runtime inputs", () => {
    expectFormatError(() => validatePngEnvelope(
      null as unknown as Parameters<typeof validatePngEnvelope>[0]
    ));
    expectFormatError(() => validatePngEnvelope({
      png: null as unknown as Uint8Array,
      expectedWidth: 2,
      expectedHeight: 3
    }));
  });
});

function expectFormatError(
  operation: () => unknown,
  code: FormatError["code"] = "PNG_ENVELOPE_INVALID"
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
