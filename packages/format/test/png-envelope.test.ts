import { describe, expect, it } from "vitest";

import { FormatError } from "../src/errors.js";
import { validatePngEnvelope } from "../src/png-envelope.js";

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

function writeUint32BE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = Math.floor(value / 0x100_0000) & 0xff;
  bytes[offset + 1] = Math.floor(value / 0x1_0000) & 0xff;
  bytes[offset + 2] = Math.floor(value / 0x100) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function pngEnvelope(width = 2, height = 3, tail: readonly number[] = []): Uint8Array {
  const bytes = new Uint8Array(33 + tail.length);
  bytes.set(SIGNATURE, 0);
  writeUint32BE(bytes, 8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  writeUint32BE(bytes, 16, width);
  writeUint32BE(bytes, 20, height);
  bytes.set([8, 6, 0, 0, 0], 24);
  // Deliberately not a computed CRC: M4 does not inspect it.
  bytes.set([0xde, 0xad, 0xbe, 0xef], 29);
  bytes.set(tail, 33);
  return bytes;
}

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

describe("M4 shallow PNG envelope gate", () => {
  it("accepts and freezes the exact signature/IHDR metadata", () => {
    const png = pngEnvelope();
    const descriptor = validatePngEnvelope({
      png,
      expectedWidth: 2,
      expectedHeight: 3
    });
    expect(descriptor).toEqual({
      width: 2,
      height: 3,
      byteRange: { offset: 0, length: 33 }
    });
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(Object.isFrozen(descriptor.byteRange)).toBe(true);
    png.fill(0);
    expect(descriptor.width).toBe(2);
  });

  it("supports an unaligned view and reads no adjacent data", () => {
    const png = pngEnvelope();
    const storage = new Uint8Array(png.length + 3).fill(0xa5);
    const view = storage.subarray(1, 1 + png.length);
    view.set(png);
    expect(validatePngEnvelope({
      png: view,
      expectedWidth: 2,
      expectedHeight: 3
    }).byteRange.length).toBe(33);
    expect(storage[0]).toBe(0xa5);
    expect([...storage.subarray(1 + png.length)]).toEqual([0xa5, 0xa5]);
  });

  it("rejects truncation through the complete IHDR CRC envelope", () => {
    const png = pngEnvelope();
    for (let length = 0; length < 33; length += 1) {
      expectFormatError(() =>
        validatePngEnvelope({
          png: png.subarray(0, length),
          expectedWidth: 2,
          expectedHeight: 3
        })
      );
    }
  });

  it("rejects signature, IHDR length, and IHDR type mutations", () => {
    const mutations: readonly ((bytes: Uint8Array) => void)[] = [
      (bytes) => { bytes[0] = 0; },
      (bytes) => { writeUint32BE(bytes, 8, 12); },
      (bytes) => { bytes[12] = 0; }
    ];
    for (const mutate of mutations) {
      const png = pngEnvelope();
      mutate(png);
      expectFormatError(() =>
        validatePngEnvelope({ png, expectedWidth: 2, expectedHeight: 3 })
      );
    }
  });

  it("requires positive dimensions matching the static descriptor", () => {
    const zeroWidth = pngEnvelope(0, 3);
    expectFormatError(() =>
      validatePngEnvelope({ png: zeroWidth, expectedWidth: 2, expectedHeight: 3 })
    );
    const wrongWidth = pngEnvelope(4, 3);
    expectFormatError(() =>
      validatePngEnvelope({ png: wrongWidth, expectedWidth: 2, expectedHeight: 3 })
    );
    const wrongHeight = pngEnvelope(2, 4);
    expectFormatError(() =>
      validatePngEnvelope({ png: wrongHeight, expectedWidth: 2, expectedHeight: 3 })
    );
  });

  it("requires 8-bit RGBA, standard compression/filtering, and no interlace", () => {
    for (const [offset, value] of [
      [24, 16],
      [25, 2],
      [26, 1],
      [27, 1],
      [28, 1]
    ] as const) {
      const png = pngEnvelope();
      png[offset] = value;
      expectFormatError(() =>
        validatePngEnvelope({ png, expectedWidth: 2, expectedHeight: 3 })
      );
    }
  });

  it("deliberately accepts a bad IHDR CRC and absent IDAT/IEND chunks", () => {
    const png = pngEnvelope();
    png.set([0, 0, 0, 0], 29);
    expect(validatePngEnvelope({
      png,
      expectedWidth: 2,
      expectedHeight: 3
    }).byteRange.length).toBe(33);
  });

  it("deliberately accepts malformed IDAT/IEND tails for M6 to reject", () => {
    const malformedTail = [
      0xff, 0xff, 0xff, 0xff, 0x49, 0x44, 0x41, 0x54, 0x00,
      0x12, 0x34, 0x56, 0x78, 0x49, 0x45, 0x4e, 0x44, 0xff
    ];
    const png = pngEnvelope(2, 3, malformedTail);
    expect(validatePngEnvelope({
      png,
      expectedWidth: 2,
      expectedHeight: 3
    }).byteRange.length).toBe(png.length);
  });

  it("honors the lower static-PNG byte budget", () => {
    expectFormatError(
      () =>
        validatePngEnvelope({
          png: pngEnvelope(),
          expectedWidth: 2,
          expectedHeight: 3,
          options: { budgets: { maxStaticPngBytes: 32 } }
        }),
      "BUDGET_EXCEEDED"
    );
  });

  it("never leaks built-in exceptions for hostile runtime inputs", () => {
    expectFormatError(() =>
      validatePngEnvelope(
        null as unknown as Parameters<typeof validatePngEnvelope>[0]
      )
    );
    expectFormatError(() =>
      validatePngEnvelope({
        png: null as unknown as Uint8Array,
        expectedWidth: 2,
        expectedHeight: 3
      })
    );
  });
});
