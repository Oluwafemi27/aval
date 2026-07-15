import { describe, expect, it, vi } from "vitest";

import {
  createIntegratedOpaqueTestAsset,
  createReferenceOnlyTestAsset
} from "./asset-test-fixture.js";
import {
  type RuntimeFailureCode
} from "./errors.js";
import {
  PlaybackFallbackError,
  type IntegratedTimerHost
} from "./integrated-player.js";
import {
  Deferred,
  ManualTimers,
  createPreparationHarness as createHarness,
  waitForCall,
  waitForLength
} from "./integrated-player-preparation-test-support.js";

describe("IntegratedPlayer preparation lifecycle", () => {
  it("publishes metadata immediately and joins concurrent prepare calls", async () => {
    const harness = createHarness();
    expect(harness.player.snapshot()).toMatchObject({
      readiness: "metadataReady",
      requestedState: "idle",
      visualState: "idle"
    });

    const first = harness.player.prepare();
    const second = harness.player.prepare();
    expect(second).toBe(first);
    const result = await first;

    expect(result.mode).toBe("animated");
    expect(harness.fallbackStore.calls).toEqual([
      "install:idle",
      "validate-all",
      "reveal-animated"
    ]);
    expect(harness.factory.maximumActiveAttempts).toBe(1);
    expect(harness.player.snapshot()).toMatchObject({
      readiness: "interactiveReady",
      selectedRendition: "opaque-high"
    });
  });

  it("falls back to static after the preferred candidate fails", async () => {
    const harness = createHarness({
      behaviors: [
        { kind: "failure", code: "unsupported-profile" },
        { kind: "success" }
      ]
    });

    const result = await harness.player.prepare();

    expect(result).toMatchObject({
      mode: "static",
      reason: "codec-unsupported",
      report: { selectedRendition: null }
    });
    expect(result.report.candidates.map(({ rendition, outcome }) =>
      [rendition, outcome]
    )).toEqual([
      ["opaque-high", "rejected"]
    ]);
    expect(harness.factory.calls).toEqual([
      "create:opaque-high",
      "prepare:opaque-high",
      "dispose:opaque-high"
    ]);
    expect(harness.events.some(({ type }) => type === "fallback")).toBe(true);
  });

  it.each([
    "resource-rejection",
    "readiness-failure",
    "worker-decode-failure",
    "renderer-failure"
  ] satisfies readonly RuntimeFailureCode[])(
    "does not try a lower candidate after a %s failure",
    async (code) => {
      const harness = createHarness({
        behaviors: [
          { kind: "failure", code },
          { kind: "success" }
        ]
      });
      const result = await harness.player.prepare();

      expect(result).toMatchObject({
        mode: "static",
        report: {
          selectedRendition: null,
          candidates: [{ rendition: "opaque-high", outcome: "rejected" }]
        }
      });
      expect(harness.factory.activeAttempts).toBe(0);
      expect(harness.factory.calls).not.toContain("create:opaque-low");
      expect(harness.events.some(({ type }) => type === "fallback")).toBe(true);
    }
  );

  it("resolves an explicit static result when there is no opaque candidate", async () => {
    const harness = createHarness({ bytes: createReferenceOnlyTestAsset() });
    const result = await harness.player.prepare();

    expect(result).toMatchObject({
      mode: "static",
      reason: "no-avc-rendition",
      report: {
        readiness: "staticReady",
        selectedRendition: null,
        candidates: []
      }
    });
    expect(harness.factory.calls).toEqual([]);
    expect(harness.player.snapshot().readiness).toBe("staticReady");
    expect(harness.events.filter(({ type }) => type === "fallback"))
      .toHaveLength(1);
  });

  it("times out to static only after the complete static check is ready", async () => {
    const timers = new ManualTimers();
    const harness = createHarness({
      behaviors: [{ kind: "pending" }],
      timers
    });
    const preparation = harness.player.prepare({ timeoutMs: 25 });
    await waitForCall(harness.factory.calls, "prepare:opaque-high");
    timers.fireAll();

    await expect(preparation).resolves.toMatchObject({
      mode: "static",
      reason: "preparation-timeout"
    });
    expect(harness.factory.calls).toContain("dispose:opaque-high");
    expect(harness.player.snapshot().readiness).toBe("staticReady");
  });

  it("fails terminally when the deadline expires before static readiness", async () => {
    const timers = new ManualTimers();
    const harness = createHarness({
      staticBehavior: "pending-initial",
      timers
    });
    const preparation = harness.player.prepare({ timeoutMs: 25 });
    await waitForCall(harness.fallbackStore.calls, "install:idle");
    timers.fireAll();

    await expect(preparation).rejects.toBeInstanceOf(PlaybackFallbackError);
    expect(harness.player.snapshot().readiness).toBe("error");
    expect(harness.factory.calls).toEqual([]);
  });

  it("aborts one attempt cleanly and permits a fresh retry", async () => {
    const controller = new AbortController();
    const harness = createHarness({
      behaviors: [{ kind: "pending" }, { kind: "success" }]
    });
    const first = harness.player.prepare({ signal: controller.signal });
    await waitForCall(harness.factory.calls, "prepare:opaque-high");
    controller.abort(new DOMException("test abort", "AbortError"));

    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(harness.factory.calls).toContain("dispose:opaque-high");
    expect(harness.player.snapshot().readiness).toBe("visualReady");

    const retry = await harness.player.prepare();
    expect(retry.mode).toBe("animated");
    expect(harness.factory.calls.filter((call) =>
      call === "create:opaque-high"
    )).toHaveLength(2);
  });

  it("plays the authored intro before a prepared request", async () => {
    const defaultHarness = createHarness();
    await defaultHarness.player.prepare();
    expect(defaultHarness.factory.draws[0]).toMatchObject({
      kind: "intro",
      state: "idle",
      frameIndex: 0
    });

    const requestedHarness = createHarness();
    const request = requestedHarness.player.requestState("hover");
    void request.catch(() => undefined);
    await requestedHarness.player.prepare();
    expect(requestedHarness.factory.draws[0]).toMatchObject({
      kind: "intro",
      state: "idle",
      frameIndex: 0
    });
    expect(requestedHarness.player.snapshot()).toMatchObject({
      requestedState: "hover",
      visualState: "idle",
      isTransitioning: true
    });
    await requestedHarness.player.dispose();
  });

  it("coalesces preparation inputs to the latest surviving request", async () => {
    const harness = createHarness();
    const hover = harness.player.requestState("hover");
    const idle = harness.player.requestState("idle");
    void hover.catch(() => undefined);
    await expect(idle).resolves.toBeUndefined();
    await harness.player.prepare();

    expect(harness.player.snapshot()).toMatchObject({
      requestedState: "idle",
      visualState: "idle",
      isTransitioning: false
    });
    expect(harness.factory.draws[0]?.kind).toBe("intro");
    await expect(hover).rejects.toMatchObject({ name: "AbortError" });
  });

  it("stops candidate fallback when failed-attempt cleanup rejects", async () => {
    const harness = createHarness({
      behaviors: [
        {
          kind: "failure",
          code: "readiness-failure",
          cleanupFailure: true
        },
        { kind: "success" }
      ]
    });

    await expect(harness.player.prepare()).resolves.toMatchObject({
      mode: "static",
      reason: "readiness-failed"
    });
    expect(harness.factory.calls.filter((call) => call.startsWith("create:")))
      .toEqual(["create:opaque-high"]);
  });

  it("prepares activation from the latest graph snapshot before commit", async () => {
    const gate = new Deferred<void>();
    const harness = createHarness({ behaviors: [{ kind: "gated", gate }] });
    const preparation = harness.player.prepare();
    await waitForCall(harness.factory.calls, "prepare:opaque-high");
    const hover = harness.player.requestState("hover");
    void hover.catch(() => undefined);
    gate.resolve(undefined);

    await expect(preparation).resolves.toMatchObject({ mode: "animated" });
    expect(harness.factory.activationSnapshots).toHaveLength(1);
    expect(harness.factory.activationSnapshots[0]).toMatchObject({
      readiness: "preparing",
      requestedState: "hover",
      visualState: "idle",
      isTransitioning: true
    });
    expect(harness.factory.draws[0]).toMatchObject({
      kind: "intro",
      state: "idle",
      frameIndex: 0
    });
    await harness.player.dispose();
  });

  it("restages activation when input changes while activation media is pending", async () => {
    const gate = new Deferred<void>();
    const harness = createHarness({
      behaviors: [
        { kind: "activation-gated", gate },
        { kind: "success" }
      ]
    });
    const preparation = harness.player.prepare();
    await waitForLength(harness.factory.activationSnapshots, 1);
    const hover = harness.player.requestState("hover");
    void hover.catch(() => undefined);
    gate.resolve(undefined);

    await expect(preparation).resolves.toMatchObject({ mode: "animated" });
    expect(harness.factory.activationSnapshots).toHaveLength(2);
    expect(harness.factory.activationSnapshots[0]).toMatchObject({
      requestedState: "idle",
      inputSequence: 0
    });
    expect(harness.factory.activationSnapshots[1]).toMatchObject({
      requestedState: "hover",
      inputSequence: 1
    });
    expect(harness.factory.calls.filter((call) =>
      call === "create:opaque-high"
    )).toHaveLength(2);
    expect(harness.factory.calls.filter((call) =>
      call === "dispose:opaque-high"
    )).toHaveLength(1);
    expect(harness.player.snapshot()).toMatchObject({
      readiness: "interactiveReady",
      requestedState: "hover",
      visualState: "idle",
      isTransitioning: true
    });
    expect(harness.events.some(({ type }) => type === "fallback")).toBe(false);
    await harness.player.dispose();
  });

  it("does not restage activation for a semantically stable request", async () => {
    const gate = new Deferred<void>();
    const harness = createHarness({
      behaviors: [{ kind: "activation-gated", gate }]
    });
    const preparation = harness.player.prepare();
    await waitForLength(harness.factory.activationSnapshots, 1);
    const idle = harness.player.requestState("idle");
    gate.resolve(undefined);

    await expect(idle).resolves.toBeUndefined();
    await expect(preparation).resolves.toMatchObject({ mode: "animated" });
    expect(harness.factory.activationSnapshots).toHaveLength(1);
    expect(harness.factory.calls.filter((call) =>
      call === "create:opaque-high"
    )).toHaveLength(1);
    expect(harness.factory.calls).not.toContain("dispose:opaque-high");
    expect(harness.player.snapshot()).toMatchObject({
      readiness: "interactiveReady",
      requestedState: "idle",
      visualState: "idle"
    });
    await harness.player.dispose();
  });

  it("covers before candidate cleanup when animated reveal fails after first draw", async () => {
    const harness = createHarness({
      staticBehavior: "fail-first-reveal",
      behaviors: [{ kind: "success" }]
    });

    await expect(harness.player.prepare()).resolves.toMatchObject({
      mode: "static",
      reason: "animation-failure",
      report: { selectedRendition: null }
    });
    expect(harness.factory.calls).toContain("dispose:opaque-high");
    expect(harness.factory.calls).not.toContain("create:opaque-low");
    const reveal = harness.order.indexOf("static:reveal-animated");
    const cover = harness.order.indexOf("static:cover-current");
    const dispose = harness.order.indexOf("candidate:dispose:opaque-high");
    expect(reveal).toBeGreaterThanOrEqual(0);
    expect(cover).toBeGreaterThan(reveal);
    expect(dispose).toBeGreaterThan(cover);
    expect(harness.player.snapshot().readiness).toBe("staticReady");
  });

  it("recovers to static when the activation draw fails after graph commit", async () => {
    const harness = createHarness({
      behaviors: [{ kind: "draw-failure" }]
    });

    await expect(harness.player.prepare()).resolves.toMatchObject({
      mode: "static",
      reason: "animation-failure",
      report: {
        readiness: "staticReady",
        selectedRendition: null
      }
    });
    expect(harness.factory.calls).toEqual(expect.arrayContaining([
      "draw:opaque-high:intro",
      "dispose:opaque-high"
    ]));
    expect(harness.fallbackStore.calls).toEqual(expect.arrayContaining([
      "stage:idle",
      "cover-current"
    ]));
    expect(harness.player.snapshot()).toMatchObject({
      readiness: "staticReady",
      selectedRendition: null,
      visualState: "idle",
      isTransitioning: false
    });
  });

  it("presents the latest request before committing initial static fallback", async () => {
    const gate = new Deferred<void>();
    const harness = createHarness({
      staticBehavior: { kind: "gate-first-present", gate },
      behaviors: [
        { kind: "failure", code: "readiness-failure" },
        { kind: "failure", code: "readiness-failure" }
      ]
    });
    const preparation = harness.player.prepare();
    await waitForCall(harness.fallbackStore.calls, "present:idle");
    const hover = harness.player.requestState("hover");
    gate.resolve(undefined);

    await expect(preparation).resolves.toMatchObject({ mode: "static" });
    await expect(hover).resolves.toBeUndefined();
    expect(harness.fallbackStore.calls.filter((call) =>
      call.startsWith("present:")
    )).toEqual(["present:idle", "present:hover"]);
    expect(harness.fallbackStore.committed).toEqual(["hover"]);
    expect(harness.player.snapshot()).toMatchObject({
      readiness: "staticReady",
      requestedState: "hover",
      visualState: "hover",
      isTransitioning: false
    });
  });

  it("stages selected readiness fields before listener-visible events", async () => {
    const harness = createHarness();
    await harness.player.prepare();
    const interactiveIndex = harness.eventSnapshots.findIndex((snapshot) =>
      snapshot.readiness === "interactiveReady"
    );

    expect(interactiveIndex).toBeGreaterThanOrEqual(0);
    expect(harness.eventSnapshots[interactiveIndex]).toMatchObject({
      readiness: "interactiveReady",
      selectedRendition: "opaque-high",
      preparing: false
    });
  });

  it("rejects a pending animated request while disposing without barrier drift", async () => {
    const harness = createHarness();
    await harness.player.prepare();
    const pending = harness.player.requestState("hover");

    await expect(harness.player.dispose()).resolves.toBeUndefined();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(harness.player.snapshot()).toMatchObject({
      readiness: "disposed",
      disposed: true
    });
  });

  it.each([
    {
      availability: { workerAvailable: false, rendererAvailable: true },
      reason: "worker-unavailable"
    },
    {
      availability: { workerAvailable: true, rendererAvailable: false },
      reason: "renderer-unavailable"
    }
  ] as const)("uses exact $reason availability evidence", async ({
    availability,
    reason
  }) => {
    const harness = createHarness({
      availability,
      behaviors: [
        { kind: "failure", code: "readiness-failure" },
        { kind: "failure", code: "readiness-failure" }
      ]
    });

    await expect(harness.player.prepare()).resolves.toMatchObject({
      mode: "static",
      reason
    });
  });

  it("rejects corrupt preferred AVC without inspecting a lower rendition", async () => {
    const harness = createHarness({
      bytes: createIntegratedOpaqueTestAsset({
        corruptHighIntroDelta: true
      })
    });

    await expect(harness.player.prepare()).resolves.toMatchObject({
      mode: "static",
      report: {
        selectedRendition: null,
        candidates: [
          { rendition: "opaque-high", outcome: "rejected" }
        ]
      }
    });
    expect(harness.factory.calls.filter((call) => call.startsWith("create:")))
      .toEqual([]);
  });

  it.each(["throw", "invalid"] as const)(
    "unlinks hostile timer state when setTimeout returns %s",
    async (behavior) => {
      const controller = new AbortController();
      const remove = vi.spyOn(controller.signal, "removeEventListener");
      const clearTimeout = vi.fn();
      const timers: IntegratedTimerHost = {
        setTimeout: () => {
          if (behavior === "throw") throw new Error("hostile timer");
          return -1;
        },
        clearTimeout
      };
      const harness = createHarness({ timers });

      await expect(harness.player.prepare({ signal: controller.signal }))
        .rejects.toThrow();
      expect(remove).toHaveBeenCalled();
      if (behavior === "invalid") expect(clearTimeout).toHaveBeenCalledWith(-1);
    }
  );

  it("does not let hostile timer cleanup replace successful readiness", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const harness = createHarness({
      timers: {
        setTimeout: () => 1,
        clearTimeout: () => {
          throw new Error("hostile timer cleanup");
        }
      }
    });

    await expect(harness.player.prepare({ signal: controller.signal }))
      .resolves.toMatchObject({ mode: "animated" });
    expect(remove).toHaveBeenCalled();
  });

  it("bounds timeout fallback and links it to player disposal", async () => {
    const timers = new ManualTimers();
    const bounded = createHarness({
      staticBehavior: "pending-present",
      behaviors: [{ kind: "pending" }],
      timers
    });
    const boundedPreparation = bounded.player.prepare({ timeoutMs: 25 });
    await waitForCall(bounded.factory.calls, "prepare:opaque-high");
    timers.fireAll();
    await waitForCall(bounded.fallbackStore.calls, "present:idle");
    timers.fireAll();
    await expect(boundedPreparation).rejects.toMatchObject({
      name: "TimeoutError"
    });

    const disposalTimers = new ManualTimers();
    const disposal = createHarness({
      staticBehavior: "pending-present",
      behaviors: [{ kind: "pending" }],
      timers: disposalTimers
    });
    const disposalPreparation = disposal.player.prepare({ timeoutMs: 25 });
    await waitForCall(disposal.factory.calls, "prepare:opaque-high");
    disposalTimers.fireAll();
    await waitForCall(disposal.fallbackStore.calls, "present:idle");
    const rejected = expect(disposalPreparation).rejects.toMatchObject({
      name: "AbortError"
    });
    await disposal.player.dispose();
    await rejected;
  });

  it("disposes the active candidate, static store, catalog, and promises once", async () => {
    const harness = createHarness();
    await harness.player.prepare();
    const first = harness.player.dispose();
    const second = harness.player.dispose();
    expect(second).toBe(first);
    await first;

    expect(harness.factory.calls.filter((call) =>
      call === "dispose:opaque-high"
    )).toHaveLength(1);
    expect(harness.fallbackStore.calls.at(-1)).toBe("dispose");
    expect(harness.player.snapshot()).toMatchObject({
      readiness: "disposed",
      disposed: true
    });
  });
});
