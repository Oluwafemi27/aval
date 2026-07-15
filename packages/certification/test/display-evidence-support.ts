import { displayMarkerFields, validateDisplayPattern } from "../src/display-pattern.js";
import type { RuntimeDisplayScheduleEntry } from "../src/runtime-scenario-ledger.js";
import type { DisplayCaptureProvenance } from "../src/model.js";

export const TEST_DISPLAY_PATTERN_DIGEST = "d".repeat(64);
export const TEST_DISPLAY_PATTERN = validateDisplayPattern({
  bitWidth: 16,
  calibrationPatchIds: ["black", "white", "red", "green", "blue"],
  markerKind: "aval-display",
  markerVersion: "1.0",
  modulus: 65_535,
  parity: "xor-fold-v1"
});
export const TEST_CAPTURE_PROVENANCE: DisplayCaptureProvenance = Object.freeze({
  rawCaptureDigest: "e".repeat(64),
  extractor: Object.freeze({ tool: "aval-display-extractor", version: "1.0.0" }),
  operatorRole: "qualified-display-capture-operator",
  reviewerIds: Object.freeze(["display-reviewer-1", "display-reviewer-2"])
});

export interface DisplayCaptureBindings {
  readonly candidateManifestDigest: string;
  readonly runtimeReportDigest: string;
  readonly runtimeScenarioId: string;
  readonly runtimeScenarioRepetition: number;
  readonly runtimeScenarioLedgerDigest: string;
  readonly patternDigest: string;
  readonly captureProvenance?: DisplayCaptureProvenance;
}

export function createDisplayCaptureLedger(
  schedule: readonly RuntimeDisplayScheduleEntry[],
  bindings: DisplayCaptureBindings
): any {
  const contentByRefresh = schedule.flatMap((_entry, index) => [index, index]);
  return {
    schemaVersion: "1.0",
    ledgerKind: "observed-display-capture",
    ...bindings,
    method: "external-high-speed-capture",
    captureRateMilliHz: 240_000,
    measuredRefreshMilliHz: 60_000,
    minimumConfidenceMillionths: 990_000,
    captureProvenance: bindings.captureProvenance ?? TEST_CAPTURE_PROVENANCE,
    calibration: {
      focusScoreMillionths: 1_000_000,
      regionCoverageMillionths: 1_000_000,
      exposureClippedSamples: 0,
      patches: [
        patch("black", 0, 0, 0), patch("white", 255, 255, 255), patch("red", 255, 0, 0),
        patch("green", 0, 255, 0), patch("blue", 0, 0, 255)
      ]
    },
    samples: contentByRefresh.flatMap((scheduleIndex, refreshOrdinal) => Array.from({ length: 4 }, (_, inRefresh) => {
      const frame = schedule[scheduleIndex]!;
      const captureOrdinal = refreshOrdinal * 4 + inRefresh;
      const capture = displayMarkerFields(500 + refreshOrdinal, TEST_DISPLAY_PATTERN);
      const content = displayMarkerFields(frame.contentOrdinal, TEST_DISPLAY_PATTERN);
      const occurrence = displayMarkerFields(frame.occurrenceOrdinal, TEST_DISPLAY_PATTERN);
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
