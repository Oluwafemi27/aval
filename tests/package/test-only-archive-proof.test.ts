import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { assertTestOnlyArchiveOutput, testOnlyPublicationMetadata } from "../../scripts/release/test-only-archive-proof.mjs";

describe("test-only packed archive proof quarantine", () => {
  it("permits only marked OS-temporary outputs and labels synthetic authority", async () => {
    const root = await mkdtemp(join(tmpdir(), "aval-packed-archive-proof-test-"));
    try {
      await expect(assertTestOnlyArchiveOutput(join(root, "release-set", "packages"), process.cwd())).resolves.toContain(root);
      expect(testOnlyPublicationMetadata()).toMatchObject({ status: "approved", note: expect.stringContaining("Forbidden from candidate") });
      await expect(assertTestOnlyArchiveOutput(join(process.cwd(), "artifacts", "test"), process.cwd())).rejects.toThrow(/marked OS-temporary|outside the repository/u);
      await expect(assertTestOnlyArchiveOutput(join(root, "candidate", "packages"), process.cwd())).rejects.toThrow(/release-authority path/u);
      const symlinkMarker = join(tmpdir(), `aval-packed-archive-proof-link-${String(process.pid)}`);
      await symlink(process.cwd(), symlinkMarker);
      try { await expect(assertTestOnlyArchiveOutput(join(symlinkMarker, "release-set", "packages"), process.cwd())).rejects.toThrow(/real private directory/u); }
      finally { await rm(symlinkMarker, { force: true }); }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
