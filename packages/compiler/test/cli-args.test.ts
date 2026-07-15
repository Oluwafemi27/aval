import { describe, expect, it } from "vitest";

import { parseCliArguments } from "../src/cli-args.js";
import { CompilerError } from "../src/diagnostics.js";

describe("CLI argument grammar", () => {
  it("parses the complete direct-input surface into exact values", () => {
    expect(parseCliArguments([
      "compile",
      "clip.mp4",
      "--loop", "12:36",
      "--fps", "30000/1001",
      "--canvas", "320x176",
      "--bitrate", "2000000:3000000",
      "--alpha", "packed",
      "--out", "clip.avl",
      "--report", "clip.report.json",
      "--ffmpeg", "/tools/ffmpeg",
      "--ffprobe", "/tools/ffprobe",
      "--normalize-vfr",
      "--force",
      "--json"
    ])).toEqual({
      command: "compile",
      input: "clip.mp4",
      output: "clip.avl",
      report: "clip.report.json",
      loop: [12, 36],
      fps: { numerator: 30000, denominator: 1001 },
      canvas: [320, 176],
      bitrate: { average: 2_000_000, peak: 3_000_000 },
      alpha: "packed",
      ffmpegPath: "/tools/ffmpeg",
      ffprobePath: "/tools/ffprobe",
      normalizeVfr: true,
      force: true,
      json: true
    });
  });

  it("accepts author-selected bitrate above the former profile policy", () => {
    expect(parseCliArguments([
      "compile", "clip.mp4", "--loop", "0:2",
      "--bitrate", "6000000:10000000", "--preset", "slow",
      "--media-timeout-ms", "900000", "--out", "clip.avl"
    ])).toMatchObject({
      bitrate: { average: 6_000_000, peak: 10_000_000 },
      preset: "slow",
      mediaTimeoutMs: 900_000
    });
  });

  it("parses capped CRF into typed direct-input controls", () => {
    expect(parseCliArguments([
      "compile", "clip.mov", "--loop", "0:120",
      "--crf", "20", "--max-bitrate", "10000000",
      "--preset", "veryslow", "--media-timeout-ms", "900000",
      "--out", "clip.avl"
    ])).toMatchObject({
      crf: 20,
      maxBitrate: 10_000_000,
      preset: "veryslow",
      mediaTimeoutMs: 900_000
    });
  });

  it("accepts the closed PNG sequence grammar and a leading-dash path after --", () => {
    expect(parseCliArguments([
      "compile",
      "--out", "out.avl",
      "--loop", "0:2",
      "--frames", "7:2",
      "--fps", "30/1",
      "--canvas", "32x32",
      "--",
      "-frames-%04d.png"
    ])).toMatchObject({
      input: "-frames-%04d.png",
      frames: { firstNumber: 7, frameCount: 2 }
    });
  });

  it("keeps project-only compilation free of direct media switches", () => {
    expect(parseCliArguments([
      "compile", "motion.json", "--media-timeout-ms", "900000",
      "--out", "motion.avl"
    ])).toMatchObject({
      command: "compile",
      input: "motion.json",
      output: "motion.avl",
      mediaTimeoutMs: 900_000
    });
    expectUsage([
      "compile", "motion.json", "--out", "motion.avl", "--fps", "30/1"
    ]);
    expectUsage([
      "compile", "motion.json", "--out", "motion.avl", "--alpha", "auto"
    ]);
    for (const override of [
      ["--crf", "20", "--max-bitrate", "10000000"],
      ["--preset", "slow"],
      ["--bitrate", "6000000:10000000"]
    ]) {
      expectUsage([
        "compile", "motion.json", "--out", "motion.avl", ...override
      ]);
    }
  });

  it("defaults direct input to auto and accepts only the closed alpha policy", () => {
    expect(parseCliArguments([
      "compile", "clip.mp4", "--loop", "0:2", "--out", "clip.avl"
    ])).toMatchObject({ alpha: "auto" });
    for (const policy of ["auto", "opaque", "packed"] as const) {
      expect(parseCliArguments([
        "compile", "clip.mp4", "--loop", "0:2", "--alpha", policy,
        "--out", "clip.avl"
      ])).toMatchObject({ alpha: policy });
    }
    expectUsage([
      "compile", "clip.mp4", "--loop", "0:2", "--alpha", "stacked",
      "--out", "clip.avl"
    ]);
  });

  it("accepts author-controlled canvas and PNG frame counts above old ceilings", () => {
    expect(parseCliArguments([
      "compile", "clip.mp4", "--loop", "0:1001", "--canvas", "1920x1080",
      "--out", "clip.avl"
    ])).toMatchObject({ loop: [0, 1001], canvas: [1920, 1080] });
    expect(parseCliArguments([
      "compile", "frames-%04d.png", "--loop", "0:2", "--frames", "0:1801",
      "--fps", "30/1", "--out", "clip.avl"
    ])).toMatchObject({ frames: { firstNumber: 0, frameCount: 1801 } });
  });

  it.each([
    ["missing direct loop", ["compile", "clip.mp4", "--out", "x.avl"]],
    ["missing output", ["compile", "clip.mp4", "--loop", "0:2"]],
    ["duplicate", ["inspect", "a.avl", "--json", "--json"]],
    ["unknown", ["inspect", "a.avl", "--wat"]],
    ["inline value", ["unpack", "a.avl", "--out=dir"]],
    ["bad range", ["compile", "a.mp4", "--loop", "2:2", "--out", "x.avl"]],
    ["unreduced fps", ["compile", "a.mp4", "--loop", "0:2", "--fps", "60/2", "--out", "x.avl"]],
    ["bad canvas", ["compile", "a.mp4", "--loop", "0:2", "--canvas", "0x32", "--out", "x.avl"]],
    ["PNG missing frames", ["compile", "a-%04d.png", "--loop", "0:2", "--fps", "30/1", "--canvas", "32x32", "--out", "x.avl"]],
    ["PNG invalid token", ["compile", "a-%d.png", "--loop", "0:2", "--frames", "0:2", "--fps", "30/1", "--canvas", "32x32", "--out", "x.avl"]],
    ["video frames", ["compile", "a.mp4", "--loop", "0:2", "--frames", "0:2", "--out", "x.avl"]],
    ["normalize missing fps", ["compile", "a.mp4", "--loop", "0:2", "--normalize-vfr", "--out", "x.avl"]],
    ["CRF below range", ["compile", "a.mp4", "--loop", "0:2", "--crf", "0", "--max-bitrate", "10000000", "--out", "x.avl"]],
    ["CRF above range", ["compile", "a.mp4", "--loop", "0:2", "--crf", "52", "--max-bitrate", "10000000", "--out", "x.avl"]],
    ["CRF without ceiling", ["compile", "a.mp4", "--loop", "0:2", "--crf", "20", "--out", "x.avl"]],
    ["orphan ceiling", ["compile", "a.mp4", "--loop", "0:2", "--max-bitrate", "10000000", "--out", "x.avl"]],
    ["mixed rate controls", ["compile", "a.mp4", "--loop", "0:2", "--crf", "20", "--max-bitrate", "10000000", "--bitrate", "1:2", "--out", "x.avl"]],
    ["unsupported preset", ["compile", "a.mp4", "--loop", "0:2", "--preset", "placebo", "--out", "x.avl"]],
    ["zero media timeout", ["compile", "a.mp4", "--loop", "0:2", "--media-timeout-ms", "0", "--out", "x.avl"]],
    ["relative tool", ["compile", "a.mp4", "--loop", "0:2", "--ffmpeg", "bin/ffmpeg", "--out", "x.avl"]],
    ["extra positional", ["validate", "a.avl", "b.avl"]]
  ])("rejects %s", (_label, argv) => {
    expectUsage(argv);
  });

  it("parses every read-only and workflow command", () => {
    expect(parseCliArguments(["inspect", "a.avl", "--json"])).toEqual({
      command: "inspect", input: "a.avl", json: true
    });
    expect(parseCliArguments(["validate", "a.avl"])).toEqual({
      command: "validate", input: "a.avl", json: false
    });
    expect(parseCliArguments(["unpack", "a.avl", "--out", "dir"])).toEqual({
      command: "unpack", input: "a.avl", output: "dir", json: false
    });
    expect(parseCliArguments(["init", "starter"])).toEqual({
      command: "init", directory: "starter", json: false
    });
    expect(parseCliArguments([
      "dev", "motion.json", "--out", "x.avl", "--media-timeout-ms", "900000"
    ])).toEqual({
      command: "dev",
      project: "motion.json",
      output: "x.avl",
      mediaTimeoutMs: 900_000,
      force: false,
      port: 4174,
      open: false,
      json: false
    });
  });
});

function expectUsage(argv: readonly string[]): void {
  try {
    parseCliArguments(argv);
    throw new Error("expected CLI usage rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(CompilerError);
    expect((error as CompilerError).code).toBe("CLI_USAGE");
  }
}
