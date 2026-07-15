import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { prepareImmutableReleaseSetOutput } from "../../scripts/release/immutable-release-output.mjs";

describe("immutable release-set output", () => {
  it("publishes one staged packages/index root and refuses every rerun without changing bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "aval-immutable-release-"));
    const target = join(root, "artifacts", "1.0.0");
    try {
      const output = join(target, "packages");
      const index = join(target, "package-index.json");
      const prepared = await prepareImmutableReleaseSetOutput({ output, index });
      await writeFile(join(prepared.stagedOutput, "archive.tgz"), "immutable archive bytes");
      await writeFile(prepared.stagedIndex, "immutable index bytes");
      await prepared.publish();
      await prepared.dispose();
      const before = await Promise.all([readFile(join(output, "archive.tgz")), readFile(index)]);
      await expect(prepareImmutableReleaseSetOutput({ output, index })).rejects.toThrow(/already exists and is immutable/u);
      const after = await Promise.all([readFile(join(output, "archive.tgz")), readFile(index)]);
      expect(after).toEqual(before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects split or noncanonical output layouts before creating a staging root", async () => {
    const root = await mkdtemp(join(tmpdir(), "aval-immutable-layout-"));
    try {
      await mkdir(join(root, "one"), { recursive: true });
      await expect(prepareImmutableReleaseSetOutput({ output: join(root, "one", "archives"), index: join(root, "two", "index.json") })).rejects.toThrow(/canonical atomic/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
