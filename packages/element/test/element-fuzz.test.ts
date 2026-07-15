import { describe, expect, it } from "vitest";

import { mutationSeeds } from "../../../tests/mutation/seed-profile.js";
import { reduceElementAutomationSignal } from "../src/element-automation-reduction.js";
import { ElementCommandSlot } from "../src/element-command-slot.js";
import {
  readElementConfiguration,
  type ElementConfigurationRead
} from "../src/element-configuration.js";
import {
  ElementDesiredState,
  type ElementDesiredSnapshot
} from "../src/element-desired-state.js";
import { ElementOwnershipLedger } from "../src/element-ownership-ledger.js";
import { ElementReconcileLane } from "../src/element-reconcile-lane.js";

const SEEDS = mutationSeeds([1, 0x5eed_c0de, 0x00c0_ffee, 0xffff_ffff]);
const GENERATED_OPERATIONS = 512;

type AutomationOperation =
  | Readonly<{ type: "document"; visible: boolean; restored: boolean }>
  | Readonly<{ type: "intersection"; intersecting: boolean }>
  | Readonly<{ type: "observer"; supported: boolean }>
  | Readonly<{ type: "box"; width: number; height: number }>
  | Readonly<{ type: "dpr"; value: number }>
  | Readonly<{ type: "motion"; value: boolean | null }>;

type TapeOperation =
  | Readonly<{
      type: "configure";
      attributes: Readonly<Record<string, string | null>>;
      throwing: readonly string[];
    }>
  | Readonly<{ type: "connected"; value: boolean }>
  | Readonly<{ type: "terminal"; value: boolean }>
  | Readonly<{ type: "play"; value: boolean }>
  | Readonly<{ type: "state"; name: string }>
  | Readonly<{ type: "initial-state" }>
  | Readonly<{ type: "clear-state" }>
  | Readonly<{ type: "source" }>
  | Readonly<{ type: "realm" }>
  | AutomationOperation;

interface ReplayRecord {
  readonly snapshot: Readonly<ElementDesiredSnapshot>;
  readonly failures: readonly string[];
  readonly rejected: string | null;
  readonly resizeChanged: boolean;
  readonly motionChanged: boolean;
  readonly restored: boolean;
}

describe("element seeded desired-state and ownership properties", () => {
  for (const seed of SEEDS) {
    it(`replays hostile lifecycle ordering deterministically for seed 0x${seed.toString(16)}`, async () => {
      const tape = createTape(seed);
      const first = replayTape(tape);
      const second = replayTape(tape);

      expect(second).toEqual(first);
      expect(first).toHaveLength(tape.length);
      expect(first.some(({ rejected }) => rejected !== null)).toBe(true);
      expect(first.some(({ failures }) => failures.length > 0)).toBe(true);

      const lane = await exerciseReconcileLane(seed);
      expect(lane.applied).toEqual([lane.first, lane.last]);
      expect(lane.completed).toBe(true);

      await exerciseCommandSlot(seed);
      expect(exerciseRetryableOwnership(seed)).toMatchObject({
        completed: true,
        retainedRetryCount: 0
      });
    });
  }
});

