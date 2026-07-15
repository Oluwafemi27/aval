import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { collectSelfContainedReportSet } from "../../scripts/release/release-report-set.mjs";

describe("self-contained release report root", () => {
  it("relocates every reference inside the release root and binds summaries transitively", async () => {
    const root = await mkdtemp(join(tmpdir(), "aval-release-root-"));
    try {
      const reports = join(root, "reports");
      const profile = join(reports, "profile-a");
      await mkdir(join(profile, "attachments"), { recursive: true });
      const attachmentBytes = Buffer.from("ledger\n");
      await writeFile(join(profile, "attachments", "ledger.jsonl"), attachmentBytes);
      const runtime = {
        reportKind: "runtime-scheduling",
        attachments: [{ id: "ledger", path: "attachments/ledger.jsonl", sha256: sha256(attachmentBytes), byteLength: attachmentBytes.byteLength, mediaType: "application/jsonl" }]
      };
      const runtimeBytes = Buffer.from(`${JSON.stringify(runtime)}\n`);
      await writeFile(join(profile, "runtime-scheduling.json"), runtimeBytes);
      await writeFile(join(profile, "runtime-scheduling.md"), "# Runtime\n");
      const index = { reports: [{ id: "runtime-a", path: "profile-a/runtime-scheduling.json", sha256: sha256(runtimeBytes), byteLength: runtimeBytes.byteLength, mediaType: "application/json" }], reviewRecord: null };
      const indexBytes = Buffer.from(`${JSON.stringify(index)}\n`);
      await writeFile(join(reports, "index.json"), indexBytes);
      await writeFile(join(reports, "index.md"), "# Index\n");
      const result = await collectSelfContainedReportSet({ index, indexBytes, indexPath: join(reports, "index.json"), referenceRoot: reports, releaseRoot: root });
      expect(result.reports[0]?.path).toBe("reports/profile-a/runtime-scheduling.json");
      expect(result.artifacts.map(({ path }) => path).sort()).toEqual([
        "reports/index.json",
        "reports/index.md",
        "reports/profile-a/runtime-scheduling.md"
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects unreferenced bytes and reference-root escapes", async () => {
    const root = await mkdtemp(join(tmpdir(), "aval-release-orphan-"));
    try {
      const reports = join(root, "reports");
      await mkdir(reports);
      const index = { reports: [], reviewRecord: null };
      const indexBytes = Buffer.from(`${JSON.stringify(index)}\n`);
      await writeFile(join(reports, "index.json"), indexBytes);
      await writeFile(join(reports, "orphan.bin"), "orphan\n");
      await expect(collectSelfContainedReportSet({ index, indexBytes, indexPath: join(reports, "index.json"), referenceRoot: reports, releaseRoot: root })).rejects.toThrow(/unreferenced/u);
      await expect(collectSelfContainedReportSet({ index, indexBytes, indexPath: join(reports, "index.json"), referenceRoot: root, releaseRoot: reports })).rejects.toThrow(/escapes/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function sha256(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
