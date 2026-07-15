#!/usr/bin/env node

const args = parse(process.argv.slice(2));
const runId = required(args, "run-id");
const expectedWorkflow = required(args, "expected-workflow");
const expectedCommit = required(args, "expected-commit");
if (!/^[1-9][0-9]{0,19}$/u.test(runId)) throw new Error("workflow run ID is invalid");
if (!/^\.github\/workflows\/[a-z0-9][a-z0-9._-]{0,127}\.ya?ml$/u.test(expectedWorkflow)) throw new Error("expected workflow path is invalid");
if (!/^[0-9a-f]{40}$/u.test(expectedCommit)) throw new Error("expected workflow commit is invalid");
const repository = environment("GITHUB_REPOSITORY", 256);
if (!/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/u.test(repository)) throw new Error("GitHub repository identity is invalid");
const token = environment("GITHUB_TOKEN", 4096);
const apiBase = canonicalApiBase(environment("GITHUB_API_URL", 512));
const endpoint = new URL(`repos/${repository}/actions/runs/${runId}`, apiBase);
const response = await fetch(endpoint, {
  method: "GET",
  redirect: "error",
  headers: {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "user-agent": "aval-release-authority/1.0",
    "x-github-api-version": "2022-11-28"
  },
  signal: AbortSignal.timeout(20_000)
});
if (response.status !== 200) throw new Error(`GitHub workflow-run lookup failed closed with status ${String(response.status)}`);
const run = await boundedJson(response, 1024 * 1024);
if (run === null || typeof run !== "object" || Array.isArray(run)) throw new Error("GitHub workflow-run response is invalid");
if (String(run.id) !== runId) throw new Error("GitHub workflow-run ID mismatch");
if (run.path !== expectedWorkflow) throw new Error("GitHub workflow-run source path mismatch");
if (run.head_sha !== expectedCommit) throw new Error("GitHub workflow-run commit mismatch");
if (run.event !== "workflow_dispatch" || run.status !== "completed" || run.conclusion !== "success") throw new Error("GitHub workflow run is not a successful protected dispatch");
if (run.repository?.full_name !== repository || run.head_repository?.full_name !== repository) throw new Error("GitHub workflow run does not belong to the authorized repository");
process.stdout.write(`${JSON.stringify({ status: "passed", runId, workflow: expectedWorkflow, commit: expectedCommit })}\n`);

async function boundedJson(response, maximumBytes) {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^(?:0|[1-9][0-9]*)$/u.test(length) || Number(length) > maximumBytes)) throw new Error("GitHub workflow-run response is oversized");
  if (response.body === null) throw new Error("GitHub workflow-run response body is absent");
  const reader = response.body.getReader();
  const chunks = []; let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) { await reader.cancel(); throw new Error("GitHub workflow-run response is oversized"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch (error) { throw new Error("GitHub workflow-run response is not strict JSON", { cause: error }); }
}
function canonicalApiBase(value) {
  const url = new URL(value.endsWith("/") ? value : `${value}/`);
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "" || url.href !== value.replace(/\/?$/u, "/")) throw new Error("GitHub API base URL is invalid");
  return url;
}
function environment(name, maximum) { const value = process.env[name]; if (typeof value !== "string" || value.length < 1 || value.length > maximum || /[\u0000-\u001F\u007F]/u.test(value)) throw new Error(`${name} is missing or unsafe`); return value; }
function parse(values) { const result = {}; for (let index = 0; index < values.length; index += 2) { const key = values[index]; if (!key?.startsWith("--")) throw new Error(`invalid argument ${String(key)}`); result[key.slice(2)] = values[index + 1] ?? "true"; } return result; }
function required(values, key) { const value = values[key]; if (typeof value !== "string" || value.length < 1 || value.length > 1024 || /[\u0000-\u001F\u007F]/u.test(value)) throw new Error(`--${key} is required or unsafe`); return value; }
