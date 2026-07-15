import { lstat, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

export async function prepareImmutableReleaseSetOutput({ output, index }) {
  const finalOutput = resolve(output);
  const finalIndex = resolve(index);
  const targetRoot = dirname(finalOutput);
  if (basename(finalOutput) !== "packages" || dirname(finalIndex) !== targetRoot || basename(finalIndex) !== "package-index.json") throw new Error("release package output and index must use one canonical atomic release-set root");
  await requireAbsent(targetRoot, "release-set output root");
  await mkdir(dirname(targetRoot), { recursive: true });
  const temporaryRoot = await mkdtemp(join(dirname(targetRoot), ".aval-release-set-"));
  const stagedRoot = join(temporaryRoot, "release-set");
  const stagedOutput = join(stagedRoot, "packages");
  const stagedIndex = join(stagedRoot, "package-index.json");
  await mkdir(stagedOutput, { recursive: true });
  let published = false;
  return Object.freeze({
    finalOutput,
    finalIndex,
    targetRoot,
    stagedRoot,
    stagedOutput,
    stagedIndex,
    async publish() {
      if (published) throw new Error("release-set output was already published");
      await requireAbsent(targetRoot, "release-set output root");
      await rename(stagedRoot, targetRoot);
      published = true;
    },
    async dispose() { await rm(temporaryRoot, { recursive: true, force: true }); }
  });
}

async function requireAbsent(path, label) {
  try {
    await lstat(path);
    throw new Error(`${label} already exists and is immutable: ${path}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
