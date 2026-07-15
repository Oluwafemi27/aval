import type { AvalElement } from "@pixel-point/aval-element";

import { createPublicMotionElement, retirePublicMotion } from "./public-element-host.js";

export const LOCAL_NETWORK_FAULTS = Object.freeze([
  "ignored-initial-range", "no-validator", "weak-etag", "changed-etag",
  "wrong-total", "truncated-body", "oversized-body", "compressed-body",
  "stalled-body", "corrupt-unit", "corrupt-bootstrap-unit", "nonzero-padding",
  "valid-external-integrity", "invalid-external-integrity"
] as const);

export interface NetworkFaultResult {
  readonly scenario: typeof LOCAL_NETWORK_FAULTS[number];
  readonly status: "passed" | "failed" | "inconclusive";
  readonly terminalReadiness: string;
  readonly usablePresentationPreserved: boolean;
  readonly outstandingSettled: boolean;
  readonly failureCode: string | null;
}

export async function runNetworkFaultStress(options: Readonly<{
  parent: HTMLElement;
  scenarios: readonly typeof LOCAL_NETWORK_FAULTS[number][];
  timeoutMs: number;
}>): Promise<readonly Readonly<NetworkFaultResult>[]> {
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 100 || options.timeoutMs > 30_000) throw new RangeError("network fault timeout is invalid");
  if (options.scenarios.length < 1 || options.scenarios.length > LOCAL_NETWORK_FAULTS.length) throw new RangeError("network fault scenario count is invalid");
  const unique = new Set(options.scenarios);
  if (unique.size !== options.scenarios.length || [...unique].some((id) => !LOCAL_NETWORK_FAULTS.includes(id))) throw new TypeError("network fault scenarios are invalid");
  const results: NetworkFaultResult[] = [];
  for (const [index, scenario] of options.scenarios.entries()) {
    const element = createPublicMotionElement(
      `/__m7__/asset?session=m9-fault-${String(index)}&scenario=${scenario}`,
      options.parent
    );
    const outcome = await boundedPrepare(element, options.timeoutMs);
    const before = element.getDiagnostics();
    const terminal = await retirePublicMotion(element).catch(() => null);
    const settled = terminal !== null && Object.values(terminal.outstanding).every((value) => value === 0);
    const expectedUsable = scenario === "ignored-initial-range" || scenario === "no-validator" || scenario === "weak-etag" || scenario === "valid-external-integrity";
    const usablePresentationPreserved = before.readiness === "staticReady" || before.readiness === "interactiveReady" || before.readiness === "error";
    const passed = settled && usablePresentationPreserved && (expectedUsable ? outcome === "ready" : outcome !== "ready" || before.mode === "static");
    results.push(Object.freeze({
      scenario,
      status: outcome === "timeout" ? "inconclusive" : passed ? "passed" : "failed",
      terminalReadiness: before.readiness,
      usablePresentationPreserved,
      outstandingSettled: settled,
      failureCode: before.lastFailure?.code ?? null
    }));
  }
  return Object.freeze(results);
}

async function boundedPrepare(element: AvalElement, timeoutMs: number): Promise<"ready" | "rejected" | "timeout"> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await element.prepare({ signal: controller.signal, timeoutMs });
    return "ready";
  } catch {
    return controller.signal.aborted ? "timeout" : "rejected";
  } finally {
    clearTimeout(timeout);
  }
}
