import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

import { RELEASE_PACKAGE_NAMES, releasePackageDirectory } from "./release-set-model.mjs";
import { ensureCompilerCliExecutable } from "./compiler-cli-mode.mjs";

const BUILD_INFO = Object.freeze({
  "@pixel-point/aval-graph": new Set(["graph.tsbuildinfo"]),
  "@pixel-point/aval-format": new Set(["format.tsbuildinfo"]),
  "@pixel-point/aval-player-web": new Set(["player-web.release.tsbuildinfo"]),
  "@pixel-point/aval-element": new Set(["element.release.tsbuildinfo"]),
  "@pixel-point/aval-compiler": new Set(["compiler.tsbuildinfo"])
});
const SOURCE_MAP_PACKAGES = new Set([
  "@pixel-point/aval-graph",
  "@pixel-point/aval-format",
  "@pixel-point/aval-compiler"
]);
const RELEASE_CONFIG = Object.freeze({
  "@pixel-point/aval-graph": "tsconfig.json",
  "@pixel-point/aval-format": "tsconfig.json",
  "@pixel-point/aval-player-web": "tsconfig.release.json",
  "@pixel-point/aval-element": "tsconfig.release.json",
  "@pixel-point/aval-compiler": "tsconfig.json"
});

export async function buildFreshPublicDistributions(root) {
  const repository = resolve(root);
  const lockPath = join(repository, ".git", "aval-release-build.lock");
  const lock = await open(lockPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600).catch((error) => {
    if (error?.code === "EEXIST") throw new Error("another fresh public distribution build is active");
    throw error;
  });
  let temporary;
  try { temporary = await mkdtemp(join(repository, ".aval-public-build-")); }
  catch (error) { await lock.close().catch(() => undefined); await rm(lockPath, { force: true }); throw error; }
  try {
    await lock.writeFile(`${String(process.pid)}\n`);
    await lock.sync();
    const staged = new Map();
    for (const name of RELEASE_PACKAGE_NAMES) {
      const short = releasePackageDirectory(name);
      const distribution = join(temporary, "dist", short);
      await mkdir(distribution, { recursive: true });
      const config = join(temporary, `tsconfig.${short}.json`);
      await writeFile(config, `${JSON.stringify(privateBuildConfig(repository, name, distribution, staged), null, 2)}\n`, { flag: "wx", mode: 0o400 });
      const result = spawnSync(process.execPath, [resolve(repository, "node_modules/typescript/bin/tsc"), "-p", config, "--pretty", "false"], { cwd: repository, stdio: "inherit", timeout: 5 * 60_000 });
      if (result.error !== undefined) throw result.error;
      if (result.status !== 0) throw new Error(`private fresh public build failed for ${name}`);
      if (name === "@pixel-point/aval-compiler") {
        await ensureCompilerCliExecutable(join(distribution, "cli.js"));
      }
      await assertDistributionDerived({ source: packageDirectory(repository, name, "src"), distribution, packageName: name });
      staged.set(name, distribution);
    }
    await installVerifiedDistributions({ root: repository, staged, backupRoot: join(temporary, "backup") });
  } finally {
    await lock.close().catch(() => undefined);
    await rm(lockPath, { force: true });
    await rm(temporary, { recursive: true, force: true });
  }
}

/** Atomically replace each verified dist directory and restore the complete prior set on any failure. */
export async function installVerifiedDistributions({ root, staged, backupRoot, renameEntry = rename, removeEntry = rm }) {
  await preflightExistingDistributions(root);
  await mkdir(backupRoot, { recursive: true });
  const installed = [];
  try {
    for (const name of RELEASE_PACKAGE_NAMES) {
      const short = releasePackageDirectory(name);
      const target = packageDirectory(root, name, "dist");
      const backup = join(backupRoot, short);
      const source = staged.get(name);
      if (typeof source !== "string") throw new Error(`verified staged distribution is missing for ${name}`);
      const existed = await pathExists(target);
      if (existed) await renameEntry(target, backup);
      try { await renameEntry(source, target); }
      catch (error) { if (existed) await renameEntry(backup, target); throw error; }
      installed.push(Object.freeze({ target, backup, existed }));
    }
  } catch (installError) {
    const failures = [installError];
    for (const entry of [...installed].reverse()) {
      try {
        await removeEntry(entry.target, { recursive: true, force: true });
        if (entry.existed) await renameEntry(entry.backup, entry.target);
      } catch (restoreError) { failures.push(restoreError); }
    }
    if (failures.length > 1) throw new AggregateError(failures, "fresh distribution install failed and prior-set restoration was incomplete");
    throw installError;
  }
}

