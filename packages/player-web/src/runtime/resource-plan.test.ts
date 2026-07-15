import { describe, expect, it } from "vitest";

import { createOpaqueTestAsset } from "./asset-test-fixture.js";
import { installRuntimeAssetCatalog } from "./asset-catalog.js";
import { createInteractionCachePlan } from "./interaction-cache-plan.js";
import {
  createCanvasRuntimeResourcePlan,
  createRuntimeResourcePlan
} from "./resource-plan.js";

describe("runtime resource plan", () => {
  it("accounts one animated canvas and no embedded fallback media", () => {
    const catalog = installRuntimeAssetCatalog(createOpaqueTestAsset());
    const canvas = createCanvasRuntimeResourcePlan({ catalog });
    expect(canvas.totalBytes).toBe(
      canvas.ownedAssetBytes + canvas.animatedCanvasBackingAllocationBytes
    );
    expect(() => createCanvasRuntimeResourcePlan({
      catalog,
      hostMaxRuntimeBytes: canvas.totalBytes - 1
    })).toThrow();

    const interactionCache = createInteractionCachePlan({
      manifest: catalog.manifest,
      rendition: "opaque",
      deviceLimits: { maxTextureSize: 4_096, maxArrayTextureLayers: 128 }
    });
    const plan = createRuntimeResourcePlan({
      catalog,
      rendition: "opaque",
      interactionCache,
      ringCapacity: 6
    });
    expect(plan.totalBytes).toBe(plan.allocationSnapshot.totalBytes);
    expect(plan.animatedCanvasBackingAllocationBytes).toBeGreaterThan(0);
    expect(Object.keys(plan).some((key) => key.toLowerCase().includes("static")))
      .toBe(false);
    catalog.dispose();
  });
});
