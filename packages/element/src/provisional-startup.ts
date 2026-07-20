import {
  retryableCandidateOutcome,
  type ProvisionalCandidateOutcome,
  type RetryableCandidateRejection
} from "./provisional-candidate-outcome.js";

export interface ProvisionalCandidateRetirement {
  readonly retryAllowed: boolean;
}

export interface ProvisionalCandidateOrchestrator<T> {
  next(): Promise<T>;
  qualify(candidate: T): Promise<void>;
  localFailure(candidate: T): unknown;
  retire(candidate: T): Promise<Readonly<ProvisionalCandidateRetirement>>;
  cancelled(): boolean;
  selected(candidate: T): void;
  rejected(candidate: T, rejection: Readonly<RetryableCandidateRejection>): void;
}

/** Owns provisional qualification, retirement, and retry publication ordering. */
export async function orchestrateProvisionalCandidates<T>(
  input: Readonly<ProvisionalCandidateOrchestrator<T>>
): Promise<T> {
  for (;;) {
    const candidate = await input.next();
    const outcome = await qualifyCandidate(input, candidate);
    switch (outcome.kind) {
      case "selected":
        return outcome.value;
      case "retryable-rejection":
        input.rejected(candidate, outcome.rejection);
        break;
      default:
        return unreachableOutcome(outcome);
    }
  }
}

async function qualifyCandidate<T>(
  input: Readonly<ProvisionalCandidateOrchestrator<T>>,
  candidate: T
): Promise<Readonly<ProvisionalCandidateOutcome<T>>> {
  try {
    await input.qualify(candidate);
    input.selected(candidate);
    return Object.freeze({ kind: "selected", value: candidate });
  } catch (error) {
    const localFailure = input.localFailure(candidate) ?? error;
    const retirement = await input.retire(candidate);
    if (input.cancelled() || !retirement.retryAllowed) throw error;
    const outcome = retryableCandidateOutcome(localFailure);
    if (outcome === null) throw error;
    return outcome;
  }
}

function unreachableOutcome(outcome: never): never {
  throw new Error(`unreachable provisional outcome ${String(outcome)}`);
}
