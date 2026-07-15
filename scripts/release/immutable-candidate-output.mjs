import { lstat, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

export async function prepareImmutableCandidateOutput({ candidate, legacyIndex }) {
  const finalCandidate = resolve(candidate);
  const finalLegacyIndex = resolve(legacyIndex);
  if (basename(finalCandidate) !== "candidate" || dirname(finalLegacyIndex) !== dirname(finalCandidate) || basename(finalLegacyIndex) !== "artifact-index.json") throw new Error("candidate and legacy index paths are not canonical");
  await requireAbsent(finalCandidate, "candidate output");
  await requireAbsent(finalLegacyIndex, "legacy loose artifact index");
  await mkdir(dirname(finalCandidate), { recursive: true });
  const temporaryRoot = await mkdtemp(join(dirname(finalCandidate), ".aval-candidate-"));
  const stagedCandidate = join(temporaryRoot, "candidate");
  const temporaryIndex = join(temporaryRoot, "artifact-index.json");
  let published = false;
  return Object.freeze({
    finalCandidate,
    finalLegacyIndex,
    temporaryRoot,
    stagedCandidate,
    temporaryIndex,
    async publish() {
      if (published) throw new Error("candidate output was already published");
      await requireAbsent(finalCandidate, "candidate output");
      await requireAbsent(finalLegacyIndex, "legacy loose artifact index");
      await rename(stagedCandidate, finalCandidate);
      published = true;
    },
    async dispose() { await rm(temporaryRoot, { recursive: true, force: true }); }
  });
}

async function requireAbsent(path, label) {
  try { await lstat(path); throw new Error(`${label} already exists and is immutable: ${path}`); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
}
