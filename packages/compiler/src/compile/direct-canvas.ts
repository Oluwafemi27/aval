import { CompilerError } from "../diagnostics.js";
import type { MediaProbe } from "../model.js";

export interface DirectCanvas {
  readonly width: number;
  readonly height: number;
}

const PNG_DIMENSION_MAX = 0xffff_ffff;

/** Validate an explicit canvas or preserve native source geometry exactly. */
export function resolveDirectCanvas(
  probe: Pick<MediaProbe, "width" | "height">,
  requested?: readonly [number, number],
  _requireExplicit = false
): Readonly<DirectCanvas> {
  if (requested !== undefined) {
    const [width, height] = requested;
    validateCanvas(width, height, probe);
    return Object.freeze({ width, height });
  }
  if (
    !Number.isSafeInteger(probe.width) ||
    !Number.isSafeInteger(probe.height) ||
    probe.width < 1 ||
    probe.height < 1 ||
    probe.width > PNG_DIMENSION_MAX ||
    probe.height > PNG_DIMENSION_MAX
  ) {
    throw new CompilerError(
      "INPUT_INVALID",
      "Source geometry is outside the supported unsigned 32-bit range"
    );
  }
  return Object.freeze({ width: probe.width, height: probe.height });
}

function validateCanvas(
  width: number,
  height: number,
  probe: Pick<MediaProbe, "width" | "height">
): void {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > PNG_DIMENSION_MAX ||
    height > PNG_DIMENSION_MAX ||
    width > probe.width ||
    height > probe.height ||
    BigInt(width) * BigInt(probe.height) !==
      BigInt(height) * BigInt(probe.width)
  ) {
    throw new CompilerError(
      "SOURCE_LIMIT",
      "Canvas must be positive, non-upscaled, and preserve source aspect"
    );
  }
}
