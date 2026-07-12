import { createHash } from "node:crypto";
import {
  copyFile,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

import {
  compileProjectFile
} from "../../../packages/compiler/dist/index.js";

import {
  decodePngRgba,
  deriveAvcRenditionGeometry,
  inspectAvcAnnexBRendition,
  parseFrontIndex,
  serializeCanonicalJson,
  validateCompleteAsset,
  validatePngProfile
} from "../../../packages/format/dist/index.js";

const outputRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(outputRoot, "../../..");
const compilerProvenancePath = resolve(
  repositoryRoot,
  "fixtures/compiler/m6/provenance.json"
);
const outputPath = resolve(outputRoot, "provenance.json");
const check = process.argv.includes("--check");
const assetNames = [
  "opaque-odd.rma",
  "packed-alpha-loop.rma",
  "packed-alpha-all-routes.rma"
];
const projectByAsset = Object.freeze({
  "opaque-odd.rma": "fixtures/compiler/m6/source/opaque-odd.json",
  "packed-alpha-loop.rma": "fixtures/compiler/m6/source/packed-loop.json",
  "packed-alpha-all-routes.rma":
    "fixtures/compiler/m6/source/packed-all-routes.json"
});
const validPngs = [
  ["stored-filter0.png", 0, 0, "conformance-pattern"],
  ["fixed-filter1.png", 1, 1, "conformance-pattern"],
  ["dynamic-filter2.png", 2, 2, "conformance-pattern"],
  ["dynamic-filter3.png", 3, 2, "conformance-pattern"],
  ["dynamic-filter4.png", 4, 2, "conformance-pattern"],
  ["dynamic-literal-only-filter0.png", 0, 2, "transparent-black"]
];

const temporaryRoot = await mkdtemp(join(tmpdir(), "rma-m6-provenance-"));
try {
  const provenance = await regenerateProvenance(temporaryRoot);
  assertNoAbsolutePaths(provenance);
  const serialized = `${JSON.stringify(provenance, null, 2)}\n`;
  if (check) {
    const recorded = await readFile(outputPath, "utf8");
    require(recorded === serialized, "complete M6 conformance provenance is stale");
  } else {
    await Promise.all(assetNames.map((name) => copyFile(
      resolve(temporaryRoot, name),
      resolve(outputRoot, name)
    )));
    await writeFile(outputPath, serialized);
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function regenerateProvenance(assetRoot) {
  const compilerProvenanceBytes = await readFile(compilerProvenancePath);
  const compiled = [];
  for (const name of assetNames) {
    const projectRelative = projectByAsset[name];
    require(projectRelative !== undefined, `${name} has no source project mapping`);
    const assetPath = resolve(assetRoot, name);
    const result = await compileProjectFile({
      projectPath: resolve(repositoryRoot, projectRelative),
      outputPath: assetPath
    });
    compiled.push(await buildAssetProvenance(name, assetPath, result));
  }
  const referenceToolchain = normalizedToolchain(compiled[0].provenance);
  for (const entry of compiled.slice(1)) {
    requireEqual(
      normalizedToolchain(entry.provenance),
      referenceToolchain,
      "M6 assets were not produced by one reviewed toolchain"
    );
  }
  const pngCorpus = await buildValidPngCorpus();
  const malformedCorpus = await buildMalformedCorpus();
  const malformedCorpusManifest = await digest("malformed/corpus.json");
  const malformedContracts = await digest("malformed/contracts.json");
  return {
    provenanceVersion: "0.1",
    generatedAt: "2026-07-12",
    generator: "rendered-motion-compiler/0.2-web",
    regeneration: {
      build: "npm run build",
      compilerSourceCheck:
        "node fixtures/compiler/m6/update-provenance.mjs --check",
      completeConformanceCheck:
        "node fixtures/conformance/m6/update-provenance.mjs --check"
    },
    compilerSource: {
      path: "fixtures/compiler/m6/provenance.json",
      bytes: compilerProvenanceBytes.byteLength,
      sha256: sha256(compilerProvenanceBytes)
    },
    toolchain: referenceToolchain,
    coverage: [
      "odd-visible-and-coded-crop-geometry",
      "opaque-and-stacked-alpha-renditions",
      "two-ranked-packed-alpha-renditions",
      "alpha-auto-and-explicit-policy",
      "hostile-hidden-rgb-and-edge-dilation",
      "alpha-and-three-background-composite-quality",
      "shared-and-distinct-strict-static-pngs",
      "all-route-classes-and-readiness",
      "stored-fixed-dynamic-deflate-and-all-png-filters",
      "rfc1951-literal-only-dynamic-empty-distance-alphabet",
      "exhaustive-reachable-strict-png-envelope-zlib-deflate-and-scanline-rejections",
      "executable-png-and-deflate-limit-only-contracts",
      "malformed-geometry-sps-crop-alpha-quality-and-resource-contracts"
    ],
    assets: compiled.map(({ provenance: _provenance, ...asset }) => asset),
    pngCorpus,
    malformedCorpus,
    malformedCorpusManifest,
    malformedContracts
  };
}

async function buildValidPngCorpus() {
  return Promise.all(validPngs.map(async ([name, filter, btype, pixelFixture]) => {
    const bytes = new Uint8Array(await readFile(resolve(outputRoot, "png", name)));
    const plan = validatePngProfile({
      png: bytes,
      expectedWidth: 32,
      expectedHeight: 16
    });
    const decoded = decodePngRgba(plan);
    const zlib = plan.copyZlibBytes();
    const filtered = inflateSync(zlib);
    require(
      Array.from({ length: 16 }, (_, row) => filtered[row * 129])
        .every((value) => value === filter),
      `${name} does not use filter ${String(filter)} on every row`
    );
    require(firstDeflateBlockType(zlib) === btype, `${name} has the wrong block type`);
    return {
      ...await digest(`png/${name}`),
      width: decoded.width,
      height: decoded.height,
      rgbaBytes: decoded.rgba.byteLength,
      filteredBytes: filtered.byteLength,
      zlibBytes: zlib.byteLength,
      rowFilter: filter,
      firstDeflateBlockType: btype,
      pixelFixture
    };
  }));
}

async function buildMalformedCorpus() {
  const manifest = JSON.parse(
    await readFile(resolve(outputRoot, "malformed/corpus.json"), "utf8")
  );
  require(manifest.corpusVersion === "0.1", "malformed corpus version drifted");
  require(
    manifest.expectedWidth === 32 && manifest.expectedHeight === 16,
    "malformed corpus dimensions drifted"
  );
  require(
    Array.isArray(manifest.cases) && manifest.cases.length >= 50,
    "malformed corpus is not comprehensive"
  );
  const names = new Set();
  const rejectionClasses = new Set();
  for (const entry of manifest.cases) {
    require(
      typeof entry.name === "string" && entry.name.endsWith(".png"),
      "malformed corpus contains an invalid file name"
    );
    require(!names.has(entry.name), `duplicate malformed file ${entry.name}`);
    require(
      typeof entry.rejectionClass === "string" &&
        !rejectionClasses.has(entry.rejectionClass),
      `duplicate malformed rejection class ${String(entry.rejectionClass)}`
    );
    require(
      entry.expected?.name === "FormatError" &&
        [
          "PNG_ENVELOPE_INVALID",
          "PNG_DEFLATE_INVALID",
          "PNG_SCANLINE_INVALID"
        ].includes(entry.expected.code),
      `${entry.name} has an invalid expected public failure`
    );
    names.add(entry.name);
    rejectionClasses.add(entry.rejectionClass);
  }
  return Promise.all(manifest.cases.map(async (entry) => {
    const { name, rejectionClass, expected } = entry;
    const bytes = new Uint8Array(
      await readFile(resolve(outputRoot, "malformed", name))
    );
    let rejection;
    try {
      const plan = validatePngProfile({
        png: bytes,
        expectedWidth: 32,
        expectedHeight: 16
      });
      decodePngRgba(plan);
    } catch (error) {
      rejection = {
        name: error?.constructor?.name ?? "Error",
        code: typeof error?.code === "string" ? error.code : "UNKNOWN"
      };
    }
    require(rejection !== undefined, `${name} unexpectedly decoded`);
    require(
      rejection.name === expected.name && rejection.code === expected.code,
      `${name} crossed its frozen ${rejectionClass} failure boundary`
    );
    return {
      ...await digest(`malformed/${name}`),
      rejectionClass,
      rejection
    };
  }));
}

async function buildAssetProvenance(name, assetPath, result) {
  const bytes = new Uint8Array(await readFile(assetPath));
  const { frontIndex } = validateCompleteAsset({ bytes });
  requireEqual(frontIndex, parseFrontIndex(bytes), `${name} front index drifted`);
  require(
    result.bytes === bytes.byteLength && result.sha256 === sha256(bytes),
    `${name} compile result does not identify the asset`
  );

  const projectRelative = projectByAsset[name];
  require(projectRelative !== undefined, `${name} has no source project mapping`);
  const projectPath = resolve(repositoryRoot, projectRelative);
  const projectBytes = await readFile(projectPath);
  require(
    result.buildDetails.projectFile.sha256 === sha256(projectBytes),
    `${name} compile result does not identify its project`
  );

  const units = frontIndex.unitBlobs.map((blob) => {
    require(
      sha256(bytes.subarray(blob.offset, blob.offset + blob.length)) === blob.sha256,
      `${name} unit ${blob.rendition}/${blob.unit} digest mismatch`
    );
    return { ...blob };
  });
  const staticFrames = frontIndex.staticBlobs.map((blob) => {
    require(
      sha256(bytes.subarray(blob.offset, blob.offset + blob.length)) === blob.sha256,
      `${name} static ${blob.staticFrame} digest mismatch`
    );
    return { ...blob };
  });

  return {
    name,
    sourceProject: {
      path: projectRelative,
      bytes: projectBytes.byteLength,
      sha256: sha256(projectBytes)
    },
    asset: { bytes: bytes.byteLength, sha256: sha256(bytes) },
    frontIndex: frontIndex.frontIndexRange,
    manifestSha256: sha256(serializeCanonicalJson(frontIndex.manifest)),
    manifest: frontIndex.manifest,
    units,
    staticFrames,
    strictInspections: inspectEveryRendition(bytes, frontIndex),
    alphaPolicy: result.buildDetails.alphaPolicy,
    sources: result.buildDetails.sources.map((source) => ({
      id: source.id,
      hasAlpha: source.hasAlpha,
      alphaAudit: source.alphaAudit,
      width: source.width,
      height: source.height,
      frameCount: source.frameCount,
      frameRate: source.frameRate,
      pixelFormat: source.pixelFormat
    })),
    renditions: result.buildDetails.renditions,
    statics: result.buildDetails.statics,
    continuity: result.buildDetails.continuity,
    encodedPayloadBytes: result.buildDetails.encodedPayloadBytes,
    staticPayloadBytes: result.buildDetails.staticPayloadBytes,
    provenance: result.provenance
  };
}

function inspectEveryRendition(bytes, frontIndex) {
  return frontIndex.manifest.renditions.map((rendition, renditionIndex) => {
    const geometry = deriveAvcRenditionGeometry({
      canvasWidth: frontIndex.manifest.canvas.width,
      canvasHeight: frontIndex.manifest.canvas.height,
      profile: rendition.profile,
      codedWidth: rendition.codedWidth,
      codedHeight: rendition.codedHeight,
      colorRect: rendition.alphaLayout.colorRect,
      ...(rendition.profile === "avc-annexb-packed-alpha-v0"
        ? { alphaRect: rendition.alphaLayout.alphaRect }
        : {})
    });
    const inspection = inspectAvcAnnexBRendition({
      profile: {
        codedWidth: rendition.codedWidth,
        codedHeight: rendition.codedHeight,
        expectedDecodedStorageRect: geometry.decodedStorageRect,
        frameRate: frontIndex.manifest.frameRate,
        averageBitrate: rendition.bitrate.average,
        peakBitrate: rendition.bitrate.peak,
        cpbBufferBits: rendition.bitrate.peak,
        requireBt709LimitedRange: true
      },
      units: frontIndex.manifest.units.map((unit, unitIndex) => ({
        id: unit.id,
        accessUnits: frontIndex.records
          .filter((record) =>
            record.renditionIndex === renditionIndex &&
            record.unitIndex === unitIndex
          )
          .map((record) => ({
            key: record.key,
            bytes: bytes.slice(
              record.payloadOffset,
              record.payloadOffset + record.payloadLength
            )
          }))
      }))
    });
    return {
      rendition: rendition.id,
      parameterSet: inspection.parameterSet,
      macroblocksPerFrame: inspection.macroblocksPerFrame,
      units: inspection.units.map((unit) => ({
        id: unit.id,
        frames: unit.frames.length
      }))
    };
  });
}

async function digest(relativePath) {
  const bytes = await readFile(resolve(outputRoot, relativePath));
  return {
    path: `fixtures/conformance/m6/${relativePath}`,
    bytes: bytes.byteLength,
    sha256: sha256(bytes)
  };
}

function firstDeflateBlockType(zlib) {
  require(zlib.byteLength >= 3, "zlib stream is truncated");
  return (zlib[2] >> 1) & 0b11;
}

function normalizedToolchain(toolchain) {
  return {
    aggregateMemoryLimit: toolchain.aggregateMemoryLimit,
    ffmpeg: {
      executableSha256: toolchain.executableSha256,
      version: toolchain.versionLine,
      versionOutputSha256: toolchain.versionOutputSha256,
      configurationSha256: sha256(
        new TextEncoder().encode(toolchain.configurationLine)
      ),
      encodersOutputSha256: toolchain.encodersOutputSha256,
      calibrationSha256: toolchain.calibrationSha256
    },
    ffprobe: {
      executableSha256: toolchain.ffprobeExecutableSha256,
      version: toolchain.ffprobeVersionLine,
      versionOutputSha256: toolchain.ffprobeVersionOutputSha256
    }
  };
}

function assertNoAbsolutePaths(value, path = "provenance") {
  if (typeof value === "string") {
    require(
      !value.startsWith("/") &&
        !value.startsWith("\\\\") &&
        !/^[a-z]:[\\/]/iu.test(value) &&
        !/(?:^|[\s"'=:(,])\/[a-z0-9._-]/iu.test(value),
      `${path} contains an absolute path`
    );
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoAbsolutePaths(entry, `${path}[${String(index)}]`)
    );
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      assertNoAbsolutePaths(child, `${path}.${key}`);
    }
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function requireEqual(actual, expected, message) {
  require(JSON.stringify(actual) === JSON.stringify(expected), message);
}

function require(condition, message) {
  if (!condition) throw new Error(message);
}
