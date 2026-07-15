import { describe, expect, it } from "vitest";
import { evaluateDisplayEvidence } from "../src/display-evidence.js";
import { displayMarkerFields, validateDisplayPattern } from "../src/display-pattern.js";
import type { RuntimeDisplayScheduleEntry } from "../src/runtime-scenario-ledger.js";

const digest = (character: string) => character.repeat(64);
const pattern = validateDisplayPattern({
  bitWidth: 16,
  calibrationPatchIds: ["black", "white", "red", "green", "blue"],
  markerKind: "aval-display",
  markerVersion: "1.0",
  modulus: 65_535,
  parity: "xor-fold-v1"
});
const schedule: readonly RuntimeDisplayScheduleEntry[] = Object.freeze(Array.from({ length: 6 }, (_, index) => Object.freeze({
  presentationOrdinal: index + 1,
  contentOrdinal: index,
  occurrenceOrdinal: 0,
  canvasSubmissionCompleteMicroseconds: index * 33_333,
  boundary: index === 4
})));
const expectation = Object.freeze({
  candidateManifestDigest: digest("a"),
  runtimeReportDigest: digest("b"),
  runtimeScenarioId: "loop-1000",
  runtimeScenarioRepetition: 1,
  runtimeScenarioLedgerDigest: digest("c"),
  patternDigest: digest("d"),
  method: "external-high-speed-capture" as const,
  captureRateMilliHz: 240_000,
  measuredRefreshMilliHz: 60_000,
  minimumConfidenceMillionths: 990_000,
  captureProvenance: Object.freeze({
    rawCaptureDigest: digest("e"),
    extractor: Object.freeze({ tool: "aval-display-extractor", version: "1.0.0" }),
    operatorRole: "qualified-display-capture-operator",
    reviewerIds: Object.freeze(["display-reviewer-1"])
  }),
  idealContentFrameIntervalMicroseconds: 33_333
});

describe("raw observed-display evidence", () => {
  it("derives a passing result from captured markers and the trusted runtime schedule", () => {
    const result = evaluateDisplayEvidence(captureLedger(), pattern, schedule, expectation).evaluation;
    expect(result).toMatchObject({
      status: "passed",
      observationCount: 48,
      refreshCount: 12,
      distinctAppearanceCount: 6,
      firstFailingRefreshOrdinal: null,
      failures: [],
      inconclusiveReasons: []
    });
    expect(Object.values(result.criteria)).toEqual(["passed", "passed", "passed", "passed"]);
  });

  it("rejects producer-authored expectations and exact binding substitution", () => {
    const ledger = captureLedger() as any;
    ledger.samples[0].expectedContentOrdinal = 0;
    expect(() => evaluateDisplayEvidence(ledger, pattern, schedule, expectation)).toThrow(/expectedContentOrdinal is unknown/u);
    expect(() => evaluateDisplayEvidence(captureLedger(), pattern, schedule, { ...expectation, candidateManifestDigest: digest("e") })).toThrow(/candidate manifest binding mismatch/u);
    expect(() => evaluateDisplayEvidence(captureLedger(), pattern, schedule, { ...expectation, patternDigest: digest("e") })).toThrow(/display pattern binding mismatch/u);
  });

  it("grades damaged markers, camera gaps, low confidence, and bad calibration as inconclusive", () => {
    const damaged = captureLedger() as any;
    damaged.samples[8].contentComplement ^= 1;
    expect(evaluateDisplayEvidence(damaged, pattern, schedule, expectation).evaluation).toMatchObject({ status: "inconclusive", inconclusiveReasons: expect.arrayContaining(["refresh-marker-ambiguous:2"]) });

    const gap = captureLedger() as any;
    gap.samples[20].captureOrdinal += 1;
    expect(evaluateDisplayEvidence(gap, pattern, schedule, expectation).evaluation).toMatchObject({ status: "inconclusive", inconclusiveReasons: expect.arrayContaining(["capture-ordinal-gap"]) });

    const uncertain = captureLedger() as any;
    uncertain.samples[24].confidenceMillionths = 1;
    expect(evaluateDisplayEvidence(uncertain, pattern, schedule, expectation).evaluation.status).toBe("inconclusive");

    const uncalibrated = captureLedger() as any;
    uncalibrated.calibration.focusScoreMillionths = 1;
    expect(evaluateDisplayEvidence(uncalibrated, pattern, schedule, expectation).evaluation).toMatchObject({ status: "inconclusive", criteria: { "display-capture-calibration": "inconclusive" } });
  });

  it("fails independently observed black output and a long boundary hold", () => {
    const black = captureLedger() as any;
    black.samples.slice(32, 36).forEach((sample: any) => { sample.blackDetected = true; });
    expect(evaluateDisplayEvidence(black, pattern, schedule, expectation).evaluation).toMatchObject({ status: "failed", firstFailingRefreshOrdinal: 8, criteria: { "display-content-identity": "failed" } });

    const held = captureLedger([0, 0, 1, 1, 2, 2, 3, 3, 3, 3, 4, 4, 5, 5]);
    expect(evaluateDisplayEvidence(held, pattern, schedule, expectation).evaluation).toMatchObject({ status: "failed", criteria: { "display-boundary-interval": "failed" } });
  });

  it("never passes an incomplete capture of the trusted schedule", () => {
    const incomplete = captureLedger([0, 0, 1, 1, 2, 2, 3, 3]);
    expect(evaluateDisplayEvidence(incomplete, pattern, schedule, expectation).evaluation).toMatchObject({ status: "inconclusive", inconclusiveReasons: expect.arrayContaining(["runtime-schedule-coverage-incomplete"]) });
  });
});

