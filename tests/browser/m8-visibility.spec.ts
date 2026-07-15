import { expect, test } from "@playwright/test";

test("zero-size suspension preserves newest state and rebuilds on visibility", async ({ page }) => {
  await page.goto("/m8-dev-entry.html?visibility");
  const motion = page.locator("aval-player");
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { readiness: string }).readiness
  ), { timeout: 20_000 }).toBe("interactiveReady");
  await motion.evaluate((element) => { (element as HTMLElement).style.display = "none"; });
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { effectivelyVisible: boolean }).effectivelyVisible
  )).toBe(false);
  await motion.evaluate(async (element) => {
    await (element as unknown as { setState(state: string): Promise<void> }).setState("hover");
  });
  expect(await motion.evaluate((element) =>
    (element as unknown as { visualState: string | null }).visualState
  )).toBe("hover");
  await motion.evaluate((element) => { (element as HTMLElement).style.display = "inline-block"; });
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { effectivelyVisible: boolean }).effectivelyVisible
  )).toBe(true);
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { readiness: string }).readiness
  )).toBe("interactiveReady");
});

test("real BFCache pagehide/pageshow restores visibility and resumes", async ({ page }) => {
  await page.goto("/__m8__/bfcache");
  const motion = page.locator("aval-player");
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { readiness: string }).readiness
  ), { timeout: 20_000 }).toBe("interactiveReady");
  await page.goto("/__m8__/bfcache-away");
  await page.goBack({ waitUntil: "commit" });
  const restore = await page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0] as
      PerformanceNavigationTiming & { notRestoredReasons?: unknown };
    return {
      persisted: (window as unknown as { m8BfcacheRestored?: boolean }).m8BfcacheRestored,
      navigationType: navigation.type,
      notRestoredReasons: navigation.notRestoredReasons ?? null
    };
  });
  expect(restore.persisted, JSON.stringify(restore)).toBe(true);
  await expect.poll(() => motion.evaluate((element) => {
    const node = element as unknown as {
      readiness: string;
      effectivelyVisible: boolean;
      getDiagnostics(options: { trace: boolean }): {
        elementTrace?: Array<{ kind: string }>;
        visibility: { runtimeVisibility: string | null };
      };
    };
    const diagnostics = node.getDiagnostics({ trace: true });
    return {
      readiness: node.readiness,
      visible: node.effectivelyVisible,
      runtimeVisibility: diagnostics.visibility.runtimeVisibility,
      restored: diagnostics.elementTrace?.some(({ kind }) => kind === "bfcache-restore")
    };
  }), { timeout: 20_000 }).toMatchObject({
    readiness: "interactiveReady",
    visible: true,
    runtimeVisibility: "visible",
    restored: true
  });
});
