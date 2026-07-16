import type { BigIntStats } from "node:fs";
import {
  lstat,
  open,
  readdir,
  rmdir,
  unlink
} from "node:fs/promises";
import { join } from "node:path";

import { CompilerError } from "../diagnostics.js";

/** Stable identity for one directory object inside a publication transaction. */
export interface DirectoryIdentity {
  readonly device: string;
  readonly inode: string;
}

export async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function lstatOrUndefined(
  path: string
): Promise<BigIntStats | undefined> {
  return lstat(path, { bigint: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    }
  );
}

export function identityFromMetadata(
  metadata: Pick<BigIntStats, "dev" | "ino">
): Readonly<DirectoryIdentity> {
  return Object.freeze({
    device: String(metadata.dev),
    inode: String(metadata.ino)
  });
}

export function sameDirectoryObject(
  left: Readonly<DirectoryIdentity>,
  right: Readonly<DirectoryIdentity>
): boolean {
  return left.device === right.device && left.inode === right.inode;
}

export async function requireDirectoryIdentity(
  path: string,
  label: string
): Promise<Readonly<DirectoryIdentity>> {
  const metadata = await lstat(path, { bigint: true });
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new CompilerError("IO_FAILED", `${label} is not a real directory`, {
      path
    });
  }
  return identityFromMetadata(metadata);
}

export async function assertDirectoryObject(
  path: string,
  expected: Readonly<DirectoryIdentity>,
  label: string
): Promise<void> {
  const metadata = await lstatOrUndefined(path);
  if (
    metadata === undefined ||
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    !sameDirectoryObject(identityFromMetadata(metadata), expected)
  ) {
    throw new CompilerError("IO_FAILED", `${label} identity changed`, { path });
  }
}

export async function removeOwnedEmptyDirectory(
  path: string,
  expected: Readonly<DirectoryIdentity>,
  label: string
): Promise<void> {
  const metadata = await lstatOrUndefined(path);
  if (metadata === undefined) return;
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    !sameDirectoryObject(identityFromMetadata(metadata), expected)
  ) {
    throw new CompilerError("IO_FAILED", `Refusing to remove changed ${label}`, {
      path
    });
  }
  await rmdir(path);
}

/** Delete only a directory object whose identity the transaction already owns. */
export async function removeProvenDirectoryTree(
  path: string,
  expected: Readonly<DirectoryIdentity>
): Promise<void> {
  const metadata = await lstatOrUndefined(path);
  if (metadata === undefined) return;
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    !sameDirectoryObject(identityFromMetadata(metadata), expected)
  ) {
    throw new CompilerError(
      "IO_FAILED",
      "Refusing to remove an unproven publication directory",
      { path }
    );
  }

  for (const name of await readdir(path)) {
    const childPath = join(path, name);
    const child = await lstat(childPath, { bigint: true });
    const childIdentity = identityFromMetadata(child);
    if (child.isDirectory() && !child.isSymbolicLink()) {
      await removeProvenDirectoryTree(childPath, childIdentity);
      continue;
    }
    const current = await lstatOrUndefined(childPath);
    if (
      current === undefined ||
      !sameDirectoryObject(identityFromMetadata(current), childIdentity)
    ) {
      throw new CompilerError(
        "IO_FAILED",
        "Refusing to remove a changed publication entry",
        { path: childPath }
      );
    }
    await unlink(childPath);
  }
  await assertDirectoryObject(path, expected, "owned publication directory");
  await rmdir(path);
}
