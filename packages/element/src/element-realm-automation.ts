import type {
  ElementOwnershipHandle,
  ElementOwnershipLedger
} from "./element-ownership-ledger.js";
import { retryHostInstallationCleanup } from "./element-host-installation-error.js";
import type { AvalMotion } from "./public-types.js";
import { nextElementSequence } from "./element-sequence.js";
import { subscribeDocumentVisibility } from "./document-visibility-broker.js";
import { subscribeDpr } from "./dpr-broker.js";
import { subscribeMotionPreference } from "./motion-preference-broker.js";
import {
  PresentationObserver,
  type PresentationBox
} from "./presentation-observer.js";

export interface ElementRealmChange {
  readonly rootChanged: boolean;
  readonly documentChanged: boolean;
}

interface BrokerOwner<Subscription extends { release(): boolean }> {
  readonly subscription: Readonly<Subscription>;
  readonly ownership: ElementOwnershipHandle;
}

interface ObserverOwner<Observer extends { disconnect(): void }> {
  readonly observer: Observer;
  readonly ownership: ElementOwnershipHandle;
}

/** Owns every document/window/root-bound observer and subscription. */
export class ElementRealmAutomation {
  readonly #host: HTMLElement;
  readonly #ledger: ElementOwnershipLedger;
  readonly #onDocumentVisible: (visible: boolean, restored: boolean) => void;
  readonly #onIntersection: (intersecting: boolean) => void;
  readonly #onObserverSupported: (supported: boolean) => void;
  readonly #onBox: (box: Readonly<PresentationBox>) => void;
  readonly #onDpr: (value: number) => void;
  readonly #onHostReduced: (value: boolean | null) => void;
  readonly #onUnsupported: () => void;
  #root: Node | null = null;
  #document: Document | null = null;
  #motion: AvalMotion = "auto";
  #motionOwner: BrokerOwner<{
    supported: boolean;
    current: boolean | null;
    release(): boolean;
  }> | null = null;
  #documentOwner: BrokerOwner<{
    current: Readonly<{ visible: boolean; restored: boolean }>;
    release(): boolean;
  }> | null = null;
  #dprOwner: BrokerOwner<{ current: number; release(): boolean }> | null = null;
  #intersectionOwner: ObserverOwner<IntersectionObserver> | null = null;
  #presentationObserver: PresentationObserver | null = null;
  #active = false;
  #disposed = false;
  #realmToken = 0;
  #motionToken = 0;

  public constructor(input: Readonly<{
    host: HTMLElement;
    ledger: ElementOwnershipLedger;
    onDocumentVisible(visible: boolean, restored: boolean): void;
    onIntersection(intersecting: boolean): void;
    onObserverSupported(supported: boolean): void;
    onBox(box: Readonly<PresentationBox>): void;
    onDpr(value: number): void;
    onHostReduced(value: boolean | null): void;
    onUnsupported(): void;
  }>) {
    this.#host = input.host;
    this.#ledger = input.ledger;
    this.#onDocumentVisible = input.onDocumentVisible;
    this.#onIntersection = input.onIntersection;
    this.#onObserverSupported = input.onObserverSupported;
    this.#onBox = input.onBox;
    this.#onDpr = input.onDpr;
    this.#onHostReduced = input.onHostReduced;
    this.#onUnsupported = input.onUnsupported;
  }

  public enterCurrentRealm(): Readonly<ElementRealmChange> {
    const root = this.#host.getRootNode();
    const document = this.#host.ownerDocument;
    const change = Object.freeze({
      rootChanged: this.#root !== null && this.#root !== root,
      documentChanged: this.#document !== null && this.#document !== document
    });
    this.#root = root;
    this.#document = document;
    return change;
  }

  public configureMotion(value: AvalMotion): boolean {
    this.#motion = value;
    const token = this.#motionToken = nextElementSequence(
      this.#motionToken,
      "motion subscription"
    );
    const previous = this.#motionOwner;
    this.#motionOwner = null;
    let complete = this.#releaseBroker(previous);
    const view = this.#host.ownerDocument.defaultView;
    if (!this.#active || value !== "auto" || view === null) {
      this.#publishMotion(token, value === "reduce");
      return complete;
    }
    let acquiredMotion: ElementOwnershipHandle | null = null;
    try {
      const ownership = acquiredMotion = this.#ledger.acquire("broker");
      const subscription = subscribeMotionPreference(view, (reduced) => {
        this.#publishMotion(token, reduced);
      });
      const owner: BrokerOwner<typeof subscription> = {
        subscription,
        ownership
      };
      if (!this.#active || token !== this.#motionToken) {
        complete = this.#releaseBroker(owner) && complete;
        return complete;
      }
      this.#motionOwner = owner;
      this.#publishMotion(token, subscription.current);
      if (!subscription.supported) this.#safe(this.#onUnsupported);
    } catch (error) {
      complete = this.#retainFailedInstallation(acquiredMotion, error) && complete;
      this.#publishMotion(token, null);
      this.#safe(this.#onUnsupported);
    }
    return complete;
  }

  public start(): void {
    if (this.#disposed || this.#active) return;
    this.#ledger.retryAll();
    const document = this.#host.ownerDocument;
    const view = document.defaultView;
    if (view === null) {
      this.#safe(this.#onUnsupported);
      return;
    }
    this.#active = true;
    const token = this.#realmToken = nextElementSequence(
      this.#realmToken,
      "realm automation"
    );
    this.#safe(() => this.#onObserverSupported(true));
    let acquiredDocument: ElementOwnershipHandle | null = null;
    try {
      const ownership = acquiredDocument = this.#ledger.acquire("broker");
      const subscription = subscribeDocumentVisibility(document, (sample) => {
        if (this.#currentRealm(token)) {
          this.#safe(() => this.#onDocumentVisible(sample.visible, sample.restored));
        }
      });
      this.#documentOwner = {
        subscription,
        ownership
      };
      this.#safe(() => this.#onDocumentVisible(
        subscription.current.visible,
        subscription.current.restored
      ));
    } catch (error) {
      this.#retainFailedInstallation(acquiredDocument, error);
      this.#safe(this.#onUnsupported);
    }
    if (typeof view.IntersectionObserver === "function") {
      let owner: ObserverOwner<IntersectionObserver> | null = null;
      let ownership: ElementOwnershipHandle | null = null;
      try {
        ownership = this.#ledger.acquire("observer");
        const observer = new view.IntersectionObserver((entries) => {
          if (!this.#currentRealm(token)) return;
          for (const entry of entries) {
            if (entry.target === this.#host) {
              this.#safe(() => this.#onIntersection(
                entry.isIntersecting && entry.intersectionRatio > 0
              ));
            }
          }
        });
        owner = { observer, ownership };
        observer.observe(this.#host);
        this.#intersectionOwner = owner;
      } catch {
        if (owner === null) ownership?.complete();
        else this.#releaseObserver(owner);
        this.#safe(() => this.#onObserverSupported(false));
        this.#safe(this.#onUnsupported);
      }
    } else {
      this.#safe(() => this.#onObserverSupported(false));
      this.#safe(this.#onUnsupported);
    }
    if (typeof view.ResizeObserver === "function") {
      try {
        this.#presentationObserver = new PresentationObserver({
          target: this.#host,
          ledger: this.#ledger,
          createObserver: (callback) => new view.ResizeObserver(callback),
          requestFrame: (callback) => view.requestAnimationFrame(callback),
          cancelFrame: (handle) => view.cancelAnimationFrame(handle),
          onBox: (box) => {
            if (this.#currentRealm(token)) this.#safe(() => this.#onBox(box));
          }
        });
      } catch {
        this.#safe(() => this.#onBox(Object.freeze({ width: 0, height: 0 })));
        this.#safe(this.#onUnsupported);
      }
    } else {
      this.#safe(() => this.#onBox(Object.freeze({ width: 0, height: 0 })));
      this.#safe(this.#onUnsupported);
    }
    let acquiredDpr: ElementOwnershipHandle | null = null;
    try {
      const ownership = acquiredDpr = this.#ledger.acquire("broker");
      const subscription = subscribeDpr(view, (value) => {
        if (this.#currentRealm(token)) this.#safe(() => this.#onDpr(value));
      });
      this.#dprOwner = {
        subscription,
        ownership
      };
      this.#safe(() => this.#onDpr(subscription.current));
    } catch (error) {
      this.#retainFailedInstallation(acquiredDpr, error);
      this.#safe(this.#onUnsupported);
    }
    this.configureMotion(this.#motion);
  }

  public stop(): boolean {
    if (!this.#active) return this.#ledger.retryAll();
    // Invalidate every old callback before the first physical release attempt.
    this.#active = false;
    this.#realmToken = nextElementSequence(this.#realmToken, "realm automation");
    this.#motionToken = nextElementSequence(this.#motionToken, "motion subscription");
    const motion = this.#motionOwner;
    this.#motionOwner = null;
    const document = this.#documentOwner;
    this.#documentOwner = null;
    const dpr = this.#dprOwner;
    this.#dprOwner = null;
    const intersection = this.#intersectionOwner;
    this.#intersectionOwner = null;
    const presentation = this.#presentationObserver;
    this.#presentationObserver = null;
    let complete = this.#releaseBroker(motion);
    complete = this.#releaseBroker(document) && complete;
    complete = this.#releaseBroker(dpr) && complete;
    complete = this.#releaseObserver(intersection) && complete;
    complete = (presentation?.dispose() ?? true) && complete;
    this.#safe(() => this.#onIntersection(false));
    this.#safe(() => this.#onBox(Object.freeze({ width: 0, height: 0 })));
    return complete;
  }

  public dispose(): boolean {
    let complete = true;
    try { complete = this.stop(); }
    catch { complete = false; }
    this.#disposed = true;
    this.#root = null;
    this.#document = null;
    try { complete = this.#ledger.retryAll() && complete; }
    catch { complete = false; }
    return complete;
  }

  #releaseBroker<Subscription extends { release(): boolean }>(
    owner: BrokerOwner<Subscription> | null
  ): boolean {
    if (owner === null) return true;
    return owner.ownership.release(() => {
      if (!owner.subscription.release()) {
        throw new Error("element broker release is incomplete");
      }
    });
  }

  #releaseObserver<Observer extends { disconnect(): void }>(
    owner: ObserverOwner<Observer> | null
  ): boolean {
    if (owner === null) return true;
    return owner.ownership.release(() => owner.observer.disconnect());
  }

  #retainFailedInstallation(
    ownership: ElementOwnershipHandle | null,
    error: unknown
  ): boolean {
    if (ownership === null) return true;
    const cleanup = retryHostInstallationCleanup(error);
    if (cleanup === null) {
      ownership.complete();
      return true;
    }
    if (cleanup) {
      ownership.complete();
      return true;
    }
    return ownership.release(() => {
      if (retryHostInstallationCleanup(error) !== true) {
        throw new Error("element host installation cleanup is incomplete");
      }
    });
  }

  #currentRealm(token: number): boolean {
    return this.#active && !this.#disposed && token === this.#realmToken;
  }

  #publishMotion(token: number, value: boolean | null): void {
    if (this.#disposed || token !== this.#motionToken) return;
    this.#safe(() => this.#onHostReduced(value));
  }

  #safe(operation: () => void): void {
    try { operation(); } catch { /* publication consumers cannot break ownership */ }
  }
}
