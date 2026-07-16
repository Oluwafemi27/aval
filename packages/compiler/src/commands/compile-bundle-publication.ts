import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  rename,
  type FileHandle
} from "node:fs/promises";
import { basename, dirname, join, parse, resolve } from "node:path";

import { VIDEO_CODECS } from "@pixel-point/aval-format";

import { throwIfAborted } from "../cancellation.js";
import { CompilerError } from "../diagnostics.js";
import type { VideoCodec } from "../model.js";
import {
  assertDirectoryObject,
  identityFromMetadata,
  lstatOrUndefined,
  removeOwnedEmptyDirectory,
  removeProvenDirectoryTree,
  requireDirectoryIdentity,
  sameDirectoryObject,
  syncDirectory,
  type DirectoryIdentity
} from "./publication-fs.js";

export interface CompileBundleAssetInput {
  readonly codec: VideoCodec;
  readonly bytes: Uint8Array;
}

export interface CompileBundlePublicationInput {
  /** Assets remain in project encoding order; their filenames are codec-fixed. */
  readonly assets: readonly Readonly<CompileBundleAssetInput>[];
  readonly buildReportBytes: Uint8Array;
}

export interface CompileBundlePublicationOptions {
  readonly force?: boolean;
  readonly signal?: AbortSignal;
}

export type CompileBundlePublicationPhase =
  | "after-stage-verified"
  | "after-target-validated"
  | "after-backup-moved"
  | "before-stage-install"
  | "after-stage-installed"
  | "after-parent-synced"
  | "before-backup-removal";

export interface CompileBundlePublicationContext {
  readonly targetPath: string;
  readonly workspacePath: string;
  readonly stagePath: string;
  readonly backupPath: string;
}

/**
 * Narrow dependency surface for deterministic namespace-race and durability
 * testing. Production callers should omit it.
 */
export interface CompileBundlePublicationDependencies {
  readonly checkpoint?: (
    phase: CompileBundlePublicationPhase,
    context: Readonly<CompileBundlePublicationContext>
  ) => void | Promise<void>;
  readonly syncDirectory?: (path: string) => Promise<void>;
}

interface DirectorySnapshot {
  readonly identity: Readonly<DirectoryIdentity>;
  readonly mode: number;
  readonly modifiedNanoseconds: string;
  readonly changedNanoseconds: string;
}

interface TransactionState {
  readonly targetPath: string;
  readonly parentPath: string;
  readonly workspacePath: string;
  readonly workspaceIdentity: Readonly<DirectoryIdentity>;
  readonly stagePath: string;
  readonly stageIdentity: Readonly<DirectoryIdentity>;
  readonly backupPath: string;
  readonly context: Readonly<CompileBundlePublicationContext>;
  reservationIdentity: Readonly<DirectoryIdentity> | undefined;
  installedIdentity: Readonly<DirectoryIdentity> | undefined;
  backupIdentity: Readonly<DirectoryIdentity> | undefined;
  committed: boolean;
}

interface FrozenPublicationInput {
  readonly files: readonly Readonly<{
    readonly name: string;
    readonly bytes: Uint8Array;
  }>[];
}

/**
 * Publish a complete codec bundle with one directory-level commit point.
 *
 * Every file is written and synced inside a private sibling workspace before
 * the staged directory is installed. Existing non-directory targets and
 * symbolic links are always rejected, including with `force`.
 */
