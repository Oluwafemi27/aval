import { describe, expect, it } from "vitest";

import {
  canonicalizeAvcConstraintSet2,
  inspectAvcAnnexBEncoderCandidateRendition,
  inspectAvcAnnexBRendition
} from "../src/avc/index.js";
import { FormatError } from "../src/errors.js";
import { makeSps, validInspectionInput } from "./avc-fixture.js";

describe("AVC constraint_set2 canonicalization", () => {
  it("rewrites only C0 to E0 and then passes the strict final profile", () => {
    const input = validInspectionInput({
      spsOptions: { compatibility: 0xc0 }
    });
    expectProfileError(() => inspectAvcAnnexBRendition(input));

    const before = input.units[0]!.accessUnits[0]!.bytes.slice();
    for (const unit of input.units) {
      for (const accessUnit of unit.accessUnits) {
        accessUnit.bytes = canonicalizeAvcConstraintSet2(accessUnit.bytes);
      }
    }
    const after = input.units[0]!.accessUnits[0]!.bytes;
    const changedOffsets: number[] = [];
    for (let index = 0; index < before.length; index += 1) {
      if (before[index] !== after[index]) {
        changedOffsets.push(index);
      }
    }

    expect(changedOffsets).toHaveLength(1);
    expect(before[changedOffsets[0]!]).toBe(0xc0);
    expect(after[changedOffsets[0]!]).toBe(0xe0);
    expect(
      inspectAvcAnnexBRendition(input).parameterSet.constraintSet2
    ).toBe(true);
  });

  it("is byte-idempotent for E0 and always returns fresh bytes", () => {
    const source = makeSps({ compatibility: 0xe0 });
    const canonical = canonicalizeAvcConstraintSet2(source);
    expect(canonical).toEqual(source);
    expect(canonical).not.toBe(source);
    expect(canonical.buffer).not.toBe(source.buffer);
  });

  it("promotes libx264 Level 1b D0 to canonical Level 1.1 E0", () => {
    const input = validInspectionInput({
      spsOptions: { compatibility: 0xd0, levelIdc: 11 }
    });
    input.profile.averageBitrate = 80_000;
    input.profile.peakBitrate = 100_000;
    input.profile.cpbBufferBits = 100_000;

    expect(() => inspectAvcAnnexBEncoderCandidateRendition(input)).not.toThrow();
    expectProfileError(() => inspectAvcAnnexBRendition(input));
    for (const unit of input.units) {
      for (const accessUnit of unit.accessUnits) {
        accessUnit.bytes = canonicalizeAvcConstraintSet2(accessUnit.bytes);
      }
    }

    expect(inspectAvcAnnexBRendition(input).parameterSet).toMatchObject({
      levelIdc: 11,
      constraintSet2: true
    });
  });

  it("rejects a malformed SPS instead of performing an unchecked byte patch", () => {
    const malformed = makeSps();
    malformed[malformed.length - 1] = 0;
    expectProfileError(() => canonicalizeAvcConstraintSet2(malformed));
  });
});

function expectProfileError(callback: () => unknown): void {
  expect(callback).toThrowError(FormatError);
  try {
    callback();
  } catch (error) {
    expect(error).toMatchObject({ code: "PROFILE_INVALID" });
  }
}
