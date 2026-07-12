import { FormatError, isFormatError } from "../errors.js";

const BYTES_PER_PIXEL = 4;
const MAX_DIMENSION = 512;

export interface PngUnfilterInput {
  readonly filtered: Uint8Array;
  readonly width: number;
  readonly height: number;
}

/** Reconstruct exact noninterlaced 8-bit RGBA scanlines for filters 0-4. */
export function unfilterPngRgba(input: PngUnfilterInput): Uint8Array {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      fail("PNG unfilter input must be an object");
    }
    const width = dimension(input.width, "PNG width");
    const height = dimension(input.height, "PNG height");
    if (!(input.filtered instanceof Uint8Array)) {
      fail("filtered PNG bytes must be a Uint8Array");
    }
    const stride = width * BYTES_PER_PIXEL;
    const expectedFilteredBytes = height * (stride + 1);
    if (input.filtered.byteLength !== expectedFilteredBytes) {
      fail("filtered PNG length does not match its dimensions");
    }
    const rgba = new Uint8Array(width * height * BYTES_PER_PIXEL);
    for (let row = 0; row < height; row += 1) {
      const sourceRow = row * (stride + 1);
      const targetRow = row * stride;
      const filter = input.filtered[sourceRow]!;
      if (filter > 4) {
        fail("PNG scanline filter must be from 0 through 4", sourceRow);
      }
      for (let column = 0; column < stride; column += 1) {
        const encoded = input.filtered[sourceRow + 1 + column]!;
        const left = column >= BYTES_PER_PIXEL
          ? rgba[targetRow + column - BYTES_PER_PIXEL]!
          : 0;
        const up = row > 0 ? rgba[targetRow - stride + column]! : 0;
        const upperLeft = row > 0 && column >= BYTES_PER_PIXEL
          ? rgba[targetRow - stride + column - BYTES_PER_PIXEL]!
          : 0;
        const predictor = filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? up
              : filter === 3
                ? Math.floor((left + up) / 2)
                : paeth(left, up, upperLeft);
        rgba[targetRow + column] = (encoded + predictor) & 0xff;
      }
    }
    return rgba;
  } catch (error) {
    if (isFormatError(error)) throw error;
    throw new FormatError(
      "PNG_SCANLINE_INVALID",
      "PNG scanlines could not be reconstructed"
    );
  }
}

function dimension(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_DIMENSION
  ) {
    fail(`${label} must be from 1 through ${String(MAX_DIMENSION)}`);
  }
  return value;
}

function paeth(left: number, up: number, upperLeft: number): number {
  const prediction = left + up - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const upDistance = Math.abs(prediction - up);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) {
    return left;
  }
  return upDistance <= upperLeftDistance ? up : upperLeft;
}

function fail(message: string, offset?: number): never {
  throw new FormatError(
    "PNG_SCANLINE_INVALID",
    message,
    offset === undefined ? undefined : { offset }
  );
}
