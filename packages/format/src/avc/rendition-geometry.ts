import type { Rect } from "../model.js";
import { avcInvalid } from "./failure.js";

const MAX_CANVAS_DIMENSION = 512;
const MAX_CODED_DIMENSION = 2_048;
const MAX_CODED_PIXELS = 1_100_000;
const PACKED_ALPHA_GUTTER = 8;

export type AvcProductionRenditionProfileV01 =
  | "avc-annexb-opaque-v0"
  | "avc-annexb-packed-alpha-v0";

interface AvcRenditionGeometryInputBase {
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly codedWidth: number;
  readonly codedHeight: number;
  readonly colorRect: Rect;
}

export type AvcRenditionGeometryInput =
  | (AvcRenditionGeometryInputBase & {
      readonly profile: "avc-annexb-opaque-v0";
      readonly alphaRect?: never;
    })
  | (AvcRenditionGeometryInputBase & {
      readonly profile: "avc-annexb-packed-alpha-v0";
      readonly alphaRect: Rect;
    });

export interface AvcVisibleRenditionGeometryInput {
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly profile: AvcProductionRenditionProfileV01;
  readonly visibleWidth: number;
  readonly visibleHeight: number;
}

export interface AvcRenditionGeometry {
  readonly profile: AvcProductionRenditionProfileV01;
  readonly visibleColorRect: Rect;
  readonly visibleAlphaRect?: Rect;
  readonly decodedStorageRect: Rect;
  readonly codedWidth: number;
  readonly codedHeight: number;
  readonly visibleColorArea: number;
  readonly decodedRgbaBytes: number;
  readonly codedRgbaBytes: number;
}

/**
 * Validate and derive every visible, cropped-storage, and coded AVC dimension.
 *
 * This is the sole rendition-geometry authority shared by schema validation,
 * compilation, worker validation, resource accounting, and presentation.
 */
export function deriveAvcRenditionGeometry(
  input: AvcRenditionGeometryInput
): AvcRenditionGeometry {
  return deriveAvcRenditionGeometryAtPath(input, "rendition");
}

/** Derive compiler-ready rectangles and coded dimensions from visible facts. */
export function deriveAvcRenditionGeometryFromVisible(
  input: AvcVisibleRenditionGeometryInput
): AvcRenditionGeometry {
  return deriveAvcRenditionGeometryFromVisibleAtPath(input, "rendition");
}

/** Package-internal diagnostic-path adapter; not exported by the package. */
export function deriveAvcRenditionGeometryAtPath(
  input: AvcRenditionGeometryInput,
  path: string
): AvcRenditionGeometry {
  requireInputObject(input, path);
  const codedWidth = boundedPositiveInteger(
    input.codedWidth,
    MAX_CODED_DIMENSION,
    `${path}.codedWidth`
  );
  const codedHeight = boundedPositiveInteger(
    input.codedHeight,
    MAX_CODED_DIMENSION,
    `${path}.codedHeight`
  );
  const codedPixels = checkedProduct(
    codedWidth,
    codedHeight,
    `${path}.codedWidth`
  );
  if (codedPixels > MAX_CODED_PIXELS) {
    avcInvalid(
      `${path}.codedWidth`,
      `coded pixel count must be at most ${String(MAX_CODED_PIXELS)}`
    );
  }

  const colorPath = `${path}.alphaLayout.colorRect`;
  const colorRect = cloneRect(input.colorRect, colorPath);
  const derived = deriveAvcRenditionGeometryFromVisibleAtPath({
    canvasWidth: input.canvasWidth,
    canvasHeight: input.canvasHeight,
    profile: input.profile,
    visibleWidth: colorRect[2],
    visibleHeight: colorRect[3]
  }, path);
  requireEqualRect(
    colorRect,
    derived.visibleColorRect,
    colorPath,
    "visible color rectangle does not match the derived geometry"
  );
  if (input.profile === "avc-annexb-opaque-v0") {
    if (Object.prototype.hasOwnProperty.call(input, "alphaRect")) {
      avcInvalid(
        `${path}.alphaLayout`,
        "opaque AVC geometry must not declare an alpha rectangle"
      );
    }
  } else if (input.profile === "avc-annexb-packed-alpha-v0") {
    const alphaPath = `${path}.alphaLayout.alphaRect`;
    const visibleAlphaRect = cloneRect(input.alphaRect, alphaPath);
    const expectedAlphaRect = derived.visibleAlphaRect;
    if (expectedAlphaRect === undefined) {
      avcInvalid(alphaPath, "packed alpha geometry is missing its derived pane");
    }
    requireEqualRect(
      visibleAlphaRect,
      expectedAlphaRect,
      alphaPath,
      "packed alpha rectangle must follow the fixed eight-pixel gutter"
    );
  } else {
    avcInvalid(`${path}.profile`, "has an unsupported production AVC profile");
  }
  if (codedWidth !== derived.codedWidth) {
    avcInvalid(
      `${path}.codedWidth`,
      `must equal the derived coded width ${String(derived.codedWidth)}`
    );
  }
  if (codedHeight !== derived.codedHeight) {
    avcInvalid(
      `${path}.codedHeight`,
      `must equal the derived coded height ${String(derived.codedHeight)}`
    );
  }
  return derived;
}

