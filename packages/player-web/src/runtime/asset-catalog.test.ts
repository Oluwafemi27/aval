import { describe, expect, it } from "vitest";

import { createOpaqueTestAsset } from "./asset-test-fixture.js";
import {
  RuntimeAssetCatalog,
  createRuntimeCatalogBlobDescriptors
} from "./asset-catalog.js";

describe("runtime asset catalog", () => {
  it("indexes and copies only animation unit payloads", () => {
    const catalog = new RuntimeAssetCatalog(createOpaqueTestAsset());

    expect(catalog.manifest.initialState).toBe("idle");
    expect(catalog.states.require("idle")).toEqual({
      id: "idle",
      bodyUnit: "body",
      initialUnit: "intro"
    });
    expect("staticFrames" in catalog.manifest).toBe(false);

    const descriptors = createRuntimeCatalogBlobDescriptors(
      catalog.layout.frontIndex
    );
    expect(descriptors).toHaveLength(2);
    expect(descriptors.every(({ kind }) => kind === "unit")).toBe(true);
    expect(new Uint8Array(catalog.copySample("opaque", "body", 0)).byteLength)
      .toBeGreaterThan(0);
    expect(catalog.residencySnapshot().unitBlobs).toMatchObject({
      total: 2,
      verified: 2
    });

    catalog.dispose();
    expect(catalog.ownedByteLength).toBe(0);
  });

  it("retains an allowlisted AVC-v1 rendition profile", () => {
    const catalog = new RuntimeAssetCatalog(createOpaqueTestAsset({
      profile: "avc-annexb-opaque-v1"
    }));

    expect(catalog.manifest.renditions[0]?.profile)
      .toBe("avc-annexb-opaque-v1");
    catalog.dispose();
  });
});
