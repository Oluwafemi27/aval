import { CompilerError } from "../diagnostics.js";
import {
  AVC_ENCODER_PRESETS,
  type AvcRateControlV03,
  type NormalizedAvcEncoding,
  type RationalV01
} from "../model.js";

const ENCODING_KEYS = Object.freeze([
  "codec",
  "preset",
  "rateControl",
  "legacyZeroLatency"
] as const);
const ABR_KEYS = Object.freeze([
  "mode",
  "averageBitrate",
  "maxBitrate"
] as const);
const CRF_KEYS = Object.freeze(["mode", "crf", "maxBitrate"] as const);

export interface CanonicalAverageBitrateInput {
  readonly canonicalBytes: number;
  readonly frameCount: number;
  readonly frameRate: Readonly<RationalV01>;
}

/** Validate and freeze the complete allowlisted libx264 policy. */
export function validateAvcEncoding(
  value: Readonly<NormalizedAvcEncoding>
): Readonly<NormalizedAvcEncoding> {
  const input = requireRecord(value, "AVC encoding policy");
  requireExactKeys(input, ENCODING_KEYS, "AVC encoding policy");
  if (input.codec !== "h264") {
    invalid("AVC encoding codec must be h264");
  }
  if (
    typeof input.preset !== "string" ||
    !AVC_ENCODER_PRESETS.some((preset) => preset === input.preset)
  ) {
    invalid("AVC encoding preset is not allowlisted");
  }
  if (typeof input.legacyZeroLatency !== "boolean") {
    invalid("AVC legacyZeroLatency must be a boolean");
  }
  const rateControl = validateAvcRateControl(
    input.rateControl as Readonly<AvcRateControlV03>
  );
  if (
    input.legacyZeroLatency &&
    (input.preset !== "medium" || rateControl.mode !== "abr")
  ) {
    invalid("Legacy AVC encoding requires medium preset and ABR rate control");
  }
  return Object.freeze({
    codec: "h264",
    preset: input.preset as NormalizedAvcEncoding["preset"],
    rateControl,
    legacyZeroLatency: input.legacyZeroLatency
  });
}

/** Produce only the owned FFmpeg rate-control arguments. */
export function avcRateControlArguments(
  value: Readonly<NormalizedAvcEncoding["rateControl"]>
): readonly string[] {
  const rateControl = validateAvcRateControl(value);
  return Object.freeze(rateControl.mode === "abr"
    ? [
        "-b:v", String(rateControl.averageBitrate),
        "-maxrate", String(rateControl.maxBitrate),
        "-bufsize", String(rateControl.maxBitrate)
      ]
    : [
        "-crf", String(rateControl.crf),
        "-maxrate", String(rateControl.maxBitrate),
        "-bufsize", String(rateControl.maxBitrate)
      ]);
}

/** Return the compiler-owned CPB and manifest peak ceiling. */
export function avcPeakBitrate(
  value: Readonly<NormalizedAvcEncoding>
): number {
  return validateAvcEncoding(value).rateControl.maxBitrate;
}

/** Derive a conservative integer bitrate from the final canonical bytes. */
export function deriveCanonicalAverageBitrate(
  input: Readonly<CanonicalAverageBitrateInput>
): number {
  const canonicalBytes = positiveSafeInteger(
    input.canonicalBytes,
    "Canonical AVC byte count"
  );
  const frameCount = positiveSafeInteger(
    input.frameCount,
    "Canonical AVC frame count"
  );
  const numerator = positiveSafeInteger(
    input.frameRate.numerator,
    "AVC frame-rate numerator"
  );
  const denominator = positiveSafeInteger(
    input.frameRate.denominator,
    "AVC frame-rate denominator"
  );
  const scaled = BigInt(canonicalBytes) * 8n * BigInt(numerator);
  const durationScale = BigInt(frameCount) * BigInt(denominator);
  const average = (scaled + durationScale - 1n) / durationScale;
  if (average > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new CompilerError(
      "OUTPUT_LIMIT",
      "Canonical AVC average bitrate exceeds the safe-integer range"
    );
  }
  return Number(average);
}

function validateAvcRateControl(
  value: Readonly<AvcRateControlV03>
): Readonly<AvcRateControlV03> {
  const input = requireRecord(value, "AVC rate-control policy");
  if (input.mode === "abr") {
    requireExactKeys(input, ABR_KEYS, "AVC ABR policy");
    const averageBitrate = positiveSafeInteger(
      input.averageBitrate,
      "AVC average bitrate"
    );
    const maxBitrate = positiveSafeInteger(
      input.maxBitrate,
      "AVC maximum bitrate"
    );
    if (averageBitrate > maxBitrate) {
      invalid("AVC average bitrate must not exceed maximum bitrate");
    }
    return Object.freeze({ mode: "abr", averageBitrate, maxBitrate });
  }
  if (input.mode === "crf") {
    requireExactKeys(input, CRF_KEYS, "AVC CRF policy");
    const crf = input.crf;
    if (
      typeof crf !== "number" ||
      !Number.isSafeInteger(crf) ||
      crf < 1 ||
      crf > 51
    ) {
      invalid("AVC CRF must be an integer from 1 through 51");
    }
    return Object.freeze({
      mode: "crf",
      crf,
      maxBitrate: positiveSafeInteger(
        input.maxBitrate,
        "AVC maximum bitrate"
      )
    });
  }
  invalid("AVC rate-control mode must be abr or crf");
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalid(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  label: string
): void {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (
    actual.length !== allowed.length ||
    actual.some((key, index) => key !== allowed[index])
  ) {
    invalid(`${label} contains unsupported fields`);
  }
}

function positiveSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    invalid(`${label} must be a positive safe integer`);
  }
  return value as number;
}

function invalid(message: string): never {
  throw new CompilerError("INPUT_INVALID", message);
}
