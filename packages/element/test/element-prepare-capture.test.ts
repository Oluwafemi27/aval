import { describe, expect, it } from "vitest";

import type { ElementAssetGeneration } from "../src/asset-generation.js";
import { capturePreparedSource } from "../src/element-prepare-capture.js";
import type { ElementDesiredSnapshot } from "../src/element-desired-state.js";

describe("capturePreparedSource", () => {
  it("rejects the invocation when lane settlement crosses a source token", async () => {
    let release!: () => void;
    const settled = new Promise<void>((resolve) => { release = resolve; });
    let current = snapshot(4);
    const successor = {} as ElementAssetGeneration;
    const capture = capturePreparedSource({
      invocationSourceToken: 4,
      settled,
      current: () => current,
      active: () => successor
    });
    current = snapshot(5);
    release();
    await expect(capture).rejects.toMatchObject({ name: "AbortError" });
  });

  it("returns only the exact invocation generation", async () => {
    const asset = {} as ElementAssetGeneration;
    await expect(capturePreparedSource({
      invocationSourceToken: 7,
      settled: Promise.resolve(),
      current: () => snapshot(7),
      active: () => asset
    })).resolves.toBe(asset);
  });
});

function snapshot(sourceToken: number): Readonly<ElementDesiredSnapshot> {
  return Object.freeze({
    revision: sourceToken,
    sourceToken,
    configuration: Object.freeze({
      src: "asset.avl", integrity: "", crossOrigin: "anonymous" as const,
      motion: "auto" as const, autoplay: "visible" as const, fit: null,
      bindings: "auto" as const, state: null, interactionFor: "",
      width: null, height: null
    }),
    connected: true,
    terminal: false,
    documentVisible: true,
    intersecting: true,
    positiveBox: true,
    observerSupported: true,
    effectivelyVisible: true,
    box: Object.freeze({ width: 1, height: 1 }),
    dpr: 1,
    hostReducedMotion: null,
    manualPlaying: true,
    playSequence: 0,
    stateIntent: null,
    bfcacheRestoreSequence: 0,
    realmSequence: 0,
    interactionTarget: null
  });
}
