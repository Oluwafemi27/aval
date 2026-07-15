import { expect, test } from "@playwright/test";

test("manual pause, hidden resume, and autoplay resets remain separate intents", async ({ page }) => {
  await page.goto("/m8-dev-entry.html?play-intent");
  const motion = page.locator("aval-player");
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { readiness: string }).readiness
  ), { timeout: 20_000 }).toBe("interactiveReady");

  await motion.evaluate((element) => {
    (element as unknown as { pause(): void }).pause();
  });
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { paused: boolean }).paused
  )).toBe(true);
  await page.waitForTimeout(50);
  const pausedTicks = await traceLength(motion);
  await page.waitForTimeout(150);
  expect(await traceLength(motion)).toBe(pausedTicks);

  await motion.evaluate((element) => {
    const node = element as unknown as { setState(state: string): Promise<void> };
    (globalThis as unknown as { pausedStateRequest: Promise<void> }).pausedStateRequest =
      node.setState("hover");
  });
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { requestedState: string | null }).requestedState
  )).toBe("hover");
  await motion.evaluate((element) => {
    (element as HTMLElement).style.display = "none";
  });
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { effectivelyVisible: boolean }).effectivelyVisible
  )).toBe(false);
  await motion.evaluate(async (element) => {
    await (element as unknown as { resume(): Promise<void> }).resume();
  });
  expect(await motion.evaluate((element) =>
    (element as unknown as { paused: boolean }).paused
  )).toBe(false);
  await motion.evaluate((element) => {
    (element as HTMLElement).style.display = "inline-block";
  });
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { readiness: string }).readiness
  ), { timeout: 20_000 }).toBe("interactiveReady");
  await page.evaluate(async () => {
    await (globalThis as unknown as { pausedStateRequest: Promise<void> }).pausedStateRequest;
  });
  expect(await motion.evaluate((element) =>
    (element as unknown as { visualState: string | null }).visualState
  )).toBe("hover");

  await motion.evaluate((element) => {
    (element as unknown as { autoplay: string }).autoplay = "manual";
  });
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { paused: boolean }).paused
  )).toBe(true);
  await motion.evaluate((element) => {
    (element as unknown as { autoplay: string }).autoplay = "visible";
  });
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { paused: boolean }).paused
  )).toBe(false);
});

test("manual autoplay prepares an animation candidate without advancing it", async ({ page }) => {
  await page.goto("/m8-dev-entry.html?manual-autoplay");
  const result = await page.evaluate(async () => {
    const element = document.querySelector("aval-player") as HTMLElement & {
      autoplay: string;
      src: string;
      readiness: string;
      paused: boolean;
      resume(): Promise<void>;
      getDiagnostics(options: { trace: boolean }): {
        sourceGeneration: number;
        runtimeTrace: readonly unknown[];
      };
    };
    await waitUntil(() => element.readiness === "interactiveReady", 20_000);
    const generation = element.getDiagnostics({ trace: true }).sourceGeneration;
    element.autoplay = "manual";
    element.src = "/__m8__/asset?fixture=one-state&session=m8-manual-autoplay";
    await waitUntil(() =>
      element.getDiagnostics({ trace: true }).sourceGeneration === generation + 1 &&
      element.readiness === "interactiveReady",
    20_000);
    await new Promise((resolve) => setTimeout(resolve, 75));
    const before = element.getDiagnostics({ trace: true }).runtimeTrace.length;
    await new Promise((resolve) => setTimeout(resolve, 150));
    const held = element.getDiagnostics({ trace: true }).runtimeTrace.length;
    await element.resume();
    await new Promise((resolve) => setTimeout(resolve, 150));
    const resumed = element.getDiagnostics({ trace: true }).runtimeTrace.length;
    return {
      before,
      held,
      resumed,
      pausedBefore: true,
      readiness: element.readiness
    };

    async function waitUntil(predicate: () => boolean, timeout: number): Promise<void> {
      const deadline = performance.now() + timeout;
      while (!predicate()) {
        if (performance.now() > deadline) throw new Error("manual prepare timed out");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
  });
  expect(result.readiness, JSON.stringify(result)).toBe("interactiveReady");
  expect(result.held).toBe(result.before);
  expect(result.resumed).toBeGreaterThan(result.held);
});

async function traceLength(locator: import("@playwright/test").Locator): Promise<number> {
  return locator.evaluate((element) =>
    (element as unknown as {
      getDiagnostics(options: { trace: boolean }): { runtimeTrace: readonly unknown[] };
    }).getDiagnostics({ trace: true }).runtimeTrace.length
  );
}
