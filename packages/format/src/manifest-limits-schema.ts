import { deriveAvcRenditionGeometryAtPath } from "./avc/rendition-geometry.js";
import { checkedMultiply } from "./checked-integer.js";
import {
  exactKeys,
  integerInRange,
  invalid,
  positiveInteger,
  record
} from "./manifest-validation.js";
import type {
  CanvasV01,
  DeclaredLimitsV01,
  FormatBudgets,
  RenditionV01
} from "./model.js";

export function cloneDeclaredLimits(
  value: unknown,
  renditions: readonly RenditionV01[],
  canvas: CanvasV01,
  budgets: FormatBudgets,
  path: string
): DeclaredLimitsV01 {
  const input = record(value, path);
  exactKeys(
    input,
    [
      "maxCompiledBytes",
      "maxRuntimeBytes",
      "decodedPixelBytes",
      "persistentCacheBytes",
      "runtimeWorkingSetBytes"
    ],
    path
  );
  const maxCompiledBytes = positiveInteger(
    input.maxCompiledBytes,
    `${path}.maxCompiledBytes`,
    budgets.maxFileBytes
  );
  const maxRuntimeBytes = positiveInteger(
    input.maxRuntimeBytes,
    `${path}.maxRuntimeBytes`
  );
  const decodedPixelBytes = integerInRange(
    input.decodedPixelBytes,
    `${path}.decodedPixelBytes`,
    0,
    maxRuntimeBytes
  );
  const persistentCacheBytes = integerInRange(
    input.persistentCacheBytes,
    `${path}.persistentCacheBytes`,
    0,
    maxRuntimeBytes
  );
  const runtimeWorkingSetBytes = integerInRange(
    input.runtimeWorkingSetBytes,
    `${path}.runtimeWorkingSetBytes`,
    0,
    maxRuntimeBytes
  );
  if (
    runtimeWorkingSetBytes < decodedPixelBytes ||
    runtimeWorkingSetBytes < persistentCacheBytes
  ) {
    invalid(
      `${path}.runtimeWorkingSetBytes`,
      "must be at least decodedPixelBytes and persistentCacheBytes"
    );
  }
  const minimumDecodedBytes = Math.max(
    ...renditions.map((rendition, index) => {
      if (rendition.profile === "reference-rgba-v0") {
        return checkedMultiply(
          checkedMultiply(
            rendition.codedWidth,
            rendition.codedHeight,
            Number.MAX_SAFE_INTEGER,
            `renditions[${String(index)}] decoded pixel count`
          ),
          4,
          Number.MAX_SAFE_INTEGER,
          `renditions[${String(index)}] decoded RGBA bytes`
        );
      }
      const common = {
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        codedWidth: rendition.codedWidth,
        codedHeight: rendition.codedHeight,
        colorRect: rendition.alphaLayout.colorRect
      } as const;
      return deriveAvcRenditionGeometryAtPath(
        rendition.profile === "avc-annexb-packed-alpha-v0" ||
          rendition.profile === "avc-annexb-packed-alpha-v1"
          ? {
              ...common,
              profile: rendition.profile,
              alphaRect: rendition.alphaLayout.alphaRect
            }
          : { ...common, profile: rendition.profile },
        `renditions[${String(index)}]`
      ).codedRgbaBytes;
    })
  );
  if (decodedPixelBytes < minimumDecodedBytes) {
    invalid(
      `${path}.decodedPixelBytes`,
      `must be at least ${String(minimumDecodedBytes)}`
    );
  }
  return Object.freeze({
    maxCompiledBytes,
    maxRuntimeBytes,
    decodedPixelBytes,
    persistentCacheBytes,
    runtimeWorkingSetBytes
  });
}
