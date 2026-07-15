#!/usr/bin/env node
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { discoverProvenanceFiles, verifyProvenanceFile } from "./verify-provenance.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
// Earlier compiler-side generators retain the exact native tool fingerprint or
// source runtime that created their reviewed bytes. M6 and M7 now compose only
// from checked motion samples, so both are safe in tool-free read-only mode.
const checkedGenerators = [
  "fixtures/conformance/m6/update-provenance.mjs",
  "fixtures/conformance/m7/update-provenance.mjs",
  ...(process.argv.includes("--tool-backed")
    ? ["fixtures/conformance/m8/update-provenance.mjs"]
    : [])
];

async function main() {
  const provenance = [];
  for (const path of await discoverProvenanceFiles()) provenance.push(await verifyProvenanceFile(path));
  for (const script of checkedGenerators) {
    const result = spawnSync(process.execPath, [script, "--check"], { cwd: root, encoding: "utf8", timeout: 120_000 });
    if (result.error !== undefined) throw result.error;
    if (result.status !== 0) throw new Error(`${script} --check failed:\n${result.stderr || result.stdout}`);
  }
  const avalPaths = [];
  await collectAval(join(root, "fixtures", "conformance"), avalPaths);
  const formatModule = await import(join(root, "packages/format/dist/index.js"));
  for (const path of avalPaths) {
    const bytes = new Uint8Array(await readFile(path));
    formatModule.validateCompleteAsset({ bytes });
  }
  const m8 = await verifyM8Semantics(formatModule);
  const starter = await verifyStarter();
  process.stdout.write(`${JSON.stringify({
    status: "passed",
    provenance,
    completeAssets: avalPaths.map((path) => relative(root, path)),
    m8,
    starter,
    generatorChecks: checkedGenerators
  }, null, 2)}\n`);
}

async function collectAval(directory, output) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== "malformed") await collectAval(path, output);
    else if (entry.isFile() && entry.name.endsWith(".avl")) output.push(path);
  }
}

async function verifyM8Semantics(formatModule) {
  const provenancePath = join(root, "fixtures/conformance/m8/provenance.json");
  const document = JSON.parse(await readFile(provenancePath, "utf8"));
  if (!Array.isArray(document.fixtures) || document.fixtures.length !== 2) {
    throw new Error("M8 provenance must describe exactly two conformance fixtures");
  }
  const expectedPaths = [
    "fixtures/conformance/m8/one-state-partial-loop.avl",
    "fixtures/conformance/m8/user-states-all-routes-alpha.avl"
  ];
  const actualPaths = document.fixtures.map(({ path }) => path).sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify([...expectedPaths].sort())) {
    throw new Error("M8 provenance fixture set drifted");
  }
  const results = [];
  for (const expected of document.fixtures) {
    const bytes = new Uint8Array(await readFile(resolve(root, expected.path)));
    const validated = formatModule.validateCompleteAsset({ bytes });
    const manifest = validated.frontIndex.manifest;
    const actual = {
      states: manifest.states.map(({ id }) => id),
      events: [...new Set(manifest.edges.flatMap(({ trigger }) =>
        trigger.type === "event" ? [trigger.name] : []
      ))],
      bindings: manifest.bindings,
      canvas: manifest.canvas,
      alphaProfiles: [...new Set(manifest.renditions.map(({ profile }) => profile))]
    };
    for (const key of Object.keys(actual)) {
      if (JSON.stringify(actual[key]) !== JSON.stringify(expected[key])) {
        throw new Error(`M8 ${expected.role} ${key} summary drifted`);
      }
    }
    results.push({ role: expected.role, path: expected.path });
  }
  return results;
}

async function verifyStarter() {
  const temporary = await mkdtemp(join(tmpdir(), "aval-starter-drift-"));
  try {
    const { runInitCommand } = await import(
      join(root, "packages/compiler/dist/commands/init.js")
    );
    const generated = await runInitCommand({
      command: "init",
      directory: "starter",
      json: false
    }, temporary);
    const committed = join(root, "fixtures/starter/m8-idle-hover");
    const [actualEntries, expectedEntries] = await Promise.all([
      collectTree(generated.directory),
      collectTree(committed)
    ]);
    if (JSON.stringify(actualEntries) !== JSON.stringify(expectedEntries)) {
      throw new Error("generated M8 starter tree drifted from the committed fixture");
    }
    for (const entry of expectedEntries) {
      if (entry.endsWith("/")) continue;
      const [actual, expected] = await Promise.all([
        readFile(join(generated.directory, entry)),
        readFile(join(committed, entry))
      ]);
      if (Buffer.compare(actual, expected) !== 0) {
        throw new Error(`generated M8 starter byte drift: ${entry}`);
      }
    }
    return { path: "fixtures/starter/m8-idle-hover", files: generated.files.length };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function collectTree(directory, prefix = "") {
  const result = [];
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const declared = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      result.push(`${declared}/`);
      result.push(...await collectTree(join(directory, entry.name), declared));
    } else if (entry.isFile()) {
      result.push(declared);
    } else {
      throw new Error(`fixture tree contains unsupported entry: ${declared}`);
    }
  }
  return result;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
