import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { canonicalJsonBytes } from "../src/canonical-json.js";
import { DISPLAY_CAPTURE_SAMPLE_KEYS, validateDisplayCaptureLedger } from "../src/display-evidence.js";
import { createDisplayCaptureLedger, TEST_DISPLAY_PATTERN_DIGEST } from "./display-evidence-support.js";

const execFileAsync = promisify(execFile);

describe("display observation import", () => {
  it("imports only raw bounded capture fields into a canonical ledger", async () => {
    const root = await mkdtemp(join(tmpdir(), "aval-observations-"));
    try {
      const input = join(root, "input.csv");
      const metadataPath = join(root, "metadata.json");
      const output = join(root, "output.json");
      const ledger = fixtureLedger();
      const { samples, ...metadata } = ledger;
      await writeFile(metadataPath, canonicalJsonBytes(metadata));
      await writeFile(input, `${DISPLAY_CAPTURE_SAMPLE_KEYS.join(",")}\n${samples.map(csvRow).join("\n")}\n`);
      await execFileAsync(process.execPath, ["scripts/certification/import-display-observations.mjs", input, metadataPath, output], { cwd: process.cwd() });
      const imported = JSON.parse(await readFile(output, "utf8"));
      expect(validateDisplayCaptureLedger(imported).samples).toHaveLength(samples.length);
      expect(imported.captureProvenance).toEqual(metadata.captureProvenance);
      expect(JSON.stringify(imported)).not.toContain("expectedContentOrdinal");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects the retired producer-authored expectation columns", async () => {
    const root = await mkdtemp(join(tmpdir(), "aval-observations-hostile-"));
    try {
      const input = join(root, "input.csv");
      const metadataPath = join(root, "metadata.json");
      const output = join(root, "output.json");
      const { samples: _samples, ...metadata } = fixtureLedger();
      await writeFile(metadataPath, canonicalJsonBytes(metadata));
      await writeFile(input, "refreshOrdinal,expectedContentOrdinal,observedContentOrdinal,confidenceMillionths,intervalMicroseconds\n0,0,0,999000,8333\n");
      await expect(execFileAsync(process.execPath, ["scripts/certification/import-display-observations.mjs", input, metadataPath, output], { cwd: process.cwd() })).rejects.toThrow(/header is not canonical/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function fixtureLedger(): any {
  const schedule = Array.from({ length: 3 }, (_, index) => ({
    presentationOrdinal: index + 1,
    contentOrdinal: index,
    occurrenceOrdinal: 0,
    canvasSubmissionCompleteMicroseconds: index * 33_333,
    boundary: index === 2
  }));
  return createDisplayCaptureLedger(schedule, {
    candidateManifestDigest: "a".repeat(64),
    runtimeReportDigest: "b".repeat(64),
    runtimeScenarioId: "loop-1000",
    runtimeScenarioRepetition: 1,
    runtimeScenarioLedgerDigest: "c".repeat(64),
    patternDigest: TEST_DISPLAY_PATTERN_DIGEST
  });
}

function csvRow(sample: Record<string, unknown>): string {
  return DISPLAY_CAPTURE_SAMPLE_KEYS.map((key) => sample[key] === null ? "" : String(sample[key])).join(",");
}
