import { createHash } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  deriveAvcRenditionGeometry,
  inspectAvcAnnexBRendition,
  parseFrontIndex,
  serializeCanonicalJson,
  validateCompleteAsset,
  writeCanonicalAsset
} from "../../../packages/format/dist/index.js";

const outputRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(outputRoot, "../../..");
const compilerProvenancePath = resolve(
  repositoryRoot,
  "fixtures/compiler/m6/provenance.json"
);
const recipePath = resolve(outputRoot, "reviewed-motion/recipe.json");
const outputPath = resolve(outputRoot, "provenance.json");
const check = process.argv.includes("--check");
const assetNames = [
  "opaque-odd.avl",
  "packed-alpha-loop.avl",
  "packed-alpha-all-routes.avl"
];
const projectByAsset = Object.freeze({
  "opaque-odd.avl": "fixtures/compiler/m6/source/opaque-odd.json",
  "packed-alpha-loop.avl": "fixtures/compiler/m6/source/packed-loop.json",
  "packed-alpha-all-routes.avl":
    "fixtures/compiler/m6/source/packed-all-routes.json"
});

const [compilerProvenanceBytes, recipeBytes] = await Promise.all([
  readFile(compilerProvenancePath),
  readFile(recipePath)
]);
const recipe = JSON.parse(recipeBytes.toString("utf8"));
require(recipe.recipeVersion === "0.1", "reviewed-motion recipe version drifted");
assertNoRemovedPosterKeys(recipe);
assertNoAbsolutePaths(recipe, "recipe");
const payloadPath = resolve(repositoryRoot, recipe.payload.path);
const payloadBytes = new Uint8Array(await readFile(payloadPath));
requireDigest(payloadBytes, recipe.payload, "reviewed AVC payload");
const reviewedBlobs = validateReviewedBlobs(recipe.blobs, payloadBytes);

requireEqual(
  recipe.assets.map(({ name }) => name),
  assetNames,
  "reviewed-motion asset order drifted"
);
const assembled = [];
for (const source of recipe.assets) {
  assembled.push(await assembleAsset(source, reviewedBlobs, payloadBytes));
}

