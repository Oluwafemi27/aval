import { mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";

import { CompilerError } from "../diagnostics.js";
import {
  assertDirectoryObject,
  removeOwnedEmptyDirectory,
  requireDirectoryIdentity,
  syncDirectory,
  type DirectoryIdentity
} from "./publication-fs.js";

/**
 * Publish a completely staged directory without replacing an independently
 * created target. POSIX needs an atomic directory claim because rename(2) may
 * replace an existing empty directory; Windows directory rename already fails
 * when the destination exists.
 */
export async function publishStagedDirectoryNoReplace(
  staged: string,
  target: string,
  platform: NodeJS.Platform = process.platform,
  syncParent: (path: string) => Promise<void> = syncDirectory
): Promise<void> {
  const parent = dirname(target);
  if (platform === "win32") {
    let committed = false;
    try {
      await rename(staged, target);
      committed = true;
      await syncParent(parent);
      return;
    } catch (error) {
      if (committed) throw durabilityUncertain(target, error);
      throw new CompilerError("IO_FAILED", "Init path changed before publication", {
        path: target,
        cause: error
      });
    }
  }

  let reservation: DirectoryIdentity | undefined;
  let committed = false;
  try {
    // mkdir is the cooperative no-replace claim exposed by Node's filesystem
    // API. An independently created destination that wins before this call
    // produces EEXIST and is never renamed over. Same-user namespace mutation
    // remains outside the process-isolation boundary, as it does after commit.
    await mkdir(target, { mode: 0o700 });
    reservation = await requireDirectoryIdentity(
      target,
      "init directory reservation"
    );
    await syncParent(parent);
    await assertDirectoryObject(target, reservation, "init directory reservation");
    await rename(staged, target);
    committed = true;
    await syncParent(parent);
  } catch (error) {
    if (committed) throw durabilityUncertain(target, error);
    if (reservation !== undefined) {
      await removeOwnedEmptyDirectory(
        target,
        reservation,
        "init directory reservation"
      ).catch(() => undefined);
      await syncParent(parent).catch(() => undefined);
    }
    if (error instanceof CompilerError) throw error;
    throw new CompilerError("IO_FAILED", "Init path changed before publication", {
      path: target,
      cause: error
    });
  }
}

function durabilityUncertain(path: string, cause: unknown): CompilerError {
  return new CompilerError(
    "IO_FAILED",
    "Init project was committed but directory durability could not be confirmed",
    {
      path,
      cause,
      committed: true,
      hint: "The complete project is present; inspect it before retrying at another path."
    }
  );
}
