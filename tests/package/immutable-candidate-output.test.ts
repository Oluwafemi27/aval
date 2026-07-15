import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { prepareImmutableCandidateOutput } from "../../scripts/release/immutable-candidate-output.mjs";

describe("immutable candidate output", () => {
  it("publishes only the closed candidate root and preserves it on rerun", async () => {
    const root = await mkdtemp(join(tmpdir(), "aval-candidate-output-"));
    const candidate = join(root, "1.0.0", "candidate");
    const legacyIndex = join(root, "1.0.0", "artifact-index.json");
    try {
      const prepared = await prepareImmutableCandidateOutput({ candidate, legacyIndex });
      await mkdir(prepared.stagedCandidate);
      await writeFile(join(prepared.stagedCandidate, "candidate-manifest.json"), "closed candidate bytes");
      await writeFile(prepared.temporaryIndex, "temporary-only index");
      await prepared.publish();
      await prepared.dispose();
      expect(await readFile(join(candidate, "candidate-manifest.json"), "utf8")).toBe("closed candidate bytes");
      await expect(readFile(legacyIndex)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(prepareImmutableCandidateOutput({ candidate, legacyIndex })).rejects.toThrow(/already exists and is immutable/u);
      expect(await readFile(join(candidate, "candidate-manifest.json"), "utf8")).toBe("closed candidate bytes");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses a preexisting loose index without changing it", async () => {
    const root = await mkdtemp(join(tmpdir(), "aval-candidate-index-"));
    const candidate = join(root, "1.0.0", "candidate");
    const legacyIndex = join(root, "1.0.0", "artifact-index.json");
    try {
      await mkdir(join(root, "1.0.0"), { recursive: true });
      await writeFile(legacyIndex, "preexisting index");
      await expect(prepareImmutableCandidateOutput({ candidate, legacyIndex })).rejects.toThrow(/legacy loose artifact index/u);
      expect(await readFile(legacyIndex, "utf8")).toBe("preexisting index");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