export async function publishCompileBundleDirectory(
  targetPath: string,
  input: Readonly<CompileBundlePublicationInput>,
  options: Readonly<CompileBundlePublicationOptions> = {},
  dependencies: Readonly<CompileBundlePublicationDependencies> = {}
): Promise<void> {
  const frozenInput = freezePublicationInput(input);
  const absoluteTarget = normalizeTargetPath(targetPath);
  const parentPath = dirname(absoluteTarget);
  const syncPublicationDirectory = dependencies.syncDirectory ?? syncDirectory;

  throwIfAborted(options.signal);
  await ensurePublicationParent(parentPath);
  const initialTarget = await inspectBundleTarget(absoluteTarget);
  if (initialTarget !== undefined && options.force !== true) {
    throw new CompilerError("IO_FAILED", "Bundle directory already exists", {
      path: absoluteTarget,
      hint: "Pass --force only when replacing this exact local bundle is intended."
    });
  }

  const state = await createTransactionState(absoluteTarget, parentPath);
  let failure: unknown;
  try {
    await stageAndVerifyBundle(state, frozenInput, syncPublicationDirectory);
    await checkpoint("after-stage-verified", state, options, dependencies);

    await assertTargetUnchanged(absoluteTarget, initialTarget);
    await checkpoint("after-target-validated", state, options, dependencies);

    if (initialTarget !== undefined) {
      await moveOriginalToBackup(state, initialTarget);
      await checkpoint("after-backup-moved", state, options, dependencies);
    }

    await installStage(state, options, dependencies);
    await checkpoint("after-stage-installed", state, options, dependencies);

    await syncPublicationDirectory(parentPath);
    await checkpoint("after-parent-synced", state, options, dependencies);

    if (state.backupIdentity !== undefined) {
      await checkpoint("before-backup-removal", state, options, dependencies);
      // Deleting the previous bundle is the sole irreversible transition.
      // The newly installed directory is already durable at this point.
      state.committed = true;
      await removeProvenDirectoryTree(state.backupPath, state.backupIdentity);
      state.backupIdentity = undefined;
    } else {
      state.committed = true;
    }
  } catch (error) {
    if (!state.committed) {
      const rollbackFailures = await rollbackTransaction(
        state,
        syncPublicationDirectory
      );
      if (rollbackFailures.length > 0) {
        const backupRetained = state.backupIdentity !== undefined;
        failure = new CompilerError(
          "IO_FAILED",
          backupRetained
            ? "Bundle publication failed and the previous directory could not be restored safely"
            : "Bundle publication failed and rollback durability could not be confirmed",
          {
            path: absoluteTarget,
            cause: new AggregateError([error, ...rollbackFailures]),
            ...(backupRetained
              ? {
                  hint: `The proven previous bundle was retained in ${state.backupPath}.`
                }
              : {})
          }
        );
      } else {
        failure = normalizeFailure(error, absoluteTarget, false);
      }
    } else {
      failure = normalizeFailure(error, absoluteTarget, true);
    }
  }

  if (state.backupIdentity === undefined) {
    try {
      await removeProvenDirectoryTree(
        state.workspacePath,
        state.workspaceIdentity
      );
      await syncPublicationDirectory(parentPath);
    } catch (cleanupError) {
      failure = mergeCleanupFailure(
        failure,
        cleanupError,
        absoluteTarget,
        state.committed
      );
    }
  }

  if (failure !== undefined) throw failure;
}

function freezePublicationInput(
  input: Readonly<CompileBundlePublicationInput>
): Readonly<FrozenPublicationInput> {
  if (!Array.isArray(input.assets) || input.assets.length === 0) {
    throw new CompilerError(
      "INPUT_INVALID",
      "A bundle publication requires at least one codec asset"
    );
  }
  const seen = new Set<VideoCodec>();
  const files: Array<Readonly<{ name: string; bytes: Uint8Array }>> = [];
  for (const asset of input.assets) {
    if (!isVideoCodec(asset.codec)) {
      throw new CompilerError("INPUT_INVALID", "Bundle asset codec is invalid", {
        field: "assets.codec"
      });
    }
    if (seen.has(asset.codec)) {
      throw new CompilerError(
        "INPUT_INVALID",
        `Bundle contains duplicate ${asset.codec} assets`,
        { field: "assets.codec" }
      );
    }
    if (!(asset.bytes instanceof Uint8Array) || asset.bytes.byteLength === 0) {
      throw new CompilerError(
        "INPUT_INVALID",
        `Bundle ${asset.codec} asset must contain bytes`,
        { field: "assets.bytes" }
      );
    }
    seen.add(asset.codec);
    files.push(Object.freeze({
      name: `${asset.codec}.avl`,
      bytes: Uint8Array.from(asset.bytes)
    }));
  }
  if (
    !(input.buildReportBytes instanceof Uint8Array) ||
    input.buildReportBytes.byteLength === 0
  ) {
    throw new CompilerError(
      "INPUT_INVALID",
      "Bundle build report must contain bytes",
      { field: "buildReportBytes" }
    );
  }
  files.push(Object.freeze({
    name: "build.json",
    bytes: Uint8Array.from(input.buildReportBytes)
  }));
  return Object.freeze({ files: Object.freeze(files) });
}

