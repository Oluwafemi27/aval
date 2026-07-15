import { expect, test } from "@playwright/test";

test("all fixed browser sources route into arbitrary authored events", async ({ page }) => {
  await page.goto("/m8-dev-entry.html?all-bindings");
  const motion = page.locator("aval-player");
  const control = page.locator("#m8-interaction");
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { readiness: string }).readiness
  ), { timeout: 20_000 }).toBe("interactiveReady");

  await control.hover();
  await control.focus();
  const before = await motion.evaluate((element) =>
    (element as unknown as { getDiagnostics(): { sourceGeneration: number } })
      .getDiagnostics().sourceGeneration
  );
  await motion.evaluate((element) => {
    (element as unknown as { src: string }).src =
      "/__m8__/asset?fixture=user-states&session=m8-all-bindings";
  });
  await expect.poll(() => motion.evaluate((element) => {
    const node = element as unknown as {
      readiness: string;
      visualState: string | null;
      getDiagnostics(): { sourceGeneration: number };
    };
    return {
      generation: node.getDiagnostics().sourceGeneration,
      readiness: node.readiness,
      visual: node.visualState
    };
  }), { timeout: 20_000 }).toEqual({
    generation: before + 1,
    readiness: "interactiveReady",
    visual: "hover"
  });

  const initialKinds = await traceKinds(motion);
  expect(initialKinds).toEqual(expect.arrayContaining([
    "input-pointer-enter",
    "input-focus-in",
    "input-engagement-on"
  ]));
  const engagementOffBefore = count(initialKinds, "input-engagement-off");
  await page.mouse.move(1, 1);
  await expect.poll(async () => count(await traceKinds(motion), "input-pointer-leave"))
    .toBeGreaterThan(0);
  expect(count(await traceKinds(motion), "input-engagement-off"))
    .toBe(engagementOffBefore);

  await page.locator("h1").click();
  await expect.poll(async () => count(await traceKinds(motion), "input-engagement-off"))
    .toBe(engagementOffBefore + 1);

  await control.focus();
  await motion.evaluate(async (element) => {
    await (element as unknown as { setState(state: string): Promise<void> })
      .setState("idle");
  });
  await page.keyboard.press("Enter");
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { requestedState: string | null }).requestedState
  )).toBe("loading");

  await motion.evaluate(async (element) => {
    await (element as unknown as { setState(state: string): Promise<void> })
      .setState("idle");
  });
  const pointerEnters = count(await traceKinds(motion), "input-pointer-enter");
  await control.dispatchEvent("pointerenter", { pointerType: "touch" });
  await page.waitForTimeout(50);
  expect(count(await traceKinds(motion), "input-pointer-enter")).toBe(pointerEnters);

  await motion.evaluate((element) => {
    (element as unknown as { interactionFor: string }).interactionFor = "missing-target";
  });
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as {
      getDiagnostics(): { lastFailure: { code: string } | null };
    }).getDiagnostics().lastFailure?.code
  )).toBe("interaction-target-unavailable");
  await motion.evaluate((element) => {
    const node = element as unknown as { interactionTarget: Element | null };
    node.interactionTarget = document.querySelector("#m8-interaction");
  });

  await motion.evaluate(async (element) => {
    await (element as unknown as { setState(state: string): Promise<void> })
      .setState("hover");
    (element as HTMLElement).style.display = "none";
  });
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { visualState: string | null }).visualState
  )).toBe("idle");
  await motion.evaluate((element) => {
    (element as HTMLElement).style.display = "inline-block";
  });
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { visualState: string | null }).visualState
  ), { timeout: 20_000 }).toBe("hover");
});

async function traceKinds(locator: import("@playwright/test").Locator): Promise<string[]> {
  return locator.evaluate((element) =>
    (element as unknown as {
      getDiagnostics(options: { trace: boolean }): {
        elementTrace: readonly { kind: string }[];
      };
    }).getDiagnostics({ trace: true }).elementTrace.map(({ kind }) => kind)
  );
}

function count(values: readonly string[], value: string): number {
  return values.filter((entry) => entry === value).length;
}
