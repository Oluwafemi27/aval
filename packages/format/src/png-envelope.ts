import type { ByteRange, FormatOptions } from "./model.js";
import { validatePngProfile } from "./png/profile.js";

export interface PngEnvelopeValidationInput {
  readonly png: Uint8Array;
  readonly expectedWidth: number;
  readonly expectedHeight: number;
  readonly options?: FormatOptions | undefined;
}

export interface PngEnvelopeDescriptor {
  readonly width: number;
  readonly height: number;
  readonly byteRange: ByteRange;
}

/**
 * Compatibility facade over the complete restricted PNG profile validator.
 */
export function validatePngEnvelope(
  input: PngEnvelopeValidationInput
): Readonly<PngEnvelopeDescriptor> {
  const plan = validatePngProfile(input);
  return Object.freeze({
    width: plan.width,
    height: plan.height,
    byteRange: plan.byteRange
  });
}