function normalizeTargetPath(path: string): string {
  if (path.trim() === "") {
    throw new CompilerError("INPUT_INVALID", "Bundle output path is required", {
      path
    });
  }
  const absolute = resolve(path);
  if (absolute === parse(absolute).root || basename(absolute) === "") {
    throw new CompilerError(
      "INPUT_INVALID",
      "Bundle output must name a directory below the filesystem root",
      { path: absolute }
    );
  }
  return absolute;
}

async function createTransactionState(
  targetPath: string,
  parentPath: string
): Promise<TransactionState> {
  let workspacePath: string;
  try {
    workspacePath = await mkdtemp(
      join(parentPath, `.${basename(targetPath)}.bundle-publish-`)
    );
  } catch (error) {
    throw normalizeFailure(error, targetPath, false);
  }
  try {
    await chmod(workspacePath, 0o700);
  } catch (error) {
    const workspaceIdentity = await requireDirectoryIdentity(
      workspacePath,
      "publication workspace"
    ).catch(() => undefined);
    if (workspaceIdentity !== undefined) {
      await removeProvenDirectoryTree(workspacePath, workspaceIdentity)
        .catch(() => undefined);
    }
    throw normalizeFailure(error, targetPath, false);
  }
  const workspaceIdentity = await requireDirectoryIdentity(
    workspacePath,
    "publication workspace"
  );
  const stagePath = join(workspacePath, "stage");
  try {
    await mkdir(stagePath, { mode: 0o755 });
  } catch (error) {
    await removeProvenDirectoryTree(workspacePath, workspaceIdentity)
      .catch(() => undefined);
    throw normalizeFailure(error, targetPath, false);
  }
  const stageIdentity = await requireDirectoryIdentity(
    stagePath,
    "staged bundle"
  );
  const backupPath = join(workspacePath, "previous");
  return {
    targetPath,
    parentPath,
    workspacePath,
    workspaceIdentity,
    stagePath,
    stageIdentity,
    backupPath,
    context: Object.freeze({
      targetPath,
      workspacePath,
      stagePath,
      backupPath
    }),
    reservationIdentity: undefined,
    installedIdentity: undefined,
    backupIdentity: undefined,
    committed: false
  };
}

async function stageAndVerifyBundle(
  state: TransactionState,
  input: Readonly<FrozenPublicationInput>,
  syncDirectory: (path: string) => Promise<void>
): Promise<void> {
  for (const file of input.files) {
    await writeSyncedFile(join(state.stagePath, file.name), file.bytes);
  }
  await syncDirectory(state.stagePath);

  const actualNames = (await readdir(state.stagePath)).sort();
  const expectedNames = input.files.map(({ name }) => name).sort();
  if (
    actualNames.length !== expectedNames.length ||
    actualNames.some((name, index) => name !== expectedNames[index])
  ) {
    throw new CompilerError(
      "IO_FAILED",
      "Staged bundle contains unexpected directory entries",
      { path: state.stagePath }
    );
  }
  for (const file of input.files) {
    await verifyRegularFileBytes(join(state.stagePath, file.name), file.bytes);
  }
  await assertDirectoryObject(state.stagePath, state.stageIdentity, "staged bundle");
}

async function writeSyncedFile(path: string, bytes: Uint8Array): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, "wx", 0o644);
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    throw new CompilerError("IO_FAILED", "Could not stage bundle file", {
      path,
      cause: error
    });
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function verifyRegularFileBytes(
  path: string,
  expected: Uint8Array
): Promise<void> {
  const pathMetadata = await lstat(path, { bigint: true });
  if (!pathMetadata.isFile() || pathMetadata.isSymbolicLink()) {
    throw new CompilerError(
      "IO_FAILED",
      "Staged bundle entry is not a regular file",
      { path }
    );
  }
  const handle = await open(path, "r");
  try {
    const handleMetadata = await handle.stat({ bigint: true });
    if (
      !handleMetadata.isFile() ||
      !sameDirectoryObject(
        identityFromMetadata(pathMetadata),
        identityFromMetadata(handleMetadata)
      ) ||
      handleMetadata.size !== BigInt(expected.byteLength)
    ) {
      throw new CompilerError("IO_FAILED", "Staged bundle file changed", {
        path
      });
    }
    const actual = new Uint8Array(await handle.readFile());
    if (!equalBytes(actual, expected)) {
      throw new CompilerError(
        "IO_FAILED",
        "Staged bundle file bytes do not match the build output",
        { path }
      );
    }
  } finally {
    await handle.close();
  }
}

