#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { loadVerifiedReleaseSet } from "../release/release-set.mjs";
import { releasePackageDirectory } from "../release/release-set-model.mjs";
import { validateSpdxDocument } from "./sbom-model.mjs";

const args = parse(process.argv.slice(2));
const packageDirectory = resolve(args.packages ?? "artifacts/1.0.0/packages");
const packageIndexPath = resolve(args.index ?? "artifacts/1.0.0/package-index.json");
const output = resolve(args.output ?? "artifacts/1.0.0/sbom");
const [policy, packageIndex] = await Promise.all([readFile("config/release/release-policy.json", "utf8").then(JSON.parse), readFile(packageIndexPath, "utf8").then(JSON.parse)]);
const releaseSet = await loadVerifiedReleaseSet({ directory: packageDirectory, policy, packageIndex });
await mkdir(output, { recursive: true });
run(process.execPath, ["scripts/security/generate-sbom.mjs", "--output", join(output, "workspace.spdx.json")]);
for (const archive of releaseSet.packages) {
  const dependencies = Object.entries(archive.manifest.dependencies ?? {}).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([name, version]) => ({
    SPDXID: spdxId(`dependency:${name}`), name, versionInfo: version, downloadLocation: "NOASSERTION", filesAnalyzed: false,
    licenseConcluded: "NOASSERTION", licenseDeclared: "NOASSERTION", checksums: []
  }));
  const files = archive.fileRecords.map((file) => ({
    SPDXID: spdxId(`file:${file.path}`), fileName: `./${file.path}`,
    checksums: [{ algorithm: "SHA256", checksumValue: file.sha256 }], licenseInfoInFiles: ["NOASSERTION"]
  }));
  const packageId = "SPDXRef-Package";
  const document = {
    spdxVersion: "SPDX-2.3", dataLicense: "CC0-1.0", SPDXID: "SPDXRef-DOCUMENT",
    name: `${archive.name}-${archive.version}`,
    documentNamespace: `https://spdx.org/spdxdocs/aval-${encodeURIComponent(archive.name)}-${archive.version}-${archive.tarballSha256}`,
    creationInfo: { created: deterministicCreatedAt(), creators: ["Tool: aval-package-sbom-v1"] },
    packages: [{
      SPDXID: packageId, name: archive.name, versionInfo: archive.version, downloadLocation: "NOASSERTION", filesAnalyzed: true,
      licenseConcluded: archive.manifest.license, licenseDeclared: archive.manifest.license,
      checksums: [
        { algorithm: "SHA256", checksumValue: archive.tarballSha256 },
        { algorithm: "SHA512", checksumValue: Buffer.from(archive.registryIntegrity.slice(7), "base64").toString("hex") }
      ]
    }, ...dependencies],
    files,
    relationships: [
      { spdxElementId: "SPDXRef-DOCUMENT", relationshipType: "DESCRIBES", relatedSpdxElement: packageId },
      ...dependencies.map(({ SPDXID }) => ({ spdxElementId: packageId, relationshipType: "DEPENDS_ON", relatedSpdxElement: SPDXID })),
      ...files.map(({ SPDXID }) => ({ spdxElementId: packageId, relationshipType: "CONTAINS", relatedSpdxElement: SPDXID }))
    ]
  };
  validateSpdxDocument(document);
  await writeFile(join(output, `${releasePackageDirectory(archive.name)}.spdx.json`), `${JSON.stringify(document, null, 2)}\n`, { flag: "wx" });
}
process.stdout.write(`${JSON.stringify({ status: "passed", output, releaseSetDigest: releaseSet.releaseSetDigest, packages: releaseSet.packages.length })}\n`);
function spdxId(value) { return `SPDXRef-${createHash("sha256").update(value).digest("hex").slice(0, 32)}`; }
function run(command, values) { const result = spawnSync(command, values, { stdio: "inherit", timeout: 120_000 }); if (result.error !== undefined) throw result.error; if (result.status !== 0) throw new Error(`${command} failed`); }
function deterministicCreatedAt() { if (process.env.SOURCE_DATE_EPOCH !== undefined) { const value = Number(process.env.SOURCE_DATE_EPOCH); if (!Number.isSafeInteger(value) || value < 0) throw new Error("SOURCE_DATE_EPOCH is invalid"); return new Date(value * 1_000).toISOString(); } const result = spawnSync("git", ["show", "-s", "--format=%cI", "HEAD"], { encoding: "utf8" }); if (result.status !== 0) throw new Error("SOURCE_DATE_EPOCH or git commit required"); return new Date(result.stdout.trim()).toISOString(); }
function parse(values) { const result = {}; for (let index = 0; index < values.length; index += 2) result[String(values[index]).replace(/^--/u, "")] = values[index + 1] ?? "true"; return result; }
