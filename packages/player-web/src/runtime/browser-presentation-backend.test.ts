import { deriveAvcRenditionGeometry } from "@rendered-motion/format";
import { describe, expect, it, vi } from "vitest";

import {
  BrowserPresentationPlanes,
  type PresentableFrameBackend
} from "./browser-presentation-planes.js";
import {
  FrameRenderer,
  type FrameTextureLayout
} from "./frame-renderer.js";
import {
  FakePresentableBackend,
  MutatingInitialFailureBackend,
  fakeCanvas,
  logicalCanvas
} from "./browser-presentation-planes.test-support.js";

describe("BrowserPresentationPlanes backend ownership", () => {
  it("rolls back a backend whose initial presentation geometry fails", () => {
    const animated = fakeCanvas();
    const statics = fakeCanvas();
    const failing = new FakePresentableBackend();
    failing.failGeometry = true;
    const replacement = new FakePresentableBackend();
    const queue = [failing, replacement];
    const planes = new BrowserPresentationPlanes({
      animatedCanvas: animated.canvas,
      staticCanvas: statics.canvas,
      canvas: logicalCanvas(),
      maxBackingBytes: 8 * 1024 * 1024,
      setStaticVisible: () => undefined,
      createBackend: () => queue.shift()!
    });
    const geometry = planes.resize({
      cssWidth: 100,
      cssHeight: 50,
      devicePixelRatio: 1
    });

    expect(() => planes.createFrameBackend()).toThrow(
      "deliberate geometry failure"
    );
    expect(failing.disposals).toBe(1);
    expect(planes.snapshot().backendAttached).toBe(false);

    const attached = planes.createFrameBackend();
    expect(replacement.geometries).toEqual([geometry]);
    expect(planes.snapshot().backendAttached).toBe(true);
    attached.dispose();
    expect(replacement.disposals).toBe(1);
    expect(planes.snapshot().backendAttached).toBe(false);
  });

  it("terminalizes the full owner when backend geometry rollback also fails", () => {
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
    planes.reserveCanvasResources(Object.freeze({
      effectiveCapBytes: 100_000,
      totalBytes: 100_000,
      canvasBackingWidth: 100,
      canvasBackingHeight: 50,
      canvasBackingBytesPerPlane: 20_000,
      animatedCanvasBackingAllocationBytes: 25_000,
      staticCanvasBackingAllocationBytes: 25_000
    }));
    planes.resize({ cssWidth: 100, cssHeight: 50, devicePixelRatio: 1 });
    backend.failGeometryAfterEveryMutation = true;

    expect(() => planes.resize({
      cssWidth: 180,
      cssHeight: 120,
      devicePixelRatio: 1.5
    })).toThrow("deliberate persistent geometry failure");
    expect(backend.disposals).toBe(1);
    expect(planes.snapshot()).toMatchObject({
      backendAttached: false,
      resourceReservations: 0,
      liveResourceTotals: []
    });
    expect(() => planes.resize({
      cssWidth: 100,
      cssHeight: 50,
      devicePixelRatio: 1
    })).toThrowError(expect.objectContaining({ name: "AbortError" }));
  });

  it("terminalizes the full owner when static redraw rollback also fails", () => {
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
    planes.resize({ cssWidth: 100, cssHeight: 50, devicePixelRatio: 1 });
    planes.staticPlane.present({
      image: { width: 100, height: 50, close() {} } as ImageBitmap,
      width: 100,
      height: 50,
      inflatePath: "pure",
      close() {}
    }, 100, 50, { cover: false });
    statics.failDraws(2);

    expect(() => planes.resize({
      cssWidth: 180,
      cssHeight: 120,
      devicePixelRatio: 1.5
    })).toThrow("static presentation rollback failed");
    expect(backend.disposals).toBe(1);
    expect(planes.snapshot()).toMatchObject({
      backendAttached: false,
      resourceReservations: 0,
      liveResourceTotals: []
    });
    expect(() => planes.staticPlane.coverStatic())
      .toThrow("the static surface store is disposed");
  });

  it("terminalizes after a hostile animated backing setter breaks rollback", () => {
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
    planes.resize({ cssWidth: 100, cssHeight: 50, devicePixelRatio: 1 });
    planes.staticPlane.present({
      image: { width: 100, height: 50, close() {} } as ImageBitmap,
      width: 100,
      height: 50,
      inflatePath: "pure",
      close() {}
    }, 100, 50, { cover: false });
    animated.failWidthSetIn(2);
    statics.failNextDraw();

    expect(() => planes.resize({
      cssWidth: 180,
      cssHeight: 120,
      devicePixelRatio: 1.5
    })).toThrow("static presentation geometry failed");
    expect(backend.disposals).toBe(1);
    expect(planes.snapshot()).toMatchObject({
      backendAttached: false,
      resourceReservations: 0,
      geometry: null
    });
  });

  it("best-effort disposes an invalid custom backend", () => {
    const animated = fakeCanvas();
    const statics = fakeCanvas();
    const dispose = vi.fn();
    const planes = new BrowserPresentationPlanes({
      animatedCanvas: animated.canvas,
      staticCanvas: statics.canvas,
      canvas: logicalCanvas(),
      maxBackingBytes: 8 * 1024 * 1024,
      setStaticVisible: () => undefined,
      createBackend: () => ({ dispose } as unknown as PresentableFrameBackend)
    });

    expect(() => planes.createFrameBackend()).toThrow(
      "presentation backend is not resize-capable"
    );
    expect(dispose).toHaveBeenCalledOnce();
    expect(planes.snapshot().backendAttached).toBe(false);
  });

  it("captures backend methods, readback, and limits exactly once", () => {
    const animated = fakeCanvas();
    const statics = fakeCanvas();
    const getterReads = new Map<string, number>();
    const calls: string[] = [];
    const receivers: unknown[] = [];
    const pixels = new Uint8Array([4, 2]);
    const backend = Object.create(null) as Record<PropertyKey, unknown>;
    const once = (name: string, value: unknown): PropertyDescriptor => ({
      get() {
        const reads = (getterReads.get(name) ?? 0) + 1;
        getterReads.set(name, reads);
        if (reads > 1) throw new Error(`hostile repeated ${name} access`);
        return value;
      }
    });
    const limits = Object.create(null) as Record<PropertyKey, unknown>;
    Object.defineProperties(limits, {
      maxTextureSize: once("maxTextureSize", 2_048),
      maxArrayTextureLayers: once("maxArrayTextureLayers", 128)
    });
    Object.defineProperties(backend, {
      dispose: once("dispose", function(this: unknown) {
        receivers.push(this);
        calls.push("dispose");
      }),
      setPresentationGeometry: once(
        "setPresentationGeometry",
        function(this: unknown) {
          receivers.push(this);
          calls.push("geometry");
          return true;
        }
      ),
      allocate: once("allocate", function(this: unknown) {
        receivers.push(this);
        calls.push("allocate");
      }),
      upload: once("upload", function(this: unknown) {
        receivers.push(this);
        calls.push("upload");
      }),
      draw: once("draw", function(this: unknown) {
        receivers.push(this);
        calls.push("draw");
      }),
      readPixels: once("readPixels", function(this: unknown) {
        receivers.push(this);
        calls.push("readPixels");
        return pixels;
      }),
      limits: once("limits", limits)
    });
    const planes = new BrowserPresentationPlanes({
      animatedCanvas: animated.canvas,
      staticCanvas: statics.canvas,
      canvas: logicalCanvas(),
      maxBackingBytes: 8 * 1024 * 1024,
      setStaticVisible: () => undefined,
      createBackend: () => backend as unknown as PresentableFrameBackend
    });

    const attached = planes.createFrameBackend();
    attached.allocate({} as FrameTextureLayout, 2);
    attached.upload("stream", 0, pixels);
    attached.draw("stream", 0);
    expect(attached.readPixels?.()).toBe(pixels);
    attached.dispose();

    expect(Object.fromEntries(getterReads)).toEqual({
      dispose: 1,
      setPresentationGeometry: 1,
      allocate: 1,
      upload: 1,
      draw: 1,
      readPixels: 1,
      limits: 1,
      maxTextureSize: 1,
      maxArrayTextureLayers: 1
    });
    expect(calls).toEqual([
      "geometry",
      "allocate",
      "upload",
      "draw",
      "readPixels",
      "dispose"
    ]);
    expect(receivers).toEqual(Array(receivers.length).fill(backend));
  });

  it.each(["non-function", "throwing"] as const)(
    "rejects a %s optional readPixels accessor using captured cleanup once",
    (failure) => {
      const animated = fakeCanvas();
      const statics = fakeCanvas();
      let disposeReads = 0;
      let disposals = 0;
      const backend = {
        limits: { maxTextureSize: 2_048, maxArrayTextureLayers: 128 },
        setPresentationGeometry() { return true; },
        allocate() {},
        upload() {},
        draw() {},
        get dispose() {
          disposeReads += 1;
          if (disposeReads > 1) {
            throw new Error("private repeated dispose accessor detail");
          }
          return () => {
            disposals += 1;
          };
        },
        get readPixels(): unknown {
          if (failure === "throwing") {
            throw new Error("private readback accessor detail");
          }
          return 17;
        }
      } as unknown as PresentableFrameBackend;
      const planes = new BrowserPresentationPlanes({
        animatedCanvas: animated.canvas,
        staticCanvas: statics.canvas,
        canvas: logicalCanvas(),
        maxBackingBytes: 8 * 1024 * 1024,
        setStaticVisible: () => undefined,
        createBackend: () => backend
      });

      expect(() => planes.createFrameBackend()).toThrow(
        "presentation backend is not resize-capable"
      );
      expect(disposeReads).toBe(1);
      expect(disposals).toBe(1);
      expect(planes.snapshot().backendAttached).toBe(false);
    }
  );

  it("rejects every operation after the attached backend is disposed", () => {
    const animated = fakeCanvas();
    const statics = fakeCanvas();
    const backend = new FakePresentableBackend();
    const readPixels = vi.fn(() => new Uint8Array([1]));
    Object.defineProperty(backend, "readPixels", { value: readPixels });
    const planes = new BrowserPresentationPlanes({
      animatedCanvas: animated.canvas,
      staticCanvas: statics.canvas,
      canvas: logicalCanvas(),
      maxBackingBytes: 8 * 1024 * 1024,
      setStaticVisible: () => undefined,
      createBackend: () => backend
    });
    const attached = planes.createFrameBackend();
    const geometry = planes.snapshot().geometry!;
    const layout = {} as FrameTextureLayout;
    const pixels = new Uint8Array(0);
    attached.dispose();

    for (const operation of [
      () => attached.setPresentationGeometry(geometry),
      () => attached.allocate(layout, 2),
      () => attached.upload("stream", 0, pixels),
      () => attached.draw("stream", 0),
      () => attached.readPixels?.()
    ]) {
      expect(operation).toThrowError(
        expect.objectContaining({ name: "AbortError" })
      );
    }
    expect(readPixels).not.toHaveBeenCalled();
    expect(backend.disposals).toBe(1);
    expect(() => attached.dispose()).not.toThrow();
    expect(backend.disposals).toBe(1);
  });

  it("preserves optional readback absence without terminalizing the renderer", () => {
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
    expect(attached.readPixels).toBeUndefined();
    const renderer = new FrameRenderer(attached, {
      geometry: deriveAvcRenditionGeometry({
        profile: "avc-annexb-opaque-v0",
        canvasWidth: 4,
        canvasHeight: 2,
        colorRect: [0, 0, 4, 2],
        codedWidth: 16,
        codedHeight: 16
      }),
      logicalWidth: 4,
      logicalHeight: 2,
      residentLayerCount: 0
    });

    expect(() => renderer.readPixels()).toThrow("pixel readback is unavailable");
    expect(renderer.snapshot().state).toBe("active");
    expect(backend.disposals).toBe(0);
    renderer.dispose();
    expect(backend.disposals).toBe(1);
  });

  it.each(["allocate", "upload", "draw", "readPixels"] as const)(
    "rejects when a raw %s callback disposes its attached wrapper",
    (operation) => {
      const animated = fakeCanvas();
      const statics = fakeCanvas();
      let attached!: PresentableFrameBackend;
      let disposals = 0;
      const retire = (): void => attached.dispose();
      const raw: PresentableFrameBackend = {
        limits: { maxTextureSize: 2_048, maxArrayTextureLayers: 128 },
        setPresentationGeometry() { return true; },
        allocate() {
          if (operation === "allocate") retire();
        },
        upload() {
          if (operation === "upload") retire();
        },
        draw() {
          if (operation === "draw") retire();
        },
        readPixels() {
          if (operation === "readPixels") retire();
          return new Uint8Array([1]);
        },
        dispose() {
          disposals += 1;
        }
      };
      const planes = new BrowserPresentationPlanes({
        animatedCanvas: animated.canvas,
        staticCanvas: statics.canvas,
        canvas: logicalCanvas(),
        maxBackingBytes: 8 * 1024 * 1024,
        setStaticVisible: () => undefined,
        createBackend: () => raw
      });
      attached = planes.createFrameBackend();
      const invocation = {
        allocate: () => attached.allocate({} as FrameTextureLayout, 2),
        upload: () => attached.upload("stream", 0, new Uint8Array(0)),
        draw: () => attached.draw("stream", 0),
        readPixels: () => attached.readPixels?.()
      }[operation];

      expect(invocation).toThrowError(
        expect.objectContaining({ name: "AbortError" })
      );
      expect(disposals).toBe(1);
      expect(planes.snapshot().backendAttached).toBe(false);
    }
  );

  it("does not resurrect canvas backings after resize reenters owner disposal", () => {
    const animated = fakeCanvas();
    const statics = fakeCanvas();
    let geometryCalls = 0;
    let planes!: BrowserPresentationPlanes;
    const backend = new FakePresentableBackend();
    backend.observeGeometry = () => {
      geometryCalls += 1;
      if (geometryCalls === 2) planes.dispose();
    };
    planes = new BrowserPresentationPlanes({
      animatedCanvas: animated.canvas,
      staticCanvas: statics.canvas,
      canvas: logicalCanvas(),
      maxBackingBytes: 8 * 1024 * 1024,
      setStaticVisible: () => undefined,
      createBackend: () => backend
    });
    planes.createFrameBackend();

    expect(() => planes.resize({
      cssWidth: 180,
      cssHeight: 120,
      devicePixelRatio: 1.5
    })).toThrowError(expect.objectContaining({ name: "AbortError" }));
    expect(animated.canvas).toMatchObject({ width: 0, height: 0 });
    expect(statics.canvas).toMatchObject({ width: 0, height: 0 });
    expect(planes.snapshot()).toMatchObject({
      backendAttached: false,
      geometry: null
    });
    expect(backend.disposals).toBe(1);
  });

  it("rejects a resize-capable backend that cannot release its resources", () => {
    const animated = fakeCanvas();
    const statics = fakeCanvas();
    const planes = new BrowserPresentationPlanes({
      animatedCanvas: animated.canvas,
      staticCanvas: statics.canvas,
      canvas: logicalCanvas(),
      maxBackingBytes: 8 * 1024 * 1024,
      setStaticVisible: () => undefined,
      createBackend: () => ({
        limits: { maxTextureSize: 2_048, maxArrayTextureLayers: 128 },
        setPresentationGeometry() { return true; },
        allocate() {},
        upload() {},
        draw() {}
      } as unknown as PresentableFrameBackend)
    });

    expect(() => planes.createFrameBackend()).toThrow(
      "presentation backend is not resize-capable"
    );
    expect(planes.snapshot().backendAttached).toBe(false);
  });

  it("does not resurrect backings when invalid-backend cleanup reenters disposal", () => {
    const animated = fakeCanvas();
    const statics = fakeCanvas();
    let planes!: BrowserPresentationPlanes;
    let disposals = 0;
    const invalid = {
      dispose() {
        disposals += 1;
        planes.dispose();
      }
    } as unknown as PresentableFrameBackend;
    planes = new BrowserPresentationPlanes({
      animatedCanvas: animated.canvas,
      staticCanvas: statics.canvas,
      canvas: logicalCanvas(),
      maxBackingBytes: 8 * 1024 * 1024,
      setStaticVisible: () => undefined,
      createBackend: () => invalid
    });

    expect(() => planes.createFrameBackend()).toThrow(
      "presentation backend is not resize-capable"
    );
    expect(planes.snapshot()).toMatchObject({
      backendAttached: false,
      resourceReservations: 0,
      geometry: null
    });
    expect(animated.canvas).toMatchObject({ width: 0, height: 0 });
    expect(statics.canvas).toMatchObject({ width: 0, height: 0 });
    expect(disposals).toBe(1);
  });

  it("retires a backend returned after its factory reenters disposal", () => {
    const animated = fakeCanvas();
    const statics = fakeCanvas();
    const backend = new FakePresentableBackend();
    let planes!: BrowserPresentationPlanes;
    planes = new BrowserPresentationPlanes({
      animatedCanvas: animated.canvas,
      staticCanvas: statics.canvas,
      canvas: logicalCanvas(),
      maxBackingBytes: 8 * 1024 * 1024,
      setStaticVisible: () => undefined,
      createBackend: (canvas) => {
        planes.dispose();
        canvas.width = 1_777;
        canvas.height = 1_555;
        return backend;
      }
    });

    expect(() => planes.createFrameBackend()).toThrowError(
      expect.objectContaining({ name: "AbortError" })
    );
    expect(backend.disposals).toBe(1);
    expect(planes.snapshot()).toMatchObject({
      backendAttached: false,
      resourceReservations: 0,
      geometry: null
    });
    expect(animated.canvas).toMatchObject({ width: 0, height: 0 });
    expect(statics.canvas).toMatchObject({ width: 0, height: 0 });
  });

  it("rejects recursive creation before a nested factory can allocate", () => {
    const animated = fakeCanvas();
    const statics = fakeCanvas();
    const outer = new FakePresentableBackend();
    const nested = new FakePresentableBackend();
    let factoryCalls = 0;
    let nestedAttached: PresentableFrameBackend | undefined;
    let nestedFailure: unknown;
    let planes!: BrowserPresentationPlanes;
    planes = new BrowserPresentationPlanes({
      animatedCanvas: animated.canvas,
      staticCanvas: statics.canvas,
      canvas: logicalCanvas(),
      maxBackingBytes: 8 * 1024 * 1024,
      setStaticVisible: () => undefined,
      createBackend: () => {
        factoryCalls += 1;
        if (factoryCalls === 1) {
          try {
            nestedAttached = planes.createFrameBackend();
          } catch (error) {
            nestedFailure = error;
          }
          return outer;
        }
        return nested;
      }
    });

    expect(() => planes.createFrameBackend()).not.toThrow();
    expect(nestedAttached).toBeUndefined();
    expect(nestedFailure).toEqual(
      expect.objectContaining({
        message: "a presentation backend is already attached"
      })
    );
    expect(factoryCalls).toBe(1);
    expect(outer.geometries).toHaveLength(1);
    expect(nested.geometries).toHaveLength(0);

    planes.dispose();
    expect(outer.disposals).toBe(1);
    expect(nested.disposals).toBe(0);
    expect(planes.snapshot().backendAttached).toBe(false);
  });

  it("does not return a backend whose initial geometry reenters disposal", () => {
    const animated = fakeCanvas();
    const statics = fakeCanvas();
    const backend = new FakePresentableBackend();
    let planes!: BrowserPresentationPlanes;
    backend.observeGeometry = () => planes.dispose();
    planes = new BrowserPresentationPlanes({
      animatedCanvas: animated.canvas,
      staticCanvas: statics.canvas,
      canvas: logicalCanvas(),
      maxBackingBytes: 8 * 1024 * 1024,
      setStaticVisible: () => undefined,
      createBackend: () => backend
    });

    expect(() => planes.createFrameBackend())
      .toThrowError(expect.objectContaining({ name: "AbortError" }));
    expect(backend.disposals).toBe(1);
    expect(planes.snapshot()).toMatchObject({
      backendAttached: false,
      geometry: null
    });
    expect(animated.canvas).toMatchObject({ width: 0, height: 0 });
    expect(statics.canvas).toMatchObject({ width: 0, height: 0 });
  });

  it.each(["geometry", "limits"] as const)(
    "contains a throwing %s accessor while taking backend ownership",
    (accessor) => {
      const animated = fakeCanvas();
      const statics = fakeCanvas();
      const dispose = vi.fn();
      const hostile = {
        dispose,
        allocate() {},
        upload() {},
        draw() {},
        get setPresentationGeometry() {
          if (accessor === "geometry") {
            throw new Error("injected geometry accessor failure");
          }
          return () => true;
        },
        get limits() {
          if (accessor === "limits") {
            throw new Error("injected limits accessor failure");
          }
          return { maxTextureSize: 2_048, maxArrayTextureLayers: 128 };
        }
      } as unknown as PresentableFrameBackend;
      const planes = new BrowserPresentationPlanes({
        animatedCanvas: animated.canvas,
        staticCanvas: statics.canvas,
        canvas: logicalCanvas(),
        maxBackingBytes: 8 * 1024 * 1024,
        setStaticVisible: () => undefined,
        createBackend: () => hostile
      });

      expect(() => planes.createFrameBackend()).toThrow(
        "presentation backend is not resize-capable"
      );
      expect(dispose).toHaveBeenCalledOnce();
      expect(planes.snapshot().backendAttached).toBe(false);
      expect(animated.canvas).toMatchObject({ width: 100, height: 50 });
    }
  );

  it("restores admitted backing after initial backend geometry mutates then fails", () => {
    const animated = fakeCanvas();
    const statics = fakeCanvas();
    const failing = new MutatingInitialFailureBackend(animated.canvas);
    const replacement = new FakePresentableBackend();
    const queue: PresentableFrameBackend[] = [failing, replacement];
    const planes = new BrowserPresentationPlanes({
      animatedCanvas: animated.canvas,
      staticCanvas: statics.canvas,
      canvas: logicalCanvas(),
      maxBackingBytes: 8 * 1024 * 1024,
      setStaticVisible: () => undefined,
      createBackend: () => queue.shift() as PresentableFrameBackend
    });

    expect(() => planes.createFrameBackend()).toThrow(
      "injected initial geometry failure"
    );
    expect(failing.disposals).toBe(1);
    expect(animated.canvas).toMatchObject({ width: 100, height: 50 });
    expect(planes.snapshot().backendAttached).toBe(false);

    expect(() => planes.createFrameBackend()).not.toThrow();
    expect(planes.snapshot().backendAttached).toBe(true);
  });

  it("restores admitted backing when the backend factory mutates then throws", () => {
    const animated = fakeCanvas();
    const statics = fakeCanvas();
    const replacement = new FakePresentableBackend();
    let attempts = 0;
    const planes = new BrowserPresentationPlanes({
      animatedCanvas: animated.canvas,
      staticCanvas: statics.canvas,
      canvas: logicalCanvas(),
      maxBackingBytes: 8 * 1024 * 1024,
      setStaticVisible: () => undefined,
      createBackend: (canvas) => {
        attempts += 1;
        if (attempts === 1) {
          canvas.width = 1_999;
          canvas.height = 1_777;
          throw new Error("injected backend factory failure");
        }
        return replacement;
      }
    });

    expect(() => planes.createFrameBackend()).toThrow(
      "injected backend factory failure"
    );
    expect(animated.canvas).toMatchObject({ width: 100, height: 50 });
    expect(planes.snapshot()).toMatchObject({
      backendAttached: false,
      geometry: { backing: { width: 100, height: 50 } }
    });

    expect(() => planes.createFrameBackend()).not.toThrow();
    expect(planes.snapshot().backendAttached).toBe(true);
  });

  it("finishes terminal cleanup when the attached backend dispose throws", () => {
    const animated = fakeCanvas();
    const statics = fakeCanvas();
    const visibility: boolean[] = [];
    const backend = new FakePresentableBackend();
    backend.failDispose = true;
    const planes = new BrowserPresentationPlanes({
      animatedCanvas: animated.canvas,
      staticCanvas: statics.canvas,
      canvas: logicalCanvas(),
      maxBackingBytes: 8 * 1024 * 1024,
      setStaticVisible: (visible) => visibility.push(visible),
      createBackend: () => backend
    });
    planes.createFrameBackend();
    planes.reserveCanvasResources(Object.freeze({
      effectiveCapBytes: 100_000,
      totalBytes: 100_000,
      canvasBackingWidth: 100,
      canvasBackingHeight: 50,
      canvasBackingBytesPerPlane: 20_000,
      animatedCanvasBackingAllocationBytes: 25_000,
      staticCanvasBackingAllocationBytes: 25_000
    }));
    planes.staticPlane.coverStatic();

    expect(() => planes.dispose()).not.toThrow();
    expect(backend.disposals).toBe(1);
    expect(visibility).toEqual([true, false]);
    expect(planes.snapshot()).toMatchObject({
      backendAttached: false,
      resourceReservations: 0,
      liveResourceTotals: [],
      geometry: null
    });
    expect(animated.canvas).toMatchObject({ width: 0, height: 0 });
    expect(statics.canvas).toMatchObject({ width: 0, height: 0 });
    expect(() => planes.dispose()).not.toThrow();
    expect(backend.disposals).toBe(1);
  });

  it("attempts every backing release when hostile canvas setters throw", () => {
    const animated = fakeCanvas();
    const statics = fakeCanvas();
    const planes = new BrowserPresentationPlanes({
      animatedCanvas: animated.canvas,
      staticCanvas: statics.canvas,
      canvas: logicalCanvas(),
      maxBackingBytes: 8 * 1024 * 1024,
      setStaticVisible: () => undefined,
      createBackend: () => new FakePresentableBackend()
    });
    planes.createFrameBackend();
    planes.reserveCanvasResources(Object.freeze({
      effectiveCapBytes: 100_000,
      totalBytes: 100_000,
      canvasBackingWidth: 100,
      canvasBackingHeight: 50,
      canvasBackingBytesPerPlane: 20_000,
      animatedCanvasBackingAllocationBytes: 25_000,
      staticCanvasBackingAllocationBytes: 25_000
    }));
    planes.resize({ cssWidth: 160, cssHeight: 90, devicePixelRatio: 1 });
    const animatedWidth = animated.canvas.width;
    animated.failNextWidthSet();
    statics.failNextHeightSet();

    expect(() => planes.dispose()).not.toThrow();

    expect(animated.canvas).toMatchObject({
      width: animatedWidth,
      height: 0
    });
    expect(statics.canvas).toMatchObject({
      width: 0,
      height: 0
    });
    expect(planes.snapshot()).toMatchObject({
      backendAttached: false,
      resourceReservations: 0,
      liveResourceTotals: [],
      geometry: null
    });
  });
});
