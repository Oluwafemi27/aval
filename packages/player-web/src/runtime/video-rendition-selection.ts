import type { CertifiedVideoRendition } from "./asset-catalog.js";
import type { DecoderWorkerProbeConfig } from "../decoder-worker/protocol.js";

export type VideoRenditionAttemptOutcome =
  | "resource-ineligible"
  | "decoder-unsupported"
  | "selected";

export interface VideoRenditionSelectionAttempt {
  readonly authoredIndex: number;
  readonly rendition: string;
  readonly outcome: VideoRenditionAttemptOutcome;
}

export type VideoRenditionSelectionResult =
  | {
      readonly outcome: "selected";
      readonly selected: Readonly<CertifiedVideoRendition>;
      readonly attempts: readonly Readonly<VideoRenditionSelectionAttempt>[];
    }
  | {
      /** Deterministic: every rendition was resource-ineligible or unsupported. */
      readonly outcome: "all-unsupported";
      readonly selected: null;
      readonly attempts: readonly Readonly<VideoRenditionSelectionAttempt>[];
    };

export type VideoRenditionResourceEligibility = (
  candidate: Readonly<CertifiedVideoRendition>
) => boolean;

export type ExactVideoDecoderConfigProbe = (
  config: Readonly<DecoderWorkerProbeConfig>,
  candidate: Readonly<CertifiedVideoRendition>
) => Promise<boolean>;

export interface VideoRenditionSelectionInput {
  readonly renditions: readonly Readonly<CertifiedVideoRendition>[];
  readonly isResourceEligible: VideoRenditionResourceEligibility;
  readonly probeDecoderConfig: ExactVideoDecoderConfigProbe;
}

/** Probe one catalog-certified authored ladder without cloning or re-ranking it. */
export async function selectVideoRendition(
  input: Readonly<VideoRenditionSelectionInput>
): Promise<Readonly<VideoRenditionSelectionResult>> {
  const attempts: VideoRenditionSelectionAttempt[] = [];
  for (const candidate of input.renditions) {
    const resourceEligible = input.isResourceEligible(candidate);
    if (typeof resourceEligible !== "boolean") {
      invalid("resource eligibility predicate must return a boolean");
    }
    if (!resourceEligible) {
      attempts.push(createAttempt(candidate, "resource-ineligible"));
      continue;
    }

    const supported = await input.probeDecoderConfig(
      candidate.decoderConfig,
      candidate
    );
    if (typeof supported !== "boolean") {
      invalid("decoder configuration probe must resolve to a boolean");
    }
    if (!supported) {
      attempts.push(createAttempt(candidate, "decoder-unsupported"));
      continue;
    }

    attempts.push(createAttempt(candidate, "selected"));
    return Object.freeze({
      outcome: "selected" as const,
      selected: candidate,
      attempts: Object.freeze(attempts)
    });
  }

  return Object.freeze({
    outcome: "all-unsupported" as const,
    selected: null,
    attempts: Object.freeze(attempts)
  });
}

function createAttempt(
  candidate: Readonly<CertifiedVideoRendition>,
  outcome: VideoRenditionAttemptOutcome
): Readonly<VideoRenditionSelectionAttempt> {
  return Object.freeze({
    authoredIndex: candidate.authoredIndex,
    rendition: candidate.rendition.id,
    outcome
  });
}

function invalid(message: string): never {
  throw new TypeError(`video rendition selection: ${message}`);
}
