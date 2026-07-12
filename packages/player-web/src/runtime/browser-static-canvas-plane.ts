import type { BrowserDecodedStaticSurface } from "./strict-static-decoder.js";
import {
  MAX_LOGICAL_CANVAS_DIMENSION,
  MAX_PRESENTATION_BACKING_DIMENSION,
  rasterizePresentationRect,
  type PresentationGeometry
} from "./presentation-geometry.js";
import {
  StaticSurfaceStoreDisposedError,
  StaticSurfaceUnavailableError
} from "./static-surface-errors.js";
import type { StaticPresentationPlane } from "./static-surfaces.js";
/** Canvas adapter only; DOM layering remains a host-supplied callback. */
export class BrowserStaticCanvasPlane
implements StaticPresentationPlane<BrowserDecodedStaticSurface> {
  readonly #canvas: HTMLCanvasElement;
  readonly #context: CanvasRenderingContext2D;
  readonly #setStaticVisible: (visible: boolean) => void;
  #geometry: Readonly<StaticPresentationMapping> | null = null;
  #image: ImageBitmap | null = null;
  #logicalWidth = 0;
  #logicalHeight = 0;
  #staticVisible = false;
  #disposed = false;
  #visibilityCallbackActive = false;

  public constructor(
    canvas: HTMLCanvasElement,
    setStaticVisible: (visible: boolean) => void
  ) {
    let context: CanvasRenderingContext2D | null;
    try {
      context = canvas.getContext("2d", { alpha: true });
    } catch {
      throw new StaticSurfaceUnavailableError("2D static canvas is unavailable");
    }
    if (context === null) {
      throw new StaticSurfaceUnavailableError("2D static canvas is unavailable");
    }
    this.#canvas = canvas;
    this.#context = context;
    this.#setStaticVisible = setStaticVisible;
  }

  public present(
    surface: BrowserDecodedStaticSurface,
    width: number,
    height: number,
    options: { readonly cover?: boolean } = {}
  ): void {
    this.#assertActive();
    validateStaticSurfaceSize(width, height);
    const previousImage = this.#image;
    const previousLogicalWidth = this.#logicalWidth;
    const previousLogicalHeight = this.#logicalHeight;
    const previousVisible = this.#staticVisible;
    const {
      previousCanvasWidth,
      previousCanvasHeight,
      image,
      cover
    } = this.#capturePresentInputs(surface, width, height, options);
    let visibilityAttempted = false;
    this.#image = image;
    this.#logicalWidth = width;
    this.#logicalHeight = height;
    try {
      if (this.#geometry === null) {
        this.#canvas.width = width;
        this.#assertActiveWithTerminalReset();
        this.#canvas.height = height;
        this.#assertActiveWithTerminalReset();
      }
      this.#drawCurrent();
      if (cover) {
        visibilityAttempted = true;
        this.#callVisibility(true);
        this.#assertActiveWithTerminalReset();
        this.#staticVisible = true;
      }
    } catch (error) {
      if (this.#disposed) {
        this.#settleDisposedState();
        throw disposedError();
      }
      this.#image = previousImage;
      this.#logicalWidth = previousLogicalWidth;
      this.#logicalHeight = previousLogicalHeight;
      let rollbackFailed = !this.#restoreBacking(
        previousCanvasWidth,
        previousCanvasHeight
      );
      try {
        this.#drawCurrent();
      } catch {
        rollbackFailed = true;
      }
      if (visibilityAttempted) {
        try {
          this.#callVisibility(previousVisible);
          this.#staticVisible = previousVisible;
        } catch {
          rollbackFailed = true;
        }
      }
      if (this.#disposed) {
        this.#settleDisposedState();
        throw disposedError();
      }
      if (rollbackFailed) {
        this.#terminalize();
        throw new StaticSurfaceUnavailableError(
          "static presentation rollback failed"
        );
      }
      throw new StaticSurfaceUnavailableError("static presentation failed");
    }
  }

  /** Apply the exact mapping shared with WebGL and redraw retained pixels. */
  public setPresentationGeometry(
    geometry: Readonly<PresentationGeometry>
  ): boolean {
    this.#assertActive();
    if (geometry === null || typeof geometry !== "object") {
      throw new RangeError("static presentation geometry is invalid");
    }
    let mapping: Readonly<StaticPresentationMapping>;
    try {
      mapping = cloneStaticPresentationMapping(geometry);
      this.#assertActiveWithTerminalReset();
    } catch {
      if (this.#disposed) {
        this.#settleDisposedState();
        throw disposedError();
      }
      throw new RangeError("static presentation geometry is invalid");
    }
    validateStaticPresentationGeometry(
      mapping,
      this.#logicalWidth === 0 ? undefined : this.#logicalWidth,
      this.#logicalHeight === 0 ? undefined : this.#logicalHeight
    );
    if (sameStaticPresentationGeometry(this.#geometry, mapping)) return false;
    const previous = this.#geometry;
    const { width: previousWidth, height: previousHeight } =
      this.#captureBackingForGeometry();
    this.#geometry = mapping;
    try {
      this.#canvas.width = mapping.backing.width;
      this.#assertActiveWithTerminalReset();
      this.#canvas.height = mapping.backing.height;
      this.#assertActiveWithTerminalReset();
      this.#drawCurrent();
    } catch (error) {
      if (this.#disposed) {
        this.#settleDisposedState();
        throw disposedError();
      }
      this.#geometry = previous;
      let rollbackFailed = !this.#restoreBacking(previousWidth, previousHeight);
      try {
        this.#drawCurrent();
      } catch {
        rollbackFailed = true;
      }
      if (this.#disposed) {
        this.#settleDisposedState();
        throw disposedError();
      }
      if (rollbackFailed) {
        this.#terminalize();
        throw new StaticSurfaceUnavailableError(
          "static presentation rollback failed"
        );
      }
      throw new StaticSurfaceUnavailableError(
        "static presentation geometry failed"
      );
    }
    return true;
  }

  public coverStatic(): void {
    this.#assertActive();
    try {
      this.#callVisibility(true);
      this.#assertActiveWithTerminalReset();
      this.#staticVisible = true;
    } catch {
      if (this.#disposed) {
        this.#settleDisposedState();
        throw disposedError();
      }
      throw new StaticSurfaceUnavailableError("static visibility update failed");
    }
  }

  public revealAnimated(): void {
    this.#assertActive();
    try {
      this.#callVisibility(false);
      this.#assertActiveWithTerminalReset();
      this.#staticVisible = false;
    } catch {
      if (this.#disposed) {
        this.#settleDisposedState();
        throw disposedError();
      }
      throw new StaticSurfaceUnavailableError("static visibility update failed");
    }
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#terminalize();
  }

  #terminalize(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#image = null;
    this.#geometry = null;
    this.#logicalWidth = 0;
    this.#logicalHeight = 0;
    try {
      this.#context.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
    } catch {
      // Terminal ownership/accounting still retires.
    }
    this.#resetBacking();
    try {
      this.#callVisibility(false);
    } catch {
      // Terminal ownership/accounting still retires.
    }
    // The visibility host can itself mutate either canvas backing. Terminal
    // ownership gets the final store so no callback can resurrect pixels.
    this.#resetBacking();
    this.#staticVisible = false;
  }

  #assertActive(): void {
    if (this.#disposed) throw disposedError();
  }

  #assertActiveWithTerminalReset(): void {
    if (this.#disposed) this.#settleDisposedState();
    this.#assertActive();
  }

  #capturePresentInputs(
    surface: BrowserDecodedStaticSurface,
    width: number,
    height: number,
    options: { readonly cover?: boolean }
  ): Readonly<{
    previousCanvasWidth: number;
    previousCanvasHeight: number;
    image: ImageBitmap;
    cover: boolean;
  }> {
    try {
      const previousCanvasWidth = this.#canvas.width;
      this.#assertActiveWithTerminalReset();
      const previousCanvasHeight = this.#canvas.height;
      this.#assertActiveWithTerminalReset();
      const image = surface.image;
      this.#assertActiveWithTerminalReset();
      const surfaceWidth = surface.width;
      this.#assertActiveWithTerminalReset();
      const surfaceHeight = surface.height;
      this.#assertActiveWithTerminalReset();
      if (image === null || typeof image !== "object") {
        throw new StaticSurfaceUnavailableError(
          "static presentation surface is invalid"
        );
      }
      if (
        surfaceWidth !== width ||
        surfaceHeight !== height
      ) {
        throw new StaticSurfaceUnavailableError(
          "static presentation surface dimensions do not match"
        );
      }
      const cover = options.cover !== false;
      this.#assertActiveWithTerminalReset();
      return Object.freeze({
        previousCanvasWidth,
        previousCanvasHeight,
        image,
        cover
      });
    } catch {
      if (this.#disposed) {
        this.#settleDisposedState();
        throw disposedError();
      }
      throw new StaticSurfaceUnavailableError("static presentation failed");
    }
  }

  #captureBackingForGeometry(): Readonly<{
    width: number;
    height: number;
  }> {
    try {
      const width = this.#canvas.width;
      this.#assertActiveWithTerminalReset();
      const height = this.#canvas.height;
      this.#assertActiveWithTerminalReset();
      return Object.freeze({ width, height });
    } catch {
      if (this.#disposed) {
        this.#settleDisposedState();
        throw disposedError();
      }
      throw new StaticSurfaceUnavailableError(
        "static presentation geometry failed"
      );
    }
  }

  #settleDisposedState(): void {
    this.#image = null;
    this.#geometry = null;
    this.#logicalWidth = 0;
    this.#logicalHeight = 0;
    this.#staticVisible = false;
    this.#resetBackingIfNeeded();
  }

  #callVisibility(visible: boolean): void {
    if (this.#visibilityCallbackActive) {
      throw new StaticSurfaceUnavailableError(
        "static visibility callback reentered"
      );
    }
    this.#visibilityCallbackActive = true;
    try {
      this.#setStaticVisible(visible);
    } catch {
      throw new StaticSurfaceUnavailableError("static visibility update failed");
    } finally {
      this.#visibilityCallbackActive = false;
    }
  }

  #restoreBacking(width: number, height: number): boolean {
    let restored = true;
    try {
      this.#canvas.width = width;
    } catch {
      restored = false;
    }
    try {
      this.#canvas.height = height;
    } catch {
      restored = false;
    }
    return restored;
  }

  #resetBacking(): void {
    try {
      this.#canvas.width = 0;
    } catch {
      // Continue through the independently mutable height backing.
    }
    try {
      this.#canvas.height = 0;
    } catch {
      // Terminal ownership/accounting still retires.
    }
  }

  #resetBackingIfNeeded(): void {
    try {
      if (this.#canvas.width !== 0) this.#canvas.width = 0;
    } catch {
      // Continue through the independently mutable height backing.
    }
    try {
      if (this.#canvas.height !== 0) this.#canvas.height = 0;
    } catch {
      // Terminal ownership/accounting still retires.
    }
  }

  #drawCurrent(): void {
    this.#assertActive();
    const image = this.#image;
    if (image === null) return;
    const geometry = this.#geometry;
    this.#context.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
    this.#assertActiveWithTerminalReset();
    if (geometry === null) {
      this.#context.drawImage(
        image,
        0,
        0,
        this.#logicalWidth,
        this.#logicalHeight
      );
      this.#assertActiveWithTerminalReset();
      return;
    }
    validateStaticPresentationGeometry(
      geometry,
      this.#logicalWidth,
      this.#logicalHeight
    );
    const source = geometry.sourceRect;
    const destination = rasterizePresentationRect(
      geometry.destinationBackingRect
    );
    this.#context.drawImage(
      image,
      source.x,
      source.y,
      source.width,
      source.height,
      destination.x,
      destination.y,
      destination.width,
      destination.height
    );
    this.#assertActiveWithTerminalReset();
  }
}

