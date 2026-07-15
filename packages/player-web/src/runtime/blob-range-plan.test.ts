import { validateCompleteAsset } from "@aval/format";
import { describe, expect, it } from "vitest";

import { createIntegratedPathTestAsset } from "./asset-test-fixture.js";
import { planBlobStorageRanges } from "./blob-range-plan.js";

describe("unit blob range plan", () => {
  it("selects canonical unit blobs and preserves digest boundaries", () => {
    const frontIndex = validateCompleteAsset({
      bytes: createIntegratedPathTestAsset()
    }).frontIndex;
    const requested = frontIndex.unitBlobs.slice(0, 3).map(({ rendition, unit }) => ({
      kind: "unit" as const,
      rendition,
      unit
    }));
    const plan = planBlobStorageRanges({
      frontIndex,
      requested,
      targetRequestBytes: 1_024
    });

    expect(plan.blobs).toHaveLength(requested.length);
    expect(plan.blobs.every(({ kind }) => kind === "unit")).toBe(true);
    expect(plan.requests.length).toBeGreaterThan(0);
    expect(plan.totalStorageBytes).toBe(
      plan.requests.reduce((total, request) => total + request.length, 0)
    );
  });

  it("rejects duplicate unit selections", () => {
    const frontIndex = validateCompleteAsset({
      bytes: createIntegratedPathTestAsset()
    }).frontIndex;
    const first = frontIndex.unitBlobs[0]!;
    const selection = {
      kind: "unit" as const,
      rendition: first.rendition,
      unit: first.unit
    };
    expect(() => planBlobStorageRanges({
      frontIndex,
      requested: [selection, selection]
    })).toThrow("duplicates");
  });
});
