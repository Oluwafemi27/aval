import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import * as certification from "../../packages/certification/src/index.js";
import { loadCandidateFixtureAuthority } from "../../scripts/certification/candidate-fixtures.mjs";

const fixtureSource = resolve("fixtures/conformance/m8/user-states-all-routes-alpha.avl");

describe("candidate fixture authority stable reads", () => {
  it("rejects a symlink even when its target bytes match the manifest", async () => {
    const root = await temporaryRoot("symlink");
    try {
      const bytes = await readFile(fixtureSource);
      await symlink(fixtureSource, join(root, "fixtures", "motion.avl"));
      await expect(load(root, artifact(bytes))).rejects.toThrow(/symbolic links/u);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("rejects candidate-policy-oversize declarations before reading or allocating", async () => {
    const root = await temporaryRoot("oversize");
    try {
      const declared = { ...artifact(new Uint8Array(0)), byteLength: 1024 * 1024 * 1024 + 1 };
      await expect(load(root, declared)).rejects.toThrow(/exceeds policy limit/u);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("rejects a path substitution after the fixture handle is open", async () => {
    const root = await temporaryRoot("race");
    try {
      const bytes = await readFile(fixtureSource);
      const path = join(root, "fixtures", "motion.avl");
      await copyFile(fixtureSource, path);
      await expect(load(root, artifact(bytes), async (phase) => {
        if (phase !== "after-open") return;
        await rename(path, join(root, "fixtures", "retired.avl"));
        await writeFile(path, bytes);
      })).rejects.toThrow(/changed while being verified/u);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

async function temporaryRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `aval-candidate-fixture-${label}-`));
  await mkdir(join(root, "fixtures"));
  return root;
}

function artifact(bytes: Uint8Array) {
  return {
    id: "fixture-motion",
    path: "fixtures/motion.avl",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    byteLength: bytes.byteLength,
    mediaType: "application/octet-stream",
    role: "fixture"
  };
}

async function load(root: string, entry: ReturnType<typeof artifact>, verificationHook?: (phase: "after-open" | "after-read") => Promise<void>) {
  return loadCandidateFixtureAuthority(
    { artifacts: [entry] },
    join(root, "candidate-manifest.json"),
    certification,
    { maximumArtifactBytes: 1024 * 1024 * 1024, ...(verificationHook === undefined ? {} : { verificationHook }) }
  );
}
