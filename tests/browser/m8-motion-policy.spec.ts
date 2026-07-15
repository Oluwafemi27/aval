import { expect, test } from "@playwright/test";

test("live reduce freezes loops and full re-enters the same semantic state", async ({ page }) => {
  await page.goto("/m8-dev-entry.html?motion");
  const motion = page.locator("aval-player");
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { readiness: string }).readiness
  ), { timeout: 20_000 }).toBe("interactiveReady");
  await motion.evaluate(async (element) => {
    const motion = element as unknown as {
      setState(state: string): Promise<void>;
      motion: string;
    };
    await motion.setState("hover");
    motion.motion = "reduce";
  });
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { readiness: string }).readiness
  )).toBe("staticReady");
  const before = await motion.evaluate((element) => {
    const motion = element as unknown as {
      requestedState: string | null;
      visualState: string | null;
      getDiagnostics(options: { trace: boolean }): { runtimeTrace: readonly unknown[] };
    };
    return {
      requested: motion.requestedState,
      visual: motion.visualState,
      ticks: motion.getDiagnostics({ trace: true }).runtimeTrace.length
    };
  });
  await page.waitForTimeout(150);
  const afterTicks = await motion.evaluate((element) =>
    (element as unknown as {
      getDiagnostics(options: { trace: boolean }): { runtimeTrace: readonly unknown[] };
    }).getDiagnostics({ trace: true }).runtimeTrace.length
  );
  expect(afterTicks).toBe(before.ticks);
  expect(before).toMatchObject({ requested: "hover", visual: "hover" });
  await motion.evaluate((element) => { (element as unknown as { motion: string }).motion = "full"; });
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { readiness: string }).readiness
  )).toBe("interactiveReady");
  expect(await motion.evaluate((element) =>
    (element as unknown as { requestedState: string | null }).requestedState
  )).toBe("hover");
});

test("a real prefers-reduced-motion media change updates auto policy live", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/m8-dev-entry.html?live-media-motion");
  const motion = page.locator("aval-player");
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { readiness: string }).readiness
  ), { timeout: 20_000 }).toBe("interactiveReady");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(() => motion.evaluate((element) => {
    const node = element as unknown as {
      readiness: string;
      staticReason: string | null;
      getDiagnostics(): { configuredMotion: string; hostReducedMotion: boolean | null };
    };
    return {
      readiness: node.readiness,
      reason: node.staticReason,
      ...node.getDiagnostics()
    };
  })).toMatchObject({
    readiness: "staticReady",
    reason: "reduced-motion",
    configuredMotion: "auto",
    hostReducedMotion: true
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { readiness: string }).readiness
  )).toBe("interactiveReady");
});
