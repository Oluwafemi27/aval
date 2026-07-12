import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  adaptManifestToMotionGraph,
  parseFrontIndex,
  validateCompleteAsset
} from "@rendered-motion/format";

import { inspectAssetFile } from "../src/commands/asset.js";
import { compileProjectFile } from "../src/compile/project-compiler.js";
import { encodeCanonicalRgbaPng } from "../src/compile/png.js";

const HAS_FFMPEG = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!HAS_FFMPEG)("source-project compiler integration", () => {
  let directory = "";
  let projectPath = "";
  let firstPath = "";
  let secondPath = "";

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "rma-project-compiler-"));
    projectPath = join(directory, "motion.rma-project.json");
    firstPath = join(directory, "first.rma");
    secondPath = join(directory, "second.rma");
    const framesDirectory = join(directory, "frames");
    await mkdir(framesDirectory);

    const loop = [128, 199, 228, 199, 128, 57, 28, 57];
    await Promise.all([...loop, ...loop.map((value) => value + 20)].map(
      async (value, index) => {
        const rgba = new Uint8Array(32 * 32 * 4);
        for (let offset = 0; offset < rgba.length; offset += 4) {
          rgba.set([value, value, value, 255], offset);
        }
        await writeFile(
          join(framesDirectory, `frame-${String(index).padStart(4, "0")}.png`),
          encodeCanonicalRgbaPng({ width: 32, height: 32, rgba })
        );
      }
    ));

    await writeFile(projectPath, JSON.stringify(sourceProject(), null, 2));
  });

  afterAll(async () => {
    if (directory !== "") await rm(directory, { recursive: true, force: true });
  });

  it("compiles identical source projects to byte-identical canonical assets", async () => {
    const first = await compileProjectFile({ projectPath, outputPath: firstPath });
    const second = await compileProjectFile({ projectPath, outputPath: secondPath });
    const modernProjectPath = join(directory, "motion-v02.json");
    const modernOutputPath = join(directory, "modern.rma");
    await writeFile(modernProjectPath, JSON.stringify(sourceProjectV02(), null, 2));
    const modern = await compileProjectFile({
      projectPath: modernProjectPath,
      outputPath: modernOutputPath
    });
    const firstBytes = new Uint8Array(await readFile(firstPath));
    const secondBytes = new Uint8Array(await readFile(secondPath));

    expect(first.sha256).toBe(second.sha256);
    expect(first.bytes).toBe(firstBytes.byteLength);
    expect(second.bytes).toBe(secondBytes.byteLength);
    expect(firstBytes).toEqual(secondBytes);
    expect(new Uint8Array(await readFile(modernOutputPath))).toEqual(firstBytes);
    expect(() => validateCompleteAsset({ bytes: firstBytes })).not.toThrow();
    expect(first.buildDetails.projectFile).toMatchObject({
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/u)
    });
    expect(first.buildDetails.sources).toHaveLength(1);
    expect(first.buildDetails.statics[0]?.validation).toMatchObject({
      profile: "strict-rgba-png-v0",
      decoder: "format-pure-rfc1950-1951-v0",
      width: 32,
      height: 32,
      rgbaBytes: 32 * 32 * 4
    });
    expect(first.buildDetails.sources[0]?.inputFiles).toHaveLength(16);
    expect(first.buildDetails.invocations.map(({ operation }) => operation))
      .toEqual(expect.arrayContaining([
        "frames:probe",
        "frames:materialize-rgba",
        "encode:opaque:active-body",
        "encode:opaque:idle-body"
      ]));
    expect(first.buildDetails.alphaPolicy).toMatchObject({
      requested: "opaque",
      selected: "opaque",
      audit: { allOpaque: true, uniqueReferencedFrames: 16 }
    });
    expect(modern.buildDetails.alphaPolicy).toMatchObject({
      requested: "auto",
      selected: "opaque",
      audit: { allOpaque: true, uniqueReferencedFrames: 16 }
    });
    expect(JSON.stringify(first.buildDetails.invocations)).not.toContain(directory);
  }, 30_000);

  it("preserves source states, ports, event routes, bindings, and readiness", async () => {
    const bytes = new Uint8Array(await readFile(firstPath));
    const front = parseFrontIndex(bytes);
    const graph = adaptManifestToMotionGraph(front.manifest).definition;

    expect(front.manifest.initialState).toBe("idle");
    expect(front.manifest.states).toEqual([
      {
        id: "active",
        bodyUnit: "active-body",
        staticFrame: "static.00"
      },
      {
        id: "idle",
        bodyUnit: "idle-body",
        staticFrame: "static.01"
      }
    ]);
    expect(front.manifest.units.map((unit) => ({
      id: unit.id,
      kind: unit.kind,
      frameCount: unit.frameCount,
      ports: unit.kind === "body" ? unit.ports : undefined
    }))).toEqual([
      {
        id: "active-body",
        kind: "body",
        frameCount: 8,
        ports: [{ id: "default", entryFrame: 0, portalFrames: [0] }]
      },
      {
        id: "idle-body",
        kind: "body",
        frameCount: 8,
        ports: [{ id: "default", entryFrame: 0, portalFrames: [0] }]
      }
    ]);
    expect(front.manifest.edges).toEqual([{
      id: "idle-to-active",
      from: "idle",
      to: "active",
      trigger: { type: "event", name: "hover-active" },
      start: { type: "cut", targetPort: "default", maxWaitFrames: 1 },
      continuity: "cut",
      targetRunwayFrames: 6
    }]);
    expect(front.manifest.bindings).toEqual([
      { source: "pointer.enter", event: "hover-active" }
    ]);
    expect(front.manifest.readiness).toEqual({
      policy: "all-routes",
      bootstrapUnits: ["active-body", "idle-body"],
      immediateEdges: ["idle-to-active"]
    });
    expect(front.manifest.staticFrames.map(({ id }) => id)).toEqual([
      "static.00",
      "static.01"
    ]);
    expect(front.records).toHaveLength(16);

    expect(graph.initialState).toBe("idle");
    expect(graph.states.map((state) => ({
      id: state.id,
      bodyUnit: state.body.unitId,
      staticFrame: state.staticFrameId,
      ports: state.body.ports
    }))).toEqual([
      {
        id: "active",
        bodyUnit: "active-body",
        staticFrame: "static.00",
        ports: [{ id: "default", entryFrame: 0, portalFrames: [0] }]
      },
      {
        id: "idle",
        bodyUnit: "idle-body",
        staticFrame: "static.01",
        ports: [{ id: "default", entryFrame: 0, portalFrames: [0] }]
      }
    ]);
    expect(graph.edges).toEqual([{
      id: "idle-to-active",
      from: "idle",
      to: "active",
      trigger: { type: "event", name: "hover-active" },
      start: { type: "cut", targetPort: "default", maxWaitFrames: 1 },
      continuity: "cut"
    }]);
  });

  it("honors an explicit project-wide packed profile and decode-back gate", async () => {
    const packedProjectPath = join(directory, "motion-packed.json");
    const packedOutputPath = join(directory, "packed.rma");
    const project = structuredClone(sourceProjectV02()) as any;
    project.profile = "avc-annexb-packed-alpha-v0";
    await writeFile(packedProjectPath, JSON.stringify(project, null, 2));

    const result = await compileProjectFile({
      projectPath: packedProjectPath,
      outputPath: packedOutputPath
    });
    expect(result.buildDetails.alphaPolicy).toMatchObject({
      requested: "packed",
      selected: "packed",
      warnings: [expect.stringContaining("fully opaque")]
    });
    expect(result.warnings).toEqual([
      "Packed alpha was requested for fully opaque canonical pixels"
    ]);
    expect(new Set(result.warnings).size).toBe(result.warnings.length);
    expect(result.buildDetails.renditions[0]).toMatchObject({
      profile: "avc-annexb-packed-alpha-v0",
      alphaQuality: {
        frameCount: 16,
        aggregate: {
          meanAbsoluteError: expect.any(Number),
          p99AbsoluteError: expect.any(Number)
        }
      },
      compositeQuality: {
        policy: "report-only",
        frameCount: 16,
        backgrounds: [
          { background: "black" },
          { background: "white" },
          { background: "magenta" }
        ]
      }
    });
    expect(parseFrontIndex(new Uint8Array(await readFile(packedOutputPath)))
      .manifest.renditions[0]?.profile)
      .toBe("avc-annexb-packed-alpha-v0");
    await expect(inspectAssetFile(packedOutputPath)).resolves.toMatchObject({
      avcClaim: "syntax-and-dependency-inspected",
      avc: [{ rendition: "opaque" }]
    });
  }, 30_000);

  it("rejects an explicit poster that differs from the body entry pixels", async () => {
    const mismatchProjectPath = join(directory, "motion-poster-mismatch.json");
    const mismatchOutputPath = join(directory, "poster-mismatch.rma");
    const project = structuredClone(sourceProjectV02()) as any;
    project.states[0].poster = { source: "frames", frame: 1 };
    await writeFile(mismatchProjectPath, JSON.stringify(project, null, 2));

    await expect(compileProjectFile({
      projectPath: mismatchProjectPath,
      outputPath: mismatchOutputPath
    })).rejects.toMatchObject({
      code: "INPUT_INVALID",
      field: "states[1].poster"
    });
  }, 30_000);
});