interface StaticPresentationMapping {
  readonly backing: { readonly width: number; readonly height: number };
  readonly sourceRect: Readonly<{
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }>;
  readonly destinationBackingRect: Readonly<{
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }>;
}

function cloneStaticPresentationMapping(
  geometry: Readonly<PresentationGeometry>
): Readonly<StaticPresentationMapping> {
  // Capture each hostile nested reference once. Reading `geometry.backing`
  // separately for width and height could otherwise splice two caller-owned
  // objects into a mapping that never existed.
  const backing = geometry.backing;
  const source = geometry.sourceRect;
  const destination = geometry.destinationBackingRect;
  return Object.freeze({
    backing: Object.freeze({
      width: backing.width,
      height: backing.height
    }),
    sourceRect: Object.freeze({
      x: source.x,
      y: source.y,
      width: source.width,
      height: source.height
    }),
    destinationBackingRect: Object.freeze({
      x: destination.x,
      y: destination.y,
      width: destination.width,
      height: destination.height
    })
  });
}

function validateStaticPresentationGeometry(
  geometry: Readonly<StaticPresentationMapping>,
  logicalWidth?: number,
  logicalHeight?: number
): void {
  if (
    geometry === null ||
    typeof geometry !== "object" ||
    !Number.isSafeInteger(geometry.backing.width) ||
    !Number.isSafeInteger(geometry.backing.height) ||
    geometry.backing.width < 1 ||
    geometry.backing.height < 1 ||
    geometry.backing.width > MAX_PRESENTATION_BACKING_DIMENSION ||
    geometry.backing.height > MAX_PRESENTATION_BACKING_DIMENSION
  ) {
    throw new RangeError("static presentation geometry is invalid");
  }
  const source = geometry.sourceRect;
  if (
    !Number.isFinite(source.x) ||
    !Number.isFinite(source.y) ||
    !Number.isFinite(source.width) ||
    !Number.isFinite(source.height) ||
    source.x < 0 ||
    source.y < 0 ||
    source.width <= 0 ||
    source.height <= 0 ||
    (logicalWidth !== undefined && source.x + source.width > logicalWidth) ||
    (logicalHeight !== undefined && source.y + source.height > logicalHeight)
  ) {
    throw new RangeError("static presentation source crop is out of bounds");
  }
  const destination = rasterizePresentationRect(
    geometry.destinationBackingRect
  );
  const destinationRight = destination.x + destination.width;
  const destinationBottom = destination.y + destination.height;
  if (
    !Number.isSafeInteger(destinationRight) ||
    !Number.isSafeInteger(destinationBottom) ||
    destination.x >= geometry.backing.width ||
    destination.y >= geometry.backing.height ||
    destinationRight <= 0 ||
    destinationBottom <= 0
  ) {
    throw new RangeError(
      "static presentation destination does not intersect the backing"
    );
  }
}

