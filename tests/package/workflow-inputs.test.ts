import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("protected workflow input authority", () => {
  it("accepts an exact default-branch ancestor and rejects shell/control substitutions", async () => {
    const root = await mkdtemp(join(tmpdir(), "aval-workflow-input-"));
    try {
      await git(root, "init", "-q", "-b", "main");
      await git(root, "config", "user.email", "workflow@example.invalid");
      await git(root, "config", "user.name", "Workflow Test");
      await writeFile(join(root, "one"), "one");
      await git(root, "add", ".");
      await git(root, "commit", "-qm", "one");
      const first = (await git(root, "rev-parse", "HEAD")).trim();
      await writeFile(join(root, "two"), "two");
      await git(root, "add", ".");
      await git(root, "commit", "-qm", "two");
      const head = (await git(root, "rev-parse", "HEAD")).trim();
      const env = { ...process.env, INPUT_COMMIT: first, GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF_NAME: "main", GITHUB_DEFAULT_BRANCH: "main", GITHUB_SHA: head };
      await expect(execFileAsync(process.execPath, [resolve("scripts/release/validate-workflow-inputs.mjs"), "authorize"], { cwd: root, env })).resolves.toMatchObject({ stdout: expect.stringContaining('"status":"passed"') });
      await expect(execFileAsync(process.execPath, [resolve("scripts/release/validate-workflow-inputs.mjs"), "authorize"], { cwd: root, env: { ...env, INPUT_COMMIT: `${first}\nmalicious` } })).rejects.toThrow();
      await expect(execFileAsync(process.execPath, [resolve("scripts/release/validate-workflow-inputs.mjs"), "authorize"], { cwd: root, env: { ...env, GITHUB_REF_NAME: "feature" } })).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function git(cwd: string, ...args: string[]): Promise<string> { return (await execFileAsync("git", args, { cwd })).stdout; }
