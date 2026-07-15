import { describe, expect, it } from "vitest";

import {
  RUNTIME_RESOURCE_FIELD_CATEGORIES,
  createRuntimeResourceCategoryPlan
} from "./resource-category-plan.js";
import type { RuntimeResourceAllocationSnapshot } from "./resource-plan.js";

describe("runtime resource category plan", () => {
  it("maps every poster-free allocation field", () => {
    expect(RUNTIME_RESOURCE_FIELD_CATEGORIES).toEqual({
      ownedAssetBytes: "asset-full",
      maximumEncodedWindowBytes: "worker-transfer",
      decoderEncodedWindowBytes: "worker-transfer",
      decodedSurfaceBytes: "decoder-output",
      persistentAllocationBytes: "persistent-animation",
      streamingAllocationBytes: "streaming-texture",
      frameStagingBytes: "frame-staging",
      animatedCanvasBackingAllocationBytes: "animated-canvas-backing"
    });
    const snapshot: RuntimeResourceAllocationSnapshot = {
      ownedAssetBytes: 1,
      maximumEncodedWindowBytes: 2,
      decoderEncodedWindowBytes: 3,
      decodedSurfaceBytes: 4,
      persistentAllocationBytes: 5,
      streamingAllocationBytes: 6,
      frameStagingBytes: 7,
      animatedCanvasBackingAllocationBytes: 8,
      totalBytes: 36
    };
    expect(createRuntimeResourceCategoryPlan(snapshot)).toMatchObject({
      totalBytes: 36,
      entries: [
        { category: "asset-full", bytes: 1 },
        { category: "worker-transfer", bytes: 5 },
        { category: "decoder-output", bytes: 4 },
        { category: "persistent-animation", bytes: 5 },
        { category: "streaming-texture", bytes: 6 },
        { category: "frame-staging", bytes: 7 },
        { category: "animated-canvas-backing", bytes: 8 }
      ]
    });
  });
});