function replayTape(tape: readonly TapeOperation[]): readonly ReplayRecord[] {
  const desired = new ElementDesiredState({ maximumSequence: 100_000 });
  const trace: ReplayRecord[] = [];
  for (const operation of tape) {
    const previous = desired.snapshot();
    let failures: readonly string[] = Object.freeze([]);
    let rejected: string | null = null;
    let resizeChanged = false;
    let motionChanged = false;
    let restored = false;
    try {
      if (operation.type === "configure") {
        const read = readConfiguration(operation);
        assertConfigurationRead(read);
        failures = Object.freeze(read.failures.map(({ attribute }) => attribute));
        desired.configure(read.configuration);
      } else if (operation.type === "connected") {
        desired.setConnected(operation.value);
      } else if (operation.type === "terminal") {
        desired.setTerminal(operation.value);
      } else if (operation.type === "play") {
        desired.setManualPlaying(operation.value);
      } else if (operation.type === "state") {
        desired.requestState(operation.name);
      } else if (operation.type === "initial-state") {
        desired.requestInitialState();
      } else if (operation.type === "clear-state") {
        desired.clearStateIntent();
      } else if (operation.type === "source") {
        desired.invalidateSource();
      } else if (operation.type === "realm") {
        desired.enterRealm();
      } else {
        const reduction = reduceElementAutomationSignal(desired, operation);
        expect(Object.isFrozen(reduction)).toBe(true);
        resizeChanged = reduction.resizeChanged;
        motionChanged = reduction.motionChanged;
        restored = reduction.restored;
      }
    } catch (error) {
      rejected = `${error instanceof Error ? error.name : "Error"}:${error instanceof Error ? error.message : String(error)}`;
      expect(desired.snapshot()).toBe(previous);
    }
    const snapshot = desired.snapshot();
    if (rejected === null) expect(snapshot.revision).toBe(previous.revision + 1);
    assertSnapshot(snapshot);
    trace.push(Object.freeze({
      snapshot,
      failures,
      rejected,
      resizeChanged,
      motionChanged,
      restored
    }));
  }
  return Object.freeze(trace);
}

function readConfiguration(
  operation: Extract<TapeOperation, Readonly<{ type: "configure" }>>
): Readonly<ElementConfigurationRead> {
  const throwing = new Set(operation.throwing);
  return readElementConfiguration((name) => {
    if (throwing.has(name)) throw new Error(`hostile ${name} getter`);
    return operation.attributes[name] ?? null;
  });
}

function assertConfigurationRead(read: Readonly<ElementConfigurationRead>): void {
  expect(Object.isFrozen(read)).toBe(true);
  expect(Object.isFrozen(read.configuration)).toBe(true);
  expect(Object.isFrozen(read.failures)).toBe(true);
  expect(read.failures.every(Object.isFrozen)).toBe(true);
}

function assertSnapshot(snapshot: Readonly<ElementDesiredSnapshot>): void {
  expect(Object.isFrozen(snapshot)).toBe(true);
  expect(Object.isFrozen(snapshot.box)).toBe(true);
  if (snapshot.configuration !== null) {
    expect(Object.isFrozen(snapshot.configuration)).toBe(true);
  }
  if (snapshot.stateIntent !== null) {
    expect(Object.isFrozen(snapshot.stateIntent)).toBe(true);
  }
  expect(snapshot.effectivelyVisible).toBe(
    snapshot.connected && !snapshot.terminal && snapshot.documentVisible &&
      snapshot.intersecting && snapshot.positiveBox
  );
  expect(snapshot.positiveBox).toBe(snapshot.box.width > 0 && snapshot.box.height > 0);
  expect(snapshot.revision).toBeGreaterThanOrEqual(0);
  expect(snapshot.sourceToken).toBeGreaterThanOrEqual(0);
  expect(snapshot.playSequence).toBeGreaterThanOrEqual(0);
  expect(snapshot.realmSequence).toBeGreaterThanOrEqual(0);
  expect(snapshot.bfcacheRestoreSequence).toBeGreaterThanOrEqual(0);
}

