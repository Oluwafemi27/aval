import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execute = promisify(execFile);

describe("self-contained candidate staging", () => {
  it("copies the production harness and its absolute-root assets into one candidate root", async () => {
    const temp = await mkdtemp(join(tmpdir(), "aval-candidate-stage-"));
    try {
      const source = join(temp, "dist");
      const output = join(temp, "candidate");
      await mkdir(join(source, "assets"), { recursive: true });
      await writeFile(join(source, "certification.html"), '<script src="/assets/harness.js"></script>\n');
      await writeFile(join(source, "assets/harness.js"), "export {};\n");
      await execute(process.execPath, [
        "scripts/release/stage-candidate.mjs",
        "--output", output,
        "--map", `${source}:`
      ], { cwd: process.cwd() });
      expect(await readFile(join(output, "certification.html"), "utf8")).toContain("/assets/harness.js");
      expect(await readFile(join(output, "assets/harness.js"), "utf8")).toBe("export {};\n");
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("rejects symlinks instead of letting staged bytes escape provenance", async () => {
    const temp = await mkdtemp(join(tmpdir(), "aval-candidate-link-"));
    try {
      const source = join(temp, "source");
      await mkdir(source);
      await writeFile(join(temp, "outside"), "secret");
      await symlink(join(temp, "outside"), join(source, "link"));
      await expect(execute(process.execPath, [
        "scripts/release/stage-candidate.mjs",
        "--output", join(temp, "candidate"),
        "--map", `${source}:files`
      ], { cwd: process.cwd() })).rejects.toThrow(/symlink/u);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("rejects non-canonical destination mappings while preserving the intentional root mapping", async () => {
    const temp = await mkdtemp(join(tmpdir(), "aval-candidate-path-"));
    try {
      const source = join(temp, "source");
      await mkdir(source);
      await writeFile(join(source, "file.js"), "export {};\n");
      await expect(execute(process.execPath, [
        "scripts/release/stage-candidate.mjs", "--output", join(temp, "bad"), "--map", `${source}:foo//bar`
      ], { cwd: process.cwd() })).rejects.toThrow(/unsafe candidate destination/u);
      await execute(process.execPath, [
        "scripts/release/stage-candidate.mjs", "--output", join(temp, "good"), "--map", `${source}:`
      ], { cwd: process.cwd() });
      expect(await readFile(join(temp, "good", "file.js"), "utf8")).toBe("export {};\n");
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
});
