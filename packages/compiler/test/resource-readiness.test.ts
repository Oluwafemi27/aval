import { describe, expect, it } from "vitest";

import { deriveReadiness } from "../src/compile/readiness-plan.js";
import { estimateRuntimeLimits } from "../src/compile/resource-estimate.js";
import { deriveAvcRenditionGeometryFromVisible } from "@rendered-motion/format";
import type {
  NormalizedSourceProject,
  SourceProjectV01
} from "../src/model.js";

describe("compiled resource and readiness derivation", () => {
  it("includes reversible residency, cuts, decoder ring, real encoded bytes, and canvas", () => {
    const project = {
      canvas: { width: 32, height: 16 },
      renditions: [
        { id: "large", width: 32, height: 16 },
        { id: "small", width: 16, height: 16 }
      ],
      units: [{
        id: "resident",
        kind: "reversible",
        range: [10, 15],
        residency: { endpoints: [{ frames: 6 }, { frames: 7 }] }
      }],
      edges: [{
        start: { type: "cut" },
        targetRunwayFrames: 8
      }]
    } as unknown as NormalizedSourceProject;
    const limits = estimateRuntimeLimits(project, [
      sample("large", 10),
      sample("large", 20),
      sample("small", 40)
    ], [
      deriveAvcRenditionGeometryFromVisible({
        canvasWidth: 32,
        canvasHeight: 16,
        profile: "avc-annexb-opaque-v0",
        visibleWidth: 32,
        visibleHeight: 16
      }),
      deriveAvcRenditionGeometryFromVisible({
        canvasWidth: 32,
        canvasHeight: 16,
        profile: "avc-annexb-opaque-v0",
        visibleWidth: 16,
        visibleHeight: 8
      })
    ]);

    expect(limits).toEqual({
      maxCompiledBytes: 32 * 1024 * 1024,
      maxRuntimeBytes: 64 * 1024 * 1024,
      decodedPixelBytes: 2_048,
      persistentCacheBytes: 26 * 2_048,
      runtimeWorkingSetBytes: 26 * 2_048 + 12 * 2_048 + 40 + 2_048
    });
  });

  it("keeps bootstrap readiness to the initial path and immediate routes", () => {
    const project = {
      initialState: "idle",
      states: [
        { id: "idle", bodyUnit: "idle-body", initialUnit: "intro" },
        { id: "hover", bodyUnit: "hover-body" },
        { id: "later", bodyUnit: "unrelated-body" }
      ],
      edges: [
        {
          id: "idle-hover",
          from: "idle",
          to: "hover",
          transition: { kind: "locked", unit: "bridge" }
        },
        { id: "hover-later", from: "hover", to: "later" }
      ]
    } as unknown as SourceProjectV01;
    expect(deriveReadiness(project)).toEqual({
      policy: "all-routes",
      bootstrapUnits: ["bridge", "hover-body", "idle-body", "intro"],
      immediateEdges: ["idle-hover"]
    });
  });
});

function sample(rendition: string, bytes: number) {
  return {
    rendition,
    unit: "unit",
    frameIndex: 0,
    key: true,
    bytes: new Uint8Array(bytes)
  };
}
