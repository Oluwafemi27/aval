import { describe, expect, it } from "vitest";

import { BrowserPresentationPlanes } from "./browser-presentation-planes.js";
import {
  FakePresentableBackend,
  fakeCanvas,
  logicalCanvas
} from "./browser-presentation-planes.test-support.js";

describe("BrowserPresentationPlanes", () => {
  it("owns one animated backing and applies resize geometry to its backend", () => {
    const animated = fakeCanvas();
    const backend = new FakePresentableBackend();
    const planes = new BrowserPresentationPlanes({
      animatedCanvas: animated.canvas,
      canvas: logicalCanvas(),
      maxBackingBytes: 8 * 1024 * 1024,
      initialPresentation: {
        cssWidth: 100,
        cssHeight: 50,
        devicePixelRatio: 2
      },
      createBackend: () => backend
    });

    expect(animated.canvas).toMatchObject({ width: 200, height: 100 });
    const attached = planes.createFrameBackend();
    const geometry = planes.resize({
      cssWidth: 120,
      cssHeight: 60,
      devicePixelRatio: 2
    });
    expect(geometry.byteTerms.totalBackingBytes).toBe(240 * 120 * 4);
    expect(animated.canvas).toMatchObject({ width: 240, height: 120 });
    expect(backend.geometries.at(-1)).toBe(geometry);

    attached.dispose();
    planes.dispose();
    expect(animated.canvas).toMatchObject({ width: 0, height: 0 });
  });
});
