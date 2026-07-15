import { describe, expect, it } from "vitest";

import {
  avcPeakBitrate,
  avcRateControlArguments,
  deriveCanonicalAverageBitrate,
  validateAvcEncoding
} from "../src/compile/avc-encoding-policy.js";
import { AVC_ENCODER_PRESETS } from "../src/model.js";

describe("safe AVC encoding policy", () => {
  it("validates and freezes allowlisted CRF policy", () => {
    const policy = validateAvcEncoding({
      codec: "h264",
      preset: "veryslow",
      legacyZeroLatency: false,
      rateControl: { mode: "crf", crf: 20, maxBitrate: 10_000_000 }
    });

    expect(policy).toEqual({
      codec: "h264",
      preset: "veryslow",
      legacyZeroLatency: false,
      rateControl: { mode: "crf", crf: 20, maxBitrate: 10_000_000 }
    });
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy.rateControl)).toBe(true);
    expect(avcPeakBitrate(policy)).toBe(10_000_000);
    expect(avcRateControlArguments(policy.rateControl)).toEqual([
      "-crf", "20",
      "-maxrate", "10000000",
      "-bufsize", "10000000"
    ]);
  });

  it("produces the complete ABR rate-control vector", () => {
    expect(avcRateControlArguments({
      mode: "abr",
      averageBitrate: 6_000_000,
      maxBitrate: 10_000_000
    })).toEqual([
      "-b:v", "6000000",
      "-maxrate", "10000000",
      "-bufsize", "10000000"
    ]);
  });

  it("accepts every documented preset and no arbitrary preset string", () => {
    for (const preset of AVC_ENCODER_PRESETS) {
      expect(validateAvcEncoding({
        codec: "h264",
        preset,
        legacyZeroLatency: false,
        rateControl: {
          mode: "abr",
          averageBitrate: 6_000_000,
          maxBitrate: 10_000_000
        }
      }).preset).toBe(preset);
    }
    expect(() => validateAvcEncoding({
      codec: "h264",
      preset: "placebo" as never,
      legacyZeroLatency: false,
      rateControl: {
        mode: "abr",
        averageBitrate: 6_000_000,
        maxBitrate: 10_000_000
      }
    })).toThrow(/preset is not allowlisted/u);
  });

  it.each([0, 52, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid CRF %s",
    (crf) => {
      expect(() => validateAvcEncoding({
        codec: "h264",
        preset: "slow",
        legacyZeroLatency: false,
        rateControl: { mode: "crf", crf, maxBitrate: 10_000_000 }
      })).toThrow(/CRF must be an integer from 1 through 51/u);
    }
  );

  it("rejects invalid ABR ordering and bitrate domains", () => {
    expect(() => avcRateControlArguments({
      mode: "abr",
      averageBitrate: 10_000_001,
      maxBitrate: 10_000_000
    })).toThrow(/must not exceed/u);
    expect(() => avcRateControlArguments({
      mode: "abr",
      averageBitrate: 0,
      maxBitrate: 10_000_000
    })).toThrow(/positive safe integer/u);
  });

  it("reserves legacy mode for the exact medium ABR policy", () => {
    for (const policy of [
      {
        codec: "h264",
        preset: "slow",
        legacyZeroLatency: true,
        rateControl: {
          mode: "abr",
          averageBitrate: 2_000_000,
          maxBitrate: 3_000_000
        }
      },
      {
        codec: "h264",
        preset: "medium",
        legacyZeroLatency: true,
        rateControl: {
          mode: "crf",
          crf: 20,
          maxBitrate: 3_000_000
        }
      }
    ]) {
      expect(() => validateAvcEncoding(policy as never))
        .toThrow(/Legacy AVC encoding requires medium preset and ABR/u);
    }
  });

  it("derives a ceiling average bitrate from canonical bytes", () => {
    expect(deriveCanonicalAverageBitrate({
      canonicalBytes: 1_000_000,
      frameCount: 120,
      frameRate: { numerator: 24, denominator: 1 }
    })).toBe(1_600_000);
    expect(deriveCanonicalAverageBitrate({
      canonicalBytes: 1,
      frameCount: 3,
      frameRate: { numerator: 1, denominator: 1 }
    })).toBe(3);
  });

  it("rejects invalid and overflowing canonical bitrate inputs", () => {
    expect(() => deriveCanonicalAverageBitrate({
      canonicalBytes: 1,
      frameCount: 0,
      frameRate: { numerator: 24, denominator: 1 }
    })).toThrowError(expect.objectContaining({ code: "INPUT_INVALID" }));
    expect(() => deriveCanonicalAverageBitrate({
      canonicalBytes: Number.MAX_SAFE_INTEGER,
      frameCount: 1,
      frameRate: { numerator: Number.MAX_SAFE_INTEGER, denominator: 1 }
    })).toThrowError(expect.objectContaining({ code: "OUTPUT_LIMIT" }));
  });
});
