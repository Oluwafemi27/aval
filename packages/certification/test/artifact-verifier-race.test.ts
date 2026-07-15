import { createHash } from "node:crypto";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { readVerifiedArtifactReferences } from "../src/artifact-verifier.js";

describe("stable nofollow artifact reads", () => {
  it("rejects a same-size in-place mutation after the verified read", async () => {
    const root = await mkdtemp(join(tmpdir(), "aval-artifact-in-place-"));
    try {
      const path = join(root, "evidence.json");
      const original = Buffer.from("same");
      await writeFile(path, original);
      await expect(readVerifiedArtifactReferences(root, [reference(original)], {
        maximumBytes: 16,
        retainBytes: () => true,
        testHook: async (phase) => { if (phase === "after-read") await writeFile(path, "SIZE"); }
      })).rejects.toThrow(/changed while being verified/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects path substitution after the nofollow handle is open", async () => {
    const root = await mkdtemp(join(tmpdir(), "aval-artifact-substitute-"));
    try {
      const path = join(root, "evidence.json");
      const original = Buffer.from("same");
      await writeFile(path, original);
      await expect(readVerifiedArtifactReferences(root, [reference(original)], {
        maximumBytes: 16,
        retainBytes: () => true,
        testHook: async (phase) => {
          if (phase !== "after-open") return;
          await rename(path, join(root, "retired.json"));
          await writeFile(path, original);
        }
      })).rejects.toThrow(/changed while being verified/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function reference(bytes: Uint8Array) {
  return {
    id: "evidence",
    path: "evidence.json",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    byteLength: bytes.byteLength,
    mediaType: "application/json"
  };
}
