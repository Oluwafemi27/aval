import { sameAspectRatio } from "./media-geometry.js";
import {
  createRendererFailureDiagnostic,
  RendererFailureError,
  type RendererDiagnosticContextAttributes,
  type RendererDiagnosticOperation,
  type RendererDiagnosticPhase,
  type RendererDiagnosticUploadPath,
  type RendererFailureDiagnostic
} from "./renderer-diagnostics.js";

export interface RenderLayout {
  readonly codedWidth: number;
  readonly codedHeight: number;
  readonly storageWidth: number;
  readonly storageHeight: number;
  readonly logicalWidth: number;
  readonly logicalHeight: number;
  readonly pixelAspect: readonly [number, number];
  readonly colorRect: readonly [number, number, number, number];
  readonly alphaRect?: readonly [number, number, number, number];
}

export interface RendererLimits {
  readonly maxTextureBytes?: number;
  readonly maxBackingBytes?: number;
  readonly maxRuntimeBytes?: number;
  readonly copyTimeoutMs?: number;
  readonly setTimeout?: (callback: () => void, delay: number) => number;
  readonly clearTimeout?: (handle: number) => void;
  readonly createImageBitmap?: (
    frame: VideoFrame,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    options: ImageBitmapOptions
  ) => Promise<ImageBitmap>;
  readonly onContextChange?: (change: Readonly<RendererContextChange>) => void;
  readonly initialPresentation?: Readonly<{
    width: number;
    height: number;
    dpr: number;
    fit: string;
  }>;
}

export type RendererContextChange =
  | Readonly<{ state: "lost"; error: null }>
  | Readonly<{ state: "restored"; error: null }>
  | Readonly<{ state: "error"; error: RendererFailureError }>;

export type RendererUploadMode = "native-probing" | "native" | "rgba-copy";

export interface RendererSnapshot {
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly backingWidth: number;
  readonly backingHeight: number;
  readonly effectiveDprX: number;
  readonly effectiveDprY: number;
  readonly contextLossCount: number;
  readonly contextRecoveryCount: number;
  readonly stagingBytes: number;
  readonly residentBytes: number;
  readonly textureBytes: number;
  readonly runtimeBytes: number;
  readonly pendingOperations: number;
  readonly sourceCopiesInFlight: number;
  readonly uploadMode: RendererUploadMode;
  readonly nativeProbeAttempts: number;
  readonly probeReadbackBytes: number;
  readonly nativeProbeInFlight: boolean;
  readonly resourceCount: number;
  readonly contextListenerCount: number;
  readonly failure: Readonly<RendererFailureDiagnostic> | null;
}

type State = "active" | "lost" | "error" | "disposed";
// The manifest and caller own admission policy. Keep the renderer default at
// the runtime's exact-arithmetic boundary instead of inventing a 64 MiB cap.
const HARD_BYTES = Number.MAX_SAFE_INTEGER;
const COPY_TIMEOUT = 5_000;
const STREAMS = 3;
const NATIVE_PROBE_EDGE = 8;
const NATIVE_PROBE_PIXELS = NATIVE_PROBE_EDGE * NATIVE_PROBE_EDGE;
const NATIVE_PROBE_BYTES = NATIVE_PROBE_PIXELS * 4;
const NATIVE_PROBE_ACCOUNTED_BYTES = NATIVE_PROBE_BYTES * 2;
const MAX_NATIVE_PROBE_ATTEMPTS = 3;
const ID = /^[a-z][a-z0-9._-]{0,63}$/;

