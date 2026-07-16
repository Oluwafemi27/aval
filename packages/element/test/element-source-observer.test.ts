import { describe, expect, it } from "vitest";

import {
  ElementSourceObserver,
  type ElementSourceMutationObserver
} from "../src/element-source-observer.js";

const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

describe("ElementSourceObserver", () => {
  it("flushes pending direct-source records synchronously", async () => {
    const host = node("aval-player", null);
    const direct = node("source", host);
    let pending: readonly MutationRecord[] = [attributeRecord(direct)];
    let changes = 0;
    const observer = new ElementSourceObserver({
      host: host as unknown as HTMLElement,
      changed: () => { changes += 1; },
      factory: () => ({
        observe: () => undefined,
        disconnect: () => undefined,
        takeRecords() {
          const records = pending;
          pending = [];
          return records as MutationRecord[];
        }
      } as ElementSourceMutationObserver)
    });
    observer.connect();

    observer.flushRecords();

    expect(changes).toBe(1);
    await Promise.resolve();
    expect(changes).toBe(1);
  });

  it("publishes an already delivered source batch once when a command flushes it", async () => {
    const host = node("aval-player", null);
    const direct = node("source", host);
    let callback: MutationCallback | null = null;
    let changes = 0;
    const observer = new ElementSourceObserver({
      host: host as unknown as HTMLElement,
      changed: () => { changes += 1; },
      factory: (next) => {
        callback = next;
        return fakeObserver([]);
      }
    });
    observer.connect();
    emit(callback, [attributeRecord(direct)]);

    observer.flushRecords();

    expect(changes).toBe(1);
    await Promise.resolve();
    expect(changes).toBe(1);
  });

  it("observes the bounded source surface and coalesces direct-source changes", async () => {
    const host = node("aval-player", null);
    const direct = node("source", host);
    let callback: MutationCallback | null = null;
    let changes = 0;
    const observed: MutationObserverInit[] = [];
    const observer = new ElementSourceObserver({
      host: host as unknown as HTMLElement,
      changed: () => { changes += 1; },
      factory: (next) => {
        callback = next;
        return fakeObserver(observed);
      }
    });

    observer.connect();
    expect(observer.active).toBe(true);
    expect(observed).toEqual([{
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "type", "integrity"]
    }]);

    emit(callback, [attributeRecord(direct), attributeRecord(direct)]);
    emit(callback, [attributeRecord(direct)]);
    expect(changes).toBe(0);
    await Promise.resolve();
    expect(changes).toBe(1);
  });

  it("ignores nested fallback mutations and unrelated direct children", async () => {
    const host = node("aval-player", null);
    const fallback = node("div", host);
    const nested = node("source", fallback);
    const image = node("img", host);
    let callback: MutationCallback | null = null;
    let changes = 0;
    const observer = new ElementSourceObserver({
      host: host as unknown as HTMLElement,
      changed: () => { changes += 1; },
      factory: (next) => {
        callback = next;
        return fakeObserver([]);
      }
    });
    observer.connect();

    emit(callback, [attributeRecord(nested)]);
    emit(callback, [childRecord(fallback, [nested], [])]);
    emit(callback, [childRecord(host, [image], [])]);
    await Promise.resolve();
    expect(changes).toBe(0);
  });

  it("tracks direct additions, removals, and reorders once per task", async () => {
    const host = node("aval-player", null);
    const first = node("source", host);
    const second = node("source", host);
    let callback: MutationCallback | null = null;
    let changes = 0;
    const observer = new ElementSourceObserver({
      host: host as unknown as HTMLElement,
      changed: () => { changes += 1; },
      factory: (next) => {
        callback = next;
        return fakeObserver([]);
      }
    });
    observer.connect();

    emit(callback, [
      childRecord(host, [first], []),
      childRecord(host, [], [second]),
      childRecord(host, [second], [first])
    ]);
    await Promise.resolve();
    expect(changes).toBe(1);
  });

  it("disconnects pending publication and creates only one active observer", async () => {
    const host = node("aval-player", null);
    const direct = node("source", host);
    let callback: MutationCallback | null = null;
    let creations = 0;
    let disconnections = 0;
    let changes = 0;
    const observer = new ElementSourceObserver({
      host: host as unknown as HTMLElement,
      changed: () => { changes += 1; },
      factory: (next) => {
        callback = next;
        creations += 1;
        return {
          observe: () => undefined,
          takeRecords: () => [],
          disconnect: () => { disconnections += 1; }
        };
      }
    });
    observer.connect();
    observer.connect();
    expect(creations).toBe(1);
    emit(callback, [attributeRecord(direct)]);
    observer.disconnect();
    await Promise.resolve();
    expect(changes).toBe(0);
    expect(disconnections).toBe(1);

    observer.connect();
    expect(creations).toBe(2);
  });

  it("releases a partially installed observer when observation fails", () => {
    const host = node("aval-player", null);
    let disconnections = 0;
    const observer = new ElementSourceObserver({
      host: host as unknown as HTMLElement,
      changed: () => undefined,
      factory: () => ({
        observe: () => { throw new Error("hostile realm"); },
        takeRecords: () => [],
        disconnect: () => { disconnections += 1; }
      })
    });

    expect(() => observer.connect()).toThrow("hostile realm");
    expect(observer.active).toBe(false);
    expect(disconnections).toBe(1);
  });
});

function fakeObserver(observed: MutationObserverInit[]): ElementSourceMutationObserver {
  return {
    observe(_target, options) { observed.push(options ?? {}); },
    takeRecords: () => [],
    disconnect: () => undefined
  };
}

function emit(callback: MutationCallback | null, records: readonly MutationRecord[]): void {
  if (callback === null) throw new Error("observer callback was not installed");
  callback(records as MutationRecord[], {} as MutationObserver);
}

function node(localName: string, parentNode: Node | null): Node {
  return {
    nodeType: 1,
    localName,
    namespaceURI: HTML_NAMESPACE,
    parentNode
  } as unknown as Node;
}

function attributeRecord(target: Node): MutationRecord {
  return { type: "attributes", target } as MutationRecord;
}

function childRecord(
  target: Node,
  added: readonly Node[],
  removed: readonly Node[]
): MutationRecord {
  return {
    type: "childList",
    target,
    addedNodes: list(added),
    removedNodes: list(removed)
  } as MutationRecord;
}

function list(values: readonly Node[]): NodeList {
  return {
    length: values.length,
    item(index: number) { return values[index] ?? null; }
  } as NodeList;
}