const provenance = {
  provenanceVersion: "0.1",
  generatedAt: "2026-07-14",
  generator: "aval-format-writer/0.1",
  regeneration: {
    build: "npm run build -w @pixel-point/aval-format",
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
  reviewedEncodedSource: {
    recipe: {
      path: "fixtures/conformance/m6/reviewed-motion/recipe.json",
      bytes: recipeBytes.byteLength,
      sha256: sha256(recipeBytes)
    },
    payload: recipe.payload,
    claim: "The recorded AVC unit blobs are preserved byte-for-byte; the current writer deterministically assembles poster-free AVAL containers without re-encoding."
  },
  toolchain: recipe.toolchain,
  coverage: [
    "odd-visible-and-coded-crop-geometry",
    "opaque-and-stacked-alpha-renditions",
    "two-ranked-packed-alpha-renditions",
    "alpha-auto-and-explicit-policy",
    "hostile-hidden-rgb-and-edge-dilation",
    "alpha-and-three-background-composite-quality",
    "all-route-classes-and-readiness",
    "motion-only-canonical-payload-layout",
    "tool-free-reviewed-sample-container-reassembly"
  ],
  assets: assembled.map(({ bytes: _bytes, ...entry }) => entry)
};
assertNoRemovedPosterKeys(provenance);
assertNoAbsolutePaths(provenance);
const serialized = `${JSON.stringify(provenance, null, 2)}\n`;

if (check) {
  const [recorded, ...assets] = await Promise.all([
    readFile(outputPath, "utf8"),
    ...assetNames.map((name) => readFile(resolve(outputRoot, name)))
  ]);
  require(recorded === serialized, "complete M6 conformance provenance is stale");
  for (let index = 0; index < assetNames.length; index += 1) {
    require(
      Buffer.compare(assets[index], assembled[index].bytes) === 0,
      `${assetNames[index]} is stale`
    );
  }
} else {
  await Promise.all(assembled.map(({ name, bytes }) =>
    writeFile(resolve(outputRoot, name), bytes)
  ));
  await writeFile(outputPath, serialized);
  await Promise.all(assetNames.map((name) =>
    chmod(resolve(outputRoot, name), 0o644)
  ));
}

async function assembleAsset(source, blobs, payload) {
  require(assetNames.includes(source.name), `unexpected reviewed asset ${source.name}`);
  const accessUnits = [];
  let encodedPayloadBytes = 0;
  for (const rendition of source.manifest.renditions) {
    for (const unit of source.manifest.units) {
      const sample = unit.samples.find(({ rendition: id }) => id === rendition.id);
      require(sample !== undefined, `${source.name} is missing ${rendition.id}/${unit.id}`);
      const blob = blobs.get(sample.sha256);
      require(blob !== undefined, `${source.name} references an unknown reviewed blob`);
      require(
        blob.samples.length === unit.frameCount,
        `${source.name} ${rendition.id}/${unit.id} frame count drifted`
      );
      let cursor = blob.offset;
      for (let frameIndex = 0; frameIndex < blob.samples.length; frameIndex += 1) {
        const frame = blob.samples[frameIndex];
        accessUnits.push({
          rendition: rendition.id,
          unit: unit.id,
          frameIndex,
          key: frame.key,
          bytes: payload.slice(cursor, cursor + frame.length)
        });
        cursor += frame.length;
      }
      require(cursor === blob.offset + blob.length, "reviewed blob sample layout drifted");
      encodedPayloadBytes += blob.length;
    }
  }
  require(
    encodedPayloadBytes === source.encodedPayloadBytes,
    `${source.name} encoded payload accounting drifted`
  );
  const manifest = {
    ...source.manifest,
    units: source.manifest.units.map((unit) => ({
      ...unit,
      samples: unit.samples.map(({ rendition, sha256: digest }) => ({
        rendition,
        sha256: digest
      }))
    }))
  };
  const bytes = writeCanonicalAsset({ manifest, accessUnits });
  const { frontIndex } = validateCompleteAsset({ bytes });
  requireEqual(frontIndex, parseFrontIndex(bytes), `${source.name} front index drifted`);
  require(
    frontIndex.unitBlobs.at(-1).offset + frontIndex.unitBlobs.at(-1).length ===
      bytes.byteLength,
    `${source.name} does not end at its final motion sample`
  );

  const projectRelative = projectByAsset[source.name];
  require(projectRelative !== undefined, `${source.name} has no source project mapping`);
  const projectBytes = await readFile(resolve(repositoryRoot, projectRelative));
  const units = frontIndex.unitBlobs.map((blob) => {
    require(
      sha256(bytes.subarray(blob.offset, blob.offset + blob.length)) === blob.sha256,
      `${source.name} unit ${blob.rendition}/${blob.unit} digest mismatch`
    );
    return { ...blob };
  });
  return {
    name: source.name,
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
    strictInspections: inspectEveryRendition(bytes, frontIndex),
    alphaPolicy: source.alphaPolicy,
    sources: source.sources,
    renditions: source.renditions,
    continuity: source.continuity,
    encodedPayloadBytes: source.encodedPayloadBytes,
    bytes
  };
}

function validateReviewedBlobs(entries, payload) {
  require(Array.isArray(entries) && entries.length > 0, "reviewed blob set is empty");
  const blobs = new Map();
  let cursor = 0;
  for (const entry of entries) {
    require(entry.offset === cursor, "reviewed blob pack is not contiguous");
    require(
      Number.isSafeInteger(entry.length) && entry.length > 0,
      "reviewed blob length is invalid"
    );
    require(Array.isArray(entry.samples) && entry.samples.length > 0, "reviewed sample set is empty");
    let sampleBytes = 0;
    for (const sample of entry.samples) {
      require(
        Number.isSafeInteger(sample.length) && sample.length > 0 &&
          typeof sample.key === "boolean",
        "reviewed sample metadata is invalid"
      );
      sampleBytes += sample.length;
    }
    require(sampleBytes === entry.length, "reviewed sample lengths do not fill their blob");
    const bytes = payload.subarray(entry.offset, entry.offset + entry.length);
    require(bytes.byteLength === entry.length, "reviewed blob range is truncated");
    require(sha256(bytes) === entry.sha256, "reviewed blob digest mismatch");
    require(!blobs.has(entry.sha256), "reviewed blob digest is duplicated");
    blobs.set(entry.sha256, entry);
    cursor += entry.length;
  }
  require(cursor === payload.byteLength, "reviewed blobs do not end at payload EOF");
  return blobs;
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
        requireBt709LimitedRange: true,
        quantizationPolicy: "fixed-qp26-v0"
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

function requireDigest(bytes, descriptor, label) {
  require(
    bytes.byteLength === descriptor.bytes && sha256(bytes) === descriptor.sha256,
    `${label} digest drifted`
  );
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function require(value, message) {
  if (!value) throw new Error(message);
}

function requireEqual(actual, expected, message) {
  require(JSON.stringify(actual) === JSON.stringify(expected), message);
}

function assertNoRemovedPosterKeys(value, path = "value") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoRemovedPosterKeys(entry, `${path}[${String(index)}]`)
    );
    return;
  }
  if (value === null || typeof value !== "object") return;
  const removed = new Set([
    "poster",
    "fallback",
    "staticFrame",
    "staticFrames",
    "staticPayloads",
    "staticPayloadBytes",
    "staticBlobs",
    "statics"
  ]);
  for (const [key, entry] of Object.entries(value)) {
    require(!removed.has(key), `${path}.${key} is removed poster metadata`);
    assertNoRemovedPosterKeys(entry, `${path}.${key}`);
  }
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
  if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      assertNoAbsolutePaths(entry, `${path}.${key}`);
    }
  }
}
