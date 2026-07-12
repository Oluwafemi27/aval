import { describe, expect, it } from "vitest";

import { FormatError } from "../src/errors.js";
import { validatePngProfile } from "../src/png/profile.js";
import { makeTestPng } from "./png-test-fixture.js";

describe("strict PNG fixed-seed mutations", () => {
  it("returns a detached plan or one stable bounded rejection for every byte mutation", () => {
    const source = makeTestPng({ width: 4, height: 3, compression: "dynamic" });
    let seed = 0x6d2b_79f5;
    for (let iteration = 0; iteration < 512; iteration += 1) {
      seed = (Math.imul(seed ^ (seed >>> 15), 1 | seed) + 0x9e37_79b9) >>> 0;
      const bytes = source.slice();
      const offset = seed % bytes.byteLength;
      bytes[offset] = bytes[offset]! ^ (1 << ((seed >>> 8) & 7));
      try {
        const plan = validatePngProfile({
          png: bytes,
          expectedWidth: 4,
          expectedHeight: 3
        });
        bytes.fill(0);
        expect(plan.copyZlibBytes().some((byte) => byte !== 0)).toBe(true);
      } catch (error) {
        expect(error).toBeInstanceOf(FormatError);
        expect(["PNG_ENVELOPE_INVALID", "BUDGET_EXCEEDED"])
          .toContain((error as FormatError).code);
        expect((error as Error).message.length).toBeLessThan(256);
      }
    }
  });
});