export class Renderer {
  readonly #canvas: HTMLCanvasElement;
  readonly #layout: Readonly<RenderLayout>;
  readonly #lost: (event: Event) => void;
  readonly #restored: () => void;
  readonly #textureBytesPerFrame: number;
  readonly #storageBytesPerFrame: number;
  readonly #maxTextureBytes: number;
  readonly #maxBackingBytes: number;
  readonly #maxRuntimeBytes: number;
  readonly #copyTimeoutMs: number;
  readonly #setTimeout: (callback: () => void, delay: number) => number;
  readonly #clearTimeout: (handle: number) => void;
  readonly #createImageBitmap: ((
    frame: VideoFrame,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    options: ImageBitmapOptions
  ) => Promise<ImageBitmap>) | null;
  readonly #onContextChange:
    ((change: Readonly<RendererContextChange>) => void) | undefined;
  readonly #resident = new Map<string, WebGLTexture>();
  readonly #reserved = new Set<string>();
  #staging: Uint8Array;
  #gl: WebGL2RenderingContext | null = null;
  #program: WebGLProgram | null = null;
  #streams: WebGLTexture[] = [];
  #nextStream = 0;
  #last: string | number | null = null;
  #state: State = "active";
  #tail: Promise<void> = Promise.resolve();
  #pending = 0;
  // 0 = copyTo fallback, 1 = native upload needs probing, 2 = native proven.
  #native = 1;
  #nativeProbeAttempts = 0;
  #nativeProbeInFlight = false;
  #nativeProbeReadback = new Uint8Array(0);
  #referenceProbeReadback = new Uint8Array(0);
  #resizeQueued = false;
  #fit = "contain";
  #cssWidth = 0;
  #cssHeight = 0;
  #dpr = 1;
  #maxTextureSize = 0;
  #maxViewportWidth = 0;
  #maxViewportHeight = 0;
  #maxResidentTextures = 0;
  #losses = 0;
  #recoveries = 0;
  #sourceCopiesInFlight = 0;
  #operationSequence = 0;
  #initializingTextureCount = 0;
  #failureError: RendererFailureError | null = null;
  #contextAttributes: Readonly<RendererDiagnosticContextAttributes> | null = null;
  #vendor: string | null = null;
  #rendererName: string | null = null;

  public constructor(
    canvas: HTMLCanvasElement,
    layout: Readonly<RenderLayout>,
    limits: Readonly<RendererLimits> = {}
  ) {
    this.#canvas = canvas;
    this.#layout = checkedLayout(layout);
    this.#textureBytesPerFrame = rgbaBytes(
      this.#layout.codedWidth,
      this.#layout.codedHeight
    );
    this.#storageBytesPerFrame = rgbaBytes(
      this.#layout.storageWidth,
      this.#layout.storageHeight
    );
    this.#maxTextureBytes = cap(limits.maxTextureBytes, "texture byte cap");
    this.#maxBackingBytes = cap(limits.maxBackingBytes, "backing byte cap");
    this.#maxRuntimeBytes = cap(limits.maxRuntimeBytes, "runtime byte cap");
    this.#copyTimeoutMs = limits.copyTimeoutMs ?? COPY_TIMEOUT;
    this.#setTimeout = limits.setTimeout ?? ((callback, delay) =>
      globalThis.setTimeout(callback, delay) as unknown as number);
    this.#clearTimeout = limits.clearTimeout ?? ((handle) => globalThis.clearTimeout(handle));
    this.#createImageBitmap = limits.createImageBitmap ??
      defaultImageBitmapFactory();
    this.#onContextChange = limits.onContextChange;
    if (
      !Number.isSafeInteger(this.#copyTimeoutMs) ||
      this.#copyTimeoutMs < 1 ||
      this.#copyTimeoutMs > 60_000
    ) throw new RangeError("renderer copy timeout is invalid");
    this.#staging = new Uint8Array(0);
    this.#lost = (event) => {
      event.preventDefault();
      this.#markLost();
    };
    this.#restored = () => this.#queueRestore();
    const initial = limits.initialPresentation;
    let width = canvas.width;
    let height = canvas.height;
    if (initial !== undefined) {
      if (!Number.isFinite(initial.width) || initial.width < 0 ||
        !Number.isFinite(initial.height) || initial.height < 0 ||
        !Number.isFinite(initial.dpr) || initial.dpr <= 0 ||
        !["contain", "cover", "fill", "none"].includes(initial.fit)) {
        throw new RangeError("renderer presentation geometry is invalid");
      }
      width = Math.max(1, Math.round(initial.width * initial.dpr));
      height = Math.max(1, Math.round(initial.height * initial.dpr));
      if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
        throw new RangeError("renderer backing dimensions are invalid");
      }
    }
    const oldWidth = canvas.width;
    const oldHeight = canvas.height;
    const operationOrdinal = this.#beginOperation();
    try {
      if (initial !== undefined) {
        try {
          canvas.width = width;
          canvas.height = height;
          if (canvas.width !== width || canvas.height !== height) {
            throw new Error("canvas rejected its exact backing dimensions");
          }
        } catch (reason) {
          throw this.#failure(
            "backing-admission",
            "construct",
            operationOrdinal,
            reason
          );
        }
        this.#cssWidth = Math.max(1, initial.width);
        this.#cssHeight = Math.max(1, initial.height);
        this.#dpr = initial.dpr;
        this.#fit = initial.fit;
      }
      this.#assertBudget(0, this.#backingBytes(canvas.width, canvas.height));
      this.#staging = new Uint8Array(this.#storageBytesPerFrame);
      canvas.addEventListener("webglcontextlost", this.#lost);
      canvas.addEventListener("webglcontextrestored", this.#restored);
      this.#initialize("construct", operationOrdinal);
    } catch (error) {
      canvas.removeEventListener("webglcontextlost", this.#lost);
      canvas.removeEventListener("webglcontextrestored", this.#restored);
      this.#destroy();
      this.#state = "error";
      this.#staging = new Uint8Array(0);
      this.#releaseNativeProbe();
      try {
        canvas.width = oldWidth;
        canvas.height = oldHeight;
      } catch { /* The constructor remains terminal. */ }
      throw error;
    }
  }

  public resize(
    cssWidth: number,
    cssHeight: number,
    devicePixelRatio: number,
    fit: string
  ): void {
    if (this.#state === "disposed") return;
    if (this.#state === "error") throw unavailable();
    if (
      !Number.isFinite(cssWidth) || cssWidth < 0 ||
      !Number.isFinite(cssHeight) || cssHeight < 0 ||
      !Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0 ||
      !["contain", "cover", "fill", "none"].includes(fit)
    ) throw new RangeError("renderer presentation geometry is invalid");
    const dpr = Math.max(0.1, devicePixelRatio);
    const width = Math.max(1, Math.round(cssWidth * dpr));
    const height = Math.max(1, Math.round(cssHeight * dpr));
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
      throw new RangeError("renderer backing dimensions are invalid");
    }
    const operationOrdinal = this.#beginOperation();
    if (
      width > this.#maxTextureSize || height > this.#maxTextureSize ||
      width > this.#maxViewportWidth || height > this.#maxViewportHeight
    ) {
      const error = this.#failure(
        "resize",
        "runtime",
        operationOrdinal,
        new Error("renderer backing dimensions exceed device limits"),
        { contextLost: this.#gl === null ? false : contextLost(this.#gl) }
      );
      this.#terminal(error);
      throw error;
    }
    const backingBytes = this.#backingBytes(width, height);
    this.#assertBudget(this.#resident.size + this.#reserved.size, backingBytes);
    const oldWidth = this.#canvas.width;
    const oldHeight = this.#canvas.height;
    try {
      if (oldWidth !== width) this.#canvas.width = width;
      if (oldHeight !== height) this.#canvas.height = height;
      if (this.#canvas.width !== width || this.#canvas.height !== height) {
        throw new Error("canvas rejected its exact backing dimensions");
      }
    } catch (reason) {
      try {
        this.#canvas.width = oldWidth;
        this.#canvas.height = oldHeight;
      } catch { /* terminalized below */ }
      const error = this.#failure(
        "resize",
        "runtime",
        operationOrdinal,
        reason
      );
      this.#terminal(error);
      throw error;
    }
    this.#cssWidth = Math.max(1, cssWidth);
    this.#cssHeight = Math.max(1, cssHeight);
    this.#dpr = dpr;
    this.#fit = fit;
    if (this.#last !== null && !this.#resizeQueued) {
      this.#resizeQueued = true;
      void this.#enqueue(() => {
        if (this.#state === "active") {
          this.#drawLast("runtime", this.#beginOperation());
        }
      }).catch(() => undefined).finally(() => {
        this.#resizeQueued = false;
      });
    }
  }

  public draw(frame: VideoFrame): Promise<void> {
    return this.#enqueue(async () => {
      if (this.#state === "lost") {
        this.#last = null;
        throw unavailable();
      }
      const operationOrdinal = this.#beginOperation();
      const slot = this.#nextStream;
      const texture = this.#streams[slot];
      if (texture === undefined) throw unavailable();
      if (!await this.#uploadFrame(texture, frame, operationOrdinal)) {
        this.#last = null;
        throw unavailable();
      }
      this.#render(texture, "runtime", operationOrdinal);
      if (this.#state !== "active") throw unavailable();
      this.#last = slot;
      this.#nextStream = (slot + 1) % STREAMS;
    });
  }

  public store(group: string, index: number, frame: VideoFrame): Promise<void> {
    const key = residentKey(group, index);
    if (this.#resident.has(key) || this.#reserved.has(key)) {
      throw new Error("resident frame already exists");
    }
    this.#assertBudget(
      this.#resident.size + this.#reserved.size + 1,
      this.#backingBytes(this.#canvas.width, this.#canvas.height)
    );
    this.#reserved.add(key);
    return this.#enqueue(async () => {
      const operationOrdinal = this.#beginOperation();
      let rect: DOMRectReadOnly;
      try { rect = validateFrame(frame, this.#layout); }
      catch (reason) {
        throw this.#failure(
          "semantic-upload",
          "runtime",
          operationOrdinal,
          reason
        );
      }
      const source = await this.#materialize(frame, rect, operationOrdinal);
      try {
        if (this.#state === "disposed" || this.#state === "error") {
          throw unavailable();
        }
        if (this.#state !== "active") throw unavailable();
        const gl = this.#gl;
        if (gl === null) throw unavailable();
        let texture: WebGLTexture;
        try { texture = this.#createTexture(gl); }
        catch (reason) {
          throw this.#failure(
            "resident-texture-create",
            "runtime",
            operationOrdinal,
            reason,
            {
              glError: capturedGlError(reason, gl),
              contextLost: contextLost(gl),
              uploadPath: "rgba-copy"
            }
          );
        }
        if (contextLost(gl)) {
          throw this.#failure(
            "resident-texture-create",
            "runtime",
            operationOrdinal,
            new Error("WebGL context was lost during resident texture creation"),
            { contextLost: true, uploadPath: "rgba-copy" }
          );
        }
        try { this.#uploadSource(gl, texture, source); }
        catch (reason) {
          const glError = capturedGlError(reason, gl);
          try { gl.deleteTexture(texture); } catch { /* preserve upload cause */ }
          throw this.#failure(
            "rgba-upload",
            "runtime",
            operationOrdinal,
            reason,
            {
              glError,
              contextLost: contextLost(gl),
              uploadPath: "rgba-copy"
            }
          );
        }
        if (contextLost(gl)) {
          try { gl.deleteTexture(texture); } catch { /* preserve context-loss cause */ }
          throw this.#failure(
            "rgba-upload",
            "runtime",
            operationOrdinal,
            new Error("WebGL context was lost during resident RGBA upload"),
            { contextLost: true, uploadPath: "rgba-copy" }
          );
        }
        this.#resident.set(key, texture);
      } finally {
        releaseSource(source);
      }
    }).finally(() => {
      this.#reserved.delete(key);
    });
  }

  public drawStored(group: string, index: number): Promise<void> {
    const key = residentKey(group, index);
    if (!this.#resident.has(key)) {
      throw new Error("resident frame is unavailable");
    }
    return this.#enqueue(() => {
      if (this.#state === "lost") throw unavailable();
      const operationOrdinal = this.#beginOperation();
      const texture = this.#resident.get(key);
      if (texture === undefined) throw unavailable();
      this.#render(texture, "runtime", operationOrdinal);
      if (this.#state !== "active") throw unavailable();
      this.#last = key;
    });
  }

  public settled(): Promise<void> {
    return this.#tail;
  }

  public admit(residentCount: number): Readonly<{
    textureBytes: number;
    runtimeBytes: number;
  }> {
    if (!Number.isSafeInteger(residentCount) || residentCount < 0) {
      throw new RangeError("resident texture count is invalid");
    }
    if (this.#state !== "active") throw unavailable();
    return this.#assertBudget(
      residentCount,
      this.#backingBytes(this.#canvas.width, this.#canvas.height)
    );
  }

  public snapshot(): Readonly<RendererSnapshot> {
    const backingBytes = this.#state === "disposed"
      ? 0 : this.#backingBytes(this.#canvas.width, this.#canvas.height);
    const residentCount = this.#resident.size;
    const textureBytes = this.#state === "active"
      ? allocationBytes(checkedProduct(
          this.#textureBytesPerFrame,
          residentCount + STREAMS
        ))
      : 0;
    const residentBytes = 0;
    return Object.freeze({
      cssWidth: this.#cssWidth,
      cssHeight: this.#cssHeight,
      backingWidth: this.#canvas.width,
      backingHeight: this.#canvas.height,
      effectiveDprX: this.#cssWidth > 0 ? this.#canvas.width / this.#cssWidth : 0,
      effectiveDprY: this.#cssHeight > 0 ? this.#canvas.height / this.#cssHeight : 0,
      contextLossCount: this.#losses,
      contextRecoveryCount: this.#recoveries,
      stagingBytes: this.#staging.byteLength,
      residentBytes,
      textureBytes,
      runtimeBytes: checkedSum([
        backingBytes,
        this.#staging.byteLength,
        this.#probeReadbackBytes(),
        residentBytes,
        textureBytes
      ]),
      pendingOperations: this.#pending,
      sourceCopiesInFlight: this.#sourceCopiesInFlight,
      uploadMode: nativeUploadMode(this.#native),
      nativeProbeAttempts: this.#nativeProbeAttempts,
      probeReadbackBytes: this.#probeReadbackBytes(),
      nativeProbeInFlight: this.#nativeProbeInFlight,
      resourceCount: Number(this.#program !== null) +
        this.#streams.length +
        this.#resident.size,
      contextListenerCount: this.#state === "disposed" ? 0 : 2,
      failure: this.#failureError?.diagnostic ?? null
    });
  }

  public dispose(): void {
    if (this.#state === "disposed") return;
    this.#state = "disposed";
    this.#canvas.removeEventListener("webglcontextlost", this.#lost);
    this.#canvas.removeEventListener("webglcontextrestored", this.#restored);
    this.#destroy();
    this.#resident.clear();
    this.#reserved.clear();
    this.#last = null;
    this.#staging = new Uint8Array(0);
    this.#releaseNativeProbe();
    try {
      this.#canvas.width = 0;
      this.#canvas.height = 0;
    } catch { /* terminal */ }
  }

  #enqueue<T>(task: () => T | Promise<T>): Promise<T> {
    if (this.#state === "disposed" || this.#state === "error") {
      return Promise.reject(unavailable());
    }
    this.#pending += 1;
    const job = this.#tail.then(async () => {
      if (this.#state === "disposed" || this.#state === "error") {
        throw unavailable();
      }
      try {
        return await task();
      } catch (reason) {
        if (this.#state !== "active" && isAbortError(reason)) throw reason;
        if (reason instanceof RendererArithmeticError) throw reason;
        const error = reason instanceof RendererFailureError
          ? reason
          : this.#failure(
              "context-event",
              "runtime",
              this.#beginOperation(),
              reason
            );
        if (this.#state === "active" || this.#state === "lost") {
          this.#terminal(error);
        }
        throw error;
      }
    }).finally(() => {
      this.#pending -= 1;
    });
    this.#tail = job.then(() => undefined, () => undefined);
    return job;
  }

  #queueRestore(): void {
    if (this.#state !== "lost") return;
    this.#pending += 1;
    const restore = this.#tail.then(() => {
      if (this.#state !== "lost") return;
      const operationOrdinal = this.#beginOperation();
      try {
        this.#initialize("restore", operationOrdinal);
        this.#state = "active";
        this.#recoveries += 1;
        this.#notify(Object.freeze({ state: "restored", error: null }));
        if (this.#last !== null) this.#drawLast("restore", operationOrdinal);
      } catch (reason) {
        const error = reason instanceof RendererFailureError
          ? reason
          : this.#failure(
              "context-event",
              "restore",
              operationOrdinal,
              reason
            );
        this.#terminal(error);
      }
    }).finally(() => {
      this.#pending -= 1;
    });
    this.#tail = restore.then(() => undefined, () => undefined);
  }

  #initialize(
    operation: RendererDiagnosticOperation,
    operationOrdinal: number
  ): void {
    this.#assertBudget(
      this.#resident.size,
      this.#backingBytes(this.#canvas.width, this.#canvas.height)
    );
    let gl: WebGL2RenderingContext | null = null;
    try {
      gl = this.#canvas.getContext("webgl2", {
        alpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        desynchronized: true,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false
      });
    } catch (reason) {
      throw this.#failure(
        "context-create",
        operation,
        operationOrdinal,
        reason
      );
    }
    if (gl === null || contextLost(gl)) {
      throw this.#failure(
        "context-create",
        operation,
        operationOrdinal,
        new Error("WebGL2 is unavailable"),
        { contextLost: gl === null ? false : contextLost(gl) }
      );
    }
    this.#contextAttributes = readContextAttributes(gl);
    const device = readDeviceIdentity(gl);
    this.#vendor = device.vendor;
    this.#rendererName = device.renderer;
    let maxTextureSize: number;
    let maxResidentTextures: number;
    let maxViewportWidth: number;
    let maxViewportHeight: number;
    try {
      maxTextureSize = positiveGl(gl.getParameter(gl.MAX_TEXTURE_SIZE));
      maxResidentTextures = Math.min(
        4096,
        positiveGl(gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS))
      );
      const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as
        ArrayLike<unknown> | null;
      maxViewportWidth = positiveGl(viewport?.[0]);
      maxViewportHeight = positiveGl(viewport?.[1]);
    } catch (reason) {
      throw this.#failure(
        "capability-query",
        operation,
        operationOrdinal,
        reason,
        { glError: readGlError(gl), contextLost: contextLost(gl) }
      );
    }
    this.#maxTextureSize = maxTextureSize;
    this.#maxViewportWidth = maxViewportWidth;
    this.#maxViewportHeight = maxViewportHeight;
    this.#maxResidentTextures = maxResidentTextures;
    if (
      this.#layout.codedWidth > maxTextureSize ||
      this.#layout.codedHeight > maxTextureSize ||
      this.#canvas.width > maxTextureSize ||
      this.#canvas.height > maxTextureSize ||
      this.#canvas.width > maxViewportWidth ||
      this.#canvas.height > maxViewportHeight
    ) {
      throw this.#failure(
        "device-limits",
        operation,
        operationOrdinal,
        new Error("renderer dimensions exceed WebGL limits"),
        { contextLost: contextLost(gl) }
      );
    }
    if (this.#resident.size > maxResidentTextures) {
      throw this.#failure(
        "device-limits",
        operation,
        operationOrdinal,
        new Error("resident texture count exceeds WebGL limits"),
        { contextLost: contextLost(gl) }
      );
    }
    let program: WebGLProgram | null = null;
    const streams: WebGLTexture[] = [];
    this.#initializingTextureCount = 0;
    try {
      try {
        program = createProgram(gl, this.#layout);
        const glError = readGlError(gl);
        if (glError !== null) {
          throw new RendererGlOperationError(
            "WebGL program creation failed",
            glError
          );
        }
      } catch (reason) {
        throw this.#failure(
          "program-create",
          operation,
          operationOrdinal,
          reason,
          {
            glError: capturedGlError(reason, gl),
            contextLost: contextLost(gl)
          }
        );
      }
      for (let index = 0; index < STREAMS; index += 1) {
        try {
          streams.push(this.#createTexture(gl));
          this.#initializingTextureCount = streams.length;
        } catch (reason) {
          throw this.#failure(
            "stream-texture-create",
            operation,
            operationOrdinal,
            reason,
            {
              glError: capturedGlError(reason, gl),
              contextLost: contextLost(gl),
              textureOrdinal: index
            }
          );
        }
      }
      gl.clearColor(0, 0, 0, 0);
      gl.disable(gl.BLEND);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      this.#gl = gl;
      this.#program = program;
      this.#streams = streams;
      this.#initializingTextureCount = 0;
      this.#nextStream = 0;
      this.#native = 1;
      this.#nativeProbeAttempts = 0;
      this.#nativeProbeInFlight = false;
      this.#nativeProbeReadback = new Uint8Array(NATIVE_PROBE_BYTES);
      this.#referenceProbeReadback = new Uint8Array(NATIVE_PROBE_BYTES);
    } catch (reason) {
      const error = reason instanceof RendererFailureError
        ? reason
        : this.#failure(
            "context-event",
            operation,
            operationOrdinal,
            reason,
            {
              glError: capturedGlError(reason, gl),
              contextLost: contextLost(gl)
            }
          );
      for (const stream of streams) {
        try { gl.deleteTexture(stream); } catch { /* preserve initialization cause */ }
      }
      if (program !== null) {
        try { gl.deleteProgram(program); } catch { /* preserve initialization cause */ }
      }
      this.#initializingTextureCount = 0;
      throw error;
    }
  }

  async #uploadFrame(
    texture: WebGLTexture,
    frame: VideoFrame,
    operationOrdinal: number
  ): Promise<boolean> {
    let rect: DOMRectReadOnly;
    try { rect = validateFrame(frame, this.#layout); }
    catch (reason) {
      throw this.#failure(
        "semantic-upload",
        "runtime",
        operationOrdinal,
        reason
      );
    }
    if (this.#state !== "active") return false;
    const gl = this.#gl;
    if (gl === null) return false;
    if (this.#native !== 0) {
      drainErrors(gl);
      let nativeError: number | null = null;
      let nativeReason: unknown = null;
      try {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          0,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          frame
        );
        nativeError = readGlError(gl);
      } catch (reason) {
        nativeReason = reason;
        nativeError = readGlError(gl);
      }
      if (contextLost(gl)) {
        throw this.#failure(
          "native-upload",
          "runtime",
          operationOrdinal,
          nativeReason ?? new Error(
            "WebGL context was lost during native frame upload"
          ),
          {
            glError: nativeError,
            contextLost: true,
            uploadPath: "native"
          }
        );
      }
      if (nativeReason === null && nativeError === null) {
        if (this.#native === 2) return true;
        return this.#qualifyNativeUpload(
          gl,
          texture,
          frame,
          rect,
          operationOrdinal
        );
      }
      this.#native = 0;
    }
    drainErrors(gl);
    const source = await this.#materialize(frame, rect, operationOrdinal);
    try {
      if (this.#state !== "active" || this.#gl !== gl) return false;
      this.#uploadRgbaFrame(gl, texture, source, operationOrdinal);
      return true;
    } finally {
      releaseSource(source);
    }
  }

  async #qualifyNativeUpload(
    gl: WebGL2RenderingContext,
    texture: WebGLTexture,
    frame: VideoFrame,
    rect: DOMRectReadOnly,
    operationOrdinal: number
  ): Promise<boolean> {
    if (
      this.#nativeProbeAttempts >= MAX_NATIVE_PROBE_ATTEMPTS ||
      this.#canvas.width < NATIVE_PROBE_EDGE ||
      this.#canvas.height < NATIVE_PROBE_EDGE ||
      this.#probeReadbackBytes() !== NATIVE_PROBE_ACCOUNTED_BYTES
    ) {
      this.#native = 0;
      drainErrors(gl);
      const source = await this.#materialize(frame, rect, operationOrdinal);
      try {
        if (this.#state !== "active" || this.#gl !== gl) return false;
        this.#uploadRgbaFrame(gl, texture, source, operationOrdinal);
        return true;
      } finally {
        releaseSource(source);
      }
    }

    this.#nativeProbeAttempts += 1;
    this.#nativeProbeInFlight = true;
    try {
      // Resolve the CPU copy before touching the main framebuffer. Native and
      // reference probe draws can then run back-to-back in one microtask, and
      // the caller's full presentation draw never exposes unproven pixels.
      const source = await this.#materialize(frame, rect, operationOrdinal);
      try {
        if (this.#state !== "active" || this.#gl !== gl) return false;

        const nativeProbe = this.#readNativeProbe(
          gl,
          texture,
          this.#nativeProbeReadback
        );
        if (nativeProbe.contextLost) {
          throw this.#failure(
            "native-upload",
            "runtime",
            operationOrdinal,
            nativeProbe.reason,
            {
              glError: nativeProbe.glError,
              contextLost: true,
              uploadPath: "native"
            }
          );
        }

        drainErrors(gl);
        this.#uploadRgbaFrame(gl, texture, source, operationOrdinal);
        const referenceProbe = nativeProbe.ok
          ? this.#readNativeProbe(gl, texture, this.#referenceProbeReadback)
          : failedProbe(new Error("native probe readback was unavailable"));
        if (referenceProbe.contextLost) {
          throw this.#failure(
            "draw",
            "runtime",
            operationOrdinal,
            referenceProbe.reason,
            {
              glError: referenceProbe.glError,
              contextLost: true,
              uploadPath: "rgba-copy"
            }
          );
        }

        if (
          !nativeProbe.ok ||
          !referenceProbe.ok ||
          !equivalentProbe(
            this.#nativeProbeReadback,
            this.#referenceProbeReadback
          )
        ) {
          this.#native = 0;
        } else if (informativeProbe(this.#referenceProbeReadback)) {
          this.#native = 2;
        } else if (this.#nativeProbeAttempts >= MAX_NATIVE_PROBE_ATTEMPTS) {
          this.#native = 0;
        }
        return true;
      } finally {
        releaseSource(source);
      }
    } finally {
      this.#nativeProbeInFlight = false;
      if (this.#gl === gl && !contextLost(gl)) {
        try {
          gl.viewport(0, 0, this.#canvas.width, this.#canvas.height);
        } catch { /* The following presentation draw retains exact evidence. */ }
      }
    }
  }

  #uploadRgbaFrame(
    gl: WebGL2RenderingContext,
    texture: WebGLTexture,
    source: RgbaSource,
    operationOrdinal: number
  ): void {
    try { this.#uploadSource(gl, texture, source); }
    catch (reason) {
      throw this.#failure(
        "rgba-upload",
        "runtime",
        operationOrdinal,
        reason,
        {
          glError: capturedGlError(reason, gl),
          contextLost: contextLost(gl),
          uploadPath: "rgba-copy"
        }
      );
    }
    if (contextLost(gl)) {
      throw this.#failure(
        "rgba-upload",
        "runtime",
        operationOrdinal,
        new Error("WebGL context was lost during RGBA frame upload"),
        { contextLost: true, uploadPath: "rgba-copy" }
      );
    }
  }

  #readNativeProbe(
    gl: WebGL2RenderingContext,
    texture: WebGLTexture,
    target: Uint8Array
  ): NativeProbeResult {
    drainErrors(gl);
    try {
      gl.viewport(0, 0, NATIVE_PROBE_EDGE, NATIVE_PROBE_EDGE);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(this.#program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      let glError = readGlError(gl);
      if (glError !== null || contextLost(gl)) {
        return failedProbe(
          new Error("WebGL native probe draw failed"),
          glError,
          contextLost(gl)
        );
      }
      target.fill(0);
      gl.readPixels(
        0,
        0,
        NATIVE_PROBE_EDGE,
        NATIVE_PROBE_EDGE,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        target
      );
      glError = readGlError(gl);
      if (glError !== null || contextLost(gl)) {
        return failedProbe(
          new Error("WebGL native probe readback failed"),
          glError,
          contextLost(gl)
        );
      }
      return Object.freeze({
        ok: true,
        reason: null,
        glError: null,
        contextLost: false
      });
    } catch (reason) {
      return failedProbe(reason, readGlError(gl), contextLost(gl));
    }
  }

  async #materialize(
    frame: VideoFrame,
    rect: DOMRectReadOnly,
    operationOrdinal: number
  ): Promise<RgbaSource> {
    let copyReason: unknown;
    try {
      return Object.freeze({
        kind: "pixels" as const,
        pixels: await this.#copy(frame, rect)
      });
    } catch (reason) {
      copyReason = reason;
    }
    if (
      this.#state !== "active" ||
      isNamedError(copyReason, "AbortError")
    ) throw unavailable();
    if (
      this.#createImageBitmap === null ||
      copyReason instanceof RgbaCopyContractError ||
      isNamedError(copyReason, "TimeoutError")
    ) {
      throw this.#failure(
        "rgba-copy",
        "runtime",
        operationOrdinal,
        copyReason,
        { uploadPath: "rgba-copy" }
      );
    }
    let bitmap: ImageBitmap;
    try {
      bitmap = await this.#bitmap(frame);
      if (
        bitmap.width !== this.#layout.storageWidth ||
        bitmap.height !== this.#layout.storageHeight
      ) {
        releaseBitmap(bitmap);
        throw new RgbaCopyContractError(
          "decoded frame ImageBitmap geometry is invalid"
        );
      }
    } catch (reason) {
      throw this.#failure(
        "rgba-copy",
        "runtime",
        operationOrdinal,
        reason,
        { uploadPath: "rgba-copy" }
      );
    }
    return Object.freeze({ kind: "bitmap" as const, bitmap });
  }

  async #copy(
    frame: VideoFrame,
    rect: DOMRectReadOnly
  ): Promise<Uint8Array> {
    const staging = this.#staging;
    if (staging.byteLength !== this.#storageBytesPerFrame) throw unavailable();
    staging.fill(0);
    const stride = this.#layout.storageWidth * 4;
    let raw: Promise<readonly PlaneLayout[]>;
    try {
      raw = frame.copyTo(staging, {
        format: "RGBA",
        rect,
        layout: [{ offset: 0, stride }]
      });
    } catch (reason) {
      throw reason;
    }
    this.#sourceCopiesInFlight += 1;
    void raw.then(
      () => { this.#sourceCopiesInFlight -= 1; },
      () => { this.#sourceCopiesInFlight -= 1; }
    );
    let planes: readonly PlaneLayout[];
    try {
      planes = await timed(
        raw,
        this.#copyTimeoutMs,
        this.#setTimeout,
        this.#clearTimeout
      );
    } catch (reason) {
      throw reason;
    }
    const plane = planes[0];
    if (
      planes.length !== 1 ||
      plane === undefined ||
      plane.offset !== 0 ||
      plane.stride !== stride
    ) {
      throw new RgbaCopyContractError("decoded frame copy layout is invalid");
    }
    return staging;
  }

  async #bitmap(frame: VideoFrame): Promise<ImageBitmap> {
    const factory = this.#createImageBitmap;
    if (factory === null) throw new Error("ImageBitmap conversion is unavailable");
    let raw: Promise<ImageBitmap>;
    try {
      raw = factory(
        frame,
        0,
        0,
        frame.displayWidth,
        frame.displayHeight,
        {
          resizeWidth: this.#layout.storageWidth,
          resizeHeight: this.#layout.storageHeight
        }
      );
    } catch (reason) {
      throw reason;
    }
    let abandoned = false;
    this.#sourceCopiesInFlight += 1;
    void raw.then(
      (bitmap) => {
        this.#sourceCopiesInFlight -= 1;
        if (abandoned) releaseBitmap(bitmap);
      },
      () => { this.#sourceCopiesInFlight -= 1; }
    );
    try {
      return await timed(
        raw,
        this.#copyTimeoutMs,
        this.#setTimeout,
        this.#clearTimeout
      );
    } catch (reason) {
      abandoned = true;
      throw reason;
    }
  }

  #createTexture(gl: WebGL2RenderingContext): WebGLTexture {
    const texture = gl.createTexture();
    if (texture === null) throw new Error("WebGL texture is unavailable");
    try {
      drainErrors(gl);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texStorage2D(
        gl.TEXTURE_2D,
        1,
        gl.RGBA8,
        this.#layout.codedWidth,
        this.#layout.codedHeight
      );
      const glError = readGlError(gl);
      if (glError !== null) {
        throw new RendererGlOperationError(
          "WebGL texture allocation failed",
          glError
        );
      }
      return texture;
    } catch (reason) {
      const error = captureGlOperationError(
        gl,
        reason,
        "WebGL texture allocation failed"
      );
      try { gl.deleteTexture(texture); } catch { /* preserve allocation cause */ }
      throw error;
    }
  }

  #uploadPixels(
    gl: WebGL2RenderingContext,
    texture: WebGLTexture,
    pixels: Uint8Array
  ): void {
    if (pixels.byteLength !== this.#storageBytesPerFrame) {
      throw new RangeError("resident pixel storage is invalid");
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      this.#layout.storageWidth,
      this.#layout.storageHeight,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels
    );
    const glError = readGlError(gl);
    if (glError !== null) {
      throw new RendererGlOperationError("WebGL RGBA upload failed", glError);
    }
  }

  #uploadSource(
    gl: WebGL2RenderingContext,
    texture: WebGLTexture,
    source: RgbaSource
  ): void {
    if (source.kind === "pixels") {
      this.#uploadPixels(gl, texture, source.pixels);
      return;
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      source.bitmap
    );
    const glError = readGlError(gl);
    if (glError !== null) {
      throw new RendererGlOperationError("WebGL ImageBitmap upload failed", glError);
    }
  }

  #render(
    texture: WebGLTexture,
    operation: RendererDiagnosticOperation,
    operationOrdinal: number
  ): void {
    const gl = this.#gl;
    const program = this.#program;
    if (this.#state !== "active" || gl === null || program === null) {
      throw unavailable();
    }
    const backingWidth = this.#canvas.width;
    const backingHeight = this.#canvas.height;
    const sourceWidth = this.#layout.logicalWidth *
      this.#layout.pixelAspect[0] / this.#layout.pixelAspect[1];
    const sourceHeight = this.#layout.logicalHeight;
    let width = backingWidth;
    let height = backingHeight;
    if (this.#fit !== "fill") {
      const scale = this.#fit === "cover"
        ? Math.max(backingWidth / sourceWidth, backingHeight / sourceHeight)
        : this.#fit === "none"
          ? this.#dpr
          : Math.min(backingWidth / sourceWidth, backingHeight / sourceHeight);
      width = Math.max(1, Math.round(sourceWidth * scale));
      height = Math.max(1, Math.round(sourceHeight * scale));
    }
    if (
      !Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width > this.#maxViewportWidth || height > this.#maxViewportHeight
    ) throw new RendererArithmeticError("renderer viewport exceeds device limits");
    try {
      gl.viewport(0, 0, backingWidth, backingHeight);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.viewport(
        Math.round((backingWidth - width) / 2),
        Math.round((backingHeight - height) / 2),
        width,
        height
      );
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const glError = readGlError(gl);
      if (glError !== null) {
        throw new RendererGlOperationError("WebGL draw failed", glError);
      }
      if (contextLost(gl) || this.#state !== "active") {
        throw new Error("WebGL context was lost during draw");
      }
    } catch (reason) {
      throw this.#failure(
        "draw",
        operation,
        operationOrdinal,
        reason,
        {
          glError: capturedGlError(reason, gl),
          contextLost: contextLost(gl)
        }
      );
    }
  }

  #drawLast(
    operation: RendererDiagnosticOperation,
    operationOrdinal: number
  ): void {
    const last = this.#last;
    if (last === null) return;
    const texture = typeof last === "number"
      ? this.#streams[last]
      : this.#resident.get(last);
    if (texture !== null && texture !== undefined) {
      this.#render(texture, operation, operationOrdinal);
    }
  }

  #markLost(): void {
    if (this.#state !== "active") return;
    this.#state = "lost";
    this.#losses += 1;
    this.#gl = null;
    this.#program = null;
    this.#streams = [];
    this.#nextStream = 0;
    this.#maxTextureSize = 0;
    this.#maxViewportWidth = 0;
    this.#maxViewportHeight = 0;
    this.#maxResidentTextures = 0;
    this.#contextAttributes = null;
    this.#vendor = null;
    this.#rendererName = null;
    this.#last = null;
    this.#resident.clear();
    this.#releaseNativeProbe();
    this.#notify(Object.freeze({ state: "lost", error: null }));
  }

  #terminal(error?: RendererFailureError): void {
    if (this.#state === "disposed" || this.#state === "error") return;
    const terminalError = error ?? this.#failure(
      "context-event",
      "runtime",
      this.#beginOperation(),
      new Error("WebGL renderer failed")
    );
    this.#state = "error";
    this.#destroy();
    this.#resident.clear();
    this.#reserved.clear();
    this.#last = null;
    this.#staging = new Uint8Array(0);
    this.#releaseNativeProbe();
    this.#notify(Object.freeze({ state: "error", error: terminalError }));
  }

  #notify(change: Readonly<RendererContextChange>): void {
    queueMicrotask(() => {
      try { this.#onContextChange?.(change); } catch { /* Host callbacks are isolated. */ }
    });
  }

  #beginOperation(): number {
    if (this.#operationSequence === Number.MAX_SAFE_INTEGER) {
      throw new RangeError("renderer operation identity is exhausted");
    }
    const ordinal = this.#operationSequence;
    this.#operationSequence += 1;
    return ordinal;
  }

  #failure(
    phase: RendererDiagnosticPhase,
    operation: RendererDiagnosticOperation,
    operationOrdinal: number,
    reason: unknown,
    details: Readonly<{
      glError?: number | null;
      contextLost?: boolean;
      uploadPath?: RendererDiagnosticUploadPath | null;
      textureOrdinal?: number | null;
    }> = {}
  ): RendererFailureError {
    if (reason instanceof RendererFailureError) return reason;
    if (this.#failureError !== null) return this.#failureError;
    const bytes = this.#diagnosticBytes();
    const diagnostic = createRendererFailureDiagnostic({
      phase,
      operation,
      operationOrdinal,
      reason,
      glError: details.glError ?? null,
      contextLost: details.contextLost ?? false,
      uploadPath: details.uploadPath ?? null,
      textureOrdinal: details.textureOrdinal ?? null,
      layout: this.#layout,
      backing: {
        width: diagnosticScalar(this.#canvas.width),
        height: diagnosticScalar(this.#canvas.height)
      },
      bytes,
      limits: {
        maxTextureSize: this.#maxTextureSize,
        maxViewportWidth: this.#maxViewportWidth,
        maxViewportHeight: this.#maxViewportHeight,
        maxResidentTextures: this.#maxResidentTextures
      },
      contextAttributes: this.#contextAttributes,
      vendor: this.#vendor,
      renderer: this.#rendererName
    });
    this.#failureError = new RendererFailureError(diagnostic);
    return this.#failureError;
  }

  #diagnosticBytes(): Readonly<{
    stagingBytes: number;
    residentBytes: number;
    textureBytes: number;
    backingBytes: number;
    runtimeBytes: number;
    maxTextureBytes: number;
    maxBackingBytes: number;
    maxRuntimeBytes: number;
  }> {
    try {
      const backingBytes = this.#backingBytes(
        this.#canvas.width,
        this.#canvas.height
      );
      const textureCount = this.#initializingTextureCount +
        (this.#state === "active"
          ? this.#resident.size + this.#streams.length
          : 0);
      const textureBytes = textureCount === 0
        ? 0
        : allocationBytes(checkedProduct(
            this.#textureBytesPerFrame,
            textureCount
          ));
      const residentBytes = 0;
      return Object.freeze({
        stagingBytes: this.#staging.byteLength,
        residentBytes,
        textureBytes,
        backingBytes,
        runtimeBytes: checkedSum([
          this.#staging.byteLength,
          this.#probeReadbackBytes(),
          residentBytes,
          textureBytes,
          backingBytes
        ]),
        maxTextureBytes: this.#maxTextureBytes,
        maxBackingBytes: this.#maxBackingBytes,
        maxRuntimeBytes: this.#maxRuntimeBytes
      });
    } catch {
      return Object.freeze({
        stagingBytes: diagnosticScalar(this.#staging.byteLength),
        residentBytes: 0,
        textureBytes: 0,
        backingBytes: 0,
        runtimeBytes: diagnosticScalar(
          this.#staging.byteLength + this.#probeReadbackBytes()
        ),
        maxTextureBytes: this.#maxTextureBytes,
        maxBackingBytes: this.#maxBackingBytes,
        maxRuntimeBytes: this.#maxRuntimeBytes
      });
    }
  }

  #destroy(): void {
    const gl = this.#gl;
    if (gl !== null) {
      for (const texture of this.#resident.values()) {
        try { gl.deleteTexture(texture); } catch { /* terminal cleanup */ }
      }
      for (const stream of this.#streams) {
        try { gl.deleteTexture(stream); } catch { /* terminal cleanup */ }
      }
      if (this.#program !== null) {
        try { gl.deleteProgram(this.#program); } catch { /* terminal cleanup */ }
      }
    }
    this.#gl = null;
    this.#program = null;
    this.#streams = [];
    this.#nextStream = 0;
  }

  #probeReadbackBytes(): number {
    return this.#nativeProbeReadback.byteLength +
      this.#referenceProbeReadback.byteLength;
  }

  #releaseNativeProbe(): void {
    this.#nativeProbeInFlight = false;
    this.#nativeProbeReadback = new Uint8Array(0);
    this.#referenceProbeReadback = new Uint8Array(0);
  }

  #backingBytes(width: number, height: number): number {
    return allocationBytes(rgbaBytes(width, height));
  }

  #assertBudget(
    residentCount: number,
    backingBytes: number
  ): Readonly<{ textureBytes: number; runtimeBytes: number }> {
    if (this.#maxResidentTextures > 0 && residentCount > this.#maxResidentTextures) {
      throw new RangeError("resident texture count exceeds device limits");
    }
    const textureBytes = allocationBytes(checkedProduct(
      this.#textureBytesPerFrame,
      residentCount + STREAMS
    ));
    const runtimeBytes = checkedSum([
      textureBytes,
      this.#storageBytesPerFrame,
      NATIVE_PROBE_ACCOUNTED_BYTES,
      backingBytes
    ]);
    if (
      textureBytes > this.#maxTextureBytes ||
      backingBytes > this.#maxBackingBytes ||
      runtimeBytes > this.#maxRuntimeBytes
    ) {
      const error = new RangeError("renderer resource byte cap exceeded");
      error.name = "ResourceBudgetError";
      throw error;
    }
    return Object.freeze({ textureBytes, runtimeBytes });
  }
}