function privateBuildConfig(root, name, distribution, staged) {
  const source = packageDirectory(root, name, "src");
  const short = releasePackageDirectory(name);
  const buildInfo = [...BUILD_INFO[name]][0];
  const paths = Object.fromEntries([...staged].map(([packageName, path]) => [packageName, [join(path, "index.d.ts")]]));
  return {
    extends: packageDirectory(root, name, RELEASE_CONFIG[name]),
    compilerOptions: {
      rootDir: source,
      outDir: distribution,
      tsBuildInfoFile: join(distribution, buildInfo),
      paths
    },
    include: [slash(join(source, "**/*.ts"))],
    exclude: [slash(join(source, "**/*.test.ts")), slash(join(source, "**/*.compile.ts")), slash(join(source, "**/*test-support.ts"))]
  };
}

async function preflightExistingDistributions(root) {
  for (const name of RELEASE_PACKAGE_NAMES) {
    const path = packageDirectory(root, name, "dist");
    try { const info = await lstat(path); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`${name} existing distribution is not a regular directory`); }
    catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
}

async function pathExists(path) { try { await lstat(path); return true; } catch (error) { if (error?.code === "ENOENT") return false; throw error; } }
function slash(path) { return path.split(sep).join("/"); }

export async function assertDistributionDerived({ source, distribution, packageName }) {
  const sourceFiles = (await collectFiles(resolve(source))).filter((path) => isReleaseSource(path));
  if (sourceFiles.length === 0) throw new Error(`${packageName} has no release source files`);
  if (!BUILD_INFO[packageName]) throw new Error(`${packageName} has no reviewed release emission contract`);
  const expected = new Set();
  for (const path of sourceFiles) {
    if (path.endsWith(".d.ts")) continue;
    const stem = path.slice(0, -3);
    expected.add(`${stem}.js`);
    expected.add(`${stem}.d.ts`);
    if (SOURCE_MAP_PACKAGES.has(packageName)) {
      expected.add(`${stem}.js.map`);
      expected.add(`${stem}.d.ts.map`);
    }
  }
  for (const name of BUILD_INFO[packageName]) expected.add(name);
  const outputs = await collectFiles(resolve(distribution));
  for (const path of outputs) {
    if (!expected.has(path)) throw new Error(`${packageName} distribution output is not in the exact release emission contract: ${path}`);
    if (/(?:^|\/)(?:[^/]+\.(?:test|compile)\.(?:js|d\.ts)|[^/]*test-support\.(?:js|d\.ts))$/u.test(path)) throw new Error(`${packageName} distribution contains test output: ${path}`);
  }
  for (const path of expected) if (!outputs.includes(path)) throw new Error(`${packageName} fresh distribution is missing required source-derived output: ${path}`);
  if (outputs.length !== expected.size) throw new Error(`${packageName} fresh distribution output count does not match the exact emission contract`);
  return Object.freeze({ sourceFiles: Object.freeze(sourceFiles), outputs: Object.freeze(outputs) });
}

async function collectFiles(root, directory = root, output = []) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`release build symlink is forbidden: ${relative(root, path).split(sep).join("/")}`);
    if (entry.isDirectory()) await collectFiles(root, path, output);
    else if (entry.isFile()) output.push(relative(root, path).split(sep).join("/"));
    else throw new Error(`release build special entry is forbidden: ${relative(root, path).split(sep).join("/")}`);
  }
  return output;
}

function isReleaseSource(path) { return path.endsWith(".ts") && !/\.(?:test|compile)\.ts$/u.test(path) && !/test-support\.ts$/u.test(path); }
function packageDirectory(root, name, child) { return resolve(root, "packages", releasePackageDirectory(name), child); }
