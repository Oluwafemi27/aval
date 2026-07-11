import { describe, expect, it } from "vitest";

import {
  compareBytes,
  encodeUtf8String,
  readStringScalar,
  readUtf8Scalar,
  utf8ByteLength
} from "../src/utf8.js";

function rejectUnicode(message: string, offset?: number): never {
  throw new Error(`${message}@${String(offset)}`);
}

describe("UTF-8 scalar primitives", () => {
  it("iterates and encodes every UTF-8 width without platform codecs", () => {
    const value = "Aé€😀";

    expect(utf8ByteLength(value, rejectUnicode)).toBe(10);
    expect([...encodeUtf8String(value, rejectUnicode)]).toEqual([
      0x41,
      0xc3,
      0xa9,
      0xe2,
      0x82,
      0xac,
      0xf0,
      0x9f,
      0x98,
      0x80
    ]);
    expect(readStringScalar(value, 3, rejectUnicode)).toEqual({
      codePoint: 0x1f600,
      width: 2
    });
  });

  it("strictly decodes scalars and reports the failing byte", () => {
    expect(
      readUtf8Scalar(Uint8Array.from([0xe2, 0x82, 0xac]), 0, rejectUnicode)
    ).toEqual({ codePoint: 0x20ac, width: 3 });
    expect(() =>
      readUtf8Scalar(Uint8Array.from([0xe2, 0x28, 0xa1]), 0, rejectUnicode)
    ).toThrow("Invalid UTF-8 continuation byte@1");
    expect(() =>
      readUtf8Scalar(Uint8Array.from([0xed, 0xa0, 0x80]), 0, rejectUnicode)
    ).toThrow("Invalid UTF-8 scalar value@0");
  });

  it("rejects both forms of unpaired JavaScript surrogate", () => {
    expect(() => utf8ByteLength("\ud800", rejectUnicode)).toThrow(
      "String contains a lone high surrogate@0"
    );
    expect(() => utf8ByteLength("\udc00", rejectUnicode)).toThrow(
      "String contains a lone low surrogate@0"
    );
  });

  it("compares byte strings unsigned and treats a prefix as smaller", () => {
    expect(compareBytes(Uint8Array.of(0x7f), Uint8Array.of(0x80))).toBeLessThan(0);
    expect(compareBytes(Uint8Array.of(1), Uint8Array.of(1, 0))).toBeLessThan(0);
    expect(compareBytes(Uint8Array.of(2), Uint8Array.of(1, 255))).toBeGreaterThan(0);
  });
});
