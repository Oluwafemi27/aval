import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compileDirectInput } from "../src/compile/direct-compiler.js";
import { compileProjectFile } from "../src/compile/project-compiler.js";
import { encodeAvcUnit } from "../src/ffmpeg/encode-unit.js";
import { probeMedia } from "../src/ffmpeg/probe.js";

describe("configurable operation timeouts", () => {
  let directory = "";
  let hangingTool = "";
  let yuvPath = "";

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "aval-timeout-tool-"));
    hangingTool = join(directory, "hang");
    yuvPath = join(directory, "frame.yuv");
    await writeFile(
      hangingTool,
      "#!/usr/bin/env node\nsetInterval(() => {}, 1000);\n",
      { mode: 0o700 }
    );
    await chmod(hangingTool, 0o700);
    await writeFile(yuvPath, new Uint8Array(32 * 32 * 3 / 2));
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("lowers the 15-second probe default", async () => {
    await expect(probeMedia(
      "/input/clip.mov",
      hangingTool,
      undefined,
      20
    )).rejects.toMatchObject({ code: "PROCESS_TIMEOUT" });
  });

  it("lowers the 120-second media default", async () => {
    await expect(encodeAvcUnit({
      source: {
        type: "raw-yuv420p",
        path: yuvPath,
        width: 32,
        height: 32,
        frameRate: { numerator: 30, denominator: 1 },
        frameBytes: 1_536
      },
      startFrame: 0,
      endFrame: 1,
      codedWidth: 32,
      codedHeight: 32,
      encoding: {
        codec: "h264",
        preset: "medium",
        legacyZeroLatency: true,
        rateControl: {
          mode: "abr",
          averageBitrate: 100_000,
          maxBitrate: 200_000
        }
      },
      executable: hangingTool,
      timeoutMs: 20
    })).rejects.toMatchObject({ code: "PROCESS_TIMEOUT" });
  });

  it("threads positive timeout validation through both public compiler entries", async () => {
    await expect(compileDirectInput({
      inputPath: "/input/never-opened.mov",
      outputPath: "/output/never-written.avl",
      loop: [0, 1],
      probeTimeoutMs: 0,
      mediaTimeoutMs: 20
    })).rejects.toMatchObject({
      code: "INPUT_INVALID",
      message: expect.stringContaining("Probe timeout")
    });

    await expect(compileProjectFile({
      projectPath: "/input/never-opened.json",
      outputPath: "/output/never-written.avl",
      probeTimeoutMs: 20,
      mediaTimeoutMs: 0
    })).rejects.toMatchObject({
      code: "INPUT_INVALID",
      message: expect.stringContaining("Media timeout")
    });
  });
});
