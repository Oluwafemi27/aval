import type {
  BindingV01,
  RuntimeReadiness,
  RuntimeReadinessResult,
  StaticReason
} from "@aval/player-web";

import type {
  ElementAssetGeneration,
  ElementAssetGenerationHost
} from "./asset-generation.js";
import type { BrowserRuntimeMetadata } from "./browser-runtime-factory.js";
import type { ElementFailures } from "./element-failures.js";
import type { ElementPublicEvents } from "./element-public-events.js";
import type { ElementPublicState } from "./element-public-state.js";
import type { AvalCleanupReceipt } from "./public-types.js";

/** Narrow publication surface implemented by the sole element actor. */
export interface ElementAssetPublicationAuthority {
  isAssetCurrent(asset: ElementAssetGeneration): boolean;
  assetReadiness(value: RuntimeReadiness, reason: StaticReason | null): void;
  assetFallback(asset: ElementAssetGeneration, reason: StaticReason): void;
  assetMetadata(asset: ElementAssetGeneration, metadata: Readonly<BrowserRuntimeMetadata>): void;
  assetPrepared(asset: ElementAssetGeneration, result: Readonly<RuntimeReadinessResult>): void;
  assetFailure(asset: ElementAssetGeneration, error: unknown, fatal: boolean): void;
  assetUnderflow(asset: ElementAssetGeneration, count: number): void;
}

/** Generation-scoped event bridge; stale generations become inert. */
export class ElementGenerationPublication implements ElementAssetGenerationHost {
  public readonly eventTarget: EventTarget;
  public readonly eventStage;
  readonly #events: ElementPublicEvents;
  readonly #state: ElementPublicState;
  readonly #failures: ElementFailures;
  readonly #authority: ElementAssetPublicationAuthority;
  #asset: ElementAssetGeneration | null = null;

  public constructor(input: Readonly<{
    host: HTMLElement;
    events: ElementPublicEvents;
    state: ElementPublicState;
    failures: ElementFailures;
    authority: ElementAssetPublicationAuthority;
  }>) {
    this.eventTarget = input.host;
    this.#events = input.events;
    this.#state = input.state;
    this.#failures = input.failures;
    this.#authority = input.authority;
    this.eventStage = Object.freeze({
      readiness: (value: RuntimeReadiness, reason: StaticReason | null) => {
        if (this.#current()) this.#authority.assetReadiness(value, reason);
      },
      requestedState: (value: string) => {
        if (this.#current()) this.#state.setRequestedState(value);
      },
      visualState: (value: string) => {
        if (this.#current()) this.#state.setVisualState(value);
      },
      transitioning: (value: boolean) => {
        if (this.#current()) this.#state.setTransitioning(value);
      },
      fallback: (reason: StaticReason) => {
        const asset = this.#asset;
        if (asset !== null && this.#authority.isAssetCurrent(asset)) {
          this.#state.fallback(reason);
          this.#authority.assetFallback(asset, reason);
        }
      },
      transaction: (active: boolean) => this.#events.transaction(active),
      snapshot: () => Object.freeze({
        requestedState: this.#state.requestedState,
        visualState: this.#state.visualState
      })
    });
  }

  public bind(asset: ElementAssetGeneration): void {
    if (this.#asset !== null) throw new Error("generation publication is already bound");
    this.#asset = asset;
  }

  public readonly createEvent = <T>(
    type: string,
    detail: Readonly<T>
  ): CustomEvent<T> => this.#events.create(type, detail);

  public metadata(metadata: Readonly<BrowserRuntimeMetadata>): void {
    const asset = this.#asset;
    if (asset !== null && this.#authority.isAssetCurrent(asset)) {
      this.#authority.assetMetadata(asset, metadata);
    }
  }

  public prepared(result: Readonly<RuntimeReadinessResult>): void {
    const asset = this.#asset;
    if (asset !== null && this.#authority.isAssetCurrent(asset)) {
      this.#authority.assetPrepared(asset, result);
    }
  }

  public failure(error: unknown, fatal: boolean): void {
    const asset = this.#asset;
    if (asset !== null) this.#authority.assetFailure(asset, error, fatal);
  }

  public underflow(count: number): void {
    const asset = this.#asset;
    if (asset !== null) this.#authority.assetUnderflow(asset, count);
  }

  public cleanup(receipt: Readonly<AvalCleanupReceipt>): void {
    this.#failures.recordCleanup(receipt);
  }

  #current(): boolean {
    return this.#asset !== null && this.#authority.isAssetCurrent(this.#asset);
  }
}

export type ElementSourceMetadata = Readonly<{
  initialState: string;
  stateNames: readonly string[];
  eventNames: readonly string[];
  bindings: readonly Readonly<BindingV01>[];
  canvas: Readonly<{
    width: number;
    height: number;
    pixelAspect: readonly [number, number];
  }>;
}>;
