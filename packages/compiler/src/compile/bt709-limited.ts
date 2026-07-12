const LUMA_RED = 2_126;
const LUMA_GREEN = 7_152;
const LUMA_BLUE = 722;
const LUMA_SCALE = 10_000;
const BYTE_MAXIMUM = 255;
const LUMA_NUMERATOR_SCALE = 219;
const CHROMA_NUMERATOR_SCALE = 224;
const CHROMA_BLUE_DENOMINATOR = 4 * 255 * 18_556;
const CHROMA_RED_DENOMINATOR = 4 * 255 * 15_748;

export interface Bt709LimitedChroma {
  readonly cb: number;
  readonly cr: number;
}

/** Round an integer ratio to nearest, with exact halves away from zero. */
export function roundSignedRatio(
  numerator: number,
  denominator: number
): number {
  if (!Number.isSafeInteger(numerator)) {
    throw new RangeError("rounding numerator must be a safe integer");
  }
  if (!Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new RangeError("rounding denominator must be a positive safe integer");
  }
  const sign = numerator < 0 ? -1 : 1;
  const magnitude = Math.abs(numerator);
  const quotient = Math.floor(magnitude / denominator);
  const remainder = magnitude % denominator;
  const rounded = quotient + (
    remainder >= Math.ceil(denominator / 2) ? 1 : 0
  );
  return sign * rounded;
}

export function bt709LimitedLuma(
  red: number,
  green: number,
  blue: number
): number {
  requireByte(red);
  requireByte(green);
  requireByte(blue);
  const weighted = weightedLuma(red, green, blue);
  return clamp(
    16,
    235,
    16 + roundSignedRatio(
      LUMA_NUMERATOR_SCALE * weighted,
      BYTE_MAXIMUM * LUMA_SCALE
    )
  );
}

export function bt709LimitedAlphaLuma(alpha: number): number {
  requireByte(alpha);
  return 16 + roundSignedRatio(LUMA_NUMERATOR_SCALE * alpha, BYTE_MAXIMUM);
}

/** Convert four interleaved RGB triplets after averaging their differences. */
export function bt709LimitedChroma2x2(
  rgb: ArrayLike<number>
): Readonly<Bt709LimitedChroma> {
  if (rgb === null || typeof rgb !== "object" || rgb.length !== 12) {
    throw new RangeError("BT.709 chroma input must contain exactly 12 RGB bytes");
  }
  let blueDifference = 0;
  let redDifference = 0;
  for (let offset = 0; offset < 12; offset += 3) {
    const red = rgb[offset];
    const green = rgb[offset + 1];
    const blue = rgb[offset + 2];
    requireByte(red);
    requireByte(green);
    requireByte(blue);
    const weighted = weightedLuma(red, green, blue);
    blueDifference += LUMA_SCALE * blue - weighted;
    redDifference += LUMA_SCALE * red - weighted;
  }
  const cb = clamp(
    16,
    240,
    128 + roundSignedRatio(
      CHROMA_NUMERATOR_SCALE * blueDifference,
      CHROMA_BLUE_DENOMINATOR
    )
  );
  const cr = clamp(
    16,
    240,
    128 + roundSignedRatio(
      CHROMA_NUMERATOR_SCALE * redDifference,
      CHROMA_RED_DENOMINATOR
    )
  );
  return Object.freeze({ cb, cr });
}

function weightedLuma(red: number, green: number, blue: number): number {
  const weighted = LUMA_RED * red + LUMA_GREEN * green + LUMA_BLUE * blue;
  if (!Number.isSafeInteger(weighted)) {
    throw new RangeError("BT.709 weighted luma exceeds safe integer range");
  }
  return weighted;
}

function requireByte(value: number | undefined): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > BYTE_MAXIMUM
  ) {
    throw new RangeError("BT.709 samples must be 8-bit integers");
  }
}

function clamp(minimum: number, maximum: number, value: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
