import type { AvalElement } from "@pixel-point/aval-element";

export interface ContextStressReport {
  readonly status: "passed" | "failed" | "unsupported";
  readonly requestedLosses: number;
  readonly observedLosses: number;
  readonly observedRecoveries: number;
  readonly failures: readonly string[];
}

export async function runContextStress(
  element: AvalElement,
  losses: number
): Promise<ContextStressReport> {
  if (!Number.isSafeInteger(losses) || losses < 1 || losses > 100) throw new RangeError("context losses must be in 1..100");
  const canvas = element.shadowRoot?.querySelector<HTMLCanvasElement>("canvas");
  const context = canvas?.getContext("webgl2");
  const extension = context?.getExtension("WEBGL_lose_context");
  if (context === null || context === undefined || extension === null || extension === undefined) {
    return Object.freeze({ status: "unsupported", requestedLosses: losses, observedLosses: 0, observedRecoveries: 0, failures: Object.freeze([]) });
  }
  const baseline = element.getDiagnostics();
  const failures: string[] = [];
  for (let index = 0; index < losses; index += 1) {
    extension.loseContext();
    await waitUntil(() => element.getDiagnostics().runtime.contextLossCount > baseline.runtime.contextLossCount + index, 5_000)
      .catch(() => failures.push(`context-loss-${String(index)}-not-observed`));
    extension.restoreContext();
    await waitUntil(() => element.getDiagnostics().runtime.contextRecoveryCount > baseline.runtime.contextRecoveryCount + index, 10_000)
      .catch(() => failures.push(`context-recovery-${String(index)}-not-observed`));
  }
  const terminal = element.getDiagnostics();
  return Object.freeze({
    status: failures.length === 0 ? "passed" : "failed",
    requestedLosses: losses,
    observedLosses: terminal.runtime.contextLossCount - baseline.runtime.contextLossCount,
    observedRecoveries: terminal.runtime.contextRecoveryCount - baseline.runtime.contextRecoveryCount,
    failures: Object.freeze(failures)
  });
}

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!predicate()) {
    if (performance.now() >= deadline) throw new Error("context transition timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
