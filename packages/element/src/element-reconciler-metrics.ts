import { addElementCount, nextElementSequence } from "./element-sequence.js";
import type { AvalDiagnosticsCounters } from "./public-types.js";

export type ElementCounterName = keyof AvalDiagnosticsCounters;
export type ElementGenerationName = "input" | "motion" | "visibility" | "resize";

export class ElementReconcilerMetrics {
  readonly #counters: Record<ElementCounterName, number> = {
    prepare: 0,
    sourceReplacement: 0,
    pause: 0,
    resume: 0,
    underflow: 0,
    fallback: 0,
    contextRecovery: 0,
    cleanup: 0
  };
  readonly #generations: Record<ElementGenerationName, number> = {
    input: 0,
    motion: 0,
    visibility: 0,
    resize: 0
  };

  public add(name: ElementCounterName, delta = 1): void {
    this.#counters[name] = addElementCount(this.#counters[name], delta, name);
  }

  public next(name: ElementGenerationName): void {
    this.#generations[name] = nextElementSequence(
      this.#generations[name],
      `${name} generation`
    );
  }

  public counters(): Readonly<AvalDiagnosticsCounters> {
    return this.#counters;
  }

  public generation(name: ElementGenerationName): number {
    return this.#generations[name];
  }
}
