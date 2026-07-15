#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const [manifestPath, outputPath] = process.argv.slice(2);
if (manifestPath === undefined || outputPath === undefined) throw new Error("usage: render-release-notes.mjs <release-manifest.json> <output.md>");
const bytes = await readFile(manifestPath);
const manifest = JSON.parse(bytes.toString("utf8"));
const digest = createHash("sha256").update(bytes).digest("hex");
const lines = [
  "# AVAL 1.0.0",
  "",
  `Release manifest SHA-256: \`${digest}\``,
  `Candidate manifest SHA-256: \`${manifest.candidateManifestDigest}\``,
  "",
  "Runtime scheduling results are reported only for exact named profiles. Observed-display continuity is not measured unless a separate observed-display report is listed.",
  "",
  `Previous known-good release: \`${manifest.previousKnownGood}\`.`
];
await writeFile(outputPath, `${lines.join("\n")}\n`, { flag: "wx" });