/** Package-internal diagnostic-path adapter; not exported by the package. */
export function deriveAvcRenditionGeometryFromVisibleAtPath(
  input: AvcVisibleRenditionGeometryInput,
  path: string
): AvcRenditionGeometry {
  requireVisibleInputObject(input, path);
  const canvasWidth = boundedPositiveInteger(
    input.canvasWidth,
    MAX_CANVAS_DIMENSION,
    "canvas.width"
  );
  const canvasHeight = boundedPositiveInteger(
    input.canvasHeight,
    MAX_CANVAS_DIMENSION,
    "canvas.height"
  );
  const colorPath = `${path}.alphaLayout.colorRect`;
  const visibleWidth = boundedPositiveInteger(
    input.visibleWidth,
    MAX_CANVAS_DIMENSION,
    `${colorPath}[2]`
  );
  const visibleHeight = boundedPositiveInteger(
    input.visibleHeight,
    MAX_CANVAS_DIMENSION,
    `${colorPath}[3]`
  );
  if (visibleWidth > canvasWidth || visibleHeight > canvasHeight) {
    avcInvalid(colorPath, "visible color rectangle must fit the logical canvas");
  }
  if (
    BigInt(visibleWidth) * BigInt(canvasHeight) !==
    BigInt(visibleHeight) * BigInt(canvasWidth)
  ) {
    avcInvalid(colorPath, "visible color rectangle must retain the canvas aspect");
  }
  if (
    input.profile !== "avc-annexb-opaque-v0" &&
    input.profile !== "avc-annexb-packed-alpha-v0"
  ) {
    avcInvalid(`${path}.profile`, "has an unsupported production AVC profile");
  }

  const paneWidth = even(visibleWidth, colorPath);
  const paneHeight = even(visibleHeight, colorPath);
  const visibleColorRect = Object.freeze([
    0,
    0,
    visibleWidth,
    visibleHeight
  ]) as Rect;
  let storageHeight = paneHeight;
  let visibleAlphaRect: Rect | undefined;
  if (input.profile === "avc-annexb-packed-alpha-v0") {
    const alphaPath = `${path}.alphaLayout.alphaRect`;
    visibleAlphaRect = Object.freeze([
      0,
      checkedSum(paneHeight, PACKED_ALPHA_GUTTER, alphaPath),
      visibleWidth,
      visibleHeight
    ]) as Rect;
    storageHeight = checkedSum(
      checkedProduct(2, paneHeight, alphaPath),
      PACKED_ALPHA_GUTTER,
      alphaPath
    );
  }
  const codedWidth = align16(paneWidth, `${path}.codedWidth`);
  const codedHeight = align16(storageHeight, `${path}.codedHeight`);
  if (codedWidth > MAX_CODED_DIMENSION || codedHeight > MAX_CODED_DIMENSION) {
    avcInvalid(path, "derived coded dimensions exceed the AVC profile");
  }
  const codedPixels = checkedProduct(
    codedWidth,
    codedHeight,
    `${path}.codedWidth`
  );
  if (codedPixels > MAX_CODED_PIXELS) {
    avcInvalid(path, `coded pixel count must be at most ${String(MAX_CODED_PIXELS)}`);
  }
  const decodedStorageRect = Object.freeze([
    0,
    0,
    paneWidth,
    storageHeight
  ]) as Rect;
  const visibleColorArea = checkedProduct(
    visibleWidth,
    visibleHeight,
    colorPath
  );
  const decodedRgbaBytes = checkedProduct(
    checkedProduct(paneWidth, storageHeight, `${path}.decodedStorageRect`),
    4,
    `${path}.decodedStorageRect`
  );
  const codedRgbaBytes = checkedProduct(
    codedPixels,
    4,
    `${path}.codedWidth`
  );

  return Object.freeze({
    profile: input.profile,
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

function requireInputObject(
  input: AvcRenditionGeometryInput,
  path: string
): void {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    avcInvalid(path, "AVC rendition geometry must be an object");
  }
}

function requireVisibleInputObject(
  input: AvcVisibleRenditionGeometryInput,
  path: string
): void {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    avcInvalid(path, "visible AVC rendition geometry must be an object");
  }
}

function boundedPositiveInteger(
  value: unknown,
  maximum: number,
  path: string
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > maximum
  ) {
    avcInvalid(
      path,
      `must be a positive safe integer no greater than ${String(maximum)}`
    );
  }
  return value;
}

function cloneRect(value: unknown, path: string): Rect {
  if (!Array.isArray(value) || value.length !== 4) {
    avcInvalid(path, "must contain exactly four integers");
  }
  for (let index = 0; index < 4; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, String(index))) {
      avcInvalid(path, "must be a dense rectangle tuple");
    }
  }
  const x = nonNegativeInteger(value[0], `${path}[0]`);
  const y = nonNegativeInteger(value[1], `${path}[1]`);
  const width = boundedPositiveInteger(
    value[2],
    MAX_CANVAS_DIMENSION,
    `${path}[2]`
  );
  const height = boundedPositiveInteger(
    value[3],
    MAX_CANVAS_DIMENSION,
    `${path}[3]`
  );
  return Object.freeze([x, y, width, height]);
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    avcInvalid(path, "must be a nonnegative safe integer");
  }
  return value;
}

function even(value: number, path: string): number {
  return value % 2 === 0 ? value : checkedSum(value, 1, path);
}

function align16(value: number, path: string): number {
  const remainder = value % 16;
  return remainder === 0 ? value : checkedSum(value, 16 - remainder, path);
}

function checkedSum(left: number, right: number, path: string): number {
  if (left > Number.MAX_SAFE_INTEGER - right) {
    avcInvalid(path, "geometry sum exceeds the safe integer range");
  }
  return left + right;
}

function checkedProduct(left: number, right: number, path: string): number {
  if (left !== 0 && right > Math.floor(Number.MAX_SAFE_INTEGER / left)) {
    avcInvalid(path, "geometry product exceeds the safe integer range");
  }
  return left * right;
}

function requireEqualRect(
  actual: Rect,
  expected: Rect,
  path: string,
  message: string
): void {
  if (actual.some((value, index) => value !== expected[index])) {
    avcInvalid(path, message);
  }
}
