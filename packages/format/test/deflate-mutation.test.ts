import { deflateRawSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { FormatError } from "../src/errors.js";
import { inflateDeflate } from "../src/png/deflate.js";

describe("DEFLATE fixed-seed mutations", () => {
  it("never escapes stable failure or the exact bounded output", () => {
    const source = Uint8Array.from({ length: 2_048 }, (_, index) =>
      (index * 17 + (index >>> 3) * 41) & 0xff
    );
    const raw = new Uint8Array(deflateRawSync(source, { level: 9 }));
    let seed = 0xa341_316c;
    for (let iteration = 0; iteration < 512; iteration += 1) {
      seed = (Math.imul(seed ^ (seed >>> 16), 0x45d9_f3b) + iteration) >>> 0;
      const mutated = raw.slice();
      const offset = seed % mutated.byteLength;
      mutated[offset] = mutated[offset]! ^ (1 << ((seed >>> 11) & 7));
      try {
        const output = inflateDeflate({
          deflate: mutated,
          expectedOutputLength: source.byteLength
        });
        expect(output.byteLength).toBe(source.byteLength);
      } catch (error) {
        expect(error).toBeInstanceOf(FormatError);
        expect((error as FormatError).code).toBe("PNG_DEFLATE_INVALID");
        expect((error as Error).message.length).toBeLessThan(256);
      }
      mutated.fill(0);
    }
  });
});
