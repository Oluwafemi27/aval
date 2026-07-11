import { describe, expect, it } from "vitest";

import {
  parseCanonicalJson,
  serializeCanonicalJson
} from "../src/canonical-json.js";
import type { CanonicalJsonValue } from "../src/canonical-json.js";
import { FormatError } from "../src/errors.js";

const SEEDS = [1, 0x5eedc0de, 0xc0ffee, 0xffffffff] as const;

function randomFor(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

function choose<T>(random: () => number, values: readonly T[]): T {
  return values[random() % values.length] as T;
}

function generatedString(random: () => number): string {
  const scalars = [
    "",
    "a",
    "z",
    "é",
    "",
    "𐀀",
    "😀",
    "/",
    '"',
    "\\",
    "\u0000",
    "\b\t\n\f\r",
    "  "
  ] as const;
  const count = random() % 5;
  let result = "";
  for (let index = 0; index < count; index += 1) {
    result += choose(random, scalars);
  }
  return result;
}

function generatedValue(random: () => number, depth = 0): CanonicalJsonValue {
  const primitive = (): CanonicalJsonValue => {
    switch (random() % 5) {
      case 0:
        return null;
      case 1:
        return (random() & 1) === 1;
      case 2:
        return (random() % 2_000_001) - 1_000_000;
      default:
        return generatedString(random);
    }
  };

  if (depth >= 4) return primitive();
  switch (random() % 8) {
    case 0:
    case 1:
    case 2:
    case 3:
      return primitive();
    case 4:
    case 5: {
      const array: CanonicalJsonValue[] = [];
      const length = random() % 5;
      for (let index = 0; index < length; index += 1) {
        array.push(generatedValue(random, depth + 1));
      }
      return array;
    }
    default: {
      const object = Object.create(null) as Record<string, CanonicalJsonValue>;
      const candidates = ["a", "z", "é", "", "𐀀", "k0", "k1"] as const;
      const count = random() % 5;
      for (let index = 0; index < count; index += 1) {
        object[choose(random, candidates)] = generatedValue(random, depth + 1);
      }
      return object;
    }
  }
}

function expectStableOutcome(bytes: Uint8Array): void {
  let value: CanonicalJsonValue;
  try {
    value = parseCanonicalJson(bytes);
  } catch (error) {
    expect(error).toBeInstanceOf(FormatError);
    expect(typeof (error as FormatError).code).toBe("string");
    return;
  }
  if (typeof value === "object" && value !== null) {
    expect(Object.isFrozen(value)).toBe(true);
  }
}

function mutate(bytes: Uint8Array, random: () => number): Uint8Array {
  const kind = random() % 4;
  if (kind === 0 && bytes.byteLength > 0) {
    const result = bytes.slice();
    const index = random() % result.byteLength;
    result[index] = random() & 0xff;
    return result;
  }
  if (kind === 1 && bytes.byteLength > 0) {
    const index = random() % bytes.byteLength;
    const result = new Uint8Array(bytes.byteLength - 1);
    result.set(bytes.subarray(0, index), 0);
    result.set(bytes.subarray(index + 1), index);
    return result;
  }
  if (kind === 2) {
    const index = random() % (bytes.byteLength + 1);
    const result = new Uint8Array(bytes.byteLength + 1);
    result.set(bytes.subarray(0, index), 0);
    result[index] = random() & 0xff;
    result.set(bytes.subarray(index), index + 1);
    return result;
  }
  const result = bytes.slice();
  if (result.byteLength > 0) {
    const start = random() % result.byteLength;
    const length = random() % (result.byteLength - start + 1);
    result.fill(random() & 0xff, start, start + length);
  }
  return result;
}

describe("canonical JSON seeded grammar fuzzing", () => {
  for (const seed of SEEDS) {
    it(`round-trips and freezes generated values for seed ${seed.toString(16)}`, () => {
      const random = randomFor(seed);
      for (let iteration = 0; iteration < 200; iteration += 1) {
        const source = generatedValue(random);
        const first = serializeCanonicalJson(source);
        const parsed = parseCanonicalJson(first);
        const second = serializeCanonicalJson(parsed);

        expect(Array.from(second)).toEqual(Array.from(first));
      }
    });

    it(`maps byte mutations to a value or FormatError for seed ${seed.toString(16)}`, () => {
      const random = randomFor(seed);
      for (let iteration = 0; iteration < 400; iteration += 1) {
        const canonical = serializeCanonicalJson(generatedValue(random));
        expectStableOutcome(mutate(canonical, random));
      }
    });

    it(`maps arbitrary bytes to a value or FormatError for seed ${seed.toString(16)}`, () => {
      const random = randomFor(seed);
      for (let iteration = 0; iteration < 400; iteration += 1) {
        const bytes = new Uint8Array(random() % 97);
        for (let index = 0; index < bytes.byteLength; index += 1) {
          bytes[index] = random() & 0xff;
        }
        expectStableOutcome(bytes);
      }
    });
  }

  it("maps every truncation of a nested canonical document to FormatError", () => {
    const canonical = serializeCanonicalJson({
      array: [0, 1, 2, { emoji: "😀", text: "hello" }],
      object: { a: true, b: false, c: null }
    });

    for (let boundary = 0; boundary < canonical.byteLength; boundary += 1) {
      try {
        parseCanonicalJson(canonical.subarray(0, boundary));
        throw new Error(`Unexpected accepted truncation at ${boundary}`);
      } catch (error) {
        expect(error).toBeInstanceOf(FormatError);
      }
    }
  });
});
