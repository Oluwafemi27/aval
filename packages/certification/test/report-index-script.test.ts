import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { canonicalJsonBytes } from "../src/canonical-json.js";

const execFileAsync = promisify(execFile);

describe("certification report index generator", () => {
  it("renders absence explicitly as not-run and not measured", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aval-index-"));
    try {
      const json = join(directory, "index.json");
      const markdown = join(directory, "index.md");
      await execFileAsync(process.execPath, [
        "scripts/certification/render-report-index.mjs",
        "--reports", directory,
        "--output-json", json,
        "--output-markdown", markdown
      ], { cwd: process.cwd() });
      const jsonBytes = await readFile(json);
      expect(JSON.parse(jsonBytes.toString("utf8"))).toMatchObject({ releaseStatus: "not-run", profiles: [] });
      expect(Buffer.compare(jsonBytes, canonicalJsonBytes(JSON.parse(jsonBytes.toString("utf8"))))).toBe(0);
      expect(await readFile(markdown, "utf8")).toContain("not measured");
      await expect(execFileAsync(process.execPath, [
        "scripts/certification/validate-report-index.mjs", "--index", json
      ], { cwd: process.cwd() })).resolves.toMatchObject({ stdout: expect.stringContaining('"status":"passed"') });
      await expect(execFileAsync(process.execPath, [
        "scripts/certification/validate-report-index.mjs", "--index", json, "--require-passed", "true"
      ], { cwd: process.cwd() })).rejects.toThrow(/exact release gate/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