function allocationBytes(rawBytes: number): number {
  return Math.ceil(checkedProduct(rawBytes, 5) / 4);
}

function checkedLayout(value: Readonly<RenderLayout>): RenderLayout {
  const codedWidth = dimension(value.codedWidth);
  const codedHeight = dimension(value.codedHeight);
  const storageWidth = dimension(value.storageWidth);
  const storageHeight = dimension(value.storageHeight);
  const logicalWidth = dimension(value.logicalWidth);
  const logicalHeight = dimension(value.logicalHeight);
  const pixelAspect = value.pixelAspect;
  if (
    pixelAspect.length !== 2 ||
    !Number.isSafeInteger(pixelAspect[0]) || pixelAspect[0] < 1 ||
    !Number.isSafeInteger(pixelAspect[1]) || pixelAspect[1] < 1 ||
    !Number.isFinite(logicalWidth * pixelAspect[0] / pixelAspect[1])
  ) throw new RangeError("renderer pixel aspect is invalid");
  if (storageWidth > codedWidth || storageHeight > codedHeight) {
    throw new RangeError("renderer storage exceeds coded dimensions");
  }
  const colorRect = rect(value.colorRect, storageWidth, storageHeight);
  const alphaRect = value.alphaRect === undefined
    ? undefined : rect(value.alphaRect, storageWidth, storageHeight);
  const paneWidth = colorRect[2] + colorRect[2] % 2;
  const paneHeight = colorRect[3] + colorRect[3] % 2;
  const expectedHeight = alphaRect === undefined
    ? paneHeight : paneHeight * 2 + 8;
  if (
    colorRect[0] !== 0 || colorRect[1] !== 0 ||
    storageWidth !== paneWidth || storageHeight !== expectedHeight ||
    alphaRect !== undefined && (
      alphaRect[0] !== 0 || alphaRect[1] !== paneHeight + 8 ||
      alphaRect[2] !== colorRect[2] || alphaRect[3] !== colorRect[3]
    )
  ) {
    throw new RangeError("renderer storage rectangle is not canonical");
  }
  return Object.freeze({
    codedWidth,
    codedHeight,
    storageWidth,
    storageHeight,
    logicalWidth,
    logicalHeight,
    pixelAspect: Object.freeze([pixelAspect[0], pixelAspect[1]]) as
      readonly [number, number],
    colorRect,
    ...(alphaRect === undefined ? {} : { alphaRect })
  });
}

