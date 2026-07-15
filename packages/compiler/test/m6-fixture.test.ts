import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  decodePngRgba,
  deriveAvcRenditionGeometry,
  parseFrontIndex,
  serializeCanonicalJson,
  validateCompleteAsset,
  validatePngProfile
} from "@aval/format";
import { describe, expect, it } from "vitest";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SOURCE_ROOT = join(REPOSITORY_ROOT, "fixtures/compiler/m6/source");
const CONFORMANCE_ROOT = join(REPOSITORY_ROOT, "fixtures/conformance/m6");
const PROVENANCE_PATH = join(CONFORMANCE_ROOT, "provenance.json");
const COMPILER_PROVENANCE_PATH = join(
  REPOSITORY_ROOT,
  "fixtures/compiler/m6/provenance.json"
);

describe("M6 checked packed-alpha fixture", () => {
  it("binds every source and checked asset to path-free provenance", async () => {
    const provenance = JSON.parse(await readFile(PROVENANCE_PATH, "utf8"));
    const compilerProvenance = JSON.parse(
      await readFile(COMPILER_PROVENANCE_PATH, "utf8")
    );
    expect(findAbsolutePaths(provenance)).toEqual([]);
    expect(findAbsolutePaths(compilerProvenance)).toEqual([]);
    await expectDigest(provenance.compilerSource);
    await expectDigest(provenance.reviewedEncodedSource.recipe);
    await expectDigest(provenance.reviewedEncodedSource.payload);

    for (const project of compilerProvenance.projects) await expectDigest(project);
    await expectDigest(compilerProvenance.generator);
    for (const module of compilerProvenance.generatorModules) {
      await expectDigest(module);
    }
    await expectDigest(compilerProvenance.license);
    for (const sequence of compilerProvenance.sequences) {
      expect(sequence).toMatchObject({ width: 45, height: 27, frameCount: 30 });
      for (const frame of sequence.frames) await expectDigest(frame);
    }

    for (const entry of provenance.assets) {
      const bytes = new Uint8Array(
        await readFile(join(CONFORMANCE_ROOT, entry.name))
      );
      const front = validateCompleteAsset({ bytes }).frontIndex;
      expect(bytes.byteLength).toBe(entry.asset.bytes);
      expect(sha256(bytes)).toBe(entry.asset.sha256);
      expect(sha256(serializeCanonicalJson(front.manifest)))
        .toBe(entry.manifestSha256);
      expect(front.unitBlobs).toEqual(entry.units);
      for (const blob of entry.units) {
        expect(sha256(bytes.subarray(blob.offset, blob.offset + blob.length)))
          .toBe(blob.sha256);
      }
    }
  });

  it("keeps opaque and hostile-alpha source facts plus exact full-size tags", async () => {
    const codes: number[] = [];
    for (let index = 0; index < 30; index += 1) {
      const name = `frame-${String(index).padStart(4, "0")}.png`;
      const opaque = await decodeSource(join(SOURCE_ROOT, "opaque-frames", name));
      const packed = await decodeSource(join(SOURCE_ROOT, "packed-frames", name));
      expect(opaque.rgba.filter((_, offset) => offset % 4 === 3)
        .every((alpha) => alpha === 255)).toBe(true);
      expect(Math.min(...packed.rgba.filter((_, offset) => offset % 4 === 3)))
        .toBe(0);

      const hidden = new Set<string>();
      for (let offset = 0; offset < packed.rgba.byteLength; offset += 4) {
        if (packed.rgba[offset + 3] === 0) {
          hidden.add(`${packed.rgba[offset]},${packed.rgba[offset + 1]},${packed.rgba[offset + 2]}`);
        }
      }
      expect(hidden).toEqual(new Set(["255,0,255", "0,255,0"]));
      const code = readTagCode(packed.rgba, packed.width);
      expect(code).toBe(tagCode(index));
      if (index > 0) expect(populationCount(code ^ codes[index - 1]!)).toBe(3);
      codes.push(code);
    }
    expect(new Set(codes).size).toBe(30);
  });

  it("freezes alpha policy, odd crop geometry, and quality margins", async () => {
    const provenance = JSON.parse(await readFile(PROVENANCE_PATH, "utf8"));
    const byName = new Map<string, any>(
      provenance.assets.map((asset: any) => [asset.name, asset])
    );
    expect(byName.get("opaque-odd.avl")!.alphaPolicy).toMatchObject({
      requested: "auto",
      selected: "opaque",
      audit: { allOpaque: true, minimumAlpha: 255 }
    });
    expect(byName.get("packed-alpha-loop.avl")!.alphaPolicy).toMatchObject({
      requested: "auto",
      selected: "packed",
      audit: { allOpaque: false, minimumAlpha: 0 }
    });
    const allRoutes: any = byName.get("packed-alpha-all-routes.avl");
    expect(allRoutes.alphaPolicy).toMatchObject({
      requested: "packed",
      selected: "packed",
      audit: { uniqueReferencedFrames: 29, minimumAlpha: 0 }
    });

    expect(allRoutes.renditions.map((rendition: any) => ({
      id: rendition.id,
      storage: rendition.geometry.decodedStorageRect,
      coded: [rendition.geometry.codedWidth, rendition.geometry.codedHeight]
    }))).toEqual([
      { id: "packed.0.333x", storage: [0, 0, 16, 28], coded: [16, 32] },
      { id: "packed.1x", storage: [0, 0, 46, 64], coded: [48, 64] }
    ]);
    for (const rendition of allRoutes.renditions) {
      expect(Number(rendition.alphaQuality.aggregate.meanAbsoluteError))
        .toBeLessThanOrEqual(2 / 255);
      expect(Number(rendition.alphaQuality.aggregate.p99AbsoluteError))
        .toBeLessThanOrEqual(5 / 255);
      for (const background of rendition.compositeQuality.backgrounds) {
        expect(Number(background.meanAbsoluteError)).toBeLessThanOrEqual(4 / 255);
        expect(Number(background.p99AbsoluteError)).toBeLessThanOrEqual(14 / 255);
      }
    }

    expect(allRoutes).not.toHaveProperty("statics");
    expect(allRoutes).not.toHaveProperty("staticPayloadBytes");

    for (const rendition of allRoutes.manifest.renditions) {
      expect(() => deriveAvcRenditionGeometry({
        canvasWidth: 45,
        canvasHeight: 27,
        profile: rendition.profile,
        codedWidth: rendition.codedWidth,
        codedHeight: rendition.codedHeight,
        colorRect: rendition.alphaLayout.colorRect,
        alphaRect: rendition.alphaLayout.alphaRect
      })).not.toThrow();
    }
  });
});

