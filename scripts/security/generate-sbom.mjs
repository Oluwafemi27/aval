#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { validateSpdxDocument, workspacePackageRecords } from "./sbom-model.mjs";

const outputIndex = process.argv.indexOf("--output");
const output = resolve(outputIndex < 0 ? "artifacts/1.0.0/sbom/workspace.spdx.json" : process.argv[outputIndex + 1]);
const lockBytes = await readFile("package-lock.json");
const lock = JSON.parse(lockBytes.toString("utf8"));
const records = workspacePackageRecords(lock);
const packages = records.map((record) => ({
  SPDXID: spdxId(`package:${record.path || "root"}`),
  name: record.name,
  versionInfo: record.version,
  downloadLocation: "NOASSERTION",
  filesAnalyzed: false,
  licenseConcluded: record.license,
  licenseDeclared: record.license,
  checksums: record.integrity?.startsWith("sha512-") ? [{ algorithm: "SHA512", checksumValue: Buffer.from(record.integrity.slice(7), "base64").toString("hex") }] : []
}));
const document = {
  spdxVersion: "SPDX-2.3",
  dataLicense: "CC0-1.0",
  SPDXID: "SPDXRef-DOCUMENT",
  name: "aval-workspace-1.0.0",
  documentNamespace: `https://spdx.org/spdxdocs/aval-workspace-1.0.0-${createHash("sha256").update(lockBytes).digest("hex")}`,
  creationInfo: { created: deterministicCreatedAt(), creators: ["Tool: aval-workspace-sbom-v1"] },
  packages,
  files: [],
  relationships: packages.map((item) => ({ spdxElementId: "SPDXRef-DOCUMENT", relationshipType: "DESCRIBES", relatedSpdxElement: item.SPDXID }))
};
validateSpdxDocument(document);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(document, null, 2)}\n`, { flag: "wx" });
process.stdout.write(`${JSON.stringify({ status: "passed", output, packages: packages.length })}\n`);
function spdxId(value) { return `SPDXRef-${createHash("sha256").update(value).digest("hex").slice(0, 32)}`; }
function deterministicCreatedAt() { if (process.env.SOURCE_DATE_EPOCH !== undefined) { const value = Number(process.env.SOURCE_DATE_EPOCH); if (!Number.isSafeInteger(value) || value < 0) throw new Error("SOURCE_DATE_EPOCH is invalid"); return new Date(value * 1_000).toISOString(); } const result = spawnSync("git", ["show", "-s", "--format=%cI", "HEAD"], { encoding: "utf8" }); if (result.status !== 0) throw new Error("SOURCE_DATE_EPOCH or a git commit is required for deterministic SBOM time"); return new Date(result.stdout.trim()).toISOString(); }
