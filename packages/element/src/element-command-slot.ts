import { avalAbortError } from "./errors.js";
import type {
  ElementOwnershipHandle,
  ElementOwnershipLedger
} from "./element-ownership-ledger.js";

interface CommandEntry<Key> {
  readonly key: Key;
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
  readonly ownership: ElementOwnershipHandle | null;
  started: boolean;
}

export interface ElementCommandRequest<Key> {
  readonly key: Key;
  readonly promise: Promise<void>;
  readonly joined: boolean;
  readonly accepted: boolean;
}

/** One exact public command, with duplicate join and distinct supersession. */
export class ElementCommandSlot<Key> {
  readonly #equal: (left: Key, right: Key) => boolean;
  readonly #identityEqual: (left: Key, right: Key) => boolean;
  readonly #ledger: ElementOwnershipLedger | null;
  #entry: CommandEntry<Key> | null = null;

  public constructor(
    equal: (left: Key, right: Key) => boolean,
    ledger: ElementOwnershipLedger | null = null,
    identityEqual: (left: Key, right: Key) => boolean = equal
  ) {
    this.#equal = equal;
    this.#identityEqual = identityEqual;
    this.#ledger = ledger;
  }

  public get pending(): number { return this.#entry === null ? 0 : 1; }

  public request(key: Key): Readonly<ElementCommandRequest<Key>> {
    const current = this.#entry;
    if (current !== null && this.#equal(current.key, key)) {
      return Object.freeze({
        key: current.key,
        promise: current.promise,
        joined: true,
        accepted: true
      });
    }
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    let ownership = current?.ownership ?? null;
    if (current === null) {
      try { ownership = this.#ledger?.acquire("command") ?? null; }
      catch (error) {
        const rejected = Promise.reject<void>(error);
        void rejected.catch(() => undefined);
        return Object.freeze({ key, promise: rejected, joined: false, accepted: false });
      }
    }
    this.#entry = {
      key,
      promise,
      resolve,
      reject,
      ownership,
      started: false
    };
    if (current !== null) {
      current.reject(avalAbortError("element command was superseded"));
    }
    void promise.catch(() => undefined);
    return Object.freeze({ key, promise, joined: false, accepted: true });
  }

  public current(): Readonly<{ key: Key; started: boolean }> | null {
    const entry = this.#entry;
    return entry === null
      ? null
      : Object.freeze({ key: entry.key, started: entry.started });
  }

  public start(key: Key): boolean {
    const entry = this.#entry;
    if (entry === null || !this.#identityEqual(entry.key, key) || entry.started) return false;
    entry.started = true;
    return true;
  }

  public resolve(key: Key): void {
    const entry = this.#take(key);
    entry?.resolve();
  }

  public reject(key: Key, error: unknown): void {
    const entry = this.#take(key);
    entry?.reject(error);
  }

  public abort(): void {
    const entry = this.#entry;
    this.#entry = null;
    entry?.ownership?.complete();
    entry?.reject(avalAbortError("element command was invalidated"));
  }

  #take(key: Key): CommandEntry<Key> | null {
    const entry = this.#entry;
    if (entry === null || !this.#identityEqual(entry.key, key)) return null;
    this.#entry = null;
    entry.ownership?.complete();
    return entry;
  }
}
