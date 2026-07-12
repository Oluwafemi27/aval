import { describe, expect, it, vi } from "vitest";

import { BrowserPresentationPlanes } from "./browser-presentation-planes.js";
import { installRuntimeAssetCatalog } from "./asset-catalog.js";
import { createOpaqueTestAsset } from "./asset-test-fixture.js";
import {
  CanvasOwningFakeBackend,
  FakePresentableBackend,
  fakeCanvas,
  logicalCanvas
} from "./browser-presentation-planes.test-support.js";

describe("BrowserPresentationPlanes", () => {
  it("captures every constructor option and nested canvas field once", () => {
    const animated = fakeCanvas();
    const statics = fakeCanvas();
    const reads = new Map<string, number>();
    const once = (name: string, value: unknown): PropertyDescriptor => ({
      get() {
        const count = (reads.get(name) ?? 0) + 1;
        reads.set(name, count);
        if (count > 1) throw new Error(`repeated ${name} getter`);
        return value;
      }
    });
    const pixelAspect = Object.create(null) as Record<PropertyKey, unknown>;
    Object.defineProperties(pixelAspect, {
      0: once("pixelAspect[0]", 1),
      1: once("pixelAspect[1]", 1)
    });
    const canvas = Object.create(null) as Record<PropertyKey, unknown>;
    Object.defineProperties(canvas, {
      width: once("canvas.width", 100),
      height: once("canvas.height", 50),
      fit: once("canvas.fit", "contain"),
      colorSpace: once("canvas.colorSpace", "srgb"),
      pixelAspect: once("canvas.pixelAspect", pixelAspect)
    });
    const options = Object.create(null) as Record<PropertyKey, unknown>;
    Object.defineProperties(options, {
      animatedCanvas: once("animatedCanvas", animated.canvas),
      staticCanvas: once("staticCanvas", statics.canvas),
      canvas: once("canvas", canvas),
      maxBackingWidth: once("maxBackingWidth", undefined),
      maxBackingHeight: once("maxBackingHeight", undefined),
      maxBackingBytes: once("maxBackingBytes", 8 * 1024 * 1024),
      setStaticVisible: once("setStaticVisible", () => undefined),
      onClamp: once("onClamp", undefined),
      createBackend: once("createBackend", undefined)
    });

    expect(() => new BrowserPresentationPlanes(
      options as unknown as ConstructorParameters<
        typeof BrowserPresentationPlanes
      >[0]
    )).not.toThrow();

    expect(Object.fromEntries(reads)).toEqual({
      animatedCanvas: 1,
      staticCanvas: 1,
      canvas: 1,
      "canvas.width": 1,
      "canvas.height": 1,
      "canvas.fit": 1,
      "canvas.colorSpace": 1,
      "canvas.pixelAspect": 1,
      "pixelAspect[0]": 1,
      "pixelAspect[1]": 1,
      maxBackingWidth: 1,
      maxBackingHeight: 1,
      maxBackingBytes: 1,
      setStaticVisible: 1,
      onClamp: 1,
      createBackend: 1
    });
    expect(animated.canvas).toMatchObject({ width: 100, height: 50 });
    expect(statics.canvas).toMatchObject({ width: 100, height: 50 });
  });

  it("rejects one canvas identity masquerading as two owned planes", () => {
    const shared = fakeCanvas();

    expect(() => new BrowserPresentationPlanes({
      animatedCanvas: shared.canvas,
      staticCanvas: shared.canvas,
      canvas: logicalCanvas(),
      maxBackingBytes: 8 * 1024 * 1024,
      setStaticVisible: () => undefined
    })).toThrow("options are invalid");
    expect(shared.canvas).toMatchObject({ width: 0, height: 0 });
  });

  it("presents a wire-valid non-reduced pixel aspect", () => {
    const animated = fakeCanvas();
    const statics = fakeCanvas();
    const catalog = installRuntimeAssetCatalog(createOpaqueTestAsset({
      pixelAspect: [2, 2]
    }));
    const planes = new BrowserPresentationPlanes({
      animatedCanvas: animated.canvas,
      staticCanvas: statics.canvas,
      canvas: catalog.manifest.canvas,
      maxBackingBytes: 8 * 1024 * 1024,
      setStaticVisible: () => undefined
    });

    expect(() => planes.resize({
      cssWidth: 120,
      cssHeight: 90,
      devicePixelRatio: 1.5
    })).not.toThrow();
  });

  it("replaces implicit browser backing with an initially clamped mapping", () => {
    const animated = fakeCanvas();
    const statics = fakeCanvas();
    const planes = new BrowserPresentationPlanes({
      animatedCanvas: animated.canvas,
      staticCanvas: statics.canvas,
      canvas: logicalCanvas(),
      maxBackingBytes: 8 * 1024 * 1024,
      setStaticVisible: () => undefined
    });

    expect(animated.canvas).toMatchObject({ width: 100, height: 50 });
    expect(statics.canvas).toMatchObject({ width: 100, height: 50 });
    expect(planes.currentCanvasBacking()).toEqual({ width: 100, height: 50 });
  });

  it("clamps before the first owned canvas allocation", () => {
    const animated = fakeCanvas();
    const statics = fakeCanvas();
    const onClamp = vi.fn();
    const planes = new BrowserPresentationPlanes({
      animatedCanvas: animated.canvas,
      staticCanvas: statics.canvas,
      canvas: logicalCanvas(),
      maxBackingBytes: 8,
      setStaticVisible: () => undefined,
      onClamp
    });

    expect(animated.canvas).toMatchObject({ width: 1, height: 1 });
    expect(statics.canvas).toMatchObject({ width: 1, height: 1 });
    expect(planes.currentCanvasBacking()).toEqual({ width: 1, height: 1 });
    expect(planes.snapshot().geometry).toMatchObject({
      backing: { width: 1, height: 1 },
      byteTerms: { totalBackingBytes: 8 },
      clampReasons: ["byte-budget"]
    });
    expect(onClamp).toHaveBeenCalledOnce();
  });

  it("constructs an extreme-aspect plane at the minimum viable cap", () => {
    const animated = fakeCanvas();
    const statics = fakeCanvas();

    expect(() => new BrowserPresentationPlanes({
      animatedCanvas: animated.canvas,
      staticCanvas: statics.canvas,
      canvas: {
        width: 512,
        height: 1,
        fit: "contain",
        pixelAspect: [1, 1],
        colorSpace: "srgb"
      },
      maxBackingBytes: 8,
      setStaticVisible: () => undefined
    })).not.toThrow();

    expect(animated.canvas).toMatchObject({ width: 1, height: 1 });
    expect(statics.canvas).toMatchObject({ width: 1, height: 1 });
  });

  it("rolls every implicit backing down when initial setter teardown fails", () => {
    const animated = fakeCanvas();
    const statics = fakeCanvas();
    animated.canvas.width = 300;
    animated.canvas.height = 150;
    statics.canvas.width = 300;
    statics.canvas.height = 150;
    animated.failNextWidthSet();

    expect(() => new BrowserPresentationPlanes({
      animatedCanvas: animated.canvas,
      staticCanvas: statics.canvas,
      canvas: logicalCanvas(),
      maxBackingBytes: 8 * 1024 * 1024,
      setStaticVisible: () => undefined
    })).toThrow("deliberate canvas width setter failure");

    expect(animated.canvas).toMatchObject({ width: 0, height: 0 });
    expect(statics.canvas).toMatchObject({ width: 0, height: 0 });
  });

  it("applies one immutable mapping to animated and static planes", () => {
    const animated = fakeCanvas();
    const statics = fakeCanvas();
    const backend = new FakePresentableBackend();
    const planes = new BrowserPresentationPlanes({
      animatedCanvas: animated.canvas,
      staticCanvas: statics.canvas,
      canvas: logicalCanvas(),
      maxBackingBytes: 8 * 1024 * 1024,
      setStaticVisible: () => undefined,
      createBackend: () => backend
    });
    const surface = {
      image: { width: 100, height: 50, close() {} } as ImageBitmap,
      width: 100,
      height: 50,
      inflatePath: "pure" as const,
      close() {}
    };
    planes.staticPlane.present(surface, 100, 50, { cover: false });
    planes.createFrameBackend();

    const geometry = planes.resize({
      cssWidth: 120,
      cssHeight: 120,
      devicePixelRatio: 2
    });

    expect(animated.canvas.width).toBe(240);
    expect(animated.canvas.height).toBe(240);
    expect(statics.canvas.width).toBe(240);
    expect(statics.canvas.height).toBe(240);
    expect(backend.geometries.at(-1)).toBe(geometry);
    expect(statics.drawCalls.at(-1)).toEqual([
      surface.image,
      geometry.sourceRect.x,
      geometry.sourceRect.y,
      geometry.sourceRect.width,
      geometry.sourceRect.height,
      0,
      60,
      240,
      120
    ]);
    expect(planes.snapshot()).toMatchObject({
      generation: 1,
      resizeCount: 1,
      equivalentResizeCount: 0,
      backendAttached: true
    });
  });

  it("redraws without media advancement and treats equivalent resize as no-op", () => {
    const animated = fakeCanvas();
    const statics = fakeCanvas();
    const backend = new FakePresentableBackend();
    const planes = new BrowserPresentationPlanes({
      animatedCanvas: animated.canvas,
      staticCanvas: statics.canvas,
      canvas: logicalCanvas(),
      maxBackingBytes: 8 * 1024 * 1024,
      setStaticVisible: () => undefined,
      createBackend: () => backend
    });
    planes.createFrameBackend();
    const input = { cssWidth: 91.5, cssHeight: 63.25, devicePixelRatio: 1.5 };
    const first = planes.resize(input);
    const second = planes.resize(input);

    expect(second).toBe(first);
    expect(backend.geometries).toHaveLength(2);
    expect(planes.snapshot()).toMatchObject({
      generation: 1,
      resizeCount: 1,
      equivalentResizeCount: 1
    });
  });

  it("uniformly clamps both backings and emits one observational diagnostic", () => {
    const animated = fakeCanvas();
    const statics = fakeCanvas();
    const onClamp = vi.fn();
    const planes = new BrowserPresentationPlanes({
      animatedCanvas: animated.canvas,
      staticCanvas: statics.canvas,
      canvas: logicalCanvas(),
      maxBackingWidth: 300,
      maxBackingHeight: 300,
      maxBackingBytes: 300 * 300 * 8,
      setStaticVisible: () => undefined,
      onClamp,
      createBackend: () => new FakePresentableBackend()
    });
    planes.createFrameBackend();

    const geometry = planes.resize({
      cssWidth: 1_000,
      cssHeight: 500,
      devicePixelRatio: 4
    });

    expect(geometry.resolutionScale).toBeLessThan(1);
    expect(geometry.clampReasons.length).toBeGreaterThan(0);
    expect(animated.canvas.width).toBe(geometry.backing.width);
    expect(statics.canvas.width).toBe(geometry.backing.width);
    expect(onClamp).toHaveBeenCalledOnce();
  });

  it("detaches a candidate-disposed backend before static-mode resize", () => {
    const animated = fakeCanvas();
    const statics = fakeCanvas();
    const backend = new FakePresentableBackend();
    const planes = new BrowserPresentationPlanes({
      animatedCanvas: animated.canvas,
      staticCanvas: statics.canvas,
      canvas: logicalCanvas(),
      maxBackingBytes: 8 * 1024 * 1024,
      setStaticVisible: () => undefined,
      createBackend: () => backend
    });
    const attached = planes.createFrameBackend();
    planes.resize({ cssWidth: 100, cssHeight: 50, devicePixelRatio: 1 });

    attached.dispose();
    expect(planes.snapshot().backendAttached).toBe(false);
    expect(backend.disposals).toBe(1);

    expect(() => planes.resize({
      cssWidth: 140,
      cssHeight: 90,
      devicePixelRatio: 1.5
    })).not.toThrow();
    expect(animated.canvas.width).toBe(210);
    expect(statics.canvas.width).toBe(210);
  });

  it("uses admitted rounded allocations to clamp every live resize", () => {
    const animated = fakeCanvas();
    const statics = fakeCanvas();
    const planes = new BrowserPresentationPlanes({
      animatedCanvas: animated.canvas,
      staticCanvas: statics.canvas,
      canvas: logicalCanvas(),
      maxBackingBytes: 64 * 1024 * 1024,
      setStaticVisible: () => undefined
    });
    const lease = planes.reserveCanvasResources(Object.freeze({
      effectiveCapBytes: 51_000,
      totalBytes: 51_000,
      canvasBackingWidth: 100,
      canvasBackingHeight: 50,
      canvasBackingBytesPerPlane: 20_000,
      animatedCanvasBackingAllocationBytes: 25_000,
      staticCanvasBackingAllocationBytes: 25_000
    }));

    const constrained = planes.resize({
      cssWidth: 1_000,
      cssHeight: 500,
      devicePixelRatio: 2
    });
    expect(constrained.clampReasons).toContain("byte-budget");
    expect(constrained.byteTerms.totalBackingBytes).toBeLessThanOrEqual(40_000);
    expect(planes.snapshot()).toMatchObject({
      resourceReservations: 1,
      effectiveMaxBackingBytes: 40_000
    });
    expect(planes.snapshot().liveResourceTotals).toHaveLength(1);
    expect(planes.snapshot().liveResourceTotals[0]).toBeLessThanOrEqual(51_000);

    lease.release();
    expect(planes.snapshot().resourceReservations).toBe(0);
    const expanded = planes.resize({
      cssWidth: 1_000,
      cssHeight: 500,
      devicePixelRatio: 2
    });
    expect(expanded.backing.width).toBeGreaterThan(constrained.backing.width);
  });

  it("does not commit static geometry when the animated redraw fails", () => {
    const animated = fakeCanvas();
    const statics = fakeCanvas();
    const backend = new FakePresentableBackend();
    const planes = new BrowserPresentationPlanes({
      animatedCanvas: animated.canvas,
      staticCanvas: statics.canvas,
      canvas: logicalCanvas(),
      maxBackingBytes: 8 * 1024 * 1024,
      setStaticVisible: () => undefined,
      createBackend: () => backend
    });
    planes.createFrameBackend();
    const committed = planes.resize({
      cssWidth: 100,
      cssHeight: 50,
      devicePixelRatio: 1
    });
    backend.failGeometryOnce = true;

    expect(() => planes.resize({
      cssWidth: 200,
      cssHeight: 100,
      devicePixelRatio: 1
    })).toThrow("deliberate geometry failure");
    expect(planes.snapshot().geometry).toBe(committed);
    expect(statics.canvas.width).toBe(committed.backing.width);
  });

  it("rolls back a backend that mutates before its resize redraw fails", () => {
    const animated = fakeCanvas();
    const statics = fakeCanvas();
    const backend = new FakePresentableBackend();
    const planes = new BrowserPresentationPlanes({
      animatedCanvas: animated.canvas,
      staticCanvas: statics.canvas,
      canvas: logicalCanvas(),
      maxBackingBytes: 8 * 1024 * 1024,
      setStaticVisible: () => undefined,
      createBackend: () => backend
    });
    planes.createFrameBackend();
    const committed = planes.resize({
      cssWidth: 100,
      cssHeight: 50,
      devicePixelRatio: 1
    });
    backend.failGeometryAfterMutationOnce = true;

    expect(() => planes.resize({
      cssWidth: 180,
      cssHeight: 120,
      devicePixelRatio: 1.5
    })).toThrow("deliberate post-mutation geometry failure");
    expect(planes.snapshot().geometry).toBe(committed);
    expect(backend.geometries.at(-1)).toBe(committed);
    expect(animated.canvas).toMatchObject(committed.backing);
    expect(statics.canvas).toMatchObject(committed.backing);
  });

  it("rolls both planes back when static redraw fails after canvas mutation", () => {
    const animated = fakeCanvas();
    const statics = fakeCanvas();
    const backend = new FakePresentableBackend();
    const planes = new BrowserPresentationPlanes({
      animatedCanvas: animated.canvas,
      staticCanvas: statics.canvas,
      canvas: logicalCanvas(),
      maxBackingBytes: 8 * 1024 * 1024,
      setStaticVisible: () => undefined,
      createBackend: () => backend
    });
    planes.createFrameBackend();
    const committed = planes.resize({
      cssWidth: 100,
      cssHeight: 50,
      devicePixelRatio: 1
    });
    planes.staticPlane.present({
      image: { width: 100, height: 50, close() {} } as ImageBitmap,
      width: 100,
      height: 50,
      inflatePath: "pure",
      close() {}
    }, 100, 50, { cover: false });
    statics.failNextDraw();

    expect(() => planes.resize({
      cssWidth: 180,
      cssHeight: 120,
      devicePixelRatio: 1.5
    })).toThrow("static presentation geometry failed");
    expect(planes.snapshot().geometry).toBe(committed);
    expect(backend.geometries.at(-1)).toBe(committed);
    expect(animated.canvas).toMatchObject(committed.backing);
    expect(statics.canvas).toMatchObject(committed.backing);
  });

  it("does not clear animated pixels after the backend redraws rollback", () => {
    const animated = fakeCanvas();
    const statics = fakeCanvas();
    const backend = new CanvasOwningFakeBackend(
      animated.canvas,
      animated.backingSets
    );
    const planes = new BrowserPresentationPlanes({
      animatedCanvas: animated.canvas,
      staticCanvas: statics.canvas,
      canvas: logicalCanvas(),
      maxBackingBytes: 8 * 1024 * 1024,
      setStaticVisible: () => undefined,
      createBackend: () => backend
    });
    planes.createFrameBackend();
    const committed = planes.resize({
      cssWidth: 100,
      cssHeight: 50,
      devicePixelRatio: 1
    });
    planes.staticPlane.present({
      image: { width: 100, height: 50, close() {} } as ImageBitmap,
      width: 100,
      height: 50,
      inflatePath: "pure",
      close() {}
    }, 100, 50, { cover: false });
    statics.failNextDraw();

    expect(() => planes.resize({
      cssWidth: 180,
      cssHeight: 120,
      devicePixelRatio: 1.5
    })).toThrow("static presentation geometry failed");

    expect(backend.lastRedrawBackingSetCount).toBeGreaterThan(0);
    expect(animated.backingSets).toHaveLength(
      backend.lastRedrawBackingSetCount
    );
    expect(animated.canvas).toMatchObject(committed.backing);
    expect(planes.snapshot().geometry).toBe(committed);
  });

  it("does not resurrect a disposed owner after a hostile resize getter", () => {
    const animated = fakeCanvas();
    const statics = fakeCanvas();
    const planes = new BrowserPresentationPlanes({
      animatedCanvas: animated.canvas,
      staticCanvas: statics.canvas,
      canvas: logicalCanvas(),
      maxBackingBytes: 8 * 1024 * 1024,
      setStaticVisible: () => undefined
    });
    const input = {
      get cssWidth() {
        planes.dispose();
        animated.canvas.width = 777;
        animated.canvas.height = 555;
        statics.canvas.width = 333;
        statics.canvas.height = 222;
        return 100;
      },
      cssHeight: 50,
      devicePixelRatio: 1
    };

    expect(() => planes.resize(input)).toThrowError(
      expect.objectContaining({ name: "AbortError" })
    );
    expect(animated.canvas).toMatchObject({ width: 0, height: 0 });
    expect(statics.canvas).toMatchObject({ width: 0, height: 0 });
    expect(planes.snapshot()).toMatchObject({
      geometry: null,
      resourceReservations: 0
    });
  });

  it("does not resurrect a disposed owner after a hostile backing setter", () => {
    const animated = fakeCanvas();
    const statics = fakeCanvas();
    let width = animated.canvas.width;
    let reenter = false;
    let planes!: BrowserPresentationPlanes;
    Object.defineProperty(animated.canvas, "width", {
      configurable: true,
      get: () => width,
      set: (value: number) => {
        if (reenter) {
          reenter = false;
          planes.dispose();
        }
        width = value;
      }
    });
    planes = new BrowserPresentationPlanes({
      animatedCanvas: animated.canvas,
      staticCanvas: statics.canvas,
      canvas: logicalCanvas(),
      maxBackingBytes: 8 * 1024 * 1024,
      setStaticVisible: () => undefined
    });
    reenter = true;

    expect(() => planes.resize({
      cssWidth: 200,
      cssHeight: 100,
      devicePixelRatio: 1
    })).toThrowError(expect.objectContaining({ name: "AbortError" }));
    expect(animated.canvas).toMatchObject({ width: 0, height: 0 });
    expect(statics.canvas).toMatchObject({ width: 0, height: 0 });
    expect(planes.snapshot()).toMatchObject({
      geometry: null,
      resourceReservations: 0
    });
  });

  it("rejects resource admission reentry before resize can violate its cap", () => {
    const animated = fakeCanvas();
    const statics = fakeCanvas();
    let width = animated.canvas.width;
    let reenter = false;
    let planes!: BrowserPresentationPlanes;
    Object.defineProperty(animated.canvas, "width", {
      configurable: true,
      get: () => width,
      set: (value: number) => {
        if (reenter) {
          reenter = false;
          planes.reserveCanvasResources(Object.freeze({
            effectiveCapBytes: 51_000,
            totalBytes: 51_000,
            canvasBackingWidth: 100,
            canvasBackingHeight: 50,
            canvasBackingBytesPerPlane: 20_000,
            animatedCanvasBackingAllocationBytes: 25_000,
            staticCanvasBackingAllocationBytes: 25_000
          }));
        }
        width = value;
      }
    });
    planes = new BrowserPresentationPlanes({
      animatedCanvas: animated.canvas,
      staticCanvas: statics.canvas,
      canvas: logicalCanvas(),
      maxBackingBytes: 64 * 1024 * 1024,
      setStaticVisible: () => undefined
    });
    const committed = planes.snapshot().geometry;
    reenter = true;

    expect(() => planes.resize({
      cssWidth: 200,
      cssHeight: 100,
      devicePixelRatio: 1
    })).toThrow("presentation mutation reentered synchronously");

    expect(planes.snapshot()).toMatchObject({
      geometry: committed,
      resourceReservations: 0,
      liveResourceTotals: []
    });
    expect(animated.canvas).toMatchObject(committed!.backing);
    expect(statics.canvas).toMatchObject(committed!.backing);
  });

  it("does not admit a resource plan whose getter disposes the owner", () => {
    const animated = fakeCanvas();
    const statics = fakeCanvas();
    const planes = new BrowserPresentationPlanes({
      animatedCanvas: animated.canvas,
      staticCanvas: statics.canvas,
      canvas: logicalCanvas(),
      maxBackingBytes: 8 * 1024 * 1024,
      setStaticVisible: () => undefined
    });
    const plan = {
      get effectiveCapBytes() {
        planes.dispose();
        animated.canvas.width = 777;
        animated.canvas.height = 555;
        statics.canvas.width = 333;
        statics.canvas.height = 222;
        return 100_000;
      },
      totalBytes: 100_000,
      canvasBackingWidth: 100,
      canvasBackingHeight: 50,
      canvasBackingBytesPerPlane: 20_000,
      animatedCanvasBackingAllocationBytes: 25_000,
      staticCanvasBackingAllocationBytes: 25_000
    };

    expect(() => planes.reserveCanvasResources(plan)).toThrowError(
      expect.objectContaining({ name: "AbortError" })
    );
    expect(planes.snapshot()).toMatchObject({
      geometry: null,
      resourceReservations: 0,
      liveResourceTotals: []
    });
    expect(animated.canvas).toMatchObject({ width: 0, height: 0 });
    expect(statics.canvas).toMatchObject({ width: 0, height: 0 });
  });

});
