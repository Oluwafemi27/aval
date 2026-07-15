import { describe, expect, it, vi } from "vitest";

import { createOpaqueTestAsset } from "./asset-test-fixture.js";
import { RuntimeAssetCatalog } from "./asset-catalog.js";
import { StateFallbackStore } from "./state-fallback-store.js";

describe("state fallback store", () => {
  it("tracks state and delegates fallback visibility without media bytes", async () => {
    const catalog = new RuntimeAssetCatalog(createOpaqueTestAsset());
    const coverFallback = vi.fn();
    const revealAnimated = vi.fn();
    const store = new StateFallbackStore(catalog, {
      coverFallback,
      revealAnimated
    });
    const signal = new AbortController().signal;

    await store.installInitial({ state: "idle", signal });
    expect(store.currentState()).toBe("idle");
    expect(coverFallback).toHaveBeenCalledOnce();

    await store.presentState("idle", { signal, cover: false });
    expect(coverFallback).toHaveBeenCalledOnce();
    store.revealAnimated();
    expect(revealAnimated).toHaveBeenCalledOnce();

    store.coverCurrent();
    expect(coverFallback).toHaveBeenCalledTimes(2);
    store.dispose();
    expect(store.currentState()).toBeNull();
    catalog.dispose();
  });

  it("rejects unknown states and aborted operations", async () => {
    const catalog = new RuntimeAssetCatalog(createOpaqueTestAsset());
    const store = new StateFallbackStore(catalog, {
      coverFallback() {},
      revealAnimated() {}
    });
    const active = new AbortController().signal;
    await expect(store.presentState("missing", { signal: active }))
      .rejects.toThrow();

    const aborted = new AbortController();
    aborted.abort(new DOMException("cancelled", "AbortError"));
    await expect(store.installInitial({
      state: "idle",
      signal: aborted.signal
    })).rejects.toMatchObject({ name: "AbortError" });

    store.dispose();
    catalog.dispose();
  });
});
