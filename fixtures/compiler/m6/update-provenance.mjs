import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const compilerRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(compilerRoot, "../../..");
const sourceRoot = resolve(compilerRoot, "source");
const outputPath = resolve(compilerRoot, "provenance.json");
const check = process.argv.includes("--check");

const projects = [
  "opaque-odd.json",
  "packed-loop.json",
  "packed-all-routes.json"
];
const sequences = ["opaque-frames", "packed-frames"];

const provenance = {
  provenanceVersion: "0.1",
  generatedAt: "2026-07-12",
  fixture: "m6-web-packed-alpha",
  license: await digest("source/ASSET-LICENSE.md"),
  generator: await digest("source/generate.mjs"),
  generatorModules: await Promise.all([
    "frame-fixtures.mjs",
    "png-fixture-helpers.mjs"
  ].map((name) => digest(`source/${name}`))),
  runtime: {
    node: process.version,
    zlib: process.versions.zlib,
    platform: process.platform,
    architecture: process.arch
  },
  projects: await Promise.all(projects.map((name) => digest(`source/${name}`))),
  sequences: await Promise.all(sequences.map(async (directory) => ({
    directory,
    width: 45,
    height: 27,
    frameCount: 30,
    frames: await Promise.all(Array.from({ length: 30 }, (_, index) =>
      digest(`source/${directory}/frame-${String(index).padStart(4, "0")}.png`)
    ))
  }))),
  tag: {
    encoding: "six-bit-gray-derived-distance-three",
    fullResolutionReadback: true,
    downscaledReadback: false,
    note: "The 15x9 rendition is a geometry and alpha-quality fixture, not an exact tag-readback oracle."
  }
};

assertNoAbsolutePaths(provenance);
const serialized = `${JSON.stringify(provenance, null, 2)}\n`;
if (check) {
  const current = await readFile(outputPath, "utf8");
  require(current === serialized, "compiler M6 provenance is stale");
} else {
  await writeFile(outputPath, serialized);
}

async function digest(relativePath) {
  const bytes = await readFile(resolve(compilerRoot, relativePath));
  return {
    path: `fixtures/compiler/m6/${relativePath}`,
    bytes: bytes.byteLength,
    sha256: sha256(bytes)
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

function require(condition, message) {
  if (!condition) throw new Error(message);
}
