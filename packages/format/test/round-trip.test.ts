import { describe, expect, it } from "vitest";

import { parseFrontIndex, validateCompleteAsset } from "../src/parser.js";
import { writeCanonicalAsset } from "../src/writer.js";
import {
  byteIdentity,
  shuffledWriterInput,
  twoRenditionWriterInput,
  writerInputFromParsed
} from "./writer-fixture.js";

describe("canonical writer/parser round trip", () => {
  it("reconstructs writer input from parsed metadata and caller payloads byte-identically", () => {
    const callerInput = shuffledWriterInput(twoRenditionWriterInput());
    const first = writeCanonicalAsset(callerInput);
    const parsed = parseFrontIndex(first);
    const reconstructed = writerInputFromParsed(parsed, callerInput);
    const second = writeCanonicalAsset(reconstructed);

    expect(byteIdentity(first, second)).toBe(true);
    expect(validateCompleteAsset({ bytes: second, frontIndex: parsed }).fileRange).toEqual({
      offset: 0,
      length: second.byteLength
    });
  });

  it("preserves every derived sample span and payload byte range", () => {
    const input = twoRenditionWriterInput();
    const bytes = writeCanonicalAsset(input);
    const parsed = parseFrontIndex(bytes);

    expect(parsed.records).toHaveLength(input.accessUnits.length);
    for (let index = 0; index < parsed.records.length; index += 1) {
      const record = parsed.records[index]!;
      expect(Array.from(bytes.subarray(
        record.payloadOffset,
        record.payloadOffset + record.payloadLength
      ))).toEqual(Array.from(input.accessUnits[index]!.bytes));
    }
    const totalFrames = parsed.manifest.units.reduce(
      (sum, unit) => sum + unit.frameCount,
      0
    );
    parsed.manifest.units.forEach((unit, unitIndex) => {
      unit.samples.forEach((sample, renditionIndex) => {
        const prefix = parsed.manifest.units
          .slice(0, unitIndex)
          .reduce((sum, candidate) => sum + candidate.frameCount, 0);
        expect(sample.sampleStart).toBe(renditionIndex * totalFrames + prefix);
        expect(sample.sampleCount).toBe(unit.frameCount);
      });
    });
  });
});
