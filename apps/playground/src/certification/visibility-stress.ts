import type { AvalElement } from "@pixel-point/aval-element";

export interface VisibilityStressReport {
  readonly status: "passed" | "failed" | "unsupported";
  readonly transitions: number;
  readonly failures: readonly string[];
}

export async function runVisibilityStress(
  element: AvalElement,
  parent: HTMLElement,
  cycles: number
): Promise<VisibilityStressReport> {
  if (!Number.isSafeInteger(cycles) || cycles < 1 || cycles > 100) throw new RangeError("visibility cycles must be in 1..100");
  const failures: string[] = [];
  let transitions = 0;
  for (let index = 0; index < cycles; index += 1) {
    for (const policy of ["reduce", "full"] as const) {
      element.motion = policy;
      await nextFrame();
      transitions += 1;
      const snapshot = element.getDiagnostics();
      if (snapshot.motion.effective !== policy) failures.push(`motion-policy-${policy}-not-applied`);
    }
    element.remove();
    await nextFrame();
    parent.append(element);
    await element.prepare({ timeoutMs: 20_000 });
    transitions += 2;
  }
  return Object.freeze({
    status: failures.length === 0 ? "passed" : "failed",
    transitions,
    failures: Object.freeze(failures)
  });
}

function nextFrame(): Promise<void> { return new Promise((resolve) => requestAnimationFrame(() => resolve())); }
