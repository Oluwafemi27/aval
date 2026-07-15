import { describe, expect, it } from "vitest";

import { createEncodeAvcUnitInvocation } from "../src/ffmpeg/encode-unit.js";

const SOURCE = Object.freeze({
  type: "raw-yuv420p" as const,
  path: "/private/job/canonical.yuv",
  width: 32,
  height: 32,
  frameRate: Object.freeze({ numerator: 30, denominator: 1 }),
  frameBytes: 1_536
});

function invocation(encoding: unknown) {
  return createEncodeAvcUnitInvocation({
    source: SOURCE,
    startFrame: 0,
    endFrame: 4,
    codedWidth: 32,
    codedHeight: 32,
    encoding
  } as never);
}

describe("FFmpeg encoder argv mutation boundary", () => {
  it.each([
    {
      codec: "h265",
      preset: "slow",
      legacyZeroLatency: false,
      rateControl: { mode: "crf", crf: 20, maxBitrate: 10_000_000 }
    },
    {
      codec: "h264",
      preset: "slow -vf scale=1:1",
      legacyZeroLatency: false,
      rateControl: { mode: "crf", crf: 20, maxBitrate: 10_000_000 }
    },
    {
      codec: "h264",
      preset: "slow",
      legacyZeroLatency: false,
      rateControl: { mode: "crf", crf: 20, maxBitrate: 10_000_000 },
      ffmpegArguments: ["-movflags", "faststart"]
    },
    {
      codec: "h264",
      preset: "slow",
      legacyZeroLatency: false,
      rateControl: {
        mode: "crf",
        crf: 20,
        maxBitrate: 10_000_000,
        filter: "scale=1:1"
      }
    }
  ])("rejects unsupported policy fields and values", (encoding) => {
    expect(() => invocation(encoding)).toThrowError(
      expect.objectContaining({ code: "INPUT_INVALID" })
    );
  });

  it("cannot emit muxer, HEVC, or user-filter arguments", () => {
    const arguments_ = invocation({
      codec: "h264",
      preset: "veryslow",
      legacyZeroLatency: false,
      rateControl: { mode: "crf", crf: 20, maxBitrate: 10_000_000 }
    }).arguments;

    expect(arguments_).not.toContain("-movflags");
    expect(arguments_).not.toContain("-tag:v");
    expect(arguments_).not.toContain("libx265");
    expect(arguments_).not.toContain("-vf");
    expect(arguments_.filter((argument) => argument.includes("scale=")))
      .toEqual([]);
  });
});
