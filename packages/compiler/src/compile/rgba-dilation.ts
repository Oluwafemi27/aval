import { CompilerError } from "../diagnostics.js";

const MAX_VISIBLE_DIMENSION = 512;
const DILATION_RADIUS = 4;
const DILATION_RADIUS_SQUARED = DILATION_RADIUS * DILATION_RADIUS;

export interface RgbaDilationInput {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

/** Fill only fully transparent hidden RGB from the nearest original source. */
export function dilateTransparentRgba(
  input: Readonly<RgbaDilationInput>
): Uint8Array {
  const { width, height, rgba } = validateInput(input);
  const output = new Uint8Array(rgba);

  for (let destinationY = 0; destinationY < height; destinationY += 1) {
    for (let destinationX = 0; destinationX < width; destinationX += 1) {
      const destination = rgbaOffset(width, destinationX, destinationY);
      if (rgba[destination + 3]! > 0) continue;

      let bestOffset = -1;
      let bestDistance = DILATION_RADIUS_SQUARED + 1;
      let bestAlpha = -1;
      let bestY = Number.MAX_SAFE_INTEGER;
      let bestX = Number.MAX_SAFE_INTEGER;
      const minimumY = Math.max(0, destinationY - DILATION_RADIUS);
      const maximumY = Math.min(height - 1, destinationY + DILATION_RADIUS);
      const minimumX = Math.max(0, destinationX - DILATION_RADIUS);
      const maximumX = Math.min(width - 1, destinationX + DILATION_RADIUS);

      for (let sourceY = minimumY; sourceY <= maximumY; sourceY += 1) {
        const deltaY = sourceY - destinationY;
        for (let sourceX = minimumX; sourceX <= maximumX; sourceX += 1) {
          const deltaX = sourceX - destinationX;
          const distance = deltaX * deltaX + deltaY * deltaY;
          if (distance > DILATION_RADIUS_SQUARED) continue;
          const source = rgbaOffset(width, sourceX, sourceY);
          const alpha = rgba[source + 3]!;
          if (alpha === 0 || !isBetterSource(
            distance,
            alpha,
            sourceY,
            sourceX,
            bestDistance,
            bestAlpha,
            bestY,
            bestX
          )) continue;
          bestOffset = source;
          bestDistance = distance;
          bestAlpha = alpha;
          bestY = sourceY;
          bestX = sourceX;
        }
      }

      output[destination] = bestOffset < 0 ? 0 : rgba[bestOffset]!;
      output[destination + 1] = bestOffset < 0 ? 0 : rgba[bestOffset + 1]!;
      output[destination + 2] = bestOffset < 0 ? 0 : rgba[bestOffset + 2]!;
      output[destination + 3] = 0;
    }
  }
  return output;
}

function validateInput(
  input: Readonly<RgbaDilationInput>
): Readonly<RgbaDilationInput> {
  if (
    typeof input !== "object" ||
    input === null ||
    !Number.isSafeInteger(input.width) ||
    !Number.isSafeInteger(input.height) ||
    input.width < 1 ||
    input.height < 1 ||
    input.width > MAX_VISIBLE_DIMENSION ||
    input.height > MAX_VISIBLE_DIMENSION
  ) {
    throw new CompilerError(
      "INPUT_INVALID",
      "RGBA dilation dimensions must be positive integers no greater than 512"
    );
  }
  if (!(input.rgba instanceof Uint8Array)) {
    throw new CompilerError("INPUT_INVALID", "RGBA dilation requires bytes");
  }
  const expected = input.width * input.height * 4;
  if (!Number.isSafeInteger(expected) || input.rgba.byteLength !== expected) {
    throw new CompilerError(
      "SOURCE_LIMIT",
      "RGBA byte length does not match the dilation dimensions"
    );
  }
  return input;
}

function rgbaOffset(width: number, x: number, y: number): number {
  return (y * width + x) * 4;
}

function isBetterSource(
  distance: number,
  alpha: number,
  y: number,
  x: number,
  bestDistance: number,
  bestAlpha: number,
  bestY: number,
  bestX: number
): boolean {
  return distance < bestDistance ||
    (distance === bestDistance && (
      alpha > bestAlpha ||
      (alpha === bestAlpha && (
        y < bestY || (y === bestY && x < bestX)
      ))
    ));
}