function sameStaticPresentationGeometry(
  left: Readonly<StaticPresentationMapping> | null,
  right: Readonly<StaticPresentationMapping>
): boolean {
  return left !== null &&
    left.backing.width === right.backing.width &&
    left.backing.height === right.backing.height &&
    left.sourceRect.x === right.sourceRect.x &&
    left.sourceRect.y === right.sourceRect.y &&
    left.sourceRect.width === right.sourceRect.width &&
    left.sourceRect.height === right.sourceRect.height &&
    left.destinationBackingRect.x === right.destinationBackingRect.x &&
    left.destinationBackingRect.y === right.destinationBackingRect.y &&
    left.destinationBackingRect.width === right.destinationBackingRect.width &&
    left.destinationBackingRect.height === right.destinationBackingRect.height;
}

function disposedError(): StaticSurfaceStoreDisposedError {
  return new StaticSurfaceStoreDisposedError();
}

function validateStaticSurfaceSize(width: number, height: number): void {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_LOGICAL_CANVAS_DIMENSION ||
    height > MAX_LOGICAL_CANVAS_DIMENSION
  ) {
    throw new RangeError(
      "static presentation dimensions must be safe integers from 1 through " +
      String(MAX_LOGICAL_CANVAS_DIMENSION)
    );
  }
}