async function moveOriginalToBackup(
  state: TransactionState,
  expected: Readonly<DirectorySnapshot>
): Promise<void> {
  await assertTargetUnchanged(state.targetPath, expected);
  await assertPathAbsent(state.backupPath, "bundle backup");
  try {
    await rename(state.targetPath, state.backupPath);
    state.backupIdentity = expected.identity;
  } catch (error) {
    throw new CompilerError(
      "IO_FAILED",
      "Could not secure the previous bundle directory",
      { path: state.targetPath, cause: error }
    );
  }
  await assertDirectoryObject(
    state.backupPath,
    expected.identity,
    "bundle backup"
  );
}

async function installStage(
  state: TransactionState,
  options: Readonly<CompileBundlePublicationOptions>,
  dependencies: Readonly<CompileBundlePublicationDependencies>
): Promise<void> {
  await assertPathAbsent(state.targetPath, "bundle target");
  if (process.platform !== "win32") {
    try {
      await mkdir(state.targetPath, { mode: 0o700 });
    } catch (error) {
      throw new CompilerError(
        "IO_FAILED",
        "Bundle directory changed before publication",
        { path: state.targetPath, cause: error }
      );
    }
    state.reservationIdentity = await requireDirectoryIdentity(
      state.targetPath,
      "bundle reservation"
    );
  }

  await checkpoint("before-stage-install", state, options, dependencies);
  await assertDirectoryObject(state.stagePath, state.stageIdentity, "staged bundle");
  if (state.reservationIdentity !== undefined) {
    await assertDirectoryObject(
      state.targetPath,
      state.reservationIdentity,
      "bundle reservation"
    );
  } else {
    await assertPathAbsent(state.targetPath, "bundle target");
  }

  try {
    await rename(state.stagePath, state.targetPath);
    state.reservationIdentity = undefined;
    state.installedIdentity = state.stageIdentity;
  } catch (error) {
    throw new CompilerError("IO_FAILED", "Could not install the staged bundle", {
      path: state.targetPath,
      cause: error
    });
  }
  await assertDirectoryObject(
    state.targetPath,
    state.stageIdentity,
    "published bundle"
  );
}

async function checkpoint(
  phase: CompileBundlePublicationPhase,
  state: TransactionState,
  options: Readonly<CompileBundlePublicationOptions>,
  dependencies: Readonly<CompileBundlePublicationDependencies>
): Promise<void> {
  await dependencies.checkpoint?.(phase, state.context);
  throwIfAborted(options.signal);
}

async function rollbackTransaction(
  state: TransactionState,
  syncDirectory: (path: string) => Promise<void>
): Promise<unknown[]> {
  const failures: unknown[] = [];

  if (state.installedIdentity !== undefined) {
    try {
      const current = await inspectBundleTarget(state.targetPath);
      if (
        current !== undefined &&
        sameDirectoryObject(current.identity, state.installedIdentity)
      ) {
        await assertPathAbsent(state.stagePath, "rollback stage");
        await rename(state.targetPath, state.stagePath);
        state.installedIdentity = undefined;
        await assertDirectoryObject(
          state.stagePath,
          state.stageIdentity,
          "rolled-back staged bundle"
        );
      } else if (current === undefined) {
        state.installedIdentity = undefined;
      } else {
        throw new CompilerError(
          "IO_FAILED",
          "Published bundle identity changed during rollback",
          { path: state.targetPath }
        );
      }
    } catch (error) {
      failures.push(error);
    }
  }

  if (state.reservationIdentity !== undefined) {
    try {
      await removeOwnedEmptyDirectory(
        state.targetPath,
        state.reservationIdentity,
        "bundle reservation"
      );
      state.reservationIdentity = undefined;
    } catch (error) {
      failures.push(error);
    }
  }

  if (state.backupIdentity !== undefined) {
    try {
      await restoreBackup(state);
    } catch (error) {
      failures.push(error);
    }
  }

  try {
    await syncDirectory(state.parentPath);
  } catch (error) {
    failures.push(error);
  }
  return failures;
}