function sourceProject(): unknown {
  return {
    projectVersion: "0.1",
    profile: "avc-annexb-opaque-v0",
    canvas: {
      width: 32,
      height: 32,
      fit: "contain",
      pixelAspect: [1, 1],
      colorSpace: "srgb"
    },
    frameRate: { numerator: 30, denominator: 1 },
    sources: [{
      id: "frames",
      type: "png-sequence",
      directory: "frames",
      prefix: "frame-",
      digits: 4,
      suffix: ".png",
      firstNumber: 0,
      frameCount: 16
    }],
    renditions: [{
      id: "opaque",
      codedWidth: 32,
      codedHeight: 32,
      bitrate: { average: 300_000, peak: 600_000 }
    }],
    units: [
      {
        id: "idle-body",
        kind: "body",
        source: "frames",
        range: [0, 8],
        playback: "loop",
        ports: [{ id: "default", entryFrame: 0, portalFrames: [0] }]
      },
      {
        id: "active-body",
        kind: "body",
        source: "frames",
        range: [8, 16],
        playback: "loop",
        ports: [{ id: "default", entryFrame: 0, portalFrames: [0] }]
      }
    ],
    initialState: "idle",
    states: [
      { id: "idle", bodyUnit: "idle-body" },
      { id: "active", bodyUnit: "active-body" }
    ],
    edges: [{
      id: "idle-to-active",
      from: "idle",
      to: "active",
      trigger: { type: "event", name: "hover-active" },
      start: { type: "cut", targetPort: "default", maxWaitFrames: 1 },
      continuity: "cut",
      targetRunwayFrames: 6
    }],
    bindings: [{ source: "pointer.enter", event: "hover-active" }]
  };
}

function sourceProjectV02(): unknown {
  const value = structuredClone(sourceProject()) as any;
  value.projectVersion = "0.2";
  value.profile = "avc-annexb-auto-v0";
  value.renditions = value.renditions.map((rendition: any) => ({
    id: rendition.id,
    width: rendition.codedWidth,
    height: rendition.codedHeight,
    bitrate: rendition.bitrate
  }));
  return value;
}
