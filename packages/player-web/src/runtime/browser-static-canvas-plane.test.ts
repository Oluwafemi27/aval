import { describe, expect, it } from "vitest";

import {
  BrowserStaticCanvasPlane,
  StaticSurfaceStore,
  StaticSurfaceStoreDisposedError,
  type BrowserDecodedStaticSurface,
  type StaticSurfaceDecoder
} from "./static-surfaces.js";
import { FakeCatalog, fakeBitmap } from "./static-surfaces.test-support.js";

describe("browser static canvas plane", () => {
  it("keeps the restored browser image open for later geometry redraws", async () => {
    const draws: string[] = [];
    const records = new Map<string, { closes: number }>();
    const context = {
      clearRect() {},
      drawImage(image: { readonly tag: string }) {
        const record = records.get(image.tag);
        draws.push(`draw:${image.tag}:${record?.closes === 0 ? "open" : "closed"}`);
      }
    } as unknown as CanvasRenderingContext2D;
    const canvas = {
      width: 0,
      height: 0,
      getContext() {
        return context;
      }
    } as unknown as HTMLCanvasElement;
    const aborted = new AbortController();
    aborted.abort();
    let triggerSuccessor = false;
    let successor: Promise<unknown> | null = null;
    let store!: StaticSurfaceStore<BrowserDecodedStaticSurface>;
    const plane = new BrowserStaticCanvasPlane(canvas, (visible) => {
      if (visible && triggerSuccessor) {
        triggerSuccessor = false;
        successor = store.presentState("done", { signal: aborted.signal });
      }
    });
    const decoder: StaticSurfaceDecoder<BrowserDecodedStaticSurface> = {
      async decode(png) {
        const tag = new TextDecoder().decode(png);
        const record = { closes: 0 };
        records.set(tag, record);
        return {
          image: { tag } as unknown as ImageBitmap,
          width: 4,
          height: 3,
          inflatePath: "pure",
          close() {
            record.closes += 1;
          }
        };
      }
    };
    store = new StaticSurfaceStore(new FakeCatalog(), decoder, plane);
    await store.installInitial();
    triggerSuccessor = true;

    await expect(store.presentState("hover"))
      .rejects.toMatchObject({ name: "AbortError" });
    await expect(successor).rejects.toMatchObject({ name: "AbortError" });
    plane.setPresentationGeometry({
      backing: { width: 8, height: 6 },
      sourceRect: { x: 0, y: 0, width: 4, height: 3 },
      destinationBackingRect: { x: 0, y: 0, width: 8, height: 6 }
    } as never);

    expect(draws.at(-1)).toBe("draw:shared:open");
    expect(records.get("shared")?.closes).toBe(0);
    expect(records.get("hover")?.closes).toBe(1);
    expect(store.currentState()).toBe("idle");
  });

  it("browser canvas plane draws before visibility and remains a narrow host adapter", () => {
    const events: string[] = [];
    const context = {
      drawImage() {
        events.push("draw");
      },
      clearRect() {
        events.push("clear");
      }
    } as unknown as CanvasRenderingContext2D;
    const canvas = {
      width: 0,
      height: 0,
      getContext() {
        return context;
      }
    } as unknown as HTMLCanvasElement;
    const plane = new BrowserStaticCanvasPlane(canvas, (visible) => {
      events.push(visible ? "show" : "hide");
    });
    const surface = {
      image: fakeBitmap().bitmap,
      width: 4,
      height: 3,
      inflatePath: "pure",
      close() {}
    } satisfies BrowserDecodedStaticSurface;

    plane.present(surface, 4, 3);
    plane.revealAnimated();
    plane.coverStatic();
    plane.dispose();
    plane.dispose();
    expect(events).toEqual([
      "clear",
      "draw",
      "show",
      "hide",
      "show",
      "clear",
      "hide"
    ]);
  });

  it("restores retained pixels when a browser canvas draw mutates then fails", () => {
    const events: string[] = [];
    let failIncoming = false;
    const oldImage = { tag: "old" } as unknown as ImageBitmap;
    const incomingImage = { tag: "incoming" } as unknown as ImageBitmap;
    const context = {
      drawImage(image: { readonly tag: string }) {
        events.push(`draw:${image.tag}`);
        if (failIncoming && (image as unknown) === incomingImage) {
          throw new Error("injected browser draw failure");
        }
      },
      clearRect() {
        events.push("clear");
      }
    } as unknown as CanvasRenderingContext2D;
    const canvas = {
      width: 0,
      height: 0,
      getContext() {
        return context;
      }
    } as unknown as HTMLCanvasElement;
    const plane = new BrowserStaticCanvasPlane(canvas, (visible) => {
      events.push(visible ? "show" : "hide");
    });
    const oldSurface = browserSurface(oldImage);
    const incomingSurface = browserSurface(incomingImage);

    plane.present(oldSurface, 4, 3);
    failIncoming = true;
    expect(() => plane.present(incomingSurface, 4, 3))
      .toThrow("static presentation failed");

    expect(events).toEqual([
      "clear",
      "draw:old",
      "show",
      "clear",
      "draw:incoming",
      "clear",
      "draw:old"
    ]);
    expect(() => plane.coverStatic()).not.toThrow();
  });

  it("rolls visibility failure back to the retained surface and closes incoming once", async () => {
    const events: string[] = [];
    let failNextShow = false;
    const context = {
      drawImage(image: { readonly tag: string }) {
        events.push(`draw:${image.tag}`);
      },
      clearRect() {
        events.push("clear");
      }
    } as unknown as CanvasRenderingContext2D;
    const canvas = {
      width: 0,
      height: 0,
      getContext() {
        return context;
      }
    } as unknown as HTMLCanvasElement;
    const plane = new BrowserStaticCanvasPlane(canvas, (visible) => {
      events.push(visible ? "show" : "hide");
      if (visible && failNextShow) {
        failNextShow = false;
        throw new Error("injected visibility failure");
      }
    });
    const surfaces: Array<BrowserDecodedStaticSurface & {
      readonly tag: string;
      readonly closeCalls: () => number;
    }> = [];
    const decoder: StaticSurfaceDecoder<BrowserDecodedStaticSurface> = {
      async decode(png) {
        const tag = new TextDecoder().decode(png);
        let closes = 0;
        const surface = {
          tag,
          image: { tag } as unknown as ImageBitmap,
          width: 4,
          height: 3,
          inflatePath: "pure",
          closeCalls: () => closes,
          close() {
            closes += 1;
          }
        } satisfies BrowserDecodedStaticSurface & {
          readonly tag: string;
          readonly closeCalls: () => number;
        };
        surfaces.push(surface);
        return surface;
      }
    };
    const store = new StaticSurfaceStore(new FakeCatalog(), decoder, plane);
    await store.installInitial();
    failNextShow = true;

    await expect(store.presentState("hover"))
      .rejects.toThrow("static presentation failed");

    expect(events).toEqual([
      "clear",
      "draw:shared",
      "show",
      "clear",
      "draw:hover",
      "show",
      "clear",
      "draw:shared",
      "show"
    ]);
    expect(surfaces[0]?.closeCalls()).toBe(0);
    expect(surfaces[1]?.closeCalls()).toBe(1);
    expect(store.snapshot()).toMatchObject({
      currentStaticFrame: "shared",
      retainedSurfaces: 1,
      errors: 1
    });
  });

  it("sanitizes draw, visibility, and geometry host failures", () => {
    let failDraw = true;
    const context = {
      clearRect() {},
      drawImage() {
        if (failDraw) {
          failDraw = false;
          throw new RangeError("/private/canvas-draw-secret");
        }
      }
    } as unknown as CanvasRenderingContext2D;
    const canvas = {
      width: 0,
      height: 0,
      getContext() {
        return context;
      }
    } as unknown as HTMLCanvasElement;
    let failVisibility = false;
    const plane = new BrowserStaticCanvasPlane(canvas, () => {
      if (failVisibility) {
        throw new RangeError("/private/visibility-secret");
      }
    });
    const surface = browserSurface(fakeBitmap().bitmap);

    expect(() => plane.present(surface, 4, 3))
      .toThrow("static presentation failed");
    plane.present(surface, 4, 3);
    failVisibility = true;
    expect(() => plane.coverStatic())
      .toThrow("static visibility update failed");

    failVisibility = false;
    failDraw = true;
    expect(() => plane.setPresentationGeometry({
      backing: { width: 8, height: 6 },
      sourceRect: { x: 0, y: 0, width: 4, height: 3 },
      destinationBackingRect: { x: 0, y: 0, width: 8, height: 6 }
    } as never)).toThrow("static presentation geometry failed");
  });

  it("rejects nested visibility operations without recursive host entry", () => {
    const context = {
      clearRect() {},
      drawImage() {}
    } as unknown as CanvasRenderingContext2D;
    const canvas = {
      width: 0,
      height: 0,
      getContext() {
        return context;
      }
    } as unknown as HTMLCanvasElement;
    let nested = false;
    let callbacks = 0;
    let plane!: BrowserStaticCanvasPlane;
    plane = new BrowserStaticCanvasPlane(canvas, (visible) => {
      callbacks += 1;
      if (visible && nested) plane.coverStatic();
    });
    plane.present(browserSurface(fakeBitmap().bitmap), 4, 3);
    nested = true;

    expect(() => plane.coverStatic())
      .toThrow("static visibility update failed");
    expect(callbacks).toBe(2);
  });

  it.each(["clear", "draw"] as const)(
    "fails closed when Canvas2D %s reenters plane disposal",
    (boundary) => {
      const visibility: boolean[] = [];
      let trigger = false;
      let plane!: BrowserStaticCanvasPlane;
      const context = {
        clearRect() {
          if (trigger && boundary === "clear") {
            trigger = false;
            plane.dispose();
          }
        },
        drawImage() {
          if (trigger && boundary === "draw") {
            trigger = false;
            plane.dispose();
          }
        }
      } as unknown as CanvasRenderingContext2D;
      const canvas = {
        width: 0,
        height: 0,
        getContext() {
          return context;
        }
      } as unknown as HTMLCanvasElement;
      plane = new BrowserStaticCanvasPlane(canvas, (visible) => {
        visibility.push(visible);
      });
      trigger = true;

      expect(() => plane.present(
        browserSurface(fakeBitmap().bitmap),
        4,
        3
      )).toThrow(StaticSurfaceStoreDisposedError);
      expect(canvas).toMatchObject({ width: 0, height: 0 });
      expect(visibility).toEqual([false]);
    }
  );

  it("does not return geometry success when redraw disposes the plane", () => {
    let trigger = false;
    let plane!: BrowserStaticCanvasPlane;
    const context = {
      clearRect() {},
      drawImage() {
        if (trigger) {
          trigger = false;
          plane.dispose();
        }
      }
    } as unknown as CanvasRenderingContext2D;
    const canvas = {
      width: 0,
      height: 0,
      getContext() {
        return context;
      }
    } as unknown as HTMLCanvasElement;
    plane = new BrowserStaticCanvasPlane(canvas, () => undefined);
    plane.present(browserSurface(fakeBitmap().bitmap), 4, 3);
    trigger = true;

    expect(() => plane.setPresentationGeometry({
      backing: { width: 8, height: 6 },
      sourceRect: { x: 0, y: 0, width: 4, height: 3 },
      destinationBackingRect: { x: 0, y: 0, width: 8, height: 6 }
    } as never)).toThrow(StaticSurfaceStoreDisposedError);
    expect(canvas).toMatchObject({ width: 0, height: 0 });
  });

  it("captures changing geometry accessors exactly once before backing writes", () => {
    const context = {
      clearRect() {},
      drawImage() {}
    } as unknown as CanvasRenderingContext2D;
    const canvas = {
      width: 0,
      height: 0,
      getContext() {
        return context;
      }
    } as unknown as HTMLCanvasElement;
    const plane = new BrowserStaticCanvasPlane(canvas, () => undefined);
    let widthReads = 0;
    let backingReads = 0;
    const backing = {
      get width() {
        widthReads += 1;
        return widthReads === 1 ? 8 : 80;
      },
      height: 6
    };

    expect(plane.setPresentationGeometry({
      get backing() {
        backingReads += 1;
        return backingReads === 1
          ? backing
          : { width: 800, height: 600 };
      },
      sourceRect: { x: 0, y: 0, width: 4, height: 3 },
      destinationBackingRect: { x: 0, y: 0, width: 8, height: 6 }
    } as never)).toBe(true);

    expect(backingReads).toBe(1);
    expect(widthReads).toBe(1);
    expect(canvas).toMatchObject({ width: 8, height: 6 });
  });

  it("accepts a direct geometry that is clipped by its backing", () => {
    const context = {
      clearRect() {},
      drawImage() {}
    } as unknown as CanvasRenderingContext2D;
    const canvas = {
      width: 0,
      height: 0,
      getContext() {
        return context;
      }
    } as unknown as HTMLCanvasElement;
    const plane = new BrowserStaticCanvasPlane(canvas, () => undefined);

    expect(plane.setPresentationGeometry({
      backing: { width: 8, height: 6 },
      sourceRect: { x: 0, y: 0, width: 4, height: 3 },
      destinationBackingRect: { x: 7, y: 0, width: 2, height: 6 }
    } as never)).toBe(true);
    expect(canvas).toMatchObject({ width: 8, height: 6 });
  });

  it("rejects a direct geometry wholly outside its backing", () => {
    const context = {
      clearRect() {},
      drawImage() {}
    } as unknown as CanvasRenderingContext2D;
    const canvas = {
      width: 0,
      height: 0,
      getContext() {
        return context;
      }
    } as unknown as HTMLCanvasElement;
    const plane = new BrowserStaticCanvasPlane(canvas, () => undefined);

    expect(() => plane.setPresentationGeometry({
      backing: { width: 8, height: 6 },
      sourceRect: { x: 0, y: 0, width: 4, height: 3 },
      destinationBackingRect: { x: 8, y: 0, width: 2, height: 6 }
    } as never)).toThrow("destination does not intersect the backing");
    expect(canvas).toMatchObject({ width: 0, height: 0 });
  });

  it("rejects unsafe standalone dimensions before touching canvas backing", () => {
    const context = {
      clearRect() {},
      drawImage() {}
    } as unknown as CanvasRenderingContext2D;
    const canvas = {
      width: 0,
      height: 0,
      getContext() {
        return context;
      }
    } as unknown as HTMLCanvasElement;
    const plane = new BrowserStaticCanvasPlane(canvas, () => undefined);
    const surface = browserSurface(fakeBitmap().bitmap);

    for (const width of [0, -1, 1.5, 513, Number.MAX_SAFE_INTEGER]) {
      expect(() => plane.present(surface, width, 3, { cover: false }))
        .toThrow("safe integers from 1 through 512");
      expect(canvas).toMatchObject({ width: 0, height: 0 });
    }
    expect(() => plane.present(surface, 4, 513, { cover: false }))
      .toThrow("safe integers from 1 through 512");
    expect(canvas).toMatchObject({ width: 0, height: 0 });
  });

  it("re-clears backing when an input getter disposes then mutates it", () => {
    const visibility: boolean[] = [];
    let width = 0;
    let height = 0;
    let trigger = false;
    let plane!: BrowserStaticCanvasPlane;
    const context = {
      clearRect() {},
      drawImage() {}
    } as unknown as CanvasRenderingContext2D;
    const canvas = {
      get width() {
        if (trigger) {
          trigger = false;
          plane.dispose();
          width = 777;
          height = 555;
        }
        return width;
      },
      set width(value: number) {
        width = value;
      },
      get height() {
        return height;
      },
      set height(value: number) {
        height = value;
      },
      getContext() {
        return context;
      }
    } as unknown as HTMLCanvasElement;
    plane = new BrowserStaticCanvasPlane(canvas, (visible) => {
      visibility.push(visible);
    });
    trigger = true;

    expect(() => plane.present(
      browserSurface(fakeBitmap().bitmap),
      4,
      3
    )).toThrow(StaticSurfaceStoreDisposedError);

    expect(canvas).toMatchObject({ width: 0, height: 0 });
    expect(visibility).toEqual([false]);
  });

  it("clears an outer present width store after its setter disposes the plane", () => {
    const visibility: boolean[] = [];
    let width = 0;
    let height = 0;
    let disposeOnWidth = false;
    let plane!: BrowserStaticCanvasPlane;
    const context = {
      clearRect() {},
      drawImage() {}
    } as unknown as CanvasRenderingContext2D;
    const canvas = {
      get width() {
        return width;
      },
      set width(value: number) {
        if (disposeOnWidth) {
          disposeOnWidth = false;
          plane.dispose();
        }
        width = value;
      },
      get height() {
        return height;
      },
      set height(value: number) {
        height = value;
      },
      getContext() {
        return context;
      }
    } as unknown as HTMLCanvasElement;
    plane = new BrowserStaticCanvasPlane(canvas, (visible) => {
      visibility.push(visible);
    });
    disposeOnWidth = true;

    expect(() => plane.present(
      browserSurface(fakeBitmap().bitmap),
      4,
      3
    )).toThrow(StaticSurfaceStoreDisposedError);

    expect(canvas).toMatchObject({ width: 0, height: 0 });
    expect(visibility).toEqual([false]);
  });

  it("clears an outer geometry width store after its setter disposes the plane", () => {
    const visibility: boolean[] = [];
    let width = 0;
    let height = 0;
    let disposeOnWidth = false;
    let plane!: BrowserStaticCanvasPlane;
    const context = {
      clearRect() {},
      drawImage() {}
    } as unknown as CanvasRenderingContext2D;
    const canvas = {
      get width() {
        return width;
      },
      set width(value: number) {
        if (disposeOnWidth) {
          disposeOnWidth = false;
          plane.dispose();
        }
        width = value;
      },
      get height() {
        return height;
      },
      set height(value: number) {
        height = value;
      },
      getContext() {
        return context;
      }
    } as unknown as HTMLCanvasElement;
    plane = new BrowserStaticCanvasPlane(canvas, (visible) => {
      visibility.push(visible);
    });
    plane.present(browserSurface(fakeBitmap().bitmap), 4, 3);
    disposeOnWidth = true;

    expect(() => plane.setPresentationGeometry({
      backing: { width: 8, height: 6 },
      sourceRect: { x: 0, y: 0, width: 4, height: 3 },
      destinationBackingRect: { x: 0, y: 0, width: 8, height: 6 }
    } as never)).toThrow(StaticSurfaceStoreDisposedError);

    expect(canvas).toMatchObject({ width: 0, height: 0 });
    expect(visibility).toEqual([true, false]);
  });

  it("does not retain or resize after a surface image getter disposes it", () => {
    const fixture = backingWriteFixture();
    const visibility: boolean[] = [];
    let plane!: BrowserStaticCanvasPlane;
    plane = new BrowserStaticCanvasPlane(fixture.canvas, (visible) => {
      visibility.push(visible);
    });
    const image = fakeBitmap().bitmap;
    const surface = {
      get image() {
        plane.dispose();
        return image;
      },
      width: 4,
      height: 3,
      inflatePath: "pure" as const,
      close() {}
    } satisfies BrowserDecodedStaticSurface;

    expect(() => plane.present(surface, 4, 3))
      .toThrow(StaticSurfaceStoreDisposedError);

    expect(fixture.widthWrites).toEqual([0, 0]);
    expect(fixture.heightWrites).toEqual([0, 0]);
    expect(fixture.draws()).toBe(0);
    expect(visibility).toEqual([false]);
  });

  it("does not commit geometry whose backing getter disposes it", () => {
    const fixture = backingWriteFixture();
    const visibility: boolean[] = [];
    let plane!: BrowserStaticCanvasPlane;
    plane = new BrowserStaticCanvasPlane(fixture.canvas, (visible) => {
      visibility.push(visible);
    });
    const backing = { width: 8, height: 6 };
    const geometry = {
      get backing() {
        plane.dispose();
        return backing;
      },
      sourceRect: { x: 0, y: 0, width: 4, height: 3 },
      destinationBackingRect: { x: 0, y: 0, width: 8, height: 6 }
    };

    expect(() => plane.setPresentationGeometry(geometry as never))
      .toThrow(StaticSurfaceStoreDisposedError);

    expect(fixture.widthWrites).toEqual([0, 0]);
    expect(fixture.heightWrites).toEqual([0, 0]);
    expect(fixture.draws()).toBe(0);
    expect(visibility).toEqual([false]);
  });

  it("releases the retained image and hides even when terminal clear fails", () => {
    const visibility: boolean[] = [];
    let failClear = false;
    const context = {
      drawImage() {},
      clearRect() {
        if (failClear) throw new Error("injected terminal clear failure");
      }
    } as unknown as CanvasRenderingContext2D;
    const canvas = {
      width: 0,
      height: 0,
      getContext() {
        return context;
      }
    } as unknown as HTMLCanvasElement;
    const plane = new BrowserStaticCanvasPlane(canvas, (visible) => {
      visibility.push(visible);
    });
    plane.present(browserSurface(fakeBitmap().bitmap), 4, 3);
    failClear = true;

    expect(() => plane.dispose()).not.toThrow();
    expect(visibility).toEqual([true, false]);
    expect(() => plane.coverStatic())
      .toThrow(StaticSurfaceStoreDisposedError);
  });

  it("finishes terminal canvas cleanup when the visibility host fails", () => {
    let clears = 0;
    const context = {
      drawImage() {},
      clearRect() {
        clears += 1;
      }
    } as unknown as CanvasRenderingContext2D;
    const canvas = {
      width: 0,
      height: 0,
      getContext() {
        return context;
      }
    } as unknown as HTMLCanvasElement;
    const plane = new BrowserStaticCanvasPlane(canvas, () => {
      throw new Error("injected terminal visibility failure");
    });

    expect(() => plane.dispose()).not.toThrow();
    expect(clears).toBe(1);
    expect(() => plane.dispose()).not.toThrow();
    expect(clears).toBe(1);
  });

  it("rejects a visibility callback that terminalizes before store commit", async () => {
    const context = {
      drawImage() {},
      clearRect() {}
    } as unknown as CanvasRenderingContext2D;
    const canvas = {
      width: 0,
      height: 0,
      getContext() {
        return context;
      }
    } as unknown as HTMLCanvasElement;
    let disposeOnShow = false;
    let plane!: BrowserStaticCanvasPlane;
    plane = new BrowserStaticCanvasPlane(canvas, (visible) => {
      if (visible && disposeOnShow) plane.dispose();
    });
    const surfaces: Array<BrowserDecodedStaticSurface & {
      readonly closeCalls: () => number;
    }> = [];
    const decoder: StaticSurfaceDecoder<BrowserDecodedStaticSurface> = {
      async decode() {
        let closes = 0;
        const surface = {
          image: fakeBitmap().bitmap,
          width: 4,
          height: 3,
          inflatePath: "pure",
          closeCalls: () => closes,
          close() {
            closes += 1;
          }
        } satisfies BrowserDecodedStaticSurface & {
          readonly closeCalls: () => number;
        };
        surfaces.push(surface);
        return surface;
      }
    };
    const store = new StaticSurfaceStore(new FakeCatalog(), decoder, plane);
    await store.installInitial();
    disposeOnShow = true;

    await expect(store.presentState("hover"))
      .rejects.toBeInstanceOf(StaticSurfaceStoreDisposedError);

    expect(canvas).toMatchObject({ width: 0, height: 0 });
    expect(surfaces[0]?.closeCalls()).toBe(1);
    expect(surfaces[1]?.closeCalls()).toBe(1);
    expect(store.snapshot()).toMatchObject({
      state: "disposed",
      currentState: null,
      currentStaticFrame: null,
      retainedSurfaces: 0,
      errors: 0
    });
  });

});

function browserSurface(image: ImageBitmap): BrowserDecodedStaticSurface {
  return {
    image,
    width: 4,
    height: 3,
    inflatePath: "pure",
    close() {}
  };
}

function backingWriteFixture(): {
  readonly canvas: HTMLCanvasElement;
  readonly widthWrites: number[];
  readonly heightWrites: number[];
  readonly draws: () => number;
} {
  let width = 0;
  let height = 0;
  let draws = 0;
  const widthWrites: number[] = [];
  const heightWrites: number[] = [];
  const context = {
    clearRect() {},
    drawImage() {
      draws += 1;
    }
  } as unknown as CanvasRenderingContext2D;
  const canvas = {
    get width() {
      return width;
    },
    set width(value: number) {
      widthWrites.push(value);
      width = value;
    },
    get height() {
      return height;
    },
    set height(value: number) {
      heightWrites.push(value);
      height = value;
    },
    getContext() {
      return context;
    }
  } as unknown as HTMLCanvasElement;
  return {
    canvas,
    widthWrites,
    heightWrites,
    draws: () => draws
  };
}
