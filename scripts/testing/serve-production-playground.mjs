#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildFreshPublicDistributions } from "../release/fresh-public-build.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const port = requirePlaywrightPort(process.env.AVL_PLAYWRIGHT_PORT ?? "4173");

await buildFreshPublicDistributions(root);
runBuild();

const preview = spawn(npm, [
  "run", "preview:production", "-w", "@pixel-point/aval-playground", "--",
  "--port", port, "--strictPort"
], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "production" }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => preview.kill(signal));
}

await new Promise((resolveExit, reject) => {
  preview.once("error", reject);
  preview.once("exit", (code, signal) => {
    process.exitCode = signal === null ? code ?? 1 : 1;
    resolveExit();
  });
});

function runBuild() {
  const result = spawnSync(npm, [
    "run", "build:production", "-w", "@pixel-point/aval-playground"
  ], { cwd: root, stdio: "inherit", env: { ...process.env, NODE_ENV: "production" } });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error("production playground build failed");
}

function requirePlaywrightPort(value) {
  if (!/^(?:[1-9][0-9]{0,4})$/u.test(value)) throw new Error("AVL_PLAYWRIGHT_PORT is invalid");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > 65_534) throw new Error("AVL_PLAYWRIGHT_PORT cannot reserve its cross-origin pair");
  return String(parsed);
}
