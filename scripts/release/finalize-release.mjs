#!/usr/bin/env node
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

import { reconstructReportIndex } from "../certification/report-index-reconstruction.mjs";
import { verifyCandidateRoot } from "./candidate-root.mjs";

const args = parse(process.argv.slice(2));
const sourceCandidatePath = resolve(required(args, "candidate"));
const expectedCandidateDigest = required(args, "expected-candidate-digest");
const sourceReportsRoot = resolve(required(args, "reports-root"));
const sourceIndexPath = resolve(required(args, "report-index"));
const expectedReportIndexDigest = required(args, "expected-report-index-digest");
const output = resolve(required(args, "output"));
const createdAt = required(args, "created-at");
if (relative(sourceReportsRoot, sourceIndexPath).split(sep).join("/") !== "index.json") throw new Error("report index must be the reports-root index.json");
await requireAbsent(output);
await mkdir(dirname(output), { recursive: true });
const certification = await import(resolve("packages/certification/dist/index.js"));
const verifiedCandidate = await verifyCandidateRoot({ manifestPath: sourceCandidatePath, expectedDigest: expectedCandidateDigest, certification });
if (verifiedCandidate.candidate.commit !== required(args, "expected-commit")) throw new Error("candidate commit does not match protected finalization intent");
const sourceIndex = await reconstructReportIndex({
  indexPath: sourceIndexPath,
  candidatePath: sourceCandidatePath,
  certification,
  policy: verifiedCandidate.policy,
  referenceRoot: sourceReportsRoot
});
if (sha256(sourceIndex.indexBytes) !== expectedReportIndexDigest) throw new Error("source report index does not match the approved digest");
if (sourceIndex.index.releaseStatus !== "passed" || sourceIndex.index.runtimeScheduling !== "passed") throw new Error("source report index has not passed release certification");

const temporary = await mkdtemp(join(dirname(output), ".aval-finalize-"));
const stagedRoot = join(temporary, "release");
let sealed = false;
try {
  run(process.execPath, [
    "scripts/release/stage-candidate.mjs",
    "--output", stagedRoot,
    "--map", `${verifiedCandidate.root}:candidate`,
    "--map", `${sourceReportsRoot}:reports`
  ]);
  const stagedCandidatePath = join(stagedRoot, "candidate", "candidate-manifest.json");
  const stagedIndexPath = join(stagedRoot, "reports", "index.json");
  const releaseArgs = [
    "scripts/release/create-release-manifest.mjs",
    "--candidate", stagedCandidatePath,
    "--expected-candidate-digest", expectedCandidateDigest,
    "--reports", stagedIndexPath,
    "--expected-report-index-digest", expectedReportIndexDigest,
    "--reference-root", join(stagedRoot, "reports"),
    "--root", stagedRoot,
    "--output", join(stagedRoot, "release-manifest.json"),
    "--created-at", createdAt
  ];
  if (args["expected-release-digest"] !== undefined) releaseArgs.push("--expected-digest", args["expected-release-digest"]);
  const created = JSON.parse(run(process.execPath, releaseArgs, true));
  if (!/^[0-9a-f]{64}$/u.test(created.sha256)) throw new Error("release-manifest creator returned an invalid digest");
  run(process.execPath, [
    "scripts/release/verify-manifest.mjs",
    "--candidate", stagedCandidatePath,
    "--expected-candidate-digest", expectedCandidateDigest,
    "--release", join(stagedRoot, "release-manifest.json"),
    "--expected-release-digest", created.sha256
  ]);
  await sealTree(stagedRoot);
  sealed = true;
  await rename(stagedRoot, output);
  sealed = false;
  process.stdout.write(`${JSON.stringify({ status: "passed", output, candidateManifestDigest: expectedCandidateDigest, releaseManifestDigest: created.sha256, releaseSetDigest: created.releaseSetDigest })}\n`);
} finally {
  if (sealed) await makeWritable(stagedRoot).catch(() => undefined);
  await rm(temporary, { recursive: true, force: true });
}

function run(command, commandArgs, capture = false) {
  const result = spawnSync(command, commandArgs, { encoding: capture ? "utf8" : undefined, stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit", timeout: 5 * 60_000 });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(capture ? result.stderr || result.stdout || `${command} failed` : `${command} ${commandArgs.join(" ")} failed`);
  return capture ? result.stdout : "";
}

async function sealTree(path) {
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error(`cannot seal symbolic link: ${path}`);
  if (info.isDirectory()) {
    for (const name of await readdir(path)) await sealTree(join(path, name));
    await chmod(path, 0o555);
  } else if (info.isFile()) await chmod(path, 0o444);
  else throw new Error(`cannot seal special release entry: ${path}`);
}
async function makeWritable(path) {
  const info = await lstat(path);
  if (info.isDirectory()) {
    await chmod(path, 0o755);
    for (const name of await readdir(path)) await makeWritable(join(path, name));
  } else if (info.isFile()) await chmod(path, 0o644);
}
async function requireAbsent(path) { try { await lstat(path); throw new Error(`release output already exists: ${path}`); } catch (error) { if (error?.code !== "ENOENT") throw error; } }
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function parse(values) { const result = {}; for (let index = 0; index < values.length; index += 2) { const key = values[index]; if (!key?.startsWith("--")) throw new Error(`invalid argument ${String(key)}`); result[key.slice(2)] = values[index + 1] ?? "true"; } return result; }
function required(values, key) { const value = values[key]; if (typeof value !== "string" || value.length < 1) throw new Error(`--${key} is required`); return value; }
