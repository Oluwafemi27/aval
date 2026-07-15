import { describe, expect, it } from "vitest";

import { FormatError } from "../src/errors.js";
import {
  createCanonicalSamplePlan,
  validateCanonicalSampleSpans
} from "../src/sample-plan.js";

describe("canonical sample plan", () => {
  it("owns rendition-major, unit-major, frame-major ordinals and unit views", () => {
    const plan = createCanonicalSamplePlan(
      [
        { id: "reference", profile: "reference-rgba-v0" },
        { id: "video", profile: "avc-annexb-opaque-v0" }
      ],
      [
        { id: "body", frameCount: 2 },
        { id: "bridge", frameCount: 1 }
      ],
      6,
      3
    );

    expect([...plan.records()].map((slot) => [
      slot.ordinal,
      slot.renditionId,
      slot.unitId,
      slot.frameIndex,
      slot.keyRequired
    ])).toEqual([
      [0, "reference", "body", 0, true],
      [1, "reference", "body", 1, true],
      [2, "reference", "bridge", 0, true],
      [3, "video", "body", 0, true],
      [4, "video", "body", 1, false],
      [5, "video", "bridge", 0, true]
    ]);
    expect(plan.spans.map(({ renditionId, unitId, sampleStart, sampleCount }) =>
      [renditionId, unitId, sampleStart, sampleCount]
    )).toEqual([
      ["reference", "body", 0, 2],
      ["reference", "bridge", 2, 1],
      ["video", "body", 3, 2],
      ["video", "bridge", 5, 1]
    ]);
    expect(plan.unitSpans[0]?.map(({ sampleStart }) => sampleStart)).toEqual([0, 3]);
    expect(plan.unitSpans[1]?.map(({ sampleStart }) => sampleStart)).toEqual([2, 5]);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.unitSpans[0])).toBe(true);
    expect(plan.recordCount).toBe(6);
    expect(plan.recordAt(4)).toEqual({
      ordinal: 4,
      renditionIndex: 1,
      renditionId: "video",
      unitIndex: 0,
      unitId: "body",
      frameIndex: 1,
      keyRequired: false
    });
  });

  it("validates wire spans against the same canonical plan", () => {
    const plan = createCanonicalSamplePlan(
      [{ id: "video", profile: "avc-annexb-opaque-v0" }],
      [{ id: "body", frameCount: 2 }],
      2,
      2
    );
    const units = [{
      samples: [{
        rendition: "video",
        sampleStart: 0,
        sampleCount: 2,
        sha256: "0".repeat(64)
      }]
    }];
    expect(() => validateCanonicalSampleSpans(plan, units)).not.toThrow();
    expect(() => validateCanonicalSampleSpans(plan, [{
      samples: [{ ...units[0]!.samples[0]!, sampleStart: 1 }]
    }], "INDEX_INVALID")).toThrowError(
      expect.objectContaining<Partial<FormatError>>({ code: "INDEX_INVALID" })
    );
  });

  it("rejects impossible declared lengths before probing sparse entries", () => {
    let probes = 0;
    const units = new Proxy(Array(1_000_000), {
      get(target, property, receiver) {
        if (typeof property === "string" && /^(?:0|[1-9][0-9]*)$/.test(property)) {
          probes += 1;
        }
        return Reflect.get(target, property, receiver);
      }
    });

    expect(() => createCanonicalSamplePlan(
      [{ id: "video", profile: "avc-annexb-opaque-v0" }],
      units as { readonly id: string; readonly frameCount: number }[],
      10,
      10
    )).toThrowError(
      expect.objectContaining<Partial<FormatError>>({ code: "BUDGET_EXCEEDED" })
    );
    expect(probes).toBe(0);
  });

  it("keeps plans above the former 3,600-record ceiling compact", () => {
    const plan = createCanonicalSamplePlan(
      [{ id: "video", profile: "avc-annexb-opaque-v0" }],
      [{ id: "body", frameCount: 4_001 }],
      0xffff_ffff,
      0xffff_ffff
    );

    expect(plan.recordCount).toBe(4_001);
    expect(plan.spans).toHaveLength(1);
    expect("slots" in plan).toBe(false);
    expect(plan.recordAt(4_000)).toMatchObject({
      ordinal: 4_000,
      frameIndex: 4_000,
      keyRequired: false
    });
  });

  it("rejects record counts outside the uint32 wire field", () => {
    expect(() => createCanonicalSamplePlan(
      [{ id: "video", profile: "avc-annexb-opaque-v0" }],
      [{ id: "body", frameCount: 0x1_0000_0000 }],
      Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER
    )).toThrowError(
      expect.objectContaining<Partial<FormatError>>({ code: "INTEGER_UNSAFE" })
    );
  });
});
