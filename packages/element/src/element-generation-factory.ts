import {
  ElementAssetGeneration,
  type ElementBrowserRuntimeFactory
} from "./asset-generation.js";
import type { ElementConfiguration } from "./element-configuration.js";
import type { ElementDesiredSnapshot } from "./element-desired-state.js";
import type { ElementFailures } from "./element-failures.js";
import {
  ElementGenerationPublication,
  type ElementAssetPublicationAuthority
} from "./element-generation-publication.js";
import type { ElementOwnershipLedger } from "./element-ownership-ledger.js";
import type { ElementPublicEvents } from "./element-public-events.js";
import type { ElementPublicState } from "./element-public-state.js";
import type { ElementTrace } from "./element-trace.js";
import type { ShadowLayerOwner } from "./shadow-layers.js";

export interface ElementCapturedSource {
  readonly desired: Readonly<ElementDesiredSnapshot>;
  readonly configuration: Readonly<ElementConfiguration>;
  readonly document: Document;
  readonly window: Window;
}

export interface ElementAutomaticPrepareAuthority {
  automaticPrepareStarted(asset: ElementAssetGeneration): void;
  automaticPrepareReady(asset: ElementAssetGeneration): void;
}

/** Constructs one generation; it owns no source identity, controller, or queue. */
export class ElementGenerationFactory {
  readonly #host: HTMLElement;
  readonly #layers: ShadowLayerOwner;
  readonly #events: ElementPublicEvents;
  readonly #state: ElementPublicState;
  readonly #failures: ElementFailures;
  readonly #ledger: ElementOwnershipLedger;
  readonly #trace: ElementTrace;
  readonly #publicationAuthority: ElementAssetPublicationAuthority;
  readonly #prepareAuthority: ElementAutomaticPrepareAuthority;
  readonly #factory: ElementBrowserRuntimeFactory | undefined;

  public constructor(input: Readonly<{
    host: HTMLElement;
    layers: ShadowLayerOwner;
    events: ElementPublicEvents;
    state: ElementPublicState;
    failures: ElementFailures;
    ledger: ElementOwnershipLedger;
    trace: ElementTrace;
    publicationAuthority: ElementAssetPublicationAuthority;
    prepareAuthority: ElementAutomaticPrepareAuthority;
    factory?: ElementBrowserRuntimeFactory;
  }>) {
    this.#host = input.host;
    this.#layers = input.layers;
    this.#events = input.events;
    this.#state = input.state;
    this.#failures = input.failures;
    this.#ledger = input.ledger;
    this.#trace = input.trace;
    this.#publicationAuthority = input.publicationAuthority;
    this.#prepareAuthority = input.prepareAuthority;
    this.#factory = input.factory;
  }

  public create(
    generation: number,
    captured: Readonly<ElementCapturedSource>
  ): ElementAssetGeneration {
    const ownership = this.#ledger.acquire("command");
    try {
      this.#layers.resetSource(generation);
      const publication = new ElementGenerationPublication({
        host: this.#host,
        events: this.#events,
        state: this.#state,
        failures: this.#failures,
        authority: this.#publicationAuthority
      });
      const asset = new ElementAssetGeneration({
        window: captured.window,
        document: captured.document,
        layers: this.#layers,
        elementGeneration: 1,
        generation,
        source: captured.configuration.src,
        integrity: captured.configuration.integrity,
        credentials: captured.configuration.crossOrigin === "use-credentials"
          ? "include"
          : "same-origin",
        motionPolicy: captured.configuration.motion,
        hostReducedMotion: captured.desired.hostReducedMotion ?? false,
        initialVisibility: captured.desired.effectivelyVisible ? "visible" : "hidden",
        initialPresentation: captured.desired.positiveBox
          ? Object.freeze({
              cssWidth: captured.desired.box.width,
              cssHeight: captured.desired.box.height,
              devicePixelRatio: captured.desired.dpr,
              ...(captured.configuration.fit === null
                ? {}
                : { fit: captured.configuration.fit })
            })
          : Object.freeze({
              cssWidth: 1,
              cssHeight: 1,
              devicePixelRatio: 1,
              ...(captured.configuration.fit === null
                ? {}
                : { fit: captured.configuration.fit })
            }),
        ...(this.#factory === undefined ? {} : { factory: this.#factory }),
        host: publication
      });
      publication.bind(asset);
      this.#trace.record("source-start", generation);
      queueMicrotask(() => this.#automaticPrepare(asset, ownership));
      return asset;
    } catch (error) {
      ownership.complete();
      throw error;
    }
  }

  #automaticPrepare(
    asset: ElementAssetGeneration,
    ownership: ReturnType<ElementOwnershipLedger["acquire"]>
  ): void {
    if (!this.#publicationAuthority.isAssetCurrent(asset)) {
      ownership.complete();
      return;
    }
    this.#prepareAuthority.automaticPrepareStarted(asset);
    void asset.prepare().then(
      () => this.#prepareAuthority.automaticPrepareReady(asset),
      () => undefined
    ).finally(() => ownership.complete());
  }
}
