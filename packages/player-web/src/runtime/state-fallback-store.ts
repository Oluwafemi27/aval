import { RuntimeAssetCatalog } from "./asset-catalog.js";
import type { IntegratedFallbackStore } from "./integrated-player-contracts.js";

export interface StateFallbackStoreOptions {
  readonly coverFallback: () => void;
  readonly revealAnimated: () => void;
}

/**
 * Tracks the logical fallback state without owning media bytes or pixels.
 * Hosts decide how to represent fallback, normally through the element's
 * external `slot="fallback"` content.
 */
export class StateFallbackStore implements IntegratedFallbackStore {
  readonly #catalog: RuntimeAssetCatalog;
  readonly #coverFallback: () => void;
  readonly #revealAnimated: () => void;
  #state: string | null = null;
  #disposed = false;

  public constructor(
    catalog: RuntimeAssetCatalog,
    options: Readonly<StateFallbackStoreOptions>
  ) {
    if (!(catalog instanceof RuntimeAssetCatalog) || catalog.disposed) {
      throw new TypeError("state fallback store requires an active catalog");
    }
    if (
      options === null ||
      typeof options !== "object" ||
      typeof options.coverFallback !== "function" ||
      typeof options.revealAnimated !== "function"
    ) {
      throw new TypeError("state fallback store options are invalid");
    }
    this.#catalog = catalog;
    this.#coverFallback = options.coverFallback;
    this.#revealAnimated = options.revealAnimated;
  }

  public async installInitial(options: Readonly<{
    readonly state: string;
    readonly signal: AbortSignal;
  }>): Promise<void> {
    this.#assertActive();
    throwIfAborted(options.signal);
    this.#catalog.states.require(options.state);
    this.#state = options.state;
    this.#coverFallback();
    throwIfAborted(options.signal);
  }

  public async validateAll(options: Readonly<{
    readonly signal: AbortSignal;
  }>): Promise<void> {
    this.#assertActive();
    throwIfAborted(options.signal);
  }

  public async presentState(
    state: string,
    options: Readonly<{
      readonly signal: AbortSignal;
      readonly cover?: boolean;
    }>
  ): Promise<void> {
    this.#assertActive();
    throwIfAborted(options.signal);
    this.#catalog.states.require(state);
    this.#state = state;
    if (options.cover !== false) this.#coverFallback();
    throwIfAborted(options.signal);
  }

  public currentState(): string | null {
    return this.#state;
  }

  public coverCurrent(): void {
    this.#assertActive();
    this.#coverFallback();
  }

  public revealAnimated(): void {
    this.#assertActive();
    this.#revealAnimated();
  }

  public settled(): Promise<void> {
    return Promise.resolve();
  }

  public dispose(): void {
    this.#disposed = true;
    this.#state = null;
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw new DOMException("state fallback store is disposed", "AbortError");
    }
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason instanceof DOMException
    ? signal.reason
    : new DOMException("state fallback operation was aborted", "AbortError");
}