function captureLedger(contentByRefresh = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]): any {
  return {
    schemaVersion: "1.0",
    ledgerKind: "observed-display-capture",
    candidateManifestDigest: expectation.candidateManifestDigest,
    runtimeReportDigest: expectation.runtimeReportDigest,
    runtimeScenarioId: expectation.runtimeScenarioId,
    runtimeScenarioRepetition: expectation.runtimeScenarioRepetition,
    runtimeScenarioLedgerDigest: expectation.runtimeScenarioLedgerDigest,
    patternDigest: expectation.patternDigest,
    method: expectation.method,
    captureRateMilliHz: expectation.captureRateMilliHz,
    measuredRefreshMilliHz: expectation.measuredRefreshMilliHz,
    minimumConfidenceMillionths: expectation.minimumConfidenceMillionths,
    captureProvenance: expectation.captureProvenance,
    calibration: {
      focusScoreMillionths: 1_000_000,
      regionCoverageMillionths: 1_000_000,
      exposureClippedSamples: 0,
      patches: [
        patch("black", 0, 0, 0), patch("white", 255, 255, 255), patch("red", 255, 0, 0),
        patch("green", 0, 255, 0), patch("blue", 0, 0, 255)
      ]
    },
    samples: contentByRefresh.flatMap((contentValue, refreshOrdinal) => Array.from({ length: 4 }, (_, inRefresh) => {
      const captureOrdinal = refreshOrdinal * 4 + inRefresh;
      const capture = displayMarkerFields(100 + refreshOrdinal, pattern);
      const content = displayMarkerFields(contentValue, pattern);
      const occurrence = displayMarkerFields(0, pattern);
      return {
        captureOrdinal,
        captureTimestampMicroseconds: captureOrdinal * 4_167,
        captureMarkerValue: capture.value,
        captureMarkerComplement: capture.complement,
        captureMarkerParity: capture.parity,
        refreshOrdinal,
        contentValue: content.value,
        contentComplement: content.complement,
        contentParity: content.parity,
        occurrenceValue: occurrence.value,
        occurrenceComplement: occurrence.complement,
        occurrenceParity: occurrence.parity,
        confidenceMillionths: 1_000_000,
        markerAmbiguous: false,
        blackDetected: false,
        transparentUninitializedDetected: false
      };
    }))
  };
}

function patch(id: string, red: number, green: number, blue: number) {
  return { id, red, green, blue, confidenceMillionths: 1_000_000 };
}
