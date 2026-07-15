import type { AvalCleanupReceipt } from "./public-types.js";
import { normalizePublicFailure } from "./public-failure.js";
import type { ElementPublicEvents } from "./element-public-events.js";
import type { ElementPublicState } from "./element-public-state.js";
import type { ShadowLayerOwner } from "./shadow-layers.js";

/** Public failure normalization plus retained terminal cleanup evidence. */
export class ElementFailures {
  readonly #events: ElementPublicEvents;
  readonly #state: ElementPublicState;
  readonly #layers: ShadowLayerOwner;
  readonly #context: () => Readonly<{
    terminal: boolean;
    connected: boolean;
    activeSource: boolean;
    sourceGeneration: number;
  }>;
  #cleanup: Readonly<AvalCleanupReceipt> | null = null;

  public constructor(input: Readonly<{
    events: ElementPublicEvents;
    state: ElementPublicState;
    layers: ShadowLayerOwner;
    context(): Readonly<{
      terminal: boolean;
      connected: boolean;
      activeSource: boolean;
      sourceGeneration: number;
    }>;
  }>) {
    this.#events = input.events;
    this.#state = input.state;
    this.#layers = input.layers;
    this.#context = input.context;
  }

  public get cleanup(): Readonly<AvalCleanupReceipt> | null {
    return this.#cleanup;
  }

  public recordCleanup(receipt: Readonly<AvalCleanupReceipt>): void {
    if (
      this.#cleanup === null ||
      receipt.sourceGeneration >= this.#cleanup.sourceGeneration
    ) this.#cleanup = receipt;
  }

  public report(error: unknown, fatal: boolean): void {
    const failure = normalizePublicFailure(error);
    const context = this.#context();
    if (failure.code === "abort") return;
    if (
      failure.code === "disposed" &&
      (!fatal || context.terminal || !context.connected || !context.activeSource)
    ) return;
    if (
      !fatal &&
      this.#state.readiness === "error" &&
      this.#state.lastFailure?.code === failure.code
    ) return;
    this.#state.setFailure(failure);
    if (fatal) {
      this.#state.markFatal();
      if (context.sourceGeneration > 0) {
        try { this.#layers.showFallbackAfterFatal(context.sourceGeneration); }
        catch { /* source was synchronously invalidated */ }
      }
    }
    this.#events.dispatch(this.#events.create("error", Object.freeze({
      generation: Math.max(1, context.sourceGeneration),
      failure,
      fatal
    })));
  }
}