async function exerciseReconcileLane(seed: number): Promise<Readonly<{
  first: number;
  last: number;
  applied: readonly number[];
  completed: boolean;
}>> {
  const random = randomFor(seed ^ 0xa11c_e5ed);
  const ledger = new ElementOwnershipLedger();
  const applied: number[] = [];
  let releaseFirst: (() => void) | undefined;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const lane = new ElementReconcileLane<number>(async (value) => {
    applied.push(value);
    if (applied.length === 1) await firstGate;
  }, ledger);
  const first = random();
  const promises = [lane.submit(first)];
  await Promise.resolve();
  let last = first;
  for (let index = 0; index < 16; index += 1) {
    last = random();
    promises.push(lane.submit(last));
  }
  expect(lane.snapshot()).toEqual({ active: 1, pending: 1, disposed: false });
  expect(Object.isFrozen(lane.snapshot())).toBe(true);
  expect(ledger.snapshot().pendingCommandCount).toBe(2);
  releaseFirst?.();
  await Promise.all([...promises, lane.settled()]);
  expect(lane.snapshot()).toEqual({ active: 0, pending: 0, disposed: false });
  expect(ledger.snapshot().pendingCommandCount).toBe(0);
  lane.dispose();
  await lane.submit(random());
  expect(lane.snapshot()).toEqual({ active: 0, pending: 0, disposed: true });
  return Object.freeze({
    first,
    last,
    applied: Object.freeze([...applied]),
    completed: ledger.snapshot().completed
  });
}

async function exerciseCommandSlot(seed: number): Promise<void> {
  const ledger = new ElementOwnershipLedger();
  type Key = Readonly<{ source: number; state: string }>;
  const equal = (left: Key, right: Key): boolean =>
    left.source === right.source && left.state === right.state;
  const slot = new ElementCommandSlot<Key>(equal, ledger);
  const source = seed >>> 0;
  const firstKey = Object.freeze({ source, state: "idle" });
  const first = slot.request(firstKey);
  const joined = slot.request(Object.freeze({ ...firstKey }));
  expect(joined.joined).toBe(true);
  expect(joined.promise).toBe(first.promise);
  expect(slot.pending).toBe(1);
  expect(ledger.snapshot().pendingCommandCount).toBe(1);

  const nextKey = Object.freeze({ source: (source + 1) >>> 0, state: "engaged" });
  const next = slot.request(nextKey);
  expect(next.accepted).toBe(true);
  expect(next.joined).toBe(false);
  await expect(first.promise).rejects.toMatchObject({ name: "AbortError" });
  expect(slot.start(firstKey)).toBe(false);
  expect(slot.start(nextKey)).toBe(true);
  expect(slot.start(nextKey)).toBe(false);
  slot.resolve(Object.freeze({ ...nextKey }));
  await next.promise;
  expect(slot.pending).toBe(0);
  expect(ledger.snapshot().completed).toBe(true);
}

function exerciseRetryableOwnership(seed: number): ReturnType<ElementOwnershipLedger["snapshot"]> {
  const random = randomFor(seed ^ 0x51de_1ea5);
  const ledger = new ElementOwnershipLedger();
  const kinds = ["listener", "observer", "broker", "timer", "command"] as const;
  const handles = Array.from({ length: 20 }, (_, index) => ({
    handle: ledger.acquire(kinds[index % kinds.length]!),
    failuresRemaining: index === 0 ? 1 : random() % 2
  }));
  for (const record of handles) {
    record.handle.release(() => {
      if (record.failuresRemaining > 0) {
        record.failuresRemaining -= 1;
        throw new Error("seeded release failure");
      }
    });
  }
  expect(ledger.snapshot().releaseFailureCount).toBeGreaterThan(0);
  expect(ledger.snapshot().retainedRetryCount).toBeGreaterThan(0);
  expect(ledger.retryAll()).toBe(true);
  const snapshot = ledger.snapshot();
  expect(Object.isFrozen(snapshot)).toBe(true);
  return snapshot;
}

