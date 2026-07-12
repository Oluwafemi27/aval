import type { CompiledManifestV01 } from "@rendered-motion/format";

import type { StaticSurfaceCatalogView } from "./static-surfaces.js";

export class FakeCatalog implements StaticSurfaceCatalogView {
  public readonly manifest = staticManifest();
  public readonly copies: string[] = [];

  public copyStaticPng(staticFrame: string): Uint8Array {
    this.copies.push(staticFrame);
    return new TextEncoder().encode(staticFrame);
  }
}
function staticManifest(): CompiledManifestV01 {
  const staticFrames = ["done", "hover", "shared"].map((id, index) => ({
    id,
    offset: 100 + index,
    length: 1,
    width: 4,
    height: 3,
    sha256: "0".repeat(64)
  }));
  return {
    formatVersion: "0.1",
    generator: "static-test",
    canvas: {
      width: 4,
      height: 3,
      fit: "contain",
      pixelAspect: [1, 1],
      colorSpace: "srgb"
    },
    frameRate: { numerator: 30, denominator: 1 },
    renditions: [],
    units: [],
    staticFrames,
    initialState: "idle",
    states: [
      { id: "alt", bodyUnit: "body-alt", staticFrame: "shared" },
      { id: "done", bodyUnit: "body-done", staticFrame: "done" },
      { id: "hover", bodyUnit: "body-hover", staticFrame: "hover" },
      { id: "idle", bodyUnit: "body-idle", staticFrame: "shared" }
    ],
    edges: [],
    bindings: [],
    readiness: {
      policy: "all-routes",
      bootstrapUnits: [],
      immediateEdges: []
    },
    fallback: {
      unsupported: "per-state-static",
      reducedMotion: "per-state-static"
    },
    limits: {
      maxCompiledBytes: 1,
      maxRuntimeBytes: 1,
      decodedPixelBytes: 0,
      persistentCacheBytes: 0,
      runtimeWorkingSetBytes: 0
    }
  };
}

export function fakeBitmap(): {
  readonly bitmap: ImageBitmap;
  closeCalls(): number;
} {
  let closes = 0;
  return {
    bitmap: {
      width: 4,
      height: 3,
      close() {
        closes += 1;
      }
    } as ImageBitmap,
    closeCalls: () => closes
  };
}
