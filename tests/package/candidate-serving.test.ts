import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CandidateAssetNotFoundError,
  createCandidateAssetStore,
  readCandidateAsset
} from "../../scripts/certification/serve-candidate.mjs";

describe("candidate server byte authority", () => {
  it("serves only manifest-allowlisted paths and the exact manifest bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "aval-serve-candidate-"));
    try {
      const harness = Buffer.from("<!doctype html><title>certification</title>\n");
      const manifest = Buffer.from("{}\n");
      await writeFile(join(root, "certification.html"), harness);
      await writeFile(join(root, "unmanifested.txt"), "must not escape\n");
      const store = createCandidateAssetStore({
        root,
        manifestBytes: manifest,
        manifestDigest: sha256(manifest),
        artifacts: [{ path: "certification.html", sha256: sha256(harness), byteLength: harness.byteLength, mediaType: "text/html" }]
      });
      await expect(readCandidateAsset(store, "/")).resolves.toMatchObject({ bytes: harness, sha256: sha256(harness) });
      await expect(readCandidateAsset(store, "/candidate-manifest.json")).resolves.toMatchObject({ bytes: manifest, sha256: sha256(manifest) });
      await expect(readCandidateAsset(store, "/unmanifested.txt")).rejects.toBeInstanceOf(CandidateAssetNotFoundError);
      await expect(readCandidateAsset(store, "/../unmanifested.txt")).rejects.toBeInstanceOf(CandidateAssetNotFoundError);
      await expect(readCandidateAsset(store, "/certification.html?ignored=1")).rejects.toBeInstanceOf(CandidateAssetNotFoundError);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed when an allowlisted file changes after startup", async () => {
    const root = await mkdtemp(join(tmpdir(), "aval-serve-mutated-"));
    try {
      const before = Buffer.from("before\n");
      const manifest = Buffer.from("{}\n");
      await writeFile(join(root, "certification.html"), before);
      const store = createCandidateAssetStore({
        root,
        manifestBytes: manifest,
        manifestDigest: sha256(manifest),
        artifacts: [{ path: "certification.html", sha256: sha256(before), byteLength: before.byteLength, mediaType: "text/html" }]
      });
      await writeFile(join(root, "certification.html"), "after!\n");
      await expect(readCandidateAsset(store, "/")).rejects.toThrow(/changed after verification/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a producer-declared manifest digest that does not match its bytes", () => {
    expect(() => createCandidateAssetStore({ root: ".", manifestBytes: Buffer.from("{}\n"), manifestDigest: "0".repeat(64), artifacts: [{ path: "x", sha256: "1".repeat(64), byteLength: 1 }] })).toThrow(/manifest bytes/u);
  });
});

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