async function restoreBackup(state: TransactionState): Promise<void> {
  const backupIdentity = state.backupIdentity;
  if (backupIdentity === undefined) return;
  await assertDirectoryObject(state.backupPath, backupIdentity, "bundle backup");
  await assertPathAbsent(state.targetPath, "bundle target during rollback");

  let restorationReservation: Readonly<DirectoryIdentity> | undefined;
  if (process.platform !== "win32") {
    await mkdir(state.targetPath, { mode: 0o700 });
    restorationReservation = await requireDirectoryIdentity(
      state.targetPath,
      "bundle restoration reservation"
    );
  }
  try {
    if (restorationReservation !== undefined) {
      await assertDirectoryObject(
        state.targetPath,
        restorationReservation,
        "bundle restoration reservation"
      );
    } else {
      await assertPathAbsent(state.targetPath, "bundle target during rollback");
    }
    await rename(state.backupPath, state.targetPath);
    state.backupIdentity = undefined;
  } catch (error) {
    if (restorationReservation !== undefined) {
      await removeOwnedEmptyDirectory(
        state.targetPath,
        restorationReservation,
        "bundle restoration reservation"
      ).catch(() => undefined);
    }
    throw error;
  }
  await assertDirectoryObject(
    state.targetPath,
    backupIdentity,
    "restored bundle"
  );
}

async function inspectBundleTarget(
  path: string
): Promise<Readonly<DirectorySnapshot> | undefined> {
  const metadata = await lstatOrUndefined(path);
  if (metadata === undefined) return undefined;
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new CompilerError(
      "IO_FAILED",
      "Bundle target must be a real directory",
      { path }
    );
  }
  return Object.freeze({
    identity: identityFromMetadata(metadata),
    mode: Number(metadata.mode) & 0o777,
    modifiedNanoseconds: String(metadata.mtimeNs),
    changedNanoseconds: String(metadata.ctimeNs)
  });
}

async function assertTargetUnchanged(
  path: string,
  expected: Readonly<DirectorySnapshot> | undefined
): Promise<void> {
  const current = await inspectBundleTarget(path);
  const matches = current === undefined
    ? expected === undefined
    : expected !== undefined &&
      sameDirectoryObject(current.identity, expected.identity) &&
      current.mode === expected.mode &&
      current.modifiedNanoseconds === expected.modifiedNanoseconds &&
      current.changedNanoseconds === expected.changedNanoseconds;
  if (!matches) {
    throw new CompilerError(
      "IO_FAILED",
      "Bundle directory changed while outputs were being built",
      { path }
    );
  }
}

async function assertPathAbsent(path: string, label: string): Promise<void> {
  if (await lstatOrUndefined(path) !== undefined) {
    throw new CompilerError("IO_FAILED", `${label} already exists`, { path });
  }
}

async function ensurePublicationParent(path: string): Promise<void> {
  try {
    await mkdir(path, { recursive: true, mode: 0o755 });
  } catch (error) {
    throw new CompilerError(
      "IO_FAILED",
      "Could not create the bundle output parent",
      { path, cause: error }
    );
  }
  const metadata = await lstat(path, { bigint: true });
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new CompilerError(
      "IO_FAILED",
      "Bundle output parent must be a real directory",
      { path }
    );
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((value, index) => value === right[index]);
}

function isVideoCodec(value: unknown): value is VideoCodec {
  return typeof value === "string" &&
    (VIDEO_CODECS as readonly string[]).includes(value);
}

function normalizeFailure(
  error: unknown,
  path: string,
  committed: boolean
): CompilerError {
  if (error instanceof CompilerError && !committed) return error;
  return new CompilerError(
    "IO_FAILED",
    committed
      ? "Bundle was committed but publication cleanup could not be confirmed"
      : "Could not publish codec bundle directory",
    { path, cause: error, ...(committed ? { committed: true } : {}) }
  );
}

function mergeCleanupFailure(
  existing: unknown,
  cleanupError: unknown,
  path: string,
  committed: boolean
): CompilerError {
  return new CompilerError(
    "IO_FAILED",
    committed
      ? "Bundle was committed but its private publication workspace could not be removed"
      : "Bundle publication workspace could not be removed",
    {
      path,
      cause: existing === undefined
        ? cleanupError
        : new AggregateError([existing, cleanupError]),
      ...(committed ? { committed: true } : {})
    }
  );
}
