import { describe, expect, it } from "vitest";

import { AutomaticInputs } from "../src/automatic-inputs.js";
import { ElementOwnershipLedger } from "../src/element-ownership-ledger.js";

describe("AutomaticInputs", () => {
  it("samples in canonical order, retains OR engagement, and detaches exactly", () => {
    const sources: string[] = [];
    const target = new FakeElement();
    const ledger = new ElementOwnershipLedger();
    const inputs = new AutomaticInputs((source) => sources.push(source), ledger);
    inputs.setTarget(target as unknown as Element);
    inputs.metadataReady();
    expect(sources).toEqual([
      "pointer.leave",
      "focus.out",
      "engagement.off"
    ]);

    target.dispatchEvent(new Event("pointerenter"));
    target.dispatchEvent(new Event("focusin"));
    target.dispatchEvent(new Event("pointerleave"));
    expect(sources.slice(3)).toEqual([
      "pointer.enter",
      "engagement.on",
      "focus.in",
      "pointer.leave"
    ]);
    target.dispatchEvent(new Event("focusout"));
    target.dispatchEvent(new Event("click"));
    expect(sources.slice(-3)).toEqual([
      "focus.out",
      "engagement.off",
      "activate"
    ]);

    const before = sources.length;
    inputs.setEnabled(false);
    target.dispatchEvent(new Event("click"));
    expect(sources).toHaveLength(before);
    expect(target.listenerCount).toBe(0);
    inputs.dispose();
    expect(ledger.snapshot().completed).toBe(true);
  });

  it("defers automatic state input until the runtime is visible", () => {
    const sources: string[] = [];
    const target = new FakeElement();
    target.hovered = true;
    const inputs = new AutomaticInputs(
      (source) => sources.push(source),
      new ElementOwnershipLedger()
    );
    inputs.setTarget(target as unknown as Element);
    inputs.setRuntimeVisible(false);
    inputs.metadataReady();
    target.dispatchEvent(new Event("pointerenter"));
    target.dispatchEvent(new Event("click"));
    expect(sources).toEqual([]);

    inputs.setRuntimeVisible(true);
    expect(sources).toEqual([
      "pointer.enter",
      "focus.out",
      "engagement.on"
    ]);
    inputs.dispose();
  });

  it("keeps failed removals owned and makes old-target callbacks inert", () => {
    const ledger = new ElementOwnershipLedger();
    const partial = new FaultyElement({ throwOnAdd: 3 });
    const sources: string[] = [];
    const inputs = new AutomaticInputs((source) => sources.push(source), ledger);
    inputs.setTarget(partial as unknown as Element);
    expect(partial.activeListeners).toBe(0);

    const hostileRemoval = new FaultyElement({ throwOnRemove: 2 });
    inputs.setTarget(hostileRemoval as unknown as Element);
    expect(hostileRemoval.activeListeners).toBe(5);
    inputs.metadataReady();
    const before = sources.length;
    const replacement = new FakeElement();
    expect(inputs.setTarget(replacement as unknown as Element)).toBe(false);
    expect(hostileRemoval.removeAttempts).toBe(5);
    hostileRemoval.dispatchEvent(new Event("click"));
    expect(sources).toHaveLength(before + 3);
    expect(ledger.snapshot()).toMatchObject({
      listenerCount: 6,
      failedReleaseCount: 1,
      retainedRetryCount: 1,
      completed: false
    });
    expect(ledger.retryAll()).toBe(true);
    expect(ledger.snapshot().listenerCount).toBe(5);
    expect(inputs.dispose()).toBe(true);
    expect(ledger.snapshot()).toMatchObject({ listenerCount: 0, completed: true });
  });

  it("rolls back a first-listener capacity failure and retries the same target", () => {
    const ledger = new ElementOwnershipLedger({ maximumOwners: 5 });
    const blockers = Array.from({ length: 5 }, () => ledger.acquire("command"));
    const target = new FakeElement();
    const inputs = new AutomaticInputs(() => undefined, ledger);
    expect(inputs.setTarget(target as unknown as Element)).toBe(false);
    expect(target.listenerCount).toBe(0);
    expect(ledger.snapshot().listenerCount).toBe(0);
    for (const blocker of blockers) blocker.complete();
    expect(inputs.setTarget(target as unknown as Element)).toBe(true);
    expect(target.listenerCount).toBe(5);
    expect(ledger.snapshot().listenerCount).toBe(5);
    expect(inputs.dispose()).toBe(true);
    expect(ledger.snapshot().completed).toBe(true);
  });

  it("rolls back a mid-loop capacity failure and retries without target churn", () => {
    const ledger = new ElementOwnershipLedger({ maximumOwners: 5 });
    const blockers = Array.from({ length: 4 }, () => ledger.acquire("command"));
    const target = new FakeElement();
    const inputs = new AutomaticInputs(() => undefined, ledger);
    expect(inputs.setTarget(target as unknown as Element)).toBe(false);
    expect(target.listenerCount).toBe(0);
    expect(ledger.snapshot()).toMatchObject({ listenerCount: 0, pendingCommandCount: 4 });
    for (const blocker of blockers) blocker.complete();
    expect(inputs.setTarget(target as unknown as Element)).toBe(true);
    expect(target.listenerCount).toBe(5);
    expect(inputs.dispose()).toBe(true);
    expect(ledger.snapshot().completed).toBe(true);
  });

  it("retains cleanup when addEventListener installs before throwing", () => {
    const ledger = new ElementOwnershipLedger();
    const target = new FaultyElement({ throwAfterAdd: 3, throwOnRemove: 1 });
    const sources: string[] = [];
    const inputs = new AutomaticInputs((source) => sources.push(source), ledger);
    expect(inputs.setTarget(target as unknown as Element)).toBe(false);
    expect(target.activeListeners).toBe(1);
    expect(ledger.snapshot()).toMatchObject({
      listenerCount: 1,
      retainedRetryCount: 1,
      completed: false
    });
    target.dispatchEvent(new Event("focusin"));
    expect(sources).toEqual([]);
    target.throwOnRemove = null;
    expect(inputs.dispose()).toBe(true);
    expect(target.activeListeners).toBe(0);
    expect(ledger.snapshot().completed).toBe(true);
  });

  it("samples focus from the target shadow root", () => {
    const target = new FakeElement();
    const focused = {} as Element;
    target.root = { activeElement: focused };
    target.contained = focused;
    const sources: string[] = [];
    const inputs = new AutomaticInputs(
      (source) => sources.push(source),
      new ElementOwnershipLedger()
    );
    inputs.setTarget(target as unknown as Element);
    inputs.metadataReady();
    expect(sources).toEqual(["pointer.leave", "focus.in", "engagement.on"]);
    inputs.dispose();
  });

  it("suppresses sticky touch hover until a real hover pointer enters", () => {
    const target = new FakeElement();
    target.hovered = true;
    target.ownerDocument.defaultView = { PointerEvent: FakePointerEvent };
    const sources: string[] = [];
    const inputs = new AutomaticInputs(
      (source) => sources.push(source),
      new ElementOwnershipLedger()
    );
    inputs.setTarget(target as unknown as Element);
    target.dispatchEvent(new FakePointerEvent("pointerenter", "touch"));
    inputs.metadataReady();
    expect(sources).toEqual(["pointer.leave", "focus.out", "engagement.off"]);
    target.dispatchEvent(new FakePointerEvent("pointerenter", "mouse"));
    expect(sources.slice(-2)).toEqual(["pointer.enter", "engagement.on"]);
    inputs.dispose();
  });
});

