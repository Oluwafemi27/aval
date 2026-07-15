import {
  deriveAvcRenditionGeometry,
  type AvcRenditionGeometry,
  type Rect
} from "@pixel-point/aval-format";

import { STREAMING_TEXTURE_LAYER_COUNT } from "./checked-runtime-bytes.js";
import type {
  FrameRendererBackend,
  FrameTextureLayout,
  LegacyOpaqueFrameRendererBackend,
  LegacyOpaqueFrameTextureLayout
} from "./frame-renderer.js";

export interface FrameUvTransform {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

export interface FrameSamplingLayout {
  readonly hasAlpha: boolean;
  /** Visible color/alpha pane size before coded padding. */
  readonly visibleWidth: number;
  readonly visibleHeight: number;
  readonly color: Readonly<FrameUvTransform>;
  readonly alpha: Readonly<FrameUvTransform> | null;
}

export function freezeFrameLayout(
  layout: FrameTextureLayout
): Readonly<FrameTextureLayout> {
  validateFrameObject(layout, "frame texture layout");
  const logicalWidth = validateFrameDimension(
    layout.logicalWidth,
    "logical width"
  );
  const logicalHeight = validateFrameDimension(
    layout.logicalHeight,
    "logical height"
  );
  const geometry = freezeFrameGeometry(
    layout.geometry,
    logicalWidth,
    logicalHeight
  );
  const residentLayerCount = validateFrameNonNegativeDimension(
    layout.residentLayerCount,
    "resident texture layer count"
  );
  checkedFrameRgbaBytes(logicalWidth, logicalHeight);
  return Object.freeze({
    geometry,
    logicalWidth,
    logicalHeight,
    residentLayerCount
  });
}

export function createLegacyOpaqueFrameLayout(
  layout: LegacyOpaqueFrameTextureLayout
): Readonly<FrameTextureLayout> {
  validateFrameObject(layout, "opaque texture layout");
  const codedWidth = validateFrameDimension(
    layout.codedWidth,
    "coded texture width"
  );
  const codedHeight = validateFrameDimension(
    layout.codedHeight,
    "coded texture height"
  );
  const decodedRgbaBytes = checkedFrameRgbaBytes(codedWidth, codedHeight);
  const rect = Object.freeze([0, 0, codedWidth, codedHeight]) as Rect;
  const geometry: Readonly<AvcRenditionGeometry> = Object.freeze({
    profile: "avc-annexb-opaque-v0",
    visibleColorRect: rect,
    decodedStorageRect: rect,
    codedWidth,
    codedHeight,
    visibleColorArea: codedWidth * codedHeight,
    decodedRgbaBytes,
    codedRgbaBytes: decodedRgbaBytes
  });
  return freezeLegacyFrameLayout({
    geometry,
    logicalWidth: layout.logicalWidth,
    logicalHeight: layout.logicalHeight,
    residentLayerCount: layout.residentLayerCount
  });
}

/** Package-internal compatibility path for the deprecated opaque adapter. */
export function freezeLegacyFrameLayout(
  layout: FrameTextureLayout
): Readonly<FrameTextureLayout> {
  validateFrameObject(layout, "frame texture layout");
  const geometry = freezeFrameGeometryStructure(layout.geometry);
  const logicalWidth = validateFrameDimension(
    layout.logicalWidth,
    "logical width"
  );
  const logicalHeight = validateFrameDimension(
    layout.logicalHeight,
    "logical height"
  );
  const residentLayerCount = validateFrameNonNegativeDimension(
    layout.residentLayerCount,
    "resident texture layer count"
  );
  checkedFrameRgbaBytes(logicalWidth, logicalHeight);
  return Object.freeze({
    geometry,
    logicalWidth,
    logicalHeight,
    residentLayerCount
  });
}

export function toLegacyOpaqueFrameLayout(
  layout: Readonly<FrameTextureLayout>
): Readonly<LegacyOpaqueFrameTextureLayout> {
  return Object.freeze({
    codedWidth: layout.geometry.codedWidth,
    codedHeight: layout.geometry.codedHeight,
    logicalWidth: layout.logicalWidth,
    logicalHeight: layout.logicalHeight,
    residentLayerCount: layout.residentLayerCount
  });
}

/** @deprecated Compatibility validator for the old opaque-only surface. */
export function freezeLegacyOpaqueFrameLayout(
  layout: LegacyOpaqueFrameTextureLayout
): Readonly<LegacyOpaqueFrameTextureLayout> {
  return toLegacyOpaqueFrameLayout(createLegacyOpaqueFrameLayout(layout));
}

/** @deprecated Compatibility validator for the old opaque-only surface. */
export function validateLegacyOpaqueBackendLimits(
  backend: LegacyOpaqueFrameRendererBackend,
  layout: Readonly<LegacyOpaqueFrameTextureLayout>
): void {
  validateFrameBackendLimits(
    backend as unknown as FrameRendererBackend,
    createLegacyOpaqueFrameLayout(layout)
  );
}

export function deriveFrameSamplingLayout(
  layout: Readonly<FrameTextureLayout>
): Readonly<FrameSamplingLayout> {
  const geometry = layout.geometry;
  validateFrameObject(geometry, "frame texture layout geometry");
  const color = deriveUvTransform(
    geometry.visibleColorRect,
    geometry.codedWidth,
    geometry.codedHeight
  );
  const alphaRect = geometry.visibleAlphaRect;
  return Object.freeze({
    hasAlpha: alphaRect !== undefined,
    visibleWidth: geometry.visibleColorRect[2],
    visibleHeight: geometry.visibleColorRect[3],
    color,
    alpha: alphaRect === undefined
      ? null
      : deriveUvTransform(
          alphaRect,
          geometry.codedWidth,
          geometry.codedHeight
        )
  });
}

export function validateFrameBackendLimits(
  backend: FrameRendererBackend,
  layout: Readonly<FrameTextureLayout>
): void {
  validateFrameObject(backend, "frame renderer backend");
  validateFrameObject(backend.limits, "frame renderer backend limits");
  const { maxTextureSize, maxArrayTextureLayers } = backend.limits;
  validateFrameDimension(maxTextureSize, "MAX_TEXTURE_SIZE");
  validateFrameDimension(maxArrayTextureLayers, "MAX_ARRAY_TEXTURE_LAYERS");
  if (
    layout.geometry.codedWidth > maxTextureSize ||
    layout.geometry.codedHeight > maxTextureSize
  ) {
    throw new RangeError("frame texture dimensions exceed MAX_TEXTURE_SIZE");
  }
  if (layout.residentLayerCount > maxArrayTextureLayers) {
    throw new RangeError("resident layers exceed MAX_ARRAY_TEXTURE_LAYERS");
  }
  if (STREAMING_TEXTURE_LAYER_COUNT > maxArrayTextureLayers) {
    throw new RangeError("streaming layers exceed MAX_ARRAY_TEXTURE_LAYERS");
  }
}

export function checkedFrameRgbaBytes(width: number, height: number): number {
  const pixels = width * height;
  const bytes = pixels * 4;
  if (!Number.isSafeInteger(pixels) || !Number.isSafeInteger(bytes)) {
    throw new RangeError("RGBA byte count exceeds safe integer range");
  }
  return bytes;
}

export function checkedFrameTextureBytes(
  bytesPerLayer: number,
  layerCount: number
): number {
  const bytes = bytesPerLayer * layerCount;
  if (!Number.isSafeInteger(bytes)) {
    throw new RangeError("frame texture byte count exceeds safe integer range");
  }
  return bytes;
}

export function validateFrameDimension(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

export function validateFrameNonNegativeDimension(
  value: number,
  label: string
): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

export function validateFrameStreamingSlots(value: number): number {
  if (value !== STREAMING_TEXTURE_LAYER_COUNT) {
    throw new RangeError(
      `streaming slots must be exactly ${String(STREAMING_TEXTURE_LAYER_COUNT)}`
    );
  }
  return value;
}

export function validateFrameIndex(
  value: number,
  exclusiveEnd: number,
  label: string
): void {
  if (!Number.isSafeInteger(value) || value < 0 || value >= exclusiveEnd) {
    throw new RangeError(
      `${label} must be an integer in [0, ${String(exclusiveEnd)})`
    );
  }
}

export function validateFrameGeneration(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
}

export function validateFrameObject(value: unknown, label: string): void {
  if (value === null || typeof value !== "object") {
    throw new TypeError(`${label} must be an object`);
  }
}

function freezeFrameGeometry(
  geometry: Readonly<AvcRenditionGeometry>,
  logicalWidth: number,
  logicalHeight: number
): Readonly<AvcRenditionGeometry> {
  const normalized = freezeFrameGeometryStructure(geometry);
  const derived = deriveAvcRenditionGeometry(
    normalized.profile === "avc-annexb-packed-alpha-v0" ||
      normalized.profile === "avc-annexb-packed-alpha-v1"
      ? {
          profile: normalized.profile,
          canvasWidth: logicalWidth,
          canvasHeight: logicalHeight,
          colorRect: normalized.visibleColorRect,
          alphaRect: normalized.visibleAlphaRect!,
          codedWidth: normalized.codedWidth,
          codedHeight: normalized.codedHeight
        }
      : {
          profile: normalized.profile,
          canvasWidth: logicalWidth,
          canvasHeight: logicalHeight,
          colorRect: normalized.visibleColorRect,
          codedWidth: normalized.codedWidth,
          codedHeight: normalized.codedHeight
        }
  );
  if (
    !sameRect(normalized.decodedStorageRect, derived.decodedStorageRect) ||
    normalized.visibleColorArea !== derived.visibleColorArea ||
    normalized.decodedRgbaBytes !== derived.decodedRgbaBytes ||
    normalized.codedRgbaBytes !== derived.codedRgbaBytes
  ) {
    throw new RangeError(
      "frame geometry does not match the canonical AVC rendition geometry"
    );
  }
  return derived;
}

function freezeFrameGeometryStructure(
  geometry: Readonly<AvcRenditionGeometry>
): Readonly<AvcRenditionGeometry> {
  validateFrameObject(geometry, "frame texture layout geometry");
  const codedWidth = validateFrameDimension(
    geometry.codedWidth,
    "coded texture width"
  );
  const codedHeight = validateFrameDimension(
    geometry.codedHeight,
    "coded texture height"
  );
  const visibleColorRect = freezeRect(
    geometry.visibleColorRect,
    "visible color rectangle",
    codedWidth,
    codedHeight
  );
  const decodedStorageRect = freezeRect(
    geometry.decodedStorageRect,
    "decoded storage rectangle",
    codedWidth,
    codedHeight
  );
  const codedRgbaBytes = checkedFrameRgbaBytes(codedWidth, codedHeight);
  if (geometry.codedRgbaBytes !== codedRgbaBytes) {
    throw new RangeError("geometry coded RGBA byte count is inconsistent");
  }
  const decodedRgbaBytes = checkedFrameRgbaBytes(
    decodedStorageRect[2],
    decodedStorageRect[3]
  );
  if (geometry.decodedRgbaBytes !== decodedRgbaBytes) {
    throw new RangeError("geometry decoded RGBA byte count is inconsistent");
  }
  const visibleColorArea = visibleColorRect[2] * visibleColorRect[3];
  if (geometry.visibleColorArea !== visibleColorArea) {
    throw new RangeError("geometry visible color area is inconsistent");
  }

  let visibleAlphaRect: Rect | undefined;
  if (
    geometry.profile === "avc-annexb-opaque-v0" ||
    geometry.profile === "avc-annexb-opaque-v1"
  ) {
    if (geometry.visibleAlphaRect !== undefined) {
      throw new RangeError("opaque frame geometry must not contain alpha");
    }
  } else if (
    geometry.profile === "avc-annexb-packed-alpha-v0" ||
    geometry.profile === "avc-annexb-packed-alpha-v1"
  ) {
    if (geometry.visibleAlphaRect === undefined) {
      throw new RangeError("packed-alpha frame geometry requires alpha");
    }
    visibleAlphaRect = freezeRect(
      geometry.visibleAlphaRect,
      "visible alpha rectangle",
      codedWidth,
      codedHeight
    );
    if (
      visibleAlphaRect[2] !== visibleColorRect[2] ||
      visibleAlphaRect[3] !== visibleColorRect[3]
    ) {
      throw new RangeError("color and alpha rectangles must have equal size");
    }
  } else {
    throw new RangeError("frame geometry profile is unsupported");
  }

  requireRectInside(
    visibleColorRect,
    decodedStorageRect,
    "visible color rectangle"
  );
  if (visibleAlphaRect !== undefined) {
    requireRectInside(
      visibleAlphaRect,
      decodedStorageRect,
      "visible alpha rectangle"
    );
  }

  return Object.freeze({
    profile: geometry.profile,
    visibleColorRect,
    ...(visibleAlphaRect === undefined ? {} : { visibleAlphaRect }),
    decodedStorageRect,
    codedWidth,
    codedHeight,
    visibleColorArea,
    decodedRgbaBytes,
    codedRgbaBytes
  });
}

function sameRect(left: Rect, right: Rect): boolean {
  return left.every((value, index) => value === right[index]);
}

function freezeRect(
  value: Rect,
  label: string,
  codedWidth: number,
  codedHeight: number
): Rect {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new TypeError(`${label} must contain exactly four integers`);
  }
  const [x, y, width, height] = value;
  if (
    !Number.isSafeInteger(x) || x < 0 ||
    !Number.isSafeInteger(y) || y < 0 ||
    !Number.isSafeInteger(width) || width <= 0 ||
    !Number.isSafeInteger(height) || height <= 0 ||
    x + width > codedWidth || y + height > codedHeight
  ) {
    throw new RangeError(`${label} must fit the coded texture`);
  }
  return Object.freeze([x, y, width, height]) as Rect;
}

function requireRectInside(inner: Rect, outer: Rect, label: string): void {
  if (
    inner[0] < outer[0] ||
    inner[1] < outer[1] ||
    inner[0] + inner[2] > outer[0] + outer[2] ||
    inner[1] + inner[3] > outer[1] + outer[3]
  ) {
    throw new RangeError(`${label} must fit the decoded storage rectangle`);
  }
}

function deriveUvTransform(
  rect: Rect,
  codedWidth: number,
  codedHeight: number
): Readonly<FrameUvTransform> {
  return Object.freeze({
    offsetX: (rect[0] + 0.5) / codedWidth,
    offsetY: (rect[1] + 0.5) / codedHeight,
    scaleX: (rect[2] - 1) / codedWidth,
    scaleY: (rect[3] - 1) / codedHeight
  });
}
