import type { CanvasV01 } from "@rendered-motion/format";
import {
  BrowserPresentationPlanes,
  type BrowserPresentationPlanesOptions,
  type StaticSurfaceStore
} from "@rendered-motion/player-web";

import type { MountedProofPlanes } from "./dom";
import { PROOF_BACKING_BYTE_LIMIT, requireProof } from "./shared";

export function createPlanes(
  mounted: Readonly<MountedProofPlanes>,
  canvas: Readonly<CanvasV01>,
  createBackend?: BrowserPresentationPlanesOptions["createBackend"]
): BrowserPresentationPlanes {
  const planes = new BrowserPresentationPlanes({
    animatedCanvas: mounted.animatedCanvas,
    staticCanvas: mounted.staticCanvas,
    canvas,
    maxBackingBytes: PROOF_BACKING_BYTE_LIMIT,
    setStaticVisible: (visible) => mounted.setStaticVisible(visible),
    ...(createBackend === undefined ? {} : { createBackend })
  });
  planes.resize({
    cssWidth: canvas.width,
    cssHeight: canvas.height,
    devicePixelRatio: 1,
    fit: "fill"
  });
  return planes;
}

export function requireStore(value: StaticSurfaceStore | null): StaticSurfaceStore {
  requireProof(value !== null, "M6 static store was not created");
  return value;
}

export function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
