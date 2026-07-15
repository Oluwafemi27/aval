import { RELEASE_PACKAGE_SPECS, RELEASE_VERSION } from "./release-set-model.mjs";
import { applyApprovedPublicationMetadata } from "./publication-metadata.mjs";

const ALLOWED_KEYS = new Set(["name", "version", "description", "keywords", "private", "type", "sideEffects", "exports", "files", "license", "engines", "repository", "homepage", "bugs", "bin", "types", "dependencies"]);
const REQUIRED_KEYS = ["name", "version", "private", "type", "sideEffects", "exports", "files", "license", "engines", "repository", "homepage", "bugs", "dependencies"];

export function createPublishManifest(source, publicationMetadata) {
  if (source === null || typeof source !== "object" || Array.isArray(source)) throw new TypeError("source package manifest is invalid");
  const effective = publicationMetadata === undefined ? source : applyApprovedPublicationMetadata(source, publicationMetadata);
  const manifest = Object.fromEntries(Object.entries(effective).filter(([key]) => ALLOWED_KEYS.has(key)));
  validatePublishManifest(manifest);
  return manifest;
}

export function validatePublishManifest(manifest) {
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) throw new TypeError("publish package manifest is invalid");
  for (const key of Object.keys(manifest)) if (!ALLOWED_KEYS.has(key)) throw new Error(`${manifest.name ?? "package"} contains forbidden publish manifest key: ${key}`);
  for (const key of REQUIRED_KEYS) if (!(key in manifest)) throw new Error(`${manifest.name ?? "package"} publish manifest is missing ${key}`);
  const specification = RELEASE_PACKAGE_SPECS.find(({ name }) => name === manifest.name);
  if (specification === undefined || manifest.version !== RELEASE_VERSION || manifest.private !== false || manifest.type !== "module" || manifest.license !== "MIT") throw new Error(`${manifest.name ?? "package"} publish identity is invalid`);
  if (JSON.stringify(manifest.files) !== JSON.stringify(["dist", "README.md", "LICENSE", "THIRD_PARTY_NOTICES.md"])) throw new Error(`${manifest.name} publish files are not the exact allowlist`);
  const expectedExports = manifest.name === "@pixel-point/aval-element"
    ? { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" }, "./auto": { types: "./dist/auto.d.ts", import: "./dist/auto.js" } }
    : { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } };
  validateExportMapBounds(manifest.exports);
  if (JSON.stringify(manifest.exports) !== JSON.stringify(expectedExports)) throw new Error(`${manifest.name} exports do not match the reviewed public surface`);
  const expectedBin = manifest.name === "@pixel-point/aval-compiler" ? { avl: "./dist/cli.js" } : undefined;
  if (JSON.stringify(manifest.bin) !== JSON.stringify(expectedBin)) throw new Error(`${manifest.name} bin map does not match the reviewed public surface`);
  if (manifest.types !== undefined && manifest.types !== "./dist/index.d.ts") throw new Error(`${manifest.name} top-level types target is invalid`);
  const expectedSideEffects = manifest.name === "@pixel-point/aval-element" ? ["./dist/auto.js"] : false;
  if (JSON.stringify(manifest.sideEffects) !== JSON.stringify(expectedSideEffects)) throw new Error(`${manifest.name} sideEffects declaration is invalid`);
  if (JSON.stringify(manifest.engines) !== JSON.stringify({ node: ">=22.12.0" })) throw new Error(`${manifest.name} engines policy is invalid`);
  validateRepositoryMetadata(manifest, specification.directory);
  const dependencies = manifest.dependencies;
  if (dependencies === null || typeof dependencies !== "object" || Array.isArray(dependencies)) throw new Error(`${manifest.name} dependencies are invalid`);
  const actualDependencies = Object.keys(dependencies).sort();
  const expectedDependencies = [...specification.dependencies].sort();
  if (JSON.stringify(actualDependencies) !== JSON.stringify(expectedDependencies)) throw new Error(`${manifest.name} dependencies must be the exact reviewed set`);
  for (const name of expectedDependencies) if (dependencies[name] !== RELEASE_VERSION) throw new Error(`${manifest.name} dependency ${name} must be exactly ${RELEASE_VERSION}`);
  if (manifest.description !== undefined && (typeof manifest.description !== "string" || manifest.description.length < 1 || manifest.description.length > 512)) throw new Error(`${manifest.name} description is invalid`);
  if (manifest.keywords !== undefined && (!Array.isArray(manifest.keywords) || manifest.keywords.length > 32 || manifest.keywords.some((value) => typeof value !== "string" || value.length < 1 || value.length > 64))) throw new Error(`${manifest.name} keywords are invalid`);
  return manifest;
}

function validateRepositoryMetadata(manifest, directory) {
  if (manifest.repository === null || typeof manifest.repository !== "object" || Array.isArray(manifest.repository) || Object.keys(manifest.repository).sort().join(",") !== "directory,type,url" || manifest.repository.type !== "git" || manifest.repository.directory !== `packages/${directory}`) throw new Error(`${manifest.name} repository metadata is invalid`);
  exactPublicUrl(manifest.repository.url, `${manifest.name} repository URL`);
  exactPublicUrl(manifest.homepage, `${manifest.name} homepage`);
  if (manifest.bugs === null || typeof manifest.bugs !== "object" || Array.isArray(manifest.bugs) || Object.keys(manifest.bugs).join(",") !== "url") throw new Error(`${manifest.name} bugs metadata is invalid`);
  exactPublicUrl(manifest.bugs.url, `${manifest.name} bugs URL`);
}

function validateExportMapBounds(value, depth = 0, counter = { entries: 0 }) {
  if (depth > 4 || counter.entries > 32) throw new Error("package export map exceeds structural bounds");
  if (typeof value === "string") {
    counter.entries += 1;
    if (!value.startsWith("./dist/") || value.includes("..") || value.includes("\\") || (!value.endsWith(".js") && !value.endsWith(".d.ts"))) throw new Error(`package export target is unsafe: ${value}`);
    return;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("package export map is invalid");
  const entries = Object.entries(value);
  counter.entries += entries.length;
  if (counter.entries > 32) throw new Error("package export map exceeds structural bounds");
  for (const [key, target] of entries) {
    if (typeof key !== "string" || key.length < 1 || key.length > 64 || key === "source") throw new Error("package export key is invalid");
    validateExportMapBounds(target, depth + 1, counter);
  }
}

function exactPublicUrl(value, label) {
  if (typeof value !== "string" || value.length > 512) throw new Error(`${label} is invalid`);
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") throw new Error(`${label} must be credential-free HTTPS without query or fragment`);
}