function validateFrame(
  frame: VideoFrame,
  layout: Readonly<RenderLayout>
): DOMRectReadOnly {
  const visible = frame.visibleRect;
  if (
    visible === null ||
    !Number.isSafeInteger(frame.codedWidth) || frame.codedWidth < 1 ||
    !Number.isSafeInteger(frame.codedHeight) || frame.codedHeight < 1 ||
    !Number.isSafeInteger(frame.displayWidth) || frame.displayWidth < 1 ||
    !Number.isSafeInteger(frame.displayHeight) || frame.displayHeight < 1 ||
    !sameAspectRatio(
      frame.displayWidth,
      frame.displayHeight,
      layout.storageWidth,
      layout.storageHeight
    ) ||
    !Number.isSafeInteger(visible.x) || visible.x < 0 ||
    !Number.isSafeInteger(visible.y) || visible.y < 0 ||
    visible.width !== layout.storageWidth ||
    visible.height !== layout.storageHeight ||
    visible.x > frame.codedWidth - visible.width ||
    visible.y > frame.codedHeight - visible.height
  ) throw new Error("decoded frame geometry is invalid");
  return visible;
}

function residentKey(group: string, index: number): string {
  if (!ID.test(group) || !Number.isSafeInteger(index) || index < 0) {
    throw new RangeError("resident frame key is invalid");
  }
  return `${group}\0${String(index)}`;
}

