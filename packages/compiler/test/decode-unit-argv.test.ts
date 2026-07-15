import { describe, expect, it } from "vitest";

import { deriveAvcRenditionGeometry } from "@aval/format";

import {
  createDecodeAvcUnitInvocation
} from "../src/ffmpeg/decode-unit.js";

describe("bounded AVC decode-back invocation", () => {
  it("decodes tagged AVC directly to cropped RGBA without scale filters", () => {
    const geometry = deriveAvcRenditionGeometry({
      profile: "avc-annexb-packed-alpha-v0",
      canvasWidth: 3,
      canvasHeight: 1,
      colorRect: [0, 0, 3, 1],
      alphaRect: [0, 10, 3, 1],
      codedWidth: 16,
      codedHeight: 16
    });
    const invocation = createDecodeAvcUnitInvocation({
      geometry,
      expectedFrameCount: 2
    });

    expect(invocation).toEqual({
      cwd: ".",
      arguments: [
        "-nostdin", "-hide_banner", "-loglevel", "error", "-xerror",
        "-protocol_whitelist", "pipe",
        "-f", "h264", "-i", "pipe:0",
        "-map", "0:v:0", "-an", "-sn", "-dn",
        "-map_metadata", "-1", "-map_chapters", "-1",
        "-threads", "1", "-filter_threads", "1",
        "-frames:v", "2", "-fps_mode", "passthrough",
        "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"
      ],
      expectedFrameBytes: 4 * 12 * 4
    });
    expect(invocation.arguments).not.toContain("-vf");
  });

  it("rejects hostile frame counts and inconsistent geometry", () => {
    const geometry = deriveAvcRenditionGeometry({
      profile: "avc-annexb-opaque-v0",
      canvasWidth: 2,
      canvasHeight: 2,
      colorRect: [0, 0, 2, 2],
      codedWidth: 16,
      codedHeight: 16
    });
    expect(() => createDecodeAvcUnitInvocation({
      geometry,
      expectedFrameCount: 0
    })).toThrow();
    expect(createDecodeAvcUnitInvocation({
      geometry,
      expectedFrameCount: 901
    }).arguments).toContain("901");
    expect(() => createDecodeAvcUnitInvocation({
      geometry: { ...geometry, decodedStorageRect: [0, 0, 3, 2] },
      expectedFrameCount: 1
    })).toThrow();
  });
});
