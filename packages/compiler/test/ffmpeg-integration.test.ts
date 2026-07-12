import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  crc32,
  deriveAvcRenditionGeometryFromVisible,
  prepareAvcEncoderRendition
} from "@rendered-motion/format";

import {
  encodeAvcUnit,
  extractRgbaRange
} from "../src/ffmpeg/encode-unit.js";
import { discoverFfmpeg } from "../src/ffmpeg/discovery.js";
import { probeMedia, probePngSequence } from "../src/ffmpeg/probe.js";
import { compileDirectInput } from "../src/compile/direct-compiler.js";
import { encodeCanonicalRgbaPng } from "../src/compile/png.js";
import { materializeNormalizedRgbaSource } from "../src/compile/rgba-spool.js";
import {
  writeYuvUnitSpool,
  type YuvUnitSpool
} from "../src/compile/yuv-spool.js";

const HAS_FFMPEG = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!HAS_FFMPEG)("real FFmpeg opaque pipeline", () => {
  let directory = "";
  let source = "";
  let alphaPattern = "";
  let indexedAlphaPattern = "";
  let encoderSpool: Readonly<YuvUnitSpool> | undefined;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "rma-ffmpeg-test-"));
    source = join(directory, "source.mp4");
    const alphaDirectory = join(directory, "alpha");
    await mkdir(alphaDirectory);
    alphaPattern = join(alphaDirectory, "frame-%04d.png");
    const indexedAlphaDirectory = join(directory, "indexed-alpha");
    await mkdir(indexedAlphaDirectory);
    indexedAlphaPattern = join(indexedAlphaDirectory, "frame-%04d.png");
    execFileSync("ffmpeg", [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi",
      "-i", "testsrc2=size=32x32:rate=30",
      "-frames:v", "12",
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-threads", "1",
      source
    ]);
    const rgba = new Uint8Array(32 * 32 * 4);
    rgba.fill(255);
    rgba[3] = 254;
    const opaque = rgba.slice();
    opaque[3] = 255;
    await writeFile(
      join(alphaDirectory, "frame-0000.png"),
      encodeCanonicalRgbaPng({ width: 32, height: 32, rgba: opaque })
    );
    await writeFile(
      join(alphaDirectory, "frame-0001.png"),
      encodeCanonicalRgbaPng({ width: 32, height: 32, rgba })
    );
    await writeFile(
      join(indexedAlphaDirectory, "frame-0000.png"),
      encodeIndexedAlphaPng(256, 256)
    );
    await writeFile(
      join(indexedAlphaDirectory, "frame-0001.png"),
      encodeIndexedAlphaPng(256, 256)
    );
    const frames = await extractRgbaRange({
      source: { type: "video", path: source },
      startFrame: 0,
      endFrame: 12,
      width: 32,
      height: 32
    });
    encoderSpool = await writeYuvUnitSpool({
      geometry: deriveAvcRenditionGeometryFromVisible({
        canvasWidth: 32,
        canvasHeight: 32,
        profile: "avc-annexb-opaque-v0",
        visibleWidth: 32,
        visibleHeight: 32
      }),
      frameRate: { numerator: 30, denominator: 1 },
      frames
    });
  });

  afterAll(async () => {
    await encoderSpool?.cleanup();
    if (directory !== "") {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("discovers x264 provenance and probes exact CFR geometry", async () => {
    const provenance = await discoverFfmpeg();
    expect(provenance.versionLine).toContain("ffmpeg version");
    expect(provenance.configurationLine).toContain("--enable-libx264");

    const probe = await probeMedia(source);
    expect(probe).toMatchObject({
      width: 32,
      height: 32,
      frameCount: 12,
      frameRate: { numerator: 30, denominator: 1 },
      variableFrameRate: false
    });
  });

  it("emits deterministic AUD-delimited low-delay units from compiler-packed YUV", async () => {
    if (encoderSpool === undefined) throw new Error("encoder spool unavailable");
    const input = {
      source: encoderSpool.input,
      startFrame: 3,
      endFrame: 10,
      codedWidth: 32,
      codedHeight: 32,
      bitrate: { average: 300_000, peak: 600_000 }
    };
    const first = await encodeAvcUnit(input);
    const second = await encodeAvcUnit(input);
    expect(first).toEqual(second);

    const types = annexBNalTypes(first);
    expect(types.slice(0, 5)).toEqual([9, 7, 8, 6, 5]);
    expect(types.filter((type) => type === 9)).toHaveLength(7);
    expect(types.every((type) => [1, 5, 6, 7, 8, 9].includes(type))).toBe(true);

    const frames = await extractRgbaRange({
      source: { type: "video", path: source },
      startFrame: 3,
      endFrame: 4,
      width: 32,
      height: 32
    });
    expect(frames).toHaveLength(1);
    expect(frames[0]).toHaveLength(32 * 32 * 4);
  });

  it("keeps SPS/PPS stable across one-frame and longer units", async () => {
    if (encoderSpool === undefined) throw new Error("encoder spool unavailable");
    const frameRate = { numerator: 30, denominator: 1 } as const;
    const common = {
      source: encoderSpool.input,
      codedWidth: 32,
      codedHeight: 32,
      bitrate: { average: 300_000, peak: 600_000 }
    };
    const one = await encodeAvcUnit({
      ...common,
      startFrame: 0,
      endFrame: 1
    });
    const longer = await encodeAvcUnit({
      ...common,
      startFrame: 1,
      endFrame: 5
    });
    const prepared = prepareAvcEncoderRendition({
      profile: {
        codedWidth: 32,
        codedHeight: 32,
        frameRate,
        averageBitrate: common.bitrate.average,
        peakBitrate: common.bitrate.peak,
        cpbBufferBits: common.bitrate.peak,
        requireBt709LimitedRange: true
      },
      units: [
        { id: "intro", bytes: one, expectedAccessUnitCount: 1 },
        { id: "body", bytes: longer, expectedAccessUnitCount: 4 }
      ]
    });
    expect(prepared.units.map(({ id, accessUnits }) => ({
      id,
      frames: accessUnits.length
    }))).toEqual([
      { id: "intro", frames: 1 },
      { id: "body", frames: 4 }
    ]);
  });

  it("preserves one sparse transparent pal8 pixel through packed alpha", async () => {
    const frameRate = { numerator: 30, denominator: 1 };
    const probe = await probePngSequence(
      indexedAlphaPattern,
      0,
      frameRate,
      "ffprobe",
      undefined,
      2
    );
    expect(probe).toMatchObject({
      width: 256,
      height: 256,
      pixelFormat: "pal8",
      hasAlpha: true
    });

    await expect(compileDirectInput({
      inputPath: indexedAlphaPattern,
      outputPath: join(directory, "indexed-alpha.rma"),
      loop: [0, 2],
      fps: frameRate,
      canvas: [32, 32],
      frames: { firstNumber: 0, frameCount: 2 }
    })).resolves.toMatchObject({
      buildDetails: {
        alphaPolicy: {
          selected: "packed",
          audit: { allOpaque: false }
        },
        renditions: [{
          profile: "avc-annexb-packed-alpha-v0",
          alphaQuality: {
            aggregate: {
              meanAbsoluteError: expect.any(Number),
              p99AbsoluteError: expect.any(Number)
            }
          }
        }]
      }
    });
  });

  it("checks selected canonical frames but ignores an unselected translucent frame", async () => {
    const frameRate = { numerator: 30, denominator: 1 };
    const sourceInput = {
      type: "png-sequence" as const,
      path: alphaPattern,
      firstFileNumber: 0,
      frameRate
    };
    const probe = await probePngSequence(
      alphaPattern,
      0,
      frameRate,
      "ffprobe",
      undefined,
      2
    );
    const opaque = await materializeNormalizedRgbaSource({
      source: sourceInput,
      probe,
      frameRate,
      outputWidth: 32,
      outputHeight: 32,
      sourceFrameByOutputFrame: [0],
      executable: "ffmpeg"
    });
    await opaque.cleanup();

    const transparent = await materializeNormalizedRgbaSource({
      source: sourceInput,
      probe,
      frameRate,
      outputWidth: 32,
      outputHeight: 32,
      sourceFrameByOutputFrame: [1],
      executable: "ffmpeg"
    });
    expect(transparent.alphaAudit).toMatchObject({
      allOpaque: false,
      minimumAlpha: 254,
      uniqueReferencedFrames: 1,
      firstNonopaque: { frame: 0, x: 0, y: 0, alpha: 254 }
    });
    await transparent.cleanup();
  });
});

function annexBNalTypes(bytes: Uint8Array): number[] {
  const types: number[] = [];
  for (let offset = 0; offset + 4 < bytes.length; offset += 1) {
    const three = bytes[offset] === 0 && bytes[offset + 1] === 0 && bytes[offset + 2] === 1;
    const four = bytes[offset] === 0 && bytes[offset + 1] === 0 &&
      bytes[offset + 2] === 0 && bytes[offset + 3] === 1;
    if (three || four) {
      const header = bytes[offset + (four ? 4 : 3)];
      if (header !== undefined) types.push(header & 0x1f);
      offset += four ? 3 : 2;
    }
  }
  return types;
}

function encodeIndexedAlphaPng(width: number, height: number): Uint8Array {
  const scanlines = new Uint8Array(height * (width + 1));
  for (let row = 0; row < height; row += 1) {
    const offset = row * (width + 1);
    scanlines[offset] = 0;
    scanlines.fill(1, offset + 1, offset + width + 1);
  }
  scanlines[scanlines.length - 1] = 0;

  const ihdr = new Uint8Array(13);
  writeUint32Be(ihdr, 0, width);
  writeUint32Be(ihdr, 4, height);
  ihdr.set([8, 3, 0, 0, 0], 8);
  return concatenate([
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    pngChunk("IHDR", ihdr),
    pngChunk("PLTE", Uint8Array.of(255, 0, 0, 0, 255, 0)),
    pngChunk("tRNS", Uint8Array.of(0, 255)),
    pngChunk("IDAT", new Uint8Array(deflateSync(scanlines))),
    pngChunk("IEND", new Uint8Array())
  ]);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const crcInput = concatenate([typeBytes, data]);
  const output = new Uint8Array(data.byteLength + 12);
  writeUint32Be(output, 0, data.byteLength);
  output.set(typeBytes, 4);
  output.set(data, 8);
  writeUint32Be(output, output.byteLength - 4, crc32(crcInput));
  return output;
}

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    parts.reduce((total, part) => total + part.byteLength, 0)
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function writeUint32Be(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}