function rect(
  value: readonly number[],
  width: number,
  height: number
): readonly [number, number, number, number] {
  if (value.length !== 4) throw new RangeError("renderer rectangle is invalid");
  const result = [
    coordinate(value[0]),
    coordinate(value[1]),
    dimension(value[2]),
    dimension(value[3])
  ] as [number, number, number, number];
  if (
    result[0] > width - result[2] ||
    result[1] > height - result[3]
  ) throw new RangeError("renderer rectangle exceeds storage");
  return Object.freeze(result);
}

function coordinate(value: number | undefined): number {
  if (!Number.isSafeInteger(value) || value === undefined || value < 0) {
    throw new RangeError("renderer coordinate is invalid");
  }
  return value;
}

function dimension(value: number | undefined): number {
  if (value === undefined || !Number.isSafeInteger(value) || value < 1) {
    throw new RangeError("renderer dimension is invalid");
  }
  return value;
}

function rgbaBytes(width: number, height: number): number {
  return checkedProduct(checkedProduct(width, height), 4);
}

function checkedProduct(left: number, right: number): number {
  if (
    !Number.isSafeInteger(left) || left < 0 ||
    !Number.isSafeInteger(right) || right < 0 ||
    right !== 0 && left > Math.floor(Number.MAX_SAFE_INTEGER / right)
  ) throw new RangeError("renderer byte count is unsafe");
  return left * right;
}

