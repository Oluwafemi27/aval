import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { avcCodecForLevel, parseFrontIndex } from "@pixel-point/aval-format";

import {
  buildDirectArtifact,
  compileDirectInput
} from "../src/compile/direct-compiler.js";
import { encodeCanonicalRgbaPng } from "../src/compile/png.js";
import {
  inspectAssetFile,
  validateAssetFile
} from "../src/commands/asset.js";

const HAS_FFMPEG = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!HAS_FFMPEG)("direct opaque compiler", () => {
  let directory = "";
  let pattern = "";

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "aval-direct-compiler-"));
    pattern = join(directory, "loop-%04d.png");
    const values = [128, 199, 228, 199, 128, 57, 28, 57];
    await Promise.all(values.map(async (value, index) => {
      const rgba = new Uint8Array(32 * 32 * 4);
      for (let offset = 0; offset < rgba.length; offset += 4) {
        rgba.set([value, value, value, 255], offset);
      }
      await writeFile(
        join(directory, `loop-${String(index).padStart(4, "0")}.png`),
        encodeCanonicalRgbaPng({ width: 32, height: 32, rgba })
      );
    }));
  });

  afterAll(async () => {
    if (directory !== "") await rm(directory, { recursive: true, force: true });
  });

  it("compiles deterministic inspected AVC and verifies every digest", async () => {
    const firstPath = join(directory, "first.avl");
    const secondPath = join(directory, "second.avl");
    const options = {
      inputPath: pattern,
      outputPath: firstPath,
      loop: [0, 8] as const,
      fps: { numerator: 30, denominator: 1 },
      canvas: [32, 32] as const,
      frames: { firstNumber: 0, frameCount: 8 }
    };
    const first = await compileDirectInput(options);
    const second = await compileDirectInput({ ...options, outputPath: secondPath });
    expect(first.sha256).toBe(second.sha256);
    expect(await readFile(firstPath)).toEqual(await readFile(secondPath));
    expect(first.buildDetails.sources[0]).toMatchObject({
      type: "direct-png-sequence",
      inputFiles: expect.arrayContaining([
        expect.objectContaining({ sha256: expect.stringMatching(/^[0-9a-f]{64}$/u) })
      ])
    });
    expect(first.buildDetails.invocations.map(({ operation }) => operation))
      .toEqual(expect.arrayContaining([
        "probe:direct",
        "materialize-rgba:direct",
        "scale:avc.1x:body.default",
        "encode:avc.1x:body.default"
      ]));
    expect(first.buildDetails.alphaPolicy).toMatchObject({
      requested: "auto",
      selected: "opaque",
      audit: { allOpaque: true, uniqueReferencedFrames: 8 }
    });
    expect(JSON.stringify(first.buildDetails.invocations)).not.toContain(directory);
    expect(first.buildDetails.continuity).toMatchObject([
      { kind: "loop", status: "pass" }
    ]);

    const bytes = new Uint8Array(await readFile(firstPath));
    const front = parseFrontIndex(bytes);
    const rendition = first.buildDetails.renditions[0]!;
    const levelIdc = rendition.inspection.parameterSet.levelIdc;
    expect(first.buildDetails.detailsVersion).toBe("0.2");
    expect(rendition).toMatchObject({
      profile: "avc-annexb-opaque-v0",
      bitrate: { average: 2_000_000, peak: 3_000_000 },
      encoding: {
        codec: "libx264",
        preset: "medium",
        legacyZeroLatency: true,
        rateControl: {
          mode: "abr",
          averageBitrate: 2_000_000,
          maxBitrate: 3_000_000
        },
        canonicalBytes: first.buildDetails.encodedPayloadBytes,
        measuredAverageBitrate: expect.any(Number)
      }
    });
    expect(rendition.encoding.measuredAverageBitrate).toBe(
      Math.ceil(rendition.encoding.canonicalBytes * 8 * 30 / 8)
    );
    expect(front.manifest.renditions[0]).toMatchObject({
      profile: "avc-annexb-opaque-v0",
      codec: avcCodecForLevel(levelIdc),
      bitrate: { average: 2_000_000, peak: 3_000_000 }
    });
    expect(front.manifest.units).toHaveLength(1);
    expect(front.manifest.units[0]).toMatchObject({
      id: "body.default",
      frameCount: 8,
      playback: "loop"
    });
    await expect(validateAssetFile(firstPath)).resolves.toBeDefined();
    await expect(inspectAssetFile(firstPath)).resolves.toMatchObject({
      states: ["default"],
      units: [{ id: "body.default", frames: 8 }]
    });
  }, 30_000);

  it("compiles capped CRF as AVC-v1 and records measured canonical bitrate", async () => {
    const outputPath = join(directory, "crf-v1.avl");
    const result = await compileDirectInput({
      inputPath: pattern,
      outputPath,
      loop: [0, 8],
      fps: { numerator: 30, denominator: 1 },
      canvas: [32, 32],
      frames: { firstNumber: 0, frameCount: 8 },
      crf: 20,
      maxBitrate: 1_000_000,
      preset: "veryslow"
    });
    const rendition = result.buildDetails.renditions[0]!;
    const manifestRendition = parseFrontIndex(
      new Uint8Array(await readFile(outputPath))
    ).manifest.renditions[0]!;

    expect(rendition).toMatchObject({
      profile: "avc-annexb-opaque-v1",
      encoding: {
        codec: "libx264",
        preset: "veryslow",
        legacyZeroLatency: false,
        rateControl: {
          mode: "crf",
          crf: 20,
          maxBitrate: 1_000_000
        },
        canonicalBytes: result.buildDetails.encodedPayloadBytes,
        measuredAverageBitrate: expect.any(Number)
      }
    });
    expect(rendition.encoding.measuredAverageBitrate).toBe(
      Math.ceil(rendition.encoding.canonicalBytes * 8 * 30 / 8)
    );
    expect(rendition.encoding.measuredAverageBitrate).toBeLessThanOrEqual(
      1_000_000
    );
    expect(rendition.bitrate).toEqual({
      average: rendition.encoding.measuredAverageBitrate,
      peak: 1_000_000
    });
    expect(manifestRendition).toMatchObject({
      profile: "avc-annexb-opaque-v1",
      bitrate: rendition.bitrate
    });
    const encode = result.buildDetails.invocations.find(
      ({ operation }) => operation === "encode:avc.1x:body.default"
    )!;
    expect(encode.arguments).toEqual(expect.arrayContaining([
      "-preset", "veryslow",
      "-crf", "20",
      "-maxrate", "1000000",
      "-bufsize", "1000000"
    ]));
    expect(encode.arguments).not.toContain("-b:v");
    expect(encode.arguments).not.toContain("-tune");
  }, 30_000);

  it("compiles nonlegacy ABR presets as AVC-v1 with measured manifest bitrate", async () => {
    const outputPath = join(directory, "abr-v1.avl");
    const result = await compileDirectInput({
      inputPath: pattern,
      outputPath,
      loop: [0, 8],
      fps: { numerator: 30, denominator: 1 },
      canvas: [32, 32],
      frames: { firstNumber: 0, frameCount: 8 },
      bitrate: { average: 300_000, peak: 600_000 },
      preset: "slow"
    });
    const rendition = result.buildDetails.renditions[0]!;
    const manifestRendition = parseFrontIndex(
      new Uint8Array(await readFile(outputPath))
    ).manifest.renditions[0]!;

    expect(rendition).toMatchObject({
      profile: "avc-annexb-opaque-v1",
      encoding: {
        codec: "libx264",
        preset: "slow",
        legacyZeroLatency: false,
        rateControl: {
          mode: "abr",
          averageBitrate: 300_000,
          maxBitrate: 600_000
        },
        canonicalBytes: result.buildDetails.encodedPayloadBytes,
        measuredAverageBitrate: expect.any(Number)
      }
    });
    expect(rendition.bitrate).toEqual({
      average: rendition.encoding.measuredAverageBitrate,
      peak: 600_000
    });
    expect(manifestRendition).toMatchObject({
      profile: "avc-annexb-opaque-v1",
      bitrate: rendition.bitrate
    });
    const encode = result.buildDetails.invocations.find(
      ({ operation }) => operation === "encode:avc.1x:body.default"
    )!;
    expect(encode.arguments).toEqual(expect.arrayContaining([
      "-preset", "slow",
      "-b:v", "300000",
      "-maxrate", "600000",
      "-bufsize", "600000"
    ]));
    expect(encode.arguments).not.toContain("-crf");
    expect(encode.arguments).not.toContain("-tune");
  }, 30_000);

  it.each([
    {
      name: "CRF plus ABR",
      override: {
        crf: 20,
        maxBitrate: 1_000_000,
        bitrate: { average: 300_000, peak: 600_000 }
      },
      message: "mutually exclusive"
    },
    {
      name: "CRF without a ceiling",
      override: { crf: 20 },
      message: "requires maxBitrate"
    },
    {
      name: "a ceiling without CRF",
      override: { maxBitrate: 1_000_000 },
      message: "valid only with CRF"
    },
    {
      name: "out-of-range CRF",
      override: { crf: 0, maxBitrate: 1_000_000 },
      message: "integer from 1 through 51"
    },
    {
      name: "an unallowlisted preset",
      override: { preset: "placebo" },
      message: "preset is not allowlisted"
    }
  ])("rejects programmatic direct input with $name", async ({ override, message }) => {
    await expect(buildDirectArtifact({
      inputPath: pattern,
      loop: [0, 8],
      fps: { numerator: 30, denominator: 1 },
      canvas: [32, 32],
      frames: { firstNumber: 0, frameCount: 8 },
      ...override
    } as never)).rejects.toMatchObject({
      code: "INPUT_INVALID",
      message: expect.stringContaining(message)
    });
  }, 30_000);

  it("canonicalizes libx264 Level 1b output as supported Level 1.1", async () => {
    const levelPattern = join(directory, "level-1b-%04d.png");
    for (let index = 0; index < 2; index += 1) {
      const rgba = new Uint8Array(176 * 144 * 4);
      for (let offset = 0; offset < rgba.length; offset += 4) {
        rgba.set([64 + index * 64, 64, 64, 255], offset);
      }
      await writeFile(
        join(directory, `level-1b-${String(index).padStart(4, "0")}.png`),
        encodeCanonicalRgbaPng({ width: 176, height: 144, rgba })
      );
    }

    const outputPath = join(directory, "level-1b.avl");
    const result = await compileDirectInput({
      inputPath: levelPattern,
      outputPath,
      loop: [0, 2],
      fps: { numerator: 15, denominator: 1 },
      canvas: [176, 144],
      frames: { firstNumber: 0, frameCount: 2 },
      bitrate: { average: 80_000, peak: 100_000 }
    });
    const manifest = parseFrontIndex(new Uint8Array(await readFile(outputPath))).manifest;

    expect(result.buildDetails.renditions[0]?.inspection.parameterSet).toMatchObject({
      levelIdc: 11,
      constraintSet2: true
    });
    expect(manifest.renditions[0]?.codec).toBe("avc1.42E00B");
  }, 30_000);
});
