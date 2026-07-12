import type { CanvasV01 } from "@rendered-motion/format";

import type { BrowserPresentationPlanesOptions } from "./browser-presentation-planes.js";
import {
  MAX_LOGICAL_CANVAS_DIMENSION,
  MAX_PRESENTATION_BACKING_DIMENSION,
  PRESENTATION_FIT_MODES,
  type PresentationFit
} from "./presentation-geometry.js";

export interface CapturedBrowserPresentationPlanesOptions {
  readonly animatedCanvas: HTMLCanvasElement;
  readonly staticCanvas: HTMLCanvasElement;
  readonly canvas: Readonly<CanvasV01>;
  readonly maxBackingWidth: number;
  readonly maxBackingHeight: number;
  readonly maxBackingBytes: number;
  readonly setStaticVisible: (visible: boolean) => void;
  readonly onClamp: BrowserPresentationPlanesOptions["onClamp"];
  readonly createBackend: BrowserPresentationPlanesOptions["createBackend"];
}

/** Capture every public constructor field once before any canvas is mutated. */
export function capturePresentationPlaneOptions(
  options: Readonly<BrowserPresentationPlanesOptions>
): Readonly<CapturedBrowserPresentationPlanesOptions> {
  if (options === null || typeof options !== "object") {
    throw new TypeError("browser presentation plane options are invalid");
  }
  let animatedCanvas: unknown;
  let staticCanvas: unknown;
  let canvasValue: unknown;
  let width: unknown;
  let height: unknown;
  let fit: unknown;
  let colorSpace: unknown;
  let pixelAspectValue: unknown;
  let pixelAspectNumerator: unknown;
  let pixelAspectDenominator: unknown;
  let maximumWidthValue: unknown;
  let maximumHeightValue: unknown;
  let maximumBytes: unknown;
  let setStaticVisible: unknown;
  let onClamp: unknown;
  let createBackend: unknown;
  try {
    animatedCanvas = Reflect.get(options, "animatedCanvas");
    staticCanvas = Reflect.get(options, "staticCanvas");
    canvasValue = Reflect.get(options, "canvas");
    if (canvasValue === null || typeof canvasValue !== "object") {
      throw new TypeError("canvas descriptor is invalid");
    }
    width = Reflect.get(canvasValue, "width");
    height = Reflect.get(canvasValue, "height");
    fit = Reflect.get(canvasValue, "fit");
    colorSpace = Reflect.get(canvasValue, "colorSpace");
    pixelAspectValue = Reflect.get(canvasValue, "pixelAspect");
    if (pixelAspectValue === null || typeof pixelAspectValue !== "object") {
      throw new TypeError("pixel aspect is invalid");
    }
    pixelAspectNumerator = Reflect.get(pixelAspectValue, 0);
    pixelAspectDenominator = Reflect.get(pixelAspectValue, 1);
    maximumWidthValue = Reflect.get(options, "maxBackingWidth");
    maximumHeightValue = Reflect.get(options, "maxBackingHeight");
    maximumBytes = Reflect.get(options, "maxBackingBytes");
    setStaticVisible = Reflect.get(options, "setStaticVisible");
    onClamp = Reflect.get(options, "onClamp");
    createBackend = Reflect.get(options, "createBackend");
  } catch {
    throw new TypeError("browser presentation plane options are invalid");
  }
  if (
    animatedCanvas === null ||
    typeof animatedCanvas !== "object" ||
    staticCanvas === null ||
    typeof staticCanvas !== "object" ||
    animatedCanvas === staticCanvas ||
    typeof setStaticVisible !== "function" ||
    (onClamp !== undefined && typeof onClamp !== "function") ||
    (createBackend !== undefined && typeof createBackend !== "function")
  ) {
    throw new TypeError("browser presentation plane options are invalid");
  }
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    (width as number) < 1 ||
    (height as number) < 1 ||
    (width as number) > MAX_LOGICAL_CANVAS_DIMENSION ||
    (height as number) > MAX_LOGICAL_CANVAS_DIMENSION ||
    !PRESENTATION_FIT_MODES.includes(fit as PresentationFit) ||
    colorSpace !== "srgb" ||
    !Number.isSafeInteger(pixelAspectNumerator) ||
    !Number.isSafeInteger(pixelAspectDenominator) ||
    (pixelAspectNumerator as number) < 1 ||
    (pixelAspectDenominator as number) < 1
  ) {
    throw new RangeError("browser presentation canvas descriptor is invalid");
  }
  const maximumWidth = maximumWidthValue ??
    MAX_PRESENTATION_BACKING_DIMENSION;
  const maximumHeight = maximumHeightValue ??
    MAX_PRESENTATION_BACKING_DIMENSION;
  for (const [value, label] of [
    [maximumWidth, "maximum backing width"],
    [maximumHeight, "maximum backing height"],
    [maximumBytes, "maximum backing bytes"]
  ] as const) {
    if (!Number.isSafeInteger(value) || (value as number) < 1) {
      throw new RangeError(`browser presentation ${label} is invalid`);
    }
  }
  if ((maximumBytes as number) < 8) {
    throw new RangeError(
      "browser presentation maximum backing bytes cannot hold both planes"
    );
  }
  const canvas = Object.freeze({
    width: width as number,
    height: height as number,
    fit: fit as PresentationFit,
    pixelAspect: Object.freeze([
      pixelAspectNumerator as number,
      pixelAspectDenominator as number
    ] as const),
    colorSpace: "srgb" as const
  });
  return Object.freeze({
    animatedCanvas: animatedCanvas as HTMLCanvasElement,
    staticCanvas: staticCanvas as HTMLCanvasElement,
    canvas,
    maxBackingWidth: maximumWidth as number,
    maxBackingHeight: maximumHeight as number,
    maxBackingBytes: maximumBytes as number,
    setStaticVisible: setStaticVisible as (visible: boolean) => void,
    onClamp: onClamp as BrowserPresentationPlanesOptions["onClamp"],
    createBackend: createBackend as BrowserPresentationPlanesOptions["createBackend"]
  });
}