function checkedSum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    if (value > Number.MAX_SAFE_INTEGER - total) {
      throw new RangeError("renderer byte sum is unsafe");
    }
    total += value;
  }
  return total;
}

function cap(value: number | undefined, label: string): number {
  if (value === undefined) return HARD_BYTES;
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${label} is invalid`);
  return Math.min(value, HARD_BYTES);
}

function positiveGl(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error("WebGL device limit is invalid");
  }
  return value;
}

class RendererGlOperationError extends Error {
  public constructor(
    message: string,
    public readonly glError: number | null
  ) {
    super(message);
    this.name = "RendererGlOperationError";
  }
}

class RendererArithmeticError extends RangeError {}

class RgbaCopyContractError extends Error {}

type RgbaSource =
  | Readonly<{ kind: "pixels"; pixels: Uint8Array }>
  | Readonly<{ kind: "bitmap"; bitmap: ImageBitmap }>;

function defaultImageBitmapFactory(): ((
  frame: VideoFrame,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  options: ImageBitmapOptions
) => Promise<ImageBitmap>) | null {
  const factory = globalThis.createImageBitmap;
  if (typeof factory !== "function") return null;
  return (frame, sx, sy, sw, sh, options) =>
    factory(frame, sx, sy, sw, sh, options);
}

function releaseSource(source: RgbaSource): void {
  if (source.kind === "bitmap") releaseBitmap(source.bitmap);
}

function releaseBitmap(bitmap: ImageBitmap): void {
  try { bitmap.close(); } catch { /* Browser-owned conversion cleanup is terminal-safe. */ }
}

interface NativeProbeResult {
  readonly ok: boolean;
  readonly reason: unknown;
  readonly glError: number | null;
  readonly contextLost: boolean;
}

function failedProbe(
  reason: unknown,
  glError: number | null = null,
  lost = false
): NativeProbeResult {
  return Object.freeze({ ok: false, reason, glError, contextLost: lost });
}

function nativeUploadMode(value: number): RendererUploadMode {
  if (value === 0) return "rgba-copy";
  if (value === 2) return "native";
  return "native-probing";
}

function informativeProbe(pixels: Uint8Array): boolean {
  if (pixels.byteLength !== NATIVE_PROBE_BYTES) return false;
  const minimum = [255, 255, 255, 255];
  const maximum = [0, 0, 0, 0];
  let visibleSignal = false;
  for (let offset = 0; offset < pixels.byteLength; offset += 4) {
    const red = pixels[offset] ?? 0;
    const green = pixels[offset + 1] ?? 0;
    const blue = pixels[offset + 2] ?? 0;
    const alpha = pixels[offset + 3] ?? 0;
    const channels = [red, green, blue, alpha];
    for (let channel = 0; channel < channels.length; channel += 1) {
      minimum[channel] = Math.min(minimum[channel] ?? 255, channels[channel] ?? 0);
      maximum[channel] = Math.max(maximum[channel] ?? 0, channels[channel] ?? 0);
    }
    // Integer Rec. 709 luma is sufficient for the bounded false-positive
    // discriminator and avoids float-dependent comparison at the threshold.
    const luma = (54 * red + 183 * green + 19 * blue) >> 8;
    if (alpha > 16 || luma > 16) visibleSignal = true;
  }
  return visibleSignal && maximum.some((value, channel) =>
    value - (minimum[channel] ?? value) >= 16);
}

function equivalentProbe(native: Uint8Array, reference: Uint8Array): boolean {
  if (
    native.byteLength !== NATIVE_PROBE_BYTES ||
    reference.byteLength !== NATIVE_PROBE_BYTES
  ) return false;
  for (let offset = 0; offset < reference.byteLength; offset += 4) {
    const referenceAlpha = reference[offset + 3] ?? 0;
    const nativeAlpha = native[offset + 3] ?? 0;
    if (Math.abs(nativeAlpha - referenceAlpha) > 1) return false;
    if (referenceAlpha === 0) continue;
    for (let channel = 0; channel < 3; channel += 1) {
      if (Math.abs(
        (native[offset + channel] ?? 0) -
        (reference[offset + channel] ?? 0)
      ) > 3) return false;
    }
  }
  return true;
}

function capturedGlError(
  reason: unknown,
  gl: WebGL2RenderingContext
): number | null {
  return reason instanceof RendererGlOperationError
    ? reason.glError
    : readGlError(gl);
}

function captureGlOperationError(
  gl: WebGL2RenderingContext,
  reason: unknown,
  fallbackMessage: string
): RendererGlOperationError {
  if (reason instanceof RendererGlOperationError) return reason;
  let message = fallbackMessage;
  try {
    if (reason instanceof Error && reason.message.length > 0) {
      message = reason.message;
    }
  } catch { /* retain the fixed fallback message */ }
  return new RendererGlOperationError(message, readGlError(gl));
}

function readGlError(gl: WebGL2RenderingContext): number | null {
  try {
    const value = gl.getError();
    return Number.isSafeInteger(value) && value >= 0 && value !== gl.NO_ERROR
      ? value : null;
  } catch {
    return null;
  }
}

function contextLost(gl: WebGL2RenderingContext): boolean {
  try { return gl.isContextLost() === true; }
  catch { return false; }
}

function readContextAttributes(
  gl: WebGL2RenderingContext
): Readonly<RendererDiagnosticContextAttributes> | null {
  let value: unknown;
  try { value = gl.getContextAttributes(); }
  catch { return null; }
  if (typeof value !== "object" || value === null) return null;
  try {
    const record = value as Readonly<Record<string, unknown>>;
    const powerPreference = record.powerPreference;
    return Object.freeze({
      alpha: diagnosticBoolean(record.alpha),
      antialias: diagnosticBoolean(record.antialias),
      depth: diagnosticBoolean(record.depth),
      desynchronized: diagnosticBoolean(record.desynchronized),
      failIfMajorPerformanceCaveat:
        diagnosticBoolean(record.failIfMajorPerformanceCaveat),
      powerPreference:
        powerPreference === "default" ||
        powerPreference === "high-performance" ||
        powerPreference === "low-power"
          ? powerPreference : null,
      premultipliedAlpha: diagnosticBoolean(record.premultipliedAlpha),
      preserveDrawingBuffer: diagnosticBoolean(record.preserveDrawingBuffer),
      stencil: diagnosticBoolean(record.stencil),
      xrCompatible: diagnosticBoolean(record.xrCompatible)
    });
  } catch {
    return null;
  }
}

function diagnosticBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function diagnosticScalar(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value : 0;
}

function readDeviceIdentity(gl: WebGL2RenderingContext): Readonly<{
  vendor: string | null;
  renderer: string | null;
}> {
  try {
    const extension = gl.getExtension("WEBGL_debug_renderer_info") as
      Readonly<{
        UNMASKED_VENDOR_WEBGL?: unknown;
        UNMASKED_RENDERER_WEBGL?: unknown;
      }> | null;
    if (extension === null) return Object.freeze({ vendor: null, renderer: null });
    const vendor = typeof extension.UNMASKED_VENDOR_WEBGL === "number"
      ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL) : null;
    const renderer = typeof extension.UNMASKED_RENDERER_WEBGL === "number"
      ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : null;
    return Object.freeze({
      vendor: typeof vendor === "string" ? vendor : null,
      renderer: typeof renderer === "string" ? renderer : null
    });
  } catch {
    return Object.freeze({ vendor: null, renderer: null });
  }
}

function drainErrors(gl: WebGL2RenderingContext): void {
  try {
    for (let index = 0; index < 8 && gl.getError() !== gl.NO_ERROR; index += 1) {
      // Error draining is bounded because a lost context may report forever.
    }
  } catch { /* Error polling is diagnostic-only. */ }
}

function unavailable(): Error {
  return new DOMException("WebGL renderer is unavailable", "AbortError");
}

function isAbortError(reason: unknown): boolean {
  if (typeof reason !== "object" || reason === null) return false;
  try { return (reason as Readonly<{ name?: unknown }>).name === "AbortError"; }
  catch { return false; }
}

function isNamedError(reason: unknown, name: string): boolean {
  if (typeof reason !== "object" || reason === null) return false;
  try { return (reason as Readonly<{ name?: unknown }>).name === name; }
  catch { return false; }
}

function timed<T>(
  operation: Promise<T>,
  milliseconds: number,
  setTimeout: (callback: () => void, delay: number) => number,
  clearTimeout: (handle: number) => void
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new DOMException("decoded frame copy timed out", "TimeoutError"));
    }, milliseconds);
    operation.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function createProgram(
  gl: WebGL2RenderingContext,
  layout: Readonly<RenderLayout>
): WebGLProgram {
  let vertex: WebGLShader | null = null;
  let fragment: WebGLShader | null = null;
  let program: WebGLProgram | null = null;
  try {
    drainErrors(gl);
    vertex = shader(gl, gl.VERTEX_SHADER, `#version 300 es
const vec2 p[3]=vec2[](vec2(-1,-1),vec2(3,-1),vec2(-1,3));
out vec2 v;void main(){vec2 q=p[gl_VertexID];v=(q+1.)/2.;gl_Position=vec4(q,0,1);}`);
    fragment = shader(gl, gl.FRAGMENT_SHADER, `#version 300 es
precision highp float;uniform sampler2D f;uniform vec4 c,a;uniform float h;in vec2 v;out vec4 o;
void main(){vec2 u=v;u.y=1.-u.y;vec3 r=texture(f,c.xy+u*c.zw).rgb;float q=h>.5?texture(f,a.xy+u*a.zw).r:1.;o=vec4(r*q,q);}`);
    program = gl.createProgram();
    if (program === null) throw new Error("WebGL program is unavailable");
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error("WebGL program link failed");
    }
    gl.useProgram(program);
    const sampler = gl.getUniformLocation(program, "f");
    const color = gl.getUniformLocation(program, "c");
    const alpha = gl.getUniformLocation(program, "a");
    const hasAlpha = gl.getUniformLocation(program, "h");
    if (sampler === null || color === null || alpha === null || hasAlpha === null) {
      throw new Error("WebGL shader uniforms are unavailable");
    }
    gl.uniform1i(sampler, 0);
    uv(gl, color, layout.colorRect, layout);
    uv(gl, alpha, layout.alphaRect ?? layout.colorRect, layout);
    gl.uniform1f(hasAlpha, layout.alphaRect === undefined ? 0 : 1);
    const glError = readGlError(gl);
    if (glError !== null) {
      throw new RendererGlOperationError(
        "WebGL program creation failed",
        glError
      );
    }
    return program;
  } catch (reason) {
    const error = captureGlOperationError(
      gl,
      reason,
      "WebGL program creation failed"
    );
    if (program !== null) {
      try { gl.deleteProgram(program); } catch { /* preserve program cause */ }
    }
    throw error;
  } finally {
    if (vertex !== null) {
      try { gl.deleteShader(vertex); } catch { /* preserve program cause */ }
    }
    if (fragment !== null) {
      try { gl.deleteShader(fragment); } catch { /* preserve program cause */ }
    }
  }
}

function shader(
  gl: WebGL2RenderingContext,
  kind: number,
  source: string
): WebGLShader {
  const result = gl.createShader(kind);
  if (result === null) throw new Error("WebGL shader is unavailable");
  try {
    gl.shaderSource(result, source);
    gl.compileShader(result);
    if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) {
      throw new Error("WebGL shader compilation failed");
    }
    const glError = readGlError(gl);
    if (glError !== null) {
      throw new RendererGlOperationError(
        "WebGL shader creation failed",
        glError
      );
    }
    return result;
  } catch (reason) {
    const error = captureGlOperationError(
      gl,
      reason,
      "WebGL shader creation failed"
    );
    try { gl.deleteShader(result); } catch { /* preserve shader cause */ }
    throw error;
  }
}

function uv(
  gl: WebGL2RenderingContext,
  location: WebGLUniformLocation,
  rect: readonly [number, number, number, number],
  layout: Readonly<RenderLayout>
): void {
  gl.uniform4f(
    location,
    (rect[0] + 0.5) / layout.codedWidth,
    (rect[1] + 0.5) / layout.codedHeight,
    (rect[2] - 1) / layout.codedWidth,
    (rect[3] - 1) / layout.codedHeight
  );
}
