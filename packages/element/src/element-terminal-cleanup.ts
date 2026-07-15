import type { ElementOwnershipSnapshot } from "./element-ownership-ledger.js";
import type {
  AvalCleanupReceipt,
  AvalElementOwnershipSnapshot,
  AvalTerminalCleanupProof
} from "./public-types.js";

export function publicElementOwnership(
  value: Readonly<ElementOwnershipSnapshot>
): Readonly<AvalElementOwnershipSnapshot> {
  return Object.freeze({ ...value });
}

export function createTerminalCleanupProof(input: Readonly<{
  sourceGeneration: number;
  cleanup: Readonly<AvalCleanupReceipt> | null;
  ownership: Readonly<ElementOwnershipSnapshot>;
  mechanicsCompleted?: boolean;
}>): Readonly<AvalTerminalCleanupProof> {
  const elementOwnership = publicElementOwnership(input.ownership);
  const sourceCleanupCompleted = input.sourceGeneration === 0 || (
    input.cleanup?.sourceGeneration === input.sourceGeneration &&
    input.cleanup.completed
  );
  return Object.freeze({
    completed: input.mechanicsCompleted !== false &&
      sourceCleanupCompleted && elementOwnership.completed &&
      elementOwnership.failedReleaseCount === 0,
    sourceCleanupCompleted,
    elementOwnership
  });
}

export class ElementCleanupIncompleteError extends Error {
  public constructor() {
    super("aval-player element cleanup was incomplete");
    this.name = "OperationError";
  }
}
