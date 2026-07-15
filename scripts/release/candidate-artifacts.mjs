import { constants as fsConstants } from "node:fs";
import { createHash } from "node:crypto";
import { open, realpath } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

const ROLE_RULES = Object.freeze([
  [/^packages\/[^/]+\.tgz$/u, "package"],
  [/^package-index\.json$/u, "package-index"],
  [/^package-inspection\.json$/u, "package-inspection"],
  [/^candidate-layout\.json$/u, "candidate-layout"],
  [/^sbom\/.+\.spdx\.json$/u, "sbom"],
  [/^etc\/api\/.+\.api\.md$/u, "api-report"],
  [/^schemas\/.+\.json$/u, "schema"],
  [/^fixtures\//u, "fixture"],
  [/^docs\//u, "documentation"],
  [/^examples\//u, "example"],
  [/^config\/release\/legal-review\.json$/u, "legal-review"],
  [/^config\/release\/.+\.json$/u, "release-policy"],
  [/^license-report\.json$/u, "license-report"],
]);
const PROJECT_METADATA = new Set(["README.md", "LICENSE", "SECURITY.md", "THREAT-MODEL.md", "THIRD_PARTY_NOTICES.md", "package-lock.json"]);

export function candidateRoleForPath(path) {
  if (PROJECT_METADATA.has(path)) return "project-metadata";
  if (path === "certification.html" || path.startsWith("assets/") || /\.(?:html|js|css|wasm)$/u.test(path)) return "browser-harness";
  for (const [pattern, role] of ROLE_RULES) if (pattern.test(path)) return role;
  throw new Error(`candidate artifact has no closed role: ${path}`);
}

export function candidateArtifactId(path) {
  const slug = path.replace(/[^a-zA-Z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "").toLowerCase();
  const suffix = createHash("sha256").update(path).digest("hex").slice(0, 12);
  return `${slug.slice(0, 114)}-${suffix}`;
}

export async function readVerifiedRegularFile(path, root, maximumBytes = 1024 * 1024 * 1024) {
  const absoluteRoot = await realpath(resolve(root));
  const absolute = resolve(absoluteRoot, path);
  const within = relative(absoluteRoot, absolute);
  if (within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new Error(`artifact escapes root: ${path}`);
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  const handle = await open(absolute, fsConstants.O_RDONLY | noFollow);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size < 0 || before.size > maximumBytes) throw new Error(`artifact is not a bounded regular file: ${path}`);
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || bytes.byteLength !== before.size) throw new Error(`artifact changed while being read: ${path}`);
    return bytes;
  } finally {
    await handle.close();
  }
}

export async function verifyArtifactIndex(index, root, options = {}) {
  if (index === null || typeof index !== "object" || Array.isArray(index) || index.schemaVersion !== "1.0" || !Array.isArray(index.artifacts)) throw new TypeError("artifact index is invalid");
  if (index.artifacts.length < 1 || index.artifacts.length > 4096) throw new RangeError("artifact index count is outside policy bounds");
  const paths = new Set();
  const ids = new Set();
  const bytesByPath = new Map();
  for (const artifact of index.artifacts) {
    if (artifact === null || typeof artifact !== "object" || Array.isArray(artifact)) throw new TypeError("artifact index entry is invalid");
    const allowed = new Set(["id", "role", "path", "sha256", "byteLength", "mediaType"]);
    if (Object.keys(artifact).some((key) => !allowed.has(key)) || [...allowed].some((key) => !(key in artifact))) throw new TypeError("artifact index entry fields are invalid");
    requireSafePath(artifact.path);
    if (paths.has(artifact.path) || ids.has(artifact.id)) throw new Error(`duplicate artifact identity: ${artifact.path}`);
    paths.add(artifact.path);
    ids.add(artifact.id);
    if (artifact.id !== candidateArtifactId(artifact.path)) throw new Error(`artifact ID is not derived from its exact path: ${artifact.path}`);
    if (options.requireCandidateRoles === true && artifact.role !== candidateRoleForPath(artifact.path)) throw new Error(`artifact role does not match path: ${artifact.path}`);
    if (artifact.mediaType !== mediaType(artifact.path)) throw new Error(`artifact media type does not match path: ${artifact.path}`);
    const bytes = await readVerifiedRegularFile(artifact.path, root, options.maximumBytes);
    if (bytes.byteLength !== artifact.byteLength || createHash("sha256").update(bytes).digest("hex") !== artifact.sha256) throw new Error(`artifact index identity mismatch: ${artifact.path}`);
    bytesByPath.set(artifact.path, bytes);
  }
  return Object.freeze({ artifacts: Object.freeze([...index.artifacts]), bytesByPath });
}

export function mediaType(path) {
  if (path.endsWith(".d.ts")) return "text/plain";
  const extension = extname(path);
  return ({
    ".css": "text/css",
    ".html": "text/html",
    ".js": "text/javascript",
    ".json": "application/json",
    ".jsonl": "application/jsonl",
    ".md": "text/markdown",
    ".avl": "application/octet-stream",
    ".tgz": "application/gzip",
    ".txt": "text/plain",
    ".wasm": "application/wasm"
  })[extension] ?? "application/octet-stream";
}

function requireSafePath(path) {
  if (typeof path !== "string" || path.length < 1 || path.length > 1024 || isAbsolute(path) || path.includes("\\") || path.includes("?") || path.split("/").some((part) => part === "" || part === "." || part === "..") || path.endsWith("/candidate-manifest.json") || path === "candidate-manifest.json" || path.endsWith("/release-manifest.json") || path === "release-manifest.json") {
    throw new Error(`unsafe or recursive artifact path: ${String(path)}`);
  }
}