function createTape(seed: number): readonly TapeOperation[] {
  const random = randomFor(seed);
  const tape: TapeOperation[] = [
    configurationOperation(random),
    Object.freeze({ type: "connected", value: true }),
    Object.freeze({ type: "document", visible: true, restored: false }),
    Object.freeze({ type: "intersection", intersecting: true }),
    Object.freeze({ type: "observer", supported: false }),
    Object.freeze({ type: "box", width: 48, height: 48 }),
    Object.freeze({ type: "box", width: -1, height: 48 }),
    Object.freeze({ type: "dpr", value: 2 }),
    Object.freeze({ type: "dpr", value: 0 }),
    Object.freeze({ type: "motion", value: true }),
    Object.freeze({ type: "play", value: false }),
    Object.freeze({ type: "state", name: "engaged" }),
    Object.freeze({ type: "initial-state" }),
    Object.freeze({ type: "clear-state" }),
    Object.freeze({ type: "source" }),
    Object.freeze({ type: "realm" }),
    Object.freeze({ type: "terminal", value: true })
  ];
  while (tape.length < GENERATED_OPERATIONS) {
    const choice = random() % 17;
    switch (choice) {
      case 0: tape.push(configurationOperation(random)); break;
      case 1: tape.push(Object.freeze({ type: "connected", value: boolean(random) })); break;
      case 2: tape.push(Object.freeze({ type: "terminal", value: boolean(random) })); break;
      case 3: tape.push(Object.freeze({ type: "document", visible: boolean(random), restored: random() % 8 === 0 })); break;
      case 4: tape.push(Object.freeze({ type: "intersection", intersecting: boolean(random) })); break;
      case 5: tape.push(Object.freeze({ type: "observer", supported: boolean(random) })); break;
      case 6: tape.push(Object.freeze({ type: "box", width: randomDimension(random), height: randomDimension(random) })); break;
      case 7: tape.push(Object.freeze({ type: "dpr", value: randomDpr(random) })); break;
      case 8: tape.push(Object.freeze({ type: "motion", value: [null, false, true][random() % 3]! })); break;
      case 9: tape.push(Object.freeze({ type: "play", value: boolean(random) })); break;
      case 10: tape.push(Object.freeze({ type: "state", name: `state-${String(random() % 32)}` })); break;
      case 11: tape.push(Object.freeze({ type: "initial-state" })); break;
      case 12: tape.push(Object.freeze({ type: "clear-state" })); break;
      case 13: tape.push(Object.freeze({ type: "source" })); break;
      case 14: tape.push(Object.freeze({ type: "realm" })); break;
      case 15: tape.push(Object.freeze({ type: "box", width: Number.POSITIVE_INFINITY, height: 1 })); break;
      default: tape.push(Object.freeze({ type: "dpr", value: Number.NaN }));
    }
  }
  return Object.freeze(tape);
}

function configurationOperation(random: () => number): Extract<TapeOperation, Readonly<{ type: "configure" }>> {
  const attributes = Object.freeze({
    src: choose(random, ["", "motion.avl", "https://example.invalid/motion.avl"]),
    integrity: choose(random, ["", `sha256-${"A".repeat(43)}=`, "sha256-invalid"]),
    crossorigin: choose(random, [null, "anonymous", "use-credentials", "include"]),
    motion: choose(random, [null, "auto", "reduce", "full", "fast"]),
    autoplay: choose(random, [null, "visible", "manual", "always"]),
    fit: choose(random, [null, "contain", "cover", "fill", "stretch"]),
    bindings: choose(random, [null, "auto", "none", "manual"]),
    state: choose(random, [null, "idle", "engaged", "Invalid State"]),
    "interaction-for": choose(random, [null, "control", "bad\u0000target"]),
    width: choose(random, [null, "1", "48", "0", "16385"]),
    height: choose(random, [null, "1", "48", "-1", "999999"])
  });
  const names = Object.keys(attributes);
  const throwing = random() % 5 === 0
    ? Object.freeze([names[random() % names.length]!])
    : Object.freeze([]);
  return Object.freeze({ type: "configure", attributes, throwing });
}

function randomDimension(random: () => number): number {
  return random() % 11 === 0 ? -1 : (random() % 4_096) / 8;
}

function randomDpr(random: () => number): number {
  return random() % 11 === 0 ? 0 : 0.25 + (random() % 1_600) / 100;
}

function choose<T>(random: () => number, values: readonly T[]): T {
  return values[random() % values.length]!;
}

function boolean(random: () => number): boolean {
  return (random() & 1) === 1;
}

function randomFor(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}
