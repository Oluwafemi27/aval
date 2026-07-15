#!/usr/bin/env node

import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { build } from "vite";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const KIB = 1_024;
const CAPS = Object.freeze({
  bootstrapGzipBytes: 75 * KIB,
  loadedRuntimeGraphGzipBytes: 250 * KIB,
  decoderWorkerGzipBytes: 20 * KIB
});
const alias = Object.freeze({
  "@pixel-point/aval-format": fileURLToPath(
    new URL("../../packages/format/src/index.ts", import.meta.url)
  ),
  "@pixel-point/aval-graph": fileURLToPath(
    new URL("../../packages/graph/src/index.ts", import.meta.url)
  ),
  "@pixel-point/aval-player-web": fileURLToPath(
    new URL("../../packages/player-web/src/index.ts", import.meta.url)
  )
});

const element = await bundle({
  entry: fileURLToPath(new URL("../../packages/element/src/auto.ts", import.meta.url)),
  entryFileName: "auto.js"
});
const worker = await bundle({
  entry: fileURLToPath(
    new URL("../../packages/player-web/src/decoder-worker/entry.ts", import.meta.url)
  ),
  entryFileName: "decoder-worker.js"
});

const bootstrap = requireSingleEntry(element, "element bootstrap");
const bootstrapChunks = collectStaticClosure(element, bootstrap.file);
const bootstrapFiles = new Set(bootstrapChunks.map(({ file }) => file));
const dynamicBoundaries = [...new Set(bootstrapChunks.flatMap(({ dynamicImports }) =>
  dynamicImports
))];
assert.equal(
  dynamicBoundaries.length,
  1,
  "the element bootstrap must expose exactly one lazy runtime boundary"
);
assert.ok(
  !bootstrapFiles.has(dynamicBoundaries[0]),
  "the lazy runtime boundary must not already be in the static bootstrap closure"
);
const runtimeClosure = collectStaticClosure(element, dynamicBoundaries[0]);
const reachableFiles = new Set([
  ...bootstrapFiles,
  ...runtimeClosure.map(({ file }) => file)
]);
assert.deepEqual(
  [...reachableFiles].sort(),
  element.map(({ file }) => file).sort(),
  "the bootstrap and sole lazy boundary must cover the complete loaded graph"
);
const runtimeChunks = element.filter(({ file }) => !bootstrapFiles.has(file));
assertNoDuplicatedModules(element);

const bootstrapGzipBytes = sum(bootstrapChunks.map(({ gzipBytes }) => gzipBytes));
const loadedRuntimeGraphGzipBytes = sum(element.map(({ gzipBytes }) => gzipBytes));
assert.ok(
  bootstrapGzipBytes < CAPS.bootstrapGzipBytes,
  `element bootstrap is ${String(bootstrapGzipBytes)} gzip bytes; cap is below ${String(CAPS.bootstrapGzipBytes)}`
);
assert.ok(
  loadedRuntimeGraphGzipBytes <= CAPS.loadedRuntimeGraphGzipBytes,
  `loaded runtime graph is ${String(loadedRuntimeGraphGzipBytes)} gzip bytes; cap is ${String(CAPS.loadedRuntimeGraphGzipBytes)}`
);

const workerEntry = requireSingleEntry(worker, "decoder worker");
assert.equal(worker.length, 1, "decoder worker must remain one self-contained chunk");
assert.deepEqual(workerEntry.imports, [], "decoder worker must not have external static chunks");
assert.deepEqual(workerEntry.dynamicImports, [], "decoder worker must not add lazy subgraphs");
assert.ok(
  workerEntry.gzipBytes <= CAPS.decoderWorkerGzipBytes,
  `decoder worker is ${String(workerEntry.gzipBytes)} gzip bytes; cap is ${String(CAPS.decoderWorkerGzipBytes)}`
);

process.stdout.write(`${JSON.stringify({
  status: "passed",
  tool: "vite",
  viteVersion: (await import("vite/package.json", { with: { type: "json" } })).default.version,
  caps: CAPS,
  element: {
    chunks: reportChunks(element, bootstrapFiles),
    bootstrapGzipBytes,
    lazyRuntimeGzipBytes: sum(runtimeChunks.map(({ gzipBytes }) => gzipBytes)),
    loadedRuntimeGraphGzipBytes
  },
  decoderWorker: {
    chunks: reportChunks(worker),
    gzipBytes: workerEntry.gzipBytes
  }
}, null, 2)}\n`);

async function bundle({ entry, entryFileName }) {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    root: ROOT,
    resolve: { alias },
    build: {
      write: false,
      target: "es2022",
      minify: "oxc",
      lib: { entry, formats: ["es"] },
      rollupOptions: {
        output: {
          entryFileNames: entryFileName,
          chunkFileNames: "[name].js"
        }
      }
    }
  });
  const outputs = Array.isArray(result)
    ? result.flatMap(({ output }) => output)
    : result.output;
  return outputs
    .filter((output) => output.type === "chunk")
    .map((chunk) => Object.freeze({
      file: chunk.fileName,
      entry: chunk.isEntry,
      imports: Object.freeze([...chunk.imports]),
      dynamicImports: Object.freeze([...chunk.dynamicImports]),
      rawBytes: Buffer.byteLength(chunk.code),
      gzipBytes: gzipSync(chunk.code, { level: 9 }).byteLength,
      modules: Object.freeze(Object.keys(chunk.modules).sort())
    }))
    .sort((left, right) => left.file.localeCompare(right.file));
}

function requireSingleEntry(chunks, label) {
  const entries = chunks.filter(({ entry }) => entry);
  assert.equal(entries.length, 1, `${label} must have exactly one entry chunk`);
  return entries[0];
}

function assertNoDuplicatedModules(chunks) {
  const owners = new Map();
  for (const chunk of chunks) {
    for (const module of chunk.modules) {
      const previous = owners.get(module);
      assert.equal(
        previous,
        undefined,
        `${module} is duplicated by ${previous ?? "an unknown chunk"} and ${chunk.file}`
      );
      owners.set(module, chunk.file);
    }
  }
}

function collectStaticClosure(chunks, entry) {
  const byFile = new Map(chunks.map((chunk) => [chunk.file, chunk]));
  const pending = [entry];
  const found = new Map();
  while (pending.length > 0) {
    const file = pending.pop();
    if (found.has(file)) continue;
    const chunk = byFile.get(file);
    assert.notEqual(chunk, undefined, `bundle references missing static chunk ${String(file)}`);
    found.set(file, chunk);
    pending.push(...chunk.imports);
  }
  return [...found.values()].sort((left, right) => left.file.localeCompare(right.file));
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function reportChunks(chunks, bootstrapFiles = new Set()) {
  return chunks.map(({ modules: _modules, ...chunk }) => ({
    ...chunk,
    phase: bootstrapFiles.has(chunk.file) ? "bootstrap" : "runtime"
  }));
}
