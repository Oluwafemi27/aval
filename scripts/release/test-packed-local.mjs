#!/usr/bin/env node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const temporary = await mkdtemp(join(tmpdir(), "aval-packed-archive-proof-"));
const root = join(temporary, "release-set");
const packages = join(root, "packages");
const index = join(root, "package-index.json");
try {
  run(process.execPath, [
    "scripts/release/build-packages.mjs",
    "--out", packages,
    "--index", index,
    "--test-only-packed-proof"
  ], 30 * 60_000);
  run(process.execPath, [
    "scripts/release/inspect-packages.mjs",
    "--packages", packages,
    "--index", index,
    "--output", join(root, "package-inspection.json")
  ], 5 * 60_000);
  run(process.execPath, ["scripts/release/test-consumers.mjs", "--packages", packages], 10 * 60_000);
  run(process.execPath, ["scripts/release/test-packed-dev.mjs", "--packages", packages], 10 * 60_000);
  run(process.execPath, ["scripts/docs/test-examples.mjs", "--packages", packages], 10 * 60_000);
  process.stdout.write(`${JSON.stringify({ status: "passed", proofKind: "test-only-local-exact-archive-consumers-and-browser", externalPublication: false })}\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

function run(command, args, timeout) { const result = spawnSync(command, args, { cwd: resolve("."), stdio: "inherit", timeout }); if (result.error !== undefined) throw result.error; if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed`); }