class FakeElement extends EventTarget {
  public readonly ownerDocument: {
    activeElement: Element | null;
    defaultView: { PointerEvent: typeof FakePointerEvent } | null;
  } = {
    activeElement: null,
    defaultView: null
  };
  readonly #listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  public root: { activeElement: Element | null } | null = null;
  public contained: Element | null = null;
  public hovered = false;
  public get listenerCount(): number {
    return [...this.#listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0);
  }

  public override addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions
  ): void {
    super.addEventListener(type, callback, options);
    if (callback !== null) {
      const listeners = this.#listeners.get(type) ?? new Set();
      listeners.add(callback);
      this.#listeners.set(type, listeners);
    }
  }

  public override removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions
  ): void {
    super.removeEventListener(type, callback, options);
    if (callback !== null) this.#listeners.get(type)?.delete(callback);
  }

  public matches(): boolean { return this.hovered; }
  public contains(value: Node | null): boolean { return value === this.contained; }
  public getRootNode(): Node {
    return (this.root ?? this.ownerDocument) as unknown as Node;
  }
}

class FaultyElement extends FakeElement {
  public removeAttempts = 0;
  readonly #throwOnAdd: number | null;
  readonly #throwAfterAdd: number | null;
  public throwOnRemove: number | null;
  #addAttempts = 0;
  public get activeListeners(): number { return this.listenerCount; }

  public constructor(options: Readonly<{
    throwOnAdd?: number;
    throwAfterAdd?: number;
    throwOnRemove?: number;
  }>) {
    super();
    this.#throwOnAdd = options.throwOnAdd ?? null;
    this.#throwAfterAdd = options.throwAfterAdd ?? null;
    this.throwOnRemove = options.throwOnRemove ?? null;
  }

  public override addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions
  ): void {
    this.#addAttempts += 1;
    if (this.#addAttempts === this.#throwOnAdd) throw new Error("hostile add");
    super.addEventListener(type, callback, options);
    if (this.#addAttempts === this.#throwAfterAdd) throw new Error("hostile add after install");
  }

  public override removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions
  ): void {
    this.removeAttempts += 1;
    if (this.removeAttempts === this.throwOnRemove) throw new Error("hostile remove");
    super.removeEventListener(type, callback, options);
  }
}

class FakePointerEvent extends Event {
  public constructor(type: string, public readonly pointerType: string) { super(type); }
}
