import type { CompiledManifestV01 } from "@rendered-motion/format";

import type { RuntimeAssetCatalog } from "./asset-catalog.js";
import {
  checkedByteNumber,
  checkedByteProduct,
  checkedRgbaBytes
} from "./checked-runtime-bytes.js";
import {
  StaticSurfaceStoreDisposedError,
  StaticSurfaceUnavailableError
} from "./static-surface-errors.js";

export { BrowserStaticCanvasPlane } from "./browser-static-canvas-plane.js";
export {
  StaticSurfaceStoreDisposedError,
  StaticSurfaceUnavailableError
} from "./static-surface-errors.js";

export {
  BrowserStaticSurfaceDecoder,
  StaticSurfaceDecodeTimeoutError
} from "./strict-static-decoder.js";
export type {
  BrowserDecodedStaticSurface,
  BrowserStaticSurfaceDecoderOptions,
  BrowserStaticSurfaceDecoderSnapshot,
  BrowserStaticSurfaceTimerHost,
  StaticPngInflatePath
} from "./strict-static-decoder.js";

export interface StaticSurfaceCatalogView {
  readonly manifest: Readonly<CompiledManifestV01>;
  copyStaticPng(staticFrame: string): Uint8Array;
}

export interface DecodedStaticSurface {
  readonly width: number;
  readonly height: number;
  close(): void;
}

export interface StaticSurfaceDecodeOptions {
  readonly signal: AbortSignal;
  readonly expectedWidth: number;
  readonly expectedHeight: number;
}

export interface StaticSurfaceDecoder<
  TSurface extends DecodedStaticSurface = DecodedStaticSurface
> {
  decode(
    png: Uint8Array,
    options: StaticSurfaceDecodeOptions
  ): Promise<TSurface>;
  snapshot?(): Readonly<StaticSurfaceDecodeSnapshot>;
}

export interface StaticSurfaceDecodeSnapshot {
  readonly nativeAttempts: number;
  readonly nativeSuccesses: number;
  readonly pureAttempts: number;
  readonly pureSuccesses: number;
  readonly errors: number;
  readonly peakPngCopyBytes: number;
  readonly peakZlibBytes: number;
  readonly peakFilteredBytes: number;
  readonly peakRgbaBytes: number;
  readonly bitmapCloses: number;
}

/** The host owns layering; present() must draw and cover atomically. */
export interface StaticPresentationPlane<
  TSurface extends DecodedStaticSurface = DecodedStaticSurface
> {
  present(
    surface: TSurface,
    width: number,
    height: number,
    options?: { readonly cover?: boolean }
  ): void;
  coverStatic(): void;
  revealAnimated(): void;
  dispose?(): void;
}

export interface StaticSurfacePresentationReport {
  readonly state: string;
  readonly staticFrame: string;
  readonly redecoded: boolean;
  readonly rgbaBytes: number;
}

export interface StaticSurfaceValidationReport {
  readonly uniqueStaticFrames: number;
  readonly newlyValidated: number;
  readonly validatedRgbaBytes: number;
}

export interface StaticSurfaceStoreSnapshot {
  readonly state: "active" | "disposed";
  readonly currentState: string | null;
  readonly currentStaticFrame: string | null;
  readonly incomingStaticFrame: string | null;
  readonly retainedSurfaces: number;
  readonly peakRetainedSurfaces: number;
  readonly retainedRgbaBytes: number;
  readonly peakRetainedRgbaBytes: number;
  readonly validatedStaticFrames: number;
  readonly validatedRgbaBytes: number;
  readonly decodedSurfaces: number;
  readonly closedSurfaces: number;
  readonly presentations: number;
  readonly errors: number;
  readonly decode: Readonly<StaticSurfaceDecodeSnapshot> | null;
}

interface RetainedSurface<TSurface extends DecodedStaticSurface> {
  readonly staticFrame: string;
  readonly surface: TSurface;
}

export class StaticSurfaceStore<
  TSurface extends DecodedStaticSurface = DecodedStaticSurface
