import { describe, expect, it } from "vitest";

import {
  createEncodeAvcUnitInvocation,
  createExtractRgbaRangeInvocation,
  encodeAvcUnit,
  FROZEN_AVC_KEYINT,
  sourceArguments
} from "../src/ffmpeg/encode-unit.js";
import { createCalibrationInvocation } from "../src/ffmpeg/discovery.js";

describe("frozen FFmpeg encode invocation", () => {
  it("owns an exact raw-yuv spool range without pixel filters", () => {
    const invocation = createEncodeAvcUnitInvocation({
      source: {
        type: "raw-yuv420p",
        path: "/private/job/packed.yuv",
        width: 48,
        height: 32,
        frameRate: { numerator: 30, denominator: 1 },
        frameBytes: 2_304
      },
      startFrame: 2,
      endFrame: 5,
      codedWidth: 48,
      codedHeight: 32,
      decodedStorageRect: [0, 0, 34, 22],
      bitrate: { average: 2_000_000, peak: 3_000_000 }
    });

    expect(invocation.stdinFile).toEqual({
      path: "/private/job/packed.yuv",
      offset: 4_608,
      length: 6_912
    });
    expect(invocation.arguments).toEqual(expect.arrayContaining([
      "-f", "rawvideo", "-pixel_format", "yuv420p",
      "-video_size", "48x32", "-i", "pipe:0"
    ]));
    expect(invocation.arguments).not.toContain("-vf");
    expect(invocation.arguments.filter((argument) =>
      argument.includes("scale=") || argument.includes("format=yuv")
    )).toEqual([]);
    const x264 = invocation.arguments[
      invocation.arguments.indexOf("-x264-params") + 1
    ];
    expect(x264).toContain("crop-rect=0,0,14,10");
  });

  it("owns the complete compiler-packed YUV pipe vector and fixed key interval", () => {
    const invocation = createEncodeAvcUnitInvocation({
      source: {
        type: "raw-yuv420p",
        path: "/private/job/canonical.yuv",
        width: 32,
        height: 32,
        frameRate: { numerator: 30, denominator: 1 },
        frameBytes: 1_536
      },
      startFrame: 3,
      endFrame: 7,
      codedWidth: 32,
      codedHeight: 32,
      bitrate: { average: 2_000_000, peak: 3_000_000 }
    });

    expect(FROZEN_AVC_KEYINT).toBe(901);
    expect(invocation).toEqual({
      cwd: "/private/job",
      stdinFile: {
        path: "/private/job/canonical.yuv",
        offset: 4_608,
        length: 6_144
      },
      arguments: [
        "-nostdin", "-hide_banner", "-loglevel", "error", "-xerror",
        "-max_alloc", "67108864",
        "-protocol_whitelist", "pipe",
        "-f", "rawvideo", "-pixel_format", "yuv420p",
        "-video_size", "32x32", "-framerate", "30/1", "-i", "pipe:0",
        "-map", "0:v:0", "-an", "-sn", "-dn",
        "-map_metadata", "-1", "-map_chapters", "-1",
        "-frames:v", "4", "-fps_mode", "passthrough",
        "-c:v", "libx264", "-preset", "medium", "-tune", "zerolatency",
        "-profile:v", "baseline", "-level:v", "3.2", "-pix_fmt", "yuv420p",
        "-color_range", "tv", "-color_primaries", "bt709",
        "-color_trc", "bt709", "-colorspace", "bt709",
        "-threads", "1", "-filter_threads", "1",
        "-g", "901", "-keyint_min", "901", "-sc_threshold", "0",
        "-bf", "0", "-refs", "1",
        "-b:v", "2000000", "-maxrate", "3000000", "-bufsize", "3000000",
        "-x264-params", "aud=1:bframes=0:cabac=0:colormatrix=bt709:colorprim=bt709:force-cfr=1:keyint=901:min-keyint=901:open-gop=0:ref=1:range=tv:repeat-headers=1:scenecut=0:sliced-threads=0:slices=1:threads=1:lookahead-threads=1:sync-lookahead=0:transfer=bt709",
        "-f", "h264", "pipe:1"
      ]
    });
  });

  it("calibrates the cropped production encoder with compiler-packed YUV", () => {
    const invocation = createCalibrationInvocation();
    expect(invocation.stdinFile).toMatchObject({
      offset: 0,
      length: 2_304
    });
    expect(invocation.arguments).toEqual(expect.arrayContaining([
      "-pixel_format", "yuv420p",
      "-video_size", "16x48",
      "-frames:v", "2"
    ]));
    expect(invocation.arguments).not.toContain("-vf");
    const x264 = invocation.arguments[
      invocation.arguments.indexOf("-x264-params") + 1
    ];
    expect(x264).toContain("crop-rect=0,0,0,4");
  });

  it("rejects decode-source types at the raw-YUV-only encoder boundary", () => {
    const common = {
      startFrame: 0,
      endFrame: 1,
      codedWidth: 16,
      codedHeight: 16,
      bitrate: { average: 100_000, peak: 200_000 }
    };
    for (const source of [
      { type: "video", path: "/input/clip.mov" },
      {
        type: "raw-rgba",
        path: "/input/canonical.rgba",
        width: 16,
        height: 16,
        frameRate: { numerator: 30, denominator: 1 }
      }
    ]) {
      expect(() => createEncodeAvcUnitInvocation({
        ...common,
        source
      } as never)).toThrow(/compiler-packed raw yuv420p/u);
    }
  });

  it("retains reviewed video and raw-RGBA inputs for decode/materialization", () => {
    expect(sourceArguments({ type: "video", path: "/input/clip.mp4" }))
      .toEqual(["-f", "mov", "-i", "/input/clip.mp4"]);
    expect(sourceArguments({
      type: "raw-rgba",
      path: "/input/canonical.rgba",
      width: 16,
      height: 16,
      frameRate: { numerator: 30, denominator: 1 }
    })).toEqual([
      "-f", "rawvideo", "-pixel_format", "rgba",
      "-video_size", "16x16", "-framerate", "30/1",
      "-i", "/input/canonical.rgba"
    ]);
  });

  it("owns the complete canvas RGBA extraction vector", () => {
    expect(createExtractRgbaRangeInvocation({
      source: { type: "video", path: "/input/clip.mov" },
      startFrame: 4,
      endFrame: 6,
      width: 320,
      height: 180
    })).toEqual({
      cwd: "/input",
      arguments: [
        "-nostdin", "-hide_banner", "-loglevel", "error", "-xerror",
        "-max_alloc", "67108864", "-protocol_whitelist", "file,pipe",
        "-f", "mov", "-i", "/input/clip.mov",
        "-map", "0:v:0", "-an", "-sn", "-dn",
        "-map_metadata", "-1", "-map_chapters", "-1",
        "-threads", "1", "-filter_threads", "1",
        "-vf", "select=between(n\\,4\\,5),scale=320:180:flags=lanczos+accurate_rnd+full_chroma_int:in_range=auto:out_range=full:in_color_matrix=auto:out_color_matrix=bt709,setsar=1,format=rgba",
        "-frames:v", "2", "-fps_mode", "passthrough",
        "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"
      ]
    });
  });

  it("only permits low-level callers to lower the media timeout ceiling", async () => {
    const source = {
      type: "raw-yuv420p" as const,
      path: "/input/canonical.yuv",
      width: 32,
      height: 32,
      frameRate: { numerator: 30, denominator: 1 },
      frameBytes: 1_536
    };
    await expect(encodeAvcUnit({
      source,
      startFrame: 0,
      endFrame: 1,
      codedWidth: 32,
      codedHeight: 32,
      bitrate: { average: 100_000, peak: 200_000 },
      executable: "not-used",
      timeoutMs: 120_001
    })).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });
});
