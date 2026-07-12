import type { CanvasV01 } from "@rendered-motion/format";
import type { BrowserAvcReadPixelsResult } from "@rendered-motion/player-web";

import { deepFreeze, requireProof } from "./shared";

export interface PlaneVisibilityEvent {
  readonly sequence: number;
  readonly visible: boolean;
  readonly phase: string;
  readonly connected: boolean;
  readonly overlaid: boolean;
  readonly staticNonTransparentPixels: number;
  readonly animatedNonTransparentPixels: number;
}

export interface MountedProofPlanes {
  readonly animatedCanvas: HTMLCanvasElement;
  readonly staticCanvas: HTMLCanvasElement;
  readonly visibility: readonly Readonly<PlaneVisibilityEvent>[];
  setPhase(phase: string): void;
  setStaticVisible(visible: boolean): void;
  snapshot(): Readonly<{
    readonly connected: boolean;
    readonly overlaid: boolean;
    readonly staticVisible: boolean;
  }>;
  dispose(): void;
}

export interface MountedProofPlaneOptions {
  /** Shared causal clock used when visibility must be ordered with teardown. */
  readonly nextSequence?: () => number;
}

/** A real connected stack; visibility evidence is taken after CSS is committed. */
export function mountProofPlanes(
  canvas: Readonly<CanvasV01>,
  label: string,
  options: Readonly<MountedProofPlaneOptions> = {}
): MountedProofPlanes {
  const host = document.createElement("div");
  host.dataset.m6Proof = label;
  Object.assign(host.style, {
    position: "relative",
    width: `${String(canvas.width * 4)}px`,
    height: `${String(canvas.height * 4)}px`,
    overflow: "hidden",
    isolation: "isolate",
    background: "rgb(37, 19, 53)"
  });
  const animatedCanvas = document.createElement("canvas");
  const staticCanvas = document.createElement("canvas");
  for (const plane of [animatedCanvas, staticCanvas]) {
    Object.assign(plane.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%"
    });
    host.append(plane);
  }
  animatedCanvas.dataset.plane = "animated";
  animatedCanvas.style.zIndex = "1";
  staticCanvas.dataset.plane = "static";
  staticCanvas.style.zIndex = "2";
  staticCanvas.style.visibility = "hidden";
  document.body.append(host);

  const visibility: PlaneVisibilityEvent[] = [];
  let phase = "setup";
  let sequence = 0;
  const nextSequence = options.nextSequence ?? (() => ++sequence);
  let disposed = false;

  const overlaid = (): boolean => {
    const animated = animatedCanvas.getBoundingClientRect();
    const staticRect = staticCanvas.getBoundingClientRect();
    return animated.width > 0 && animated.height > 0 &&
      animated.left === staticRect.left && animated.top === staticRect.top &&
      animated.width === staticRect.width && animated.height === staticRect.height;
  };

  const api: MountedProofPlanes = {
    animatedCanvas,
    staticCanvas,
    visibility,
    setPhase(value) {
      phase = value;
    },
    setStaticVisible(visible) {
      staticCanvas.style.visibility = visible ? "visible" : "hidden";
      staticCanvas.dataset.visible = String(visible);
      visibility.push(deepFreeze({
        sequence: nextSequence(),
        visible,
        phase,
        connected: host.isConnected,
        overlaid: overlaid(),
        staticNonTransparentPixels: countNonTransparent(readCanvasRgba(staticCanvas).rgba),
        // Do not probe a not-yet-configured animated canvas here: asking for a
        // 2D context would permanently prevent its later WebGL2 acquisition.
        animatedNonTransparentPixels: 0
      }));
    },
    snapshot() {
      return deepFreeze({
        connected: host.isConnected,
        overlaid: overlaid(),
        staticVisible: getComputedStyle(staticCanvas).visibility === "visible"
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      host.remove();
    }
  };
  requireProof(api.snapshot().connected && api.snapshot().overlaid,
    "M6 proof planes were not mounted as a connected overlay");
  return Object.freeze(api);
}

export function readCanvasRgba(
  canvas: HTMLCanvasElement
): Readonly<BrowserAvcReadPixelsResult> {
  const width = canvas.width;
  const height = canvas.height;
  if (width === 0 || height === 0) {
    return Object.freeze({ rgba: new Uint8Array(), width, height });
  }
  const context = canvas.getContext("2d", { alpha: true });
  if (context === null) {
    // A WebGL canvas cannot also acquire a 2D context. Read it through WebGL.
    const gl = canvas.getContext("webgl2");
    requireProof(gl !== null, "proof canvas has no readable context");
    const bottomUp = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bottomUp);
    const rgba = new Uint8Array(bottomUp.byteLength);
    const stride = width * 4;
    for (let y = 0; y < height; y += 1) {
      rgba.set(
        bottomUp.subarray((height - y - 1) * stride, (height - y) * stride),
        y * stride
      );
    }
    return Object.freeze({ rgba, width, height });
  }
  const image = context.getImageData(0, 0, width, height);
  return Object.freeze({
    rgba: new Uint8Array(image.data.buffer.slice(0)),
    width,
    height
  });
}

function countNonTransparent(rgba: Uint8Array): number {
  let count = 0;
  for (let offset = 3; offset < rgba.byteLength; offset += 4) {
    if (rgba[offset]! > 0) count += 1;
  }
  return count;
}