> {
  readonly #catalog: StaticSurfaceCatalogView;
  readonly #decoder: StaticSurfaceDecoder<TSurface>;
  readonly #plane: StaticPresentationPlane<TSurface>;
  readonly #width: number;
  readonly #height: number;
  readonly #surfaceBytes: number;
  readonly #maximumRetainedBytes: number;
  readonly #allValidatedBytes: number;
  readonly #staticByState: ReadonlyMap<string, string>;
  readonly #referencedStaticIds: readonly string[];
  readonly #validated = new Set<string>();
  readonly #ownedSurfaces = new WeakSet<object>();
  readonly #closedSurfaces = new WeakSet<object>();
  readonly #surfaceClosers = new WeakMap<object, () => unknown>();
  readonly #controllers = new Set<AbortController>();

  #current: RetainedSurface<TSurface> | null = null;
  #incoming: RetainedSurface<TSurface> | null = null;
  #currentState: string | null = null;
  #tail: Promise<void> = Promise.resolve();
  #activePresentController: AbortController | null = null;
  #latestPresentation = 0;
  #disposed = false;
  #peakRetainedSurfaces = 0;
  #decodedSurfaceCount = 0;
  #closedSurfaceCount = 0;
  #presentationCount = 0;
  #errors = 0;

  public constructor(
    catalog: StaticSurfaceCatalogView,
    decoder: StaticSurfaceDecoder<TSurface>,
    plane: StaticPresentationPlane<TSurface>
  ) {
    validateObject(catalog, "static surface catalog");
    validateObject(decoder, "static surface decoder");
    validateObject(plane, "static presentation plane");
    const manifest = catalog.manifest;
    this.#width = manifest.canvas.width;
    this.#height = manifest.canvas.height;
    this.#surfaceBytes = checkedByteNumber(
      checkedRgbaBytes(this.#width, this.#height, 1, "static surface bytes"),
      "static surface bytes"
    );
    this.#staticByState = new Map(
      manifest.states.map(({ id, staticFrame }) => [id, staticFrame])
    );
    this.#referencedStaticIds = Object.freeze(
      [...new Set(manifest.states.map(({ staticFrame }) => staticFrame))].sort()
    );
    this.#maximumRetainedBytes = checkedStaticByteCount(
      2,
      this.#surfaceBytes,
      "two-surface static peak"
    );
    this.#allValidatedBytes = checkedStaticByteCount(
      this.#referencedStaticIds.length,
      this.#surfaceBytes,
      "validated static bytes"
    );
    this.#catalog = catalog;
    this.#decoder = decoder;
    this.#plane = plane;
  }

  public installInitial(options: {
    readonly state?: string;
    readonly signal?: AbortSignal;
  } = {}): Promise<Readonly<StaticSurfacePresentationReport>> {
    const state = options.state ?? this.#catalog.manifest.initialState;
    return this.presentState(state, options);
  }

  public presentState(
    state: string,
    options: {
      readonly signal?: AbortSignal;
      readonly cover?: boolean;
    } = {}
  ): Promise<Readonly<StaticSurfacePresentationReport>> {
    this.#assertActive();
    const staticFrame = this.#staticByState.get(state);
    if (staticFrame === undefined) {
      throw new RangeError(`static presentation state ${state} is unknown`);
    }
    const generation = checkedCounterIncrement(
      this.#latestPresentation,
      "static presentation generation",
      Number.MAX_SAFE_INTEGER - 1
    );
    this.#latestPresentation = generation;
    this.#activePresentController?.abort(supersededError());
    const controller = new AbortController();
    this.#activePresentController = controller;
    const operation = this.#enqueue(
      controller,
      options.signal,
      async () => this.#present(
        state,
        staticFrame,
        generation,
        controller.signal,
        options.cover !== false
      )
    );
    void operation.finally(() => {
      if (this.#activePresentController === controller) {
        this.#activePresentController = null;
      }
    }).catch(() => undefined);
    return operation;
  }

  /** Sequentially probes every unique referenced static and closes each probe. */
  public validateAll(options: {
    readonly signal?: AbortSignal;
  } = {}): Promise<Readonly<StaticSurfaceValidationReport>> {
    this.#assertActive();
    const controller = new AbortController();
    return this.#enqueue(controller, options.signal, async () => {
      let newlyValidated = 0;
      for (const staticFrame of this.#referencedStaticIds) {
        throwIfAborted(controller.signal);
        if (this.#validated.has(staticFrame)) continue;
        const surface = await this.#decode(staticFrame, controller.signal);
        this.#incoming = { staticFrame, surface };
        this.#trackPeak();
        try {
          const nextNewlyValidated = checkedCounterIncrement(
            newlyValidated,
            "newly validated static surfaces"
          );
          this.#validated.add(staticFrame);
          newlyValidated = nextNewlyValidated;
        } finally {
          this.#incoming = null;
          this.#close(surface);
        }
      }
      return Object.freeze({
        uniqueStaticFrames: this.#referencedStaticIds.length,
        newlyValidated,
        validatedRgbaBytes: checkedStaticByteCount(
          this.#validated.size,
          this.#surfaceBytes,
          "validated static bytes"
        )
      });
    });
  }

  /** Cover animation with the retained static pixels without touching WebGL. */
  public coverCurrent(): void {
    this.#assertActive();
    if (this.#current === null) {
      throw new StaticSurfaceUnavailableError("no current static surface");
    }
    this.#plane.coverStatic();
  }

  public revealAnimated(): void {
    this.#assertActive();
    this.#plane.revealAnimated();
  }

  public currentState(): string | null {
    return this.#currentState;
  }

  public snapshot(): Readonly<StaticSurfaceStoreSnapshot> {
    const retained = Number(this.#current !== null) + Number(this.#incoming !== null);
    return Object.freeze({
      state: this.#disposed ? "disposed" : "active",
      currentState: this.#currentState,
      currentStaticFrame: this.#current?.staticFrame ?? null,
      incomingStaticFrame: this.#incoming?.staticFrame ?? null,
      retainedSurfaces: retained,
      peakRetainedSurfaces: this.#peakRetainedSurfaces,
      retainedRgbaBytes: retained === 2
        ? this.#maximumRetainedBytes
        : retained * this.#surfaceBytes,
      peakRetainedRgbaBytes: this.#peakRetainedSurfaces === 2
        ? this.#maximumRetainedBytes
        : this.#peakRetainedSurfaces * this.#surfaceBytes,
      validatedStaticFrames: this.#validated.size,
      validatedRgbaBytes: this.#validated.size === this.#referencedStaticIds.length
        ? this.#allValidatedBytes
        : checkedStaticByteCount(
            this.#validated.size,
            this.#surfaceBytes,
            "validated static bytes"
          ),
      decodedSurfaces: this.#decodedSurfaceCount,
      closedSurfaces: this.#closedSurfaceCount,
      presentations: this.#presentationCount,
      errors: this.#errors,
      decode: cloneStaticDecodeSnapshot(this.#decoder.snapshot?.())
    });
  }

  public async settled(): Promise<void> {
    await this.#tail;
  }

  public dispose(): void {
    if (this.#disposed) return;
    const terminalGeneration = checkedCounterIncrement(
      this.#latestPresentation,
      "static presentation generation"
    );
    this.#disposed = true;
    this.#latestPresentation = terminalGeneration;
    for (const controller of this.#controllers) {
      controller.abort(disposedError());
    }
    this.#controllers.clear();
    this.#activePresentController = null;
    if (this.#incoming !== null) {
      this.#close(this.#incoming.surface);
      this.#incoming = null;
    }
    if (this.#current !== null) {
      this.#close(this.#current.surface);
      this.#current = null;
    }
    this.#currentState = null;
    try {
      this.#plane.dispose?.();
    } catch {
      this.#errors = checkedCounterIncrement(
        this.#errors,
        "static surface errors"
      );
    }
  }

  async #present(
    state: string,
    staticFrame: string,
    generation: number,
    signal: AbortSignal,
    cover: boolean
  ): Promise<Readonly<StaticSurfacePresentationReport>> {
    throwIfAborted(signal);
    this.#assertActive();
    this.#assertLatest(generation);
    if (this.#current?.staticFrame === staticFrame) {
      const presentationCount = checkedCounterIncrement(
        this.#presentationCount,
        "static surface presentations"
      );
      if (cover) {
        this.#plane.coverStatic();
        throwIfAborted(signal);
        this.#assertActive();
        this.#assertLatest(generation);
      }
      this.#currentState = state;
      this.#presentationCount = presentationCount;
      return Object.freeze({
        state,
        staticFrame,
        redecoded: false,
        rgbaBytes: this.#surfaceBytes
      });
    }

    const surface = await this.#decode(staticFrame, signal);
    this.#incoming = { staticFrame, surface };
    this.#trackPeak();
    try {
      throwIfAborted(signal);
      this.#assertActive();
      this.#assertLatest(generation);
      const presentationCount = checkedCounterIncrement(
        this.#presentationCount,
        "static surface presentations"
      );
      try {
        this.#plane.present(
          surface,
          this.#width,
          this.#height,
          Object.freeze({ cover })
        );
      } catch (error) {
        if (error instanceof StaticSurfaceStoreDisposedError) this.dispose();
        throw error;
      }
      const previous = this.#current;
      try {
        throwIfAborted(signal);
        this.#assertActive();
        this.#assertLatest(generation);
      } catch (error) {
        // Disposal already closed and detached both retained slots. A hostile
        // plane that returns after reentering disposal must not let this outer
        // presentation resurrect terminal accounting as a provisional first
        // surface.
        if (this.#disposed) throw error;
        if (previous === null) {
          // The first successful draw is the only coherent rollback surface.
          // Retain it provisionally while the already-queued newest request
          // replaces it, so the plane never points at a closed image.
          this.#current = this.#incoming;
          this.#incoming = null;
          this.#currentState = state;
          this.#validated.add(staticFrame);
          this.#presentationCount = presentationCount;
        } else {
          this.#restoreAfterStalePresentation(previous, cover);
        }
        throw error;
      }
      this.#current = this.#incoming;
      this.#incoming = null;
      this.#currentState = state;
      this.#validated.add(staticFrame);
      this.#presentationCount = presentationCount;
      if (previous !== null) this.#close(previous.surface);
      return Object.freeze({
        state,
        staticFrame,
        redecoded: true,
        rgbaBytes: this.#surfaceBytes
      });
    } finally {
      if (this.#incoming?.surface === surface) {
        this.#incoming = null;
        this.#close(surface);
      }
    }
  }

  async #decode(staticFrame: string, signal: AbortSignal): Promise<TSurface> {
    throwIfAborted(signal);
    this.#assertActive();
    const decodedSurfaceCount = checkedCounterIncrement(
      this.#decodedSurfaceCount,
      "decoded static surfaces"
    );
    const png = this.#catalog.copyStaticPng(staticFrame);
    let surface: TSurface;
    try {
      surface = await this.#decoder.decode(png, {
        signal,
        expectedWidth: this.#width,
        expectedHeight: this.#height
      });
    } catch (error) {
      if (signal.aborted) throw abortReason(signal);
      throw error;
    }
    this.#decodedSurfaceCount = decodedSurfaceCount;
    if (surface === null || typeof surface !== "object") {
      throw new StaticSurfaceUnavailableError("decoder returned no surface");
    }
    if (this.#ownedSurfaces.has(surface)) {
      throw new StaticSurfaceUnavailableError("decoder reused a surface identity");
    }
    this.#ownedSurfaces.add(surface);
    let width: unknown;
    let height: unknown;
    let close: unknown;
    try {
      // Capture the closer once before touching other hostile accessors so a
      // malformed surface can still be retired without re-reading its shape.
      close = Reflect.get(surface, "close");
      width = Reflect.get(surface, "width");
      height = Reflect.get(surface, "height");
    } catch {
      this.#closeUnknown(surface, close);
      throw new StaticSurfaceUnavailableError(
        "decoded static surface is invalid"
      );
    }
    if (typeof close === "function") {
      this.#surfaceClosers.set(
        surface,
        () => Reflect.apply(close as (...args: never[]) => unknown, surface, [])
      );
    }
    if (
      width !== this.#width ||
      height !== this.#height ||
      typeof close !== "function"
    ) {
      this.#closeUnknown(surface, close);
      throw new StaticSurfaceUnavailableError(
        "decoded static surface dimensions do not match the logical canvas"
      );
    }
    if (signal.aborted || this.#disposed) {
      this.#close(surface);
      throw signal.aborted ? abortReason(signal) : disposedError();
    }
    return surface;
  }

  #enqueue<TResult>(
    controller: AbortController,
    callerSignal: AbortSignal | undefined,
    operation: () => Promise<TResult>
  ): Promise<TResult> {
    const unlink = forwardAbort(callerSignal, controller);
    this.#controllers.add(controller);
    const result = this.#tail.then(async () => {
      throwIfAborted(controller.signal);
      this.#assertActive();
      try {
        return await operation();
      } catch (error) {
        if (!isAbortError(error) && !this.#disposed) {
          this.#errors = checkedCounterIncrement(
            this.#errors,
            "static surface errors"
          );
        }
        throw error;
      }
    });
    this.#tail = result.then(() => undefined, () => undefined);
    void result.finally(() => {
      unlink();
      this.#controllers.delete(controller);
    }).catch(() => undefined);
    return result;
  }

  #assertLatest(generation: number): void {
    if (generation !== this.#latestPresentation) throw supersededError();
  }

  #trackPeak(): void {
    const retained = Number(this.#current !== null) + Number(this.#incoming !== null);
    this.#peakRetainedSurfaces = Math.max(this.#peakRetainedSurfaces, retained);
    if (retained > 2) {
      throw new Error("static surface store exceeded the two-surface bound");
    }
  }

  #restoreAfterStalePresentation(
    previous: RetainedSurface<TSurface>,
    cover: boolean
  ): void {
    try {
      this.#plane.present(
        previous.surface,
        this.#width,
        this.#height,
        Object.freeze({ cover })
      );
    } catch {
      this.dispose();
      throw new StaticSurfaceUnavailableError(
        "static presentation rollback failed"
      );
    }
  }

  #close(surface: TSurface): void {
    this.#closeUnknown(surface, this.#surfaceClosers.get(surface));
  }

  #closeUnknown(surface: object, capturedClose: unknown): void {
    if (this.#closedSurfaces.has(surface)) return;
    const closedSurfaceCount = checkedCounterIncrement(
      this.#closedSurfaceCount,
      "closed static surfaces"
    );
    this.#closedSurfaces.add(surface);
    this.#closedSurfaceCount = closedSurfaceCount;
    try {
      if (typeof capturedClose === "function") {
        Reflect.apply(
          capturedClose as (...args: never[]) => unknown,
          surface,
          []
        );
      }
    } catch {
      this.#errors = checkedCounterIncrement(
        this.#errors,
        "static surface errors"
      );
    }
  }

  #assertActive(): void {
    if (this.#disposed) throw disposedError();
  }
}