async function decodeSource(path: string) {
  const png = new Uint8Array(await readFile(path));
  return decodePngRgba(validatePngProfile({
    png,
    expectedWidth: 45,
    expectedHeight: 27
  }));
}

function readTagCode(rgba: Uint8Array, width: number): number {
  let code = 0;
  for (let bit = 0; bit < 6; bit += 1) {
    const offset = (16 * width + 3 + bit * 5) * 4;
    expect(rgba[offset + 3]).toBe(255);
    if (rgba[offset]! > 128) code |= 1 << bit;
  }
  return code;
}

function tagCode(frameIndex: number): number {
  const columns = [0b000111, 0b001011, 0b001101, 0b001110, 0b010011, 0b100011];
  const gray = frameIndex ^ (frameIndex >> 1);
  return columns.reduce(
    (code, column, bit) => (gray & (1 << bit)) === 0 ? code : code ^ column,
    0
  );
}

function populationCount(value: number): number {
  let count = 0;
  for (let remaining = value; remaining !== 0; remaining >>>= 1) count += remaining & 1;
  return count;
}

async function expectDigest(entry: { path: string; bytes: number; sha256: string }) {
  const bytes = await readFile(join(REPOSITORY_ROOT, entry.path));
  expect(bytes.byteLength).toBe(entry.bytes);
  expect(sha256(bytes)).toBe(entry.sha256);
}

function findAbsolutePaths(value: unknown, output: string[] = []): string[] {
  if (typeof value === "string") {
    if (
      value.startsWith("/") || value.startsWith("\\\\") ||
      /^[a-z]:[\\/]/iu.test(value) ||
      /(?:^|[\s"'=:(,])\/[a-z0-9._-]/iu.test(value)
    ) output.push(value);
  } else if (Array.isArray(value)) {
    for (const child of value) findAbsolutePaths(child, output);
  } else if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) findAbsolutePaths(child, output);
  }
  return output;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
