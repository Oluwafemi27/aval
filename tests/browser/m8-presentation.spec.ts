import { expect, test } from "@playwright/test";

test("fit and resize use one exact animated geometry", async ({ page }) => {
  await page.goto("/m8-dev-entry.html?presentation");
  const motion = page.locator("aval-player");
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { readiness: string }).readiness
  ), { timeout: 20_000 }).toBe("interactiveReady");
  for (const fit of ["contain", "cover", "fill", "none"] as const) {
    await motion.evaluate((element, nextFit) => {
      const node = element as HTMLElement & { fit: string };
      node.style.width = "221.5px";
      node.style.height = "117.25px";
      node.fit = nextFit;
    }, fit);
    await expect.poll(() => motion.evaluate((element) =>
      (element as unknown as {
        getDiagnostics(): { presentation: { fit: string | null } };
      }).getDiagnostics().presentation.fit
    )).toBe(fit);
    const presentation = await motion.evaluate((element) =>
      (element as unknown as {
        getDiagnostics(): { presentation: Record<string, unknown> };
      }).getDiagnostics().presentation
    );
    expect(presentation).toMatchObject({ fit });
    expect(presentation.backingWidth as number).toBeGreaterThan(0);
    expect(presentation.backingHeight as number).toBeGreaterThan(0);
  }
});

test("a real browser DPR change rebuilds the resolution query and backing", async ({ page }) => {
  test.skip(
    page.context().browser()?.browserType().name() !== "chromium",
    "CDP live DPR proof is Chromium-specific; broker unit coverage is engine-neutral"
  );
  await page.goto("/m8-dev-entry.html?dpr-change");
  const motion = page.locator("aval-player");
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { readiness: string }).readiness
  ), { timeout: 20_000 }).toBe("interactiveReady");
  const before = await motion.evaluate((element) =>
    (element as unknown as {
      getDiagnostics(): {
        resizeGeneration: number;
        presentation: { effectiveDprX: number };
      };
    }).getDiagnostics()
  );
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 720,
    deviceScaleFactor: 2,
    mobile: false
  });
  const emulatedDpr = await page.evaluate(() => {
    window.dispatchEvent(new Event("resize"));
    return window.devicePixelRatio;
  });
  expect(emulatedDpr).toBe(2);
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as {
      getDiagnostics(): {
        resizeGeneration: number;
        presentation: { effectiveDprX: number };
      };
    }).getDiagnostics()
  )).toMatchObject({
    resizeGeneration: expect.any(Number),
    presentation: { effectiveDprX: 2 }
  });
  const after = await motion.evaluate((element) =>
    (element as unknown as { getDiagnostics(): { resizeGeneration: number } })
      .getDiagnostics().resizeGeneration
  );
  expect(after).toBeGreaterThan(before.resizeGeneration);
  await session.send("Emulation.clearDeviceMetricsOverride");
  await session.detach();
});
