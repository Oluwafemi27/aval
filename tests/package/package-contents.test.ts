import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { PUBLIC_RELEASE_PACKAGES, validateSynchronizedReleaseSet, type ReleasePackageManifest } from "../../packages/certification/src/compatibility.js";
import { releasePackageDirectory } from "../../scripts/release/release-set.mjs";

describe("publishable package manifests", () => {
  it("form one synchronized explicit 1.0 release set", async () => {
    const manifests = await Promise.all(PUBLIC_RELEASE_PACKAGES.map(async (name) => {
      const short = releasePackageDirectory(name);
      return JSON.parse(await readFile(`packages/${short}/package.json`, "utf8")) as ReleasePackageManifest;
    }));
    expect(validateSynchronizedReleaseSet(manifests)).toEqual([]);
  });
});
