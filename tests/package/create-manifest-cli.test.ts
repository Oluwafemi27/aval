import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("candidate manifest CLI", () => {
  it("runs end to end against one isolated clean synthetic repository authority", async () => {
    const repository = await mkdtemp(join(tmpdir(), "aval-candidate-cli-"));
    try {
      const candidate = join(repository, "candidate");
      await mkdir(candidate);
      const index = join(repository, "artifact-index.json");
      await writeFile(index, `${JSON.stringify({ schemaVersion: "1.0", artifacts: [{ id: "synthetic-artifact", role: "project-metadata", path: "README.md", sha256: "a".repeat(64), byteLength: 1, mediaType: "text/markdown" }] })}\n`);
      await writeFile(join(repository, "README.md"), "x");
      await git(repository, "init", "-q");
      await git(repository, "config", "user.email", "synthetic@example.invalid");
      await git(repository, "config", "user.name", "Synthetic Candidate Test");
      await git(repository, "add", ".");
      await git(repository, "commit", "-qm", "synthetic candidate authority");
      const commit = (await git(repository, "rev-parse", "HEAD")).trim();
      const tree = (await git(repository, "rev-parse", "HEAD^{tree}")).trim();

      const mockCandidate = join(repository, "mock-candidate.mjs");
      const mockCertification = join(repository, "mock-certification.mjs");
      const childWrapper = join(repository, "child-wrapper.mjs");
      const loader = join(repository, "loader.mjs");
      await writeFile(mockCandidate, `import { readFileSync } from "node:fs";\nexport async function verifyCandidateArtifactSet(){return {layout:{commit:process.env.SYNTHETIC_COMMIT,tree:process.env.SYNTHETIC_TREE},policy:JSON.parse(readFileSync(process.env.SYNTHETIC_POLICY,"utf8")),releaseSet:{releaseSetDigest:"${"d".repeat(64)}"}};}\n`);
      await writeFile(mockCertification, "export function validateCandidateToolchain(){}\nexport function validateCandidateManifest(value){return value;}\nexport function canonicalJsonBytes(value){return Buffer.from(JSON.stringify(value)+\"\\n\");}\n");
      await writeFile(childWrapper, `import { spawnSync as actual } from "node:child_process";\nexport function spawnSync(command,args,options){if(command===process.execPath&&String(args?.[2]??"").endsWith("@microsoft/api-extractor/package.json"))return {status:0,stdout:'{"version":"7.58.9"}',stderr:""};return actual(command,args,options);}\n`);
      await writeFile(loader, `export async function resolve(specifier,context,next){if(specifier==="node:child_process"&&!context.parentURL?.endsWith("child-wrapper.mjs"))return {url:${JSON.stringify(new URL(`file://${childWrapper}`).href)},shortCircuit:true};const value=await next(specifier,context);if(value.url.endsWith("/candidate-root.mjs"))return {url:${JSON.stringify(new URL(`file://${mockCandidate}`).href)},shortCircuit:true};if(value.url.endsWith("/packages/certification/dist/index.js"))return {url:${JSON.stringify(new URL(`file://${mockCertification}`).href)},shortCircuit:true};return value;}\n`);
      await git(repository, "add", ".");
      await git(repository, "commit", "-qm", "synthetic loader authority");
      const finalCommit = (await git(repository, "rev-parse", "HEAD")).trim();
      const finalTree = (await git(repository, "rev-parse", "HEAD^{tree}")).trim();
      const output = join(candidate, "candidate-manifest.json");
      const { stdout } = await execFileAsync(process.execPath, [
        "--experimental-loader", loader,
        resolve("scripts/release/create-manifest.mjs"),
        "--repository-root", repository,
        "--artifacts", index,
        "--root", candidate,
        "--output", output,
        "--created-at", "2026-07-12T13:00:00.000Z"
      ], {
        cwd: process.cwd(),
        env: { ...process.env, SYNTHETIC_COMMIT: finalCommit, SYNTHETIC_TREE: finalTree, SYNTHETIC_POLICY: resolve("config/release/release-policy.json") },
        maxBuffer: 1024 * 1024
      });
      const result = JSON.parse(stdout);
      const manifest = JSON.parse(await readFile(output, "utf8"));
      expect(result).toMatchObject({ sha256: expect.stringMatching(/^[0-9a-f]{64}$/u), releaseSetDigest: "d".repeat(64) });
      expect(manifest).toMatchObject({ manifestKind: "candidate", commit: finalCommit, tree: finalTree, releaseSetDigest: "d".repeat(64) });
      expect(commit).not.toBe(finalCommit);
      expect(tree).not.toBe(finalTree);
    } finally {
      await rm(repository, { recursive: true, force: true });
    }
  }, 30_000);
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 1024 * 1024 });
  return stdout;
}