function cloneStaticDecodeSnapshot(
  value: Readonly<StaticSurfaceDecodeSnapshot> | undefined
): Readonly<StaticSurfaceDecodeSnapshot> | null {
  if (value === undefined) return null;
  const keys = [
    "nativeAttempts",
    "nativeSuccesses",
    "pureAttempts",
    "pureSuccesses",
    "errors",
    "peakPngCopyBytes",
    "peakZlibBytes",
    "peakFilteredBytes",
    "peakRgbaBytes",
    "bitmapCloses"
  ] as const;
  const result = {} as Record<(typeof keys)[number], number>;
  for (const key of keys) {
    const field = value[key];
    if (!Number.isSafeInteger(field) || field < 0) {
      throw new RangeError(`static decoder snapshot ${key} is invalid`);
    }
    result[key] = field;
  }
  return Object.freeze(result);
}


/** Live catalog satisfies the narrow store dependency without an adapter. */
export function asStaticSurfaceCatalog(
  catalog: RuntimeAssetCatalog
): StaticSurfaceCatalogView {
  return catalog;
}

function forwardAbort(
  source: AbortSignal | undefined,
  target: AbortController
): () => void {
  if (source === undefined) return () => undefined;
  const abort = (): void => target.abort(abortReason(source));
  if (source.aborted) abort();
  else source.addEventListener("abort", abort, { once: true });
  return () => source.removeEventListener("abort", abort);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortReason(signal);
}

function abortReason(signal: AbortSignal): DOMException {
  return isAbortError(signal.reason)
    ? signal.reason as DOMException
    : new DOMException("static surface operation aborted", "AbortError");
}

function supersededError(): DOMException {
  return new DOMException("static presentation superseded", "AbortError");
}

function disposedError(): StaticSurfaceStoreDisposedError {
  return new StaticSurfaceStoreDisposedError();
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function validateObject(value: unknown, label: string): void {
  if (value === null || typeof value !== "object") {
    throw new TypeError(`${label} must be an object`);
  }
}

function checkedCounterIncrement(
  value: number,
  label: string,
  maximum = Number.MAX_SAFE_INTEGER
): number {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    !Number.isSafeInteger(maximum) ||
    maximum < 1 ||
    value >= maximum
  ) {
    throw new RangeError(`${label} exceeds safe-integer range`);
  }
  return value + 1;
}

function checkedStaticByteCount(
  surfaces: number,
  surfaceBytes: number,
  label: string
): number {
  return checkedByteNumber(
    checkedByteProduct([surfaces, surfaceBytes], label),
    label
  );
}
