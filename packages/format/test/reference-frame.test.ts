import { describe, expect, it } from "vitest";

import { writeUint16LE, writeUint32LE } from "../src/checked-integer.js";
import { FormatError } from "../src/errors.js";
import {
  encodeReferenceFrame,
  parseReferenceFrameHeader,
  validateReferenceFrame
} from "../src/reference-frame.js";

const RGBA = new Uint8Array([1, 2, 3, 4]);
const GOLDEN_HEX =
  "524d5246000118000000000001000100040302010400000001020304";

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function expectFormatError(
  operation: () => unknown,
  code: FormatError["code"] = "REFERENCE_FRAME_INVALID"
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

describe("reference-rgba-v0 sample profile", () => {
  it("encodes the exact 24-byte RMRF header and row-major RGBA payload", () => {
    const sample = encodeReferenceFrame({
      width: 1,
      height: 1,
      frameIndex: 0x0102_0304,
      rgba: RGBA
    });
    expect(sample).toHaveLength(28);
    expect(hex(sample)).toBe(GOLDEN_HEX);
  });

  it("parses frozen header metadata without requiring or retaining payload bytes", () => {
    const sample = encodeReferenceFrame({
      width: 1,
      height: 1,
      frameIndex: 7,
      rgba: RGBA
    });
    const header = parseReferenceFrameHeader(sample.subarray(0, 24));
    expect(header).toEqual({
      width: 1,
      height: 1,
      frameIndex: 7,
      rgbaLength: 4
    });
    expect(Object.isFrozen(header)).toBe(true);
    sample.fill(0);
    expect(header.frameIndex).toBe(7);
  });

  it("validates an exact sample and returns only a frozen numeric RGBA range", () => {
    const sample = encodeReferenceFrame({
      width: 1,
      height: 1,
      frameIndex: 3,
      rgba: RGBA
    });
    const descriptor = validateReferenceFrame({
      sample,
      expectedWidth: 1,
      expectedHeight: 1,
      expectedFrameIndex: 3
    });
    expect(descriptor).toEqual({
      width: 1,
      height: 1,
      frameIndex: 3,
      rgbaLength: 4,
      rgbaRange: { offset: 24, length: 4 }
    });
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(Object.isFrozen(descriptor.rgbaRange)).toBe(true);
  });

  it("supports an unaligned sample view", () => {
    const sample = encodeReferenceFrame({
      width: 1,
      height: 1,
      frameIndex: 0,
      rgba: RGBA
    });
    const storage = new Uint8Array(sample.length + 5).fill(0xa5);
    const view = storage.subarray(2, 2 + sample.length);
    view.set(sample);
    expect(validateReferenceFrame({
      sample: view,
      expectedWidth: 1,
      expectedHeight: 1,
      expectedFrameIndex: 0
    }).rgbaRange).toEqual({ offset: 24, length: 4 });
    expect([...storage.subarray(0, 2)]).toEqual([0xa5, 0xa5]);
    expect([...storage.subarray(2 + sample.length)]).toEqual([0xa5, 0xa5, 0xa5]);
  });

  it("rejects truncation throughout the fixed header", () => {
    const sample = encodeReferenceFrame({
      width: 1,
      height: 1,
      frameIndex: 0,
      rgba: RGBA
    });
    for (let length = 0; length < 24; length += 1) {
      expectFormatError(() => parseReferenceFrameHeader(sample.subarray(0, length)));
    }
  });

  it("rejects every fixed-header field mutation", () => {
    const original = encodeReferenceFrame({
      width: 1,
      height: 1,
      frameIndex: 0,
      rgba: RGBA
    });
    const mutations: readonly ((bytes: Uint8Array) => void)[] = [
      (bytes) => { bytes[0] = 0; },
      (bytes) => { bytes[4] = 1; },
      (bytes) => { bytes[5] = 2; },
      (bytes) => { writeUint16LE(bytes, 6, 23); },
      (bytes) => { writeUint32LE(bytes, 8, 1); },
      (bytes) => { writeUint16LE(bytes, 12, 0); },
      (bytes) => { writeUint16LE(bytes, 14, 0); },
      (bytes) => { writeUint32LE(bytes, 20, 5); }
    ];
    for (const mutate of mutations) {
      const sample = original.slice();
      mutate(sample);
      expectFormatError(() => parseReferenceFrameHeader(sample));
    }
  });

  it("checks the dimension product before accepting the declared RGBA length", () => {
    const sample = encodeReferenceFrame({
      width: 1,
      height: 1,
      frameIndex: 0,
      rgba: RGBA
    });
    writeUint16LE(sample, 12, 2);
    expectFormatError(() => parseReferenceFrameHeader(sample));

    expectFormatError(
      () =>
        parseReferenceFrameHeader(
          encodeReferenceFrame({ width: 1, height: 1, frameIndex: 0, rgba: RGBA }),
          { budgets: { maxSampleBytes: 27 } }
        ),
      "BUDGET_EXCEEDED"
    );
  });

  it("cross-checks rendition dimensions and index-record frame identity", () => {
    const sample = encodeReferenceFrame({
      width: 1,
      height: 1,
      frameIndex: 4,
      rgba: RGBA
    });
    expectFormatError(() =>
      validateReferenceFrame({
        sample,
        expectedWidth: 2,
        expectedHeight: 1,
        expectedFrameIndex: 4
      })
    );
    expectFormatError(() =>
      validateReferenceFrame({
        sample,
        expectedWidth: 1,
        expectedHeight: 1,
        expectedFrameIndex: 5
      })
    );
  });

  it("rejects missing final RGBA bytes and any trailing bytes", () => {
    const sample = encodeReferenceFrame({
      width: 1,
      height: 1,
      frameIndex: 0,
      rgba: RGBA
    });
    expectFormatError(() =>
      validateReferenceFrame({
        sample: sample.subarray(0, sample.length - 1),
        expectedWidth: 1,
        expectedHeight: 1,
        expectedFrameIndex: 0
      })
    );
    const trailing = new Uint8Array(sample.length + 1);
    trailing.set(sample);
    expectFormatError(() =>
      validateReferenceFrame({
        sample: trailing,
        expectedWidth: 1,
        expectedHeight: 1,
        expectedFrameIndex: 0
      })
    );
  });

  it("copies encoder input and treats every possible final alpha byte as data", () => {
    const rgba = RGBA.slice();
    const sample = encodeReferenceFrame({ width: 1, height: 1, frameIndex: 0, rgba });
    rgba[3] = 0xff;
    expect(sample[27]).toBe(4);
    sample[27] = 0xff;
    expect(validateReferenceFrame({
      sample,
      expectedWidth: 1,
      expectedHeight: 1,
      expectedFrameIndex: 0
    }).rgbaLength).toBe(4);
  });

  it("rejects malformed encoder input without leaking built-in exceptions", () => {
    expectFormatError(() =>
      encodeReferenceFrame(null as unknown as {
        width: number;
        height: number;
        frameIndex: number;
        rgba: Uint8Array;
      })
    );
    expectFormatError(() =>
      encodeReferenceFrame({ width: 1, height: 1, frameIndex: 0, rgba: new Uint8Array(3) })
    );
    expectFormatError(() =>
      validateReferenceFrame(null as unknown as Parameters<typeof validateReferenceFrame>[0])
    );
  });
});
