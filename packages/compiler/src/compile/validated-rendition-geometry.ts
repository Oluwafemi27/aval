import {
  FormatError,
  deriveAvcRenditionGeometry,
  type AvcRenditionGeometry,
  type Rect
} from "@aval/format";

import { CompilerError, type CompilerErrorDetails } from "../diagnostics.js";

/** Revalidate a derived geometry object through the sole format authority. */
export function revalidateAvcRenditionGeometry(
  geometry: Readonly<AvcRenditionGeometry>,
  options: Readonly<{
    readonly message?: string;
    readonly details?: CompilerErrorDetails;
  }> = {}
): Readonly<AvcRenditionGeometry> {
  const message = options.message ?? "AVC rendition geometry is invalid";
  if (
    typeof geometry !== "object" ||
    geometry === null ||
    !isRect(geometry.visibleColorRect) ||
    !isRect(geometry.decodedStorageRect)
  ) {
    throw invalid(message, options.details);
  }
  let validated: Readonly<AvcRenditionGeometry>;
  try {
    validated = deriveAvcRenditionGeometry(
      geometry.profile === "avc-annexb-opaque-v0" ||
        geometry.profile === "avc-annexb-opaque-v1"
        ? {
            profile: geometry.profile,
            canvasWidth: geometry.visibleColorRect[2],
            canvasHeight: geometry.visibleColorRect[3],
            codedWidth: geometry.codedWidth,
            codedHeight: geometry.codedHeight,
            colorRect: geometry.visibleColorRect
          }
        : (geometry.profile === "avc-annexb-packed-alpha-v0" ||
            geometry.profile === "avc-annexb-packed-alpha-v1") &&
            isRect(geometry.visibleAlphaRect)
          ? {
              profile: geometry.profile,
              canvasWidth: geometry.visibleColorRect[2],
              canvasHeight: geometry.visibleColorRect[3],
              codedWidth: geometry.codedWidth,
              codedHeight: geometry.codedHeight,
              colorRect: geometry.visibleColorRect,
              alphaRect: geometry.visibleAlphaRect
            }
          : failUnsupported(message, options.details)
    );
  } catch (error) {
    if (error instanceof CompilerError) throw error;
    if (error instanceof FormatError) {
      throw invalid(message, { ...options.details, cause: error });
    }
    throw error;
  }
  if (
    !sameRect(geometry.decodedStorageRect, validated.decodedStorageRect) ||
    geometry.visibleColorArea !== validated.visibleColorArea ||
    geometry.decodedRgbaBytes !== validated.decodedRgbaBytes ||
    geometry.codedRgbaBytes !== validated.codedRgbaBytes
  ) {
    throw invalid(message, options.details);
  }
  return validated;
}

function isRect(value: unknown): value is Rect {
  return Array.isArray(value) &&
    value.length === 4 &&
    value.every((part) => Number.isSafeInteger(part) && part >= 0);
}

function sameRect(left: Rect, right: Rect): boolean {
  return left.every((value, index) => value === right[index]);
}

function failUnsupported(
  message: string,
  details?: CompilerErrorDetails
): never {
  throw invalid(message, details);
}

function invalid(
  message: string,
  details?: CompilerErrorDetails
): CompilerError {
  return new CompilerError("INPUT_INVALID", message, details);
}
