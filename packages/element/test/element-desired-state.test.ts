import { describe, expect, it } from "vitest";

import { ElementDesiredState } from "../src/element-desired-state.js";
import type { ElementConfiguration } from "../src/element-configuration.js";

describe("ElementDesiredState", () => {
  it("publishes immutable revisions and synchronously invalidates source identity", () => {
    const desired = new ElementDesiredState();
    const initial = desired.snapshot();
    expect(initial).toMatchObject({
      revision: 0,
      sourceToken: 0,
      connected: false,
      terminal: false,
      effectivelyVisible: false,
      manualPlaying: true
    });
    const invalidated = desired.invalidateSource();
    expect(invalidated).toMatchObject({ revision: 1, sourceToken: 1 });
    expect(initial).toMatchObject({ revision: 0, sourceToken: 0 });
    expect(Object.isFrozen(invalidated)).toBe(true);

    const configured = desired.configure(configuration({ autoplay: "manual" }));
    expect(configured).toMatchObject({
      revision: 2,
      sourceToken: 1,
      manualPlaying: false,
      playSequence: 1
    });
    expect(Object.isFrozen(configured.configuration)).toBe(true);
  });

  it("derives visibility and sequences state/play intent without side effects", () => {
    const desired = new ElementDesiredState();
    desired.setConnected(true);
    desired.setDocumentVisible(true, false);
    desired.setIntersection(true);
    desired.setBox({ width: 120.5, height: 60.25 });
    expect(desired.snapshot()).toMatchObject({
      positiveBox: true,
      effectivelyVisible: true,
      box: { width: 120.5, height: 60.25 }
    });
    const state = desired.requestState("hover");
    desired.clearStateIntent();
    const nextState = desired.requestState("idle");
    const initialState = desired.requestInitialState();
    const resumed = desired.setManualPlaying(true);
    const paused = desired.setManualPlaying(false);
    expect(state.stateIntent).toEqual({ name: "hover", sequence: 1 });
    expect(nextState.stateIntent).toEqual({ name: "idle", sequence: 2 });
    expect(initialState.stateIntent).toEqual({ name: null, sequence: 3 });
    expect(resumed.playSequence).toBe(1);
    expect(paused).toMatchObject({ manualPlaying: false, playSequence: 2 });
    desired.setDocumentVisible(false, true);
    expect(desired.snapshot()).toMatchObject({
      documentVisible: false,
      effectivelyVisible: false,
      bfcacheRestoreSequence: 1
    });
    desired.setDocumentVisible(true, false);
    expect(desired.snapshot().effectivelyVisible).toBe(true);
    desired.setConnected(false);
    expect(desired.snapshot().effectivelyVisible).toBe(false);
    desired.setConnected(true);
    expect(desired.snapshot().effectivelyVisible).toBe(true);
    desired.setTerminal(true);
    expect(desired.snapshot()).toMatchObject({
      connected: false,
      terminal: true,
      effectivelyVisible: false
    });
  });

  it("fails closed when any desired-state identity sequence is exhausted", () => {
    const revision = new ElementDesiredState({ maximumSequence: 1 });
    revision.setConnected(true);
    expect(() => revision.setConnected(false)).toThrow("revision is exhausted");

    const source = new ElementDesiredState({ maximumSequence: 2 });
    source.invalidateSource();
    source.invalidateSource();
    expect(() => source.invalidateSource()).toThrow("source token is exhausted");

    const play = new ElementDesiredState({ maximumSequence: 2 });
    play.setManualPlaying(false);
    play.setManualPlaying(true);
    expect(() => play.setManualPlaying(false)).toThrow("play sequence is exhausted");

    const state = new ElementDesiredState({ maximumSequence: 2 });
    state.requestState("idle");
    state.requestState("hover");
    expect(() => state.requestState("idle")).toThrow("state intent sequence is exhausted");

    const realm = new ElementDesiredState({ maximumSequence: 2 });
    realm.enterRealm();
    realm.enterRealm();
    expect(() => realm.enterRealm()).toThrow("realm sequence is exhausted");

    const restore = new ElementDesiredState({ maximumSequence: 2 });
    restore.setDocumentVisible(true, true);
    restore.setDocumentVisible(true, true);
    expect(() => restore.setDocumentVisible(true, true)).toThrow(
      "bfcache restore sequence is exhausted"
    );
  });
});

function configuration(
  override: Partial<ElementConfiguration> = {}
): Readonly<ElementConfiguration> {
  return Object.freeze({
    src: "asset.avl",
    integrity: "",
    crossOrigin: "anonymous",
    motion: "auto",
    autoplay: "visible",
    fit: null,
    bindings: "auto",
    state: null,
    interactionFor: "",
    width: null,
    height: null,
    ...override
  });
}
