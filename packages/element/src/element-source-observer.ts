import { isLiteralHtmlSource } from "./element-source-candidates.js";

const SOURCE_ATTRIBUTES = Object.freeze(["src", "type", "integrity"] as const);

export interface ElementSourceMutationObserver {
  observe(target: Node, options?: MutationObserverInit): void;
  takeRecords(): MutationRecord[];
  disconnect(): void;
}

export type ElementSourceMutationObserverFactory = (
  callback: MutationCallback
) => ElementSourceMutationObserver;

/** Owns the one connected-realm observer for direct-child source identity. */
export class ElementSourceObserver {
  readonly #host: HTMLElement;
  readonly #changed: () => void;
  readonly #factory: ElementSourceMutationObserverFactory | undefined;
  #observer: ElementSourceMutationObserver | null = null;
  #scheduled = false;
  #token = 0;

  public constructor(input: Readonly<{
    host: HTMLElement;
    changed(): void;
    factory?: ElementSourceMutationObserverFactory;
  }>) {
    this.#host = input.host;
    this.#changed = input.changed;
    this.#factory = input.factory;
  }

  public get active(): boolean { return this.#observer !== null; }

  public connect(): void {
    if (this.#observer !== null) return;
    const factory = this.#factory ?? realmFactory(this.#host);
    if (factory === undefined) return;
    const token = ++this.#token;
    const observer = factory((records) => this.#records(records, token));
    try {
      observer.observe(this.#host, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [...SOURCE_ATTRIBUTES]
      });
    } catch (error) {
      observer.disconnect();
      throw error;
    }
    this.#observer = observer;
  }

  public disconnect(): void {
    this.#token += 1;
    this.#scheduled = false;
    this.#observer?.disconnect();
    this.#observer = null;
  }

  /** Publish source mutations still queued by the realm before a command reads configuration. */
  public flushRecords(): void {
    const observer = this.#observer;
    if (observer === null) return;
    const changed = observer.takeRecords().some((record) =>
      affectsDirectSource(this.#host, record)
    );
    if (!changed && !this.#scheduled) return;
    this.#scheduled = false;
    this.#changed();
  }

  #records(records: readonly MutationRecord[], token: number): void {
    if (
      token !== this.#token ||
      this.#observer === null ||
      this.#scheduled ||
      !records.some((record) => affectsDirectSource(this.#host, record))
    ) return;
    this.#scheduled = true;
    queueMicrotask(() => {
      if (token !== this.#token || this.#observer === null || !this.#scheduled) return;
      this.#scheduled = false;
      this.#changed();
    });
  }
}

function realmFactory(
  host: HTMLElement
): ElementSourceMutationObserverFactory | undefined {
  const Constructor = host.ownerDocument.defaultView?.MutationObserver;
  return Constructor === undefined
    ? undefined
    : (callback) => new Constructor(callback);
}

function affectsDirectSource(host: HTMLElement, record: MutationRecord): boolean {
  if (record.type === "attributes") {
    return record.target.parentNode === host && isLiteralHtmlSource(record.target);
  }
  if (record.type !== "childList" || record.target !== host) return false;
  return nodeListContainsSource(record.addedNodes) ||
    nodeListContainsSource(record.removedNodes);
}

function nodeListContainsSource(nodes: NodeList): boolean {
  for (let index = 0; index < nodes.length; index += 1) {
    if (isLiteralHtmlSource(nodes.item(index))) return true;
  }
  return false;
}
