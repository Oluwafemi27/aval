import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { deriveAvcRenditionGeometry } from "@rendered-motion/format";
import { afterEach, describe, expect, it } from "vitest";

import {
  readExpectedAlphaFrame,
  readExpectedRgbaFrame,
  writeYuvUnitSpool
} from "../src/compile/yuv-spool.js";
import { diagnosticFromError } from "../src/diagnostics.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })
  ));
});

describe("bounded packed YUV unit spool", () => {
  it("writes exact frame ranges and a canonical RGBA quality reference", async () => {
    const root = await temporaryRoot();
    const geometry = deriveAvcRenditionGeometry({
      profile: "avc-annexb-packed-alpha-v0",
      canvasWidth: 2,
      canvasHeight: 1,
      colorRect: [0, 0, 2, 1],
      alphaRect: [0, 10, 2, 1],
      codedWidth: 16,
      codedHeight: 16
    });
    const first = Uint8Array.of(255, 0, 0, 0, 0, 0, 255, 127);
    const second = Uint8Array.of(0, 255, 0, 255, 0, 0, 0, 64);
    const spool = await writeYuvUnitSpool({
      geometry,
      frameRate: { numerator: 30, denominator: 1 },
      frames: [first, second],
      temporaryRoot: root
    });

    expect(spool.input).toMatchObject({
      type: "raw-yuv420p",
      width: 16,
      height: 16,
      frameBytes: 384
    });
    expect((await readFile(spool.input.path)).byteLength).toBe(768);
    await expect(readExpectedAlphaFrame(spool, 0)).resolves.toEqual(
      Uint8Array.of(0, 127)
    );
    await expect(readExpectedAlphaFrame(spool, 1)).resolves.toEqual(
      Uint8Array.of(255, 64)
    );
    await expect(readExpectedRgbaFrame(spool, 0)).resolves.toEqual(first);
    await expect(readExpectedRgbaFrame(spool, 1)).resolves.toEqual(second);
    await expect(readExpectedAlphaFrame(spool, 2)).rejects.toMatchObject({
      code: "FRAME_RANGE_INVALID"
    });
    await spool.cleanup();
  });

  it("omits alpha scratch for opaque frames and cleans cancellation", async () => {
    const root = await temporaryRoot();
    const geometry = deriveAvcRenditionGeometry({
      profile: "avc-annexb-opaque-v0",
      canvasWidth: 1,
      canvasHeight: 1,
      colorRect: [0, 0, 1, 1],
      codedWidth: 16,
      codedHeight: 16
    });
    const spool = await writeYuvUnitSpool({
      geometry,
      frameRate: { numerator: 30, denominator: 1 },
      frames: [Uint8Array.of(0, 0, 0, 255)],
      temporaryRoot: root
    });
    expect(spool.expectedRgba).toBeNull();
    await expect(readExpectedAlphaFrame(spool, 0)).rejects.toMatchObject({
      code: "INPUT_INVALID"
    });
    await spool.cleanup();

    const controller = new AbortController();
    controller.abort("test");
    await expect(writeYuvUnitSpool({
      geometry,
      frameRate: { numerator: 30, denominator: 1 },
      frames: [Uint8Array.of(0, 0, 0, 255)],
      temporaryRoot: root,
      signal: controller.signal
    })).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("maps scratch filesystem failures without exposing host paths", async () => {
    const geometry = deriveAvcRenditionGeometry({
      profile: "avc-annexb-opaque-v0",
      canvasWidth: 1,
      canvasHeight: 1,
      colorRect: [0, 0, 1, 1],
      codedWidth: 16,
      codedHeight: 16
    });
    const privatePath = join(tmpdir(), "private-project-name", "missing");
    try {
      await writeYuvUnitSpool({
        geometry,
        frameRate: { numerator: 30, denominator: 1 },
        frames: [Uint8Array.of(0, 0, 0, 255)],
        temporaryRoot: privatePath
      });
      throw new Error("expected scratch storage failure");
    } catch (error) {
      const diagnostic = diagnosticFromError(error);
      expect(diagnostic).toMatchObject({
        code: "IO_FAILED",
        message: "Could not inspect YUV scratch storage"
      });
      expect(JSON.stringify(diagnostic)).not.toContain(privatePath);
      expect(JSON.stringify(diagnostic)).not.toContain("private-project-name");
    }
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "rma-yuv-spool-test-"));
  roots.push(root);
  return root;
}
