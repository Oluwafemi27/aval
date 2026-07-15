import { createHash } from "node:crypto";
import { chmod, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseFrontIndex,
  validateCompleteAsset
} from "../../../packages/format/dist/index.js";

const outputRoot = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(outputRoot, "../../compiler/m5/source");
const fixtures = [
  {
    name: "opaque-loop.avl",
    project: "loop.json",
    coverage: "Two-frame opaque body loop."
  },
  {
    name: "opaque-path.avl",
    project: "path.json",
    coverage: "Initial one-shot, two body loops, locked bridge, and pointer binding."
  },
  {
    name: "opaque-reversible.avl",
    project: "reversible.json",
    coverage: "Forward-authored reversible transition, exact inverse edge, finish route, and deliberate cut."
  }
];

const records = [];
let reviewedToolchain;
let compiler;
for (const fixture of fixtures) {
  const result = await fixtureRecord(fixture);
  records.push(result.record);
  const toolchain = normalizedToolchain(result.report.toolchain);
  if (reviewedToolchain === undefined) reviewedToolchain = toolchain;
  else requireEqual(toolchain, reviewedToolchain, "fixture toolchains differ");
  const nextCompiler = result.report.compiler;
  if (compiler === undefined) compiler = nextCompiler;
  else requireEqual(nextCompiler, compiler, "fixture compiler environments differ");
}

const provenance = {
  provenanceVersion: "0.2",
  generatedAt: "2026-07-14",
  generator: "aval-compiler/0.1",
  pipelineLineage: {
    migration: "embedded-posters-to-motion-only-v0",
    previousAssets: [
      {
        name: "opaque-loop.avl",
        sha256: "56b1616ef53a4d3974337e9fa3b910657700f8b5897266e15f6b0dff22671204"
      },
      {
        name: "opaque-path.avl",
        sha256: "f3777ad640387940858e9ef52924dd7c1fec2c02d9f732b93c866fc0b39efa20"
      },
      {
        name: "opaque-reversible.avl",
        sha256: "d7cfff018d1b42b9cde438f65ea7a56d267618cb3f2ec0a91b1819caf7d6bcc9"
      }
    ],
    review: "Intentional wire migration: embedded static PNGs were removed; source projects, motion units, and PNG source frames remain unchanged."
  },
  compiler,
  toolchain: reviewedToolchain,
  fixtures: records
};
await writeFile(
  resolve(outputRoot, "provenance.json"),
  `${JSON.stringify(provenance, null, 2)}\n`
);

// Build reports contain machine-local paths and identities. They are inputs to
// this normalized reviewed record, never checked-in conformance artifacts.
await Promise.all(fixtures.map(({ name }) =>
  unlink(resolve(outputRoot, `${name}.build.json`))
));

async function fixtureRecord(fixture) {
  const projectPath = resolve(sourceRoot, fixture.project);
  const projectBytes = await readFile(projectPath);
  const project = JSON.parse(projectBytes.toString("utf8"));
  const sourceFrames = await sourceFrameRecords(project);
  const assetPath = resolve(outputRoot, fixture.name);
  const asset = new Uint8Array(await readFile(assetPath));
  await chmod(assetPath, 0o644);
  const report = JSON.parse(
    await readFile(`${assetPath}.build.json`, "utf8")
  );
  const { frontIndex } = validateCompleteAsset({ bytes: asset });
  const reparsed = parseFrontIndex(asset);
  requireEqual(frontIndex, reparsed, `${fixture.name} front index is unstable`);
  require(
    report.asset.sha256 === sha256(asset) && report.asset.bytes === asset.byteLength,
    `${fixture.name} report does not identify its asset`
  );
  require(
    report.buildDetails.projectFile?.sha256 === sha256(projectBytes),
    `${fixture.name} report does not identify its project`
  );

  return {
    report,
    record: {
      name: fixture.name,
      coverage: fixture.coverage,
      sourceProject: {
        path: `fixtures/compiler/m5/source/${fixture.project}`,
        bytes: projectBytes.byteLength,
        sha256: sha256(projectBytes)
      },
      sourceFrames,
      frontIndex: frontIndex.frontIndexRange,
      units: frontIndex.unitBlobs.map((blob) => {
        require(
          sha256(asset.subarray(blob.offset, blob.offset + blob.length)) === blob.sha256,
          `${fixture.name} unit blob digest mismatch`
        );
        return { ...blob };
      }),
      normalization: report.buildDetails.sources.map((source) => ({
        source: source.id,
        probe: {
          width: source.width,
          height: source.height,
          frameCount: source.frameCount,
          frameRate: source.frameRate,
          timeBase: source.timeBase,
          durationMicros: source.durationMicros,
          pixelFormat: source.pixelFormat,
          hasAlpha: source.hasAlpha,
          variableFrameRate: source.variableFrameRate,
          frames: source.frames
        },
        normalization: source.normalization,
        alphaAudit: source.alphaAudit
      })),
      invocations: report.buildDetails.invocations,
      renditions: report.buildDetails.renditions,
      continuity: report.buildDetails.continuity,
      asset: { bytes: asset.byteLength, sha256: sha256(asset) }
    }
  };
}

async function sourceFrameRecords(project) {
  const result = [];
  for (const source of project.sources) {
    require(source.type === "png-sequence", "checked M5 fixtures must use PNG sources");
    for (let index = 0; index < source.frameCount; index += 1) {
      const number = source.firstNumber + index;
      const relativePath = `${source.directory}/${source.prefix}${String(number).padStart(source.digits, "0")}${source.suffix}`;
      const bytes = await readFile(resolve(sourceRoot, relativePath));
      result.push({ path: relativePath, bytes: bytes.byteLength, sha256: sha256(bytes) });
    }
  }
  return result;
}

function normalizedToolchain(toolchain) {
  return {
    aggregateMemoryLimit: toolchain.aggregateMemoryLimit,
    ffmpeg: {
      executableSha256: toolchain.ffmpeg.executableSha256,
      version: toolchain.ffmpeg.version,
      versionOutputSha256: toolchain.ffmpeg.versionOutputSha256,
      configuration: toolchain.ffmpeg.configuration,
      configurationSha256: toolchain.ffmpeg.configurationSha256,
      encodersOutputSha256: toolchain.ffmpeg.encodersOutputSha256,
      calibrationSha256: toolchain.ffmpeg.calibrationSha256
    },
    ffprobe: {
      executableSha256: toolchain.ffprobe.executableSha256,
      version: toolchain.ffprobe.version,
      versionOutputSha256: toolchain.ffprobe.versionOutputSha256
    }
  };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function require(condition, message) {
  if (!condition) throw new Error(message);
}

function requireEqual(actual, expected, message) {
  require(JSON.stringify(actual) === JSON.stringify(expected), message);
}
