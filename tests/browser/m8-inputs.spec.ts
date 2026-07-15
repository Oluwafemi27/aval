import { expect, test } from "@playwright/test";

test("native click routes the authored activate binding without keyboard synthesis", async ({ page }) => {
  await page.goto("/m8-dev-entry.html?inputs");
  const motion = page.locator("aval-player");
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { readiness: string }).readiness
  ), { timeout: 20_000 }).toBe("interactiveReady");
  await page.locator("#m8-interaction").focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { requestedState: string | null }).requestedState
  )).toBe("loading");
});

test("bindings none removes automatic routing but preserves direct send", async ({ page }) => {
  await page.goto("/m8-dev-entry.html?bindings-none");
  const motion = page.locator("aval-player");
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { readiness: string }).readiness
  ), { timeout: 20_000 }).toBe("interactiveReady");
  await motion.evaluate((element) => {
    (element as unknown as { bindings: string }).bindings = "none";
  });
  await page.locator("#m8-interaction").click();
  await page.waitForTimeout(100);
  expect(await motion.evaluate((element) =>
    (element as unknown as { requestedState: string | null }).requestedState
  )).toBe("idle");
  expect(await motion.evaluate((element) =>
    (element as unknown as { send(event: string): boolean }).send("activate-loading")
  )).toBe(true);
});

test("automatic focus sampling follows the interaction target shadow root", async ({ page }) => {
  await page.goto("/m8-dev-entry.html?shadow-focus-input");
  const motion = page.locator("aval-player");
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { readiness: string }).readiness
  ), { timeout: 20_000 }).toBe("interactiveReady");
  const before = await motion.evaluate((element) => {
    const generation = (element as unknown as {
      getDiagnostics(): { sourceGeneration: number };
    }).getDiagnostics().sourceGeneration;
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const control = document.createElement("button");
    shadow.append(control, element);
    document.body.append(host);
    control.focus();
    (element as unknown as { interactionTarget: Element | null }).interactionTarget = control;
    return generation;
  });
  await expect.poll(() => motion.evaluate((element) => {
    const node = element as unknown as {
      readiness: string;
      getDiagnostics(): { sourceGeneration: number };
    };
    return {
      readiness: node.readiness,
      generation: node.getDiagnostics().sourceGeneration
    };
  }), { timeout: 20_000 }).toEqual({
    readiness: "interactiveReady",
    generation: before + 1
  });
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as {
      getDiagnostics(options: { trace: boolean }): {
        elementTrace: readonly { kind: string }[];
      };
    }).getDiagnostics({ trace: true }).elementTrace
      .filter(({ kind }) => kind === "input-focus-in").length
  )).toBe(1);
});

test("touch pointer hover does not become sticky during source metadata sampling", async ({ page }) => {
  await page.goto("/m8-dev-entry.html?touch-hover-input");
  const motion = page.locator("aval-player");
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { readiness: string }).readiness
  ), { timeout: 20_000 }).toBe("interactiveReady");
  const before = await motion.evaluate((element) => {
    const node = element as unknown as {
      src: string;
      getDiagnostics(options?: { trace: boolean }): {
        sourceGeneration: number;
        elementTrace?: readonly { kind: string }[];
      };
    };
    const target = document.querySelector("#m8-interaction");
    if (!(target instanceof HTMLElement)) throw new Error("interaction target missing");
    const nativeMatches = target.matches.bind(target);
    Object.defineProperty(target, "matches", {
      configurable: true,
      value: (selector: string) => selector === ":hover" || nativeMatches(selector)
    });
    target.dispatchEvent(new PointerEvent("pointerenter", { pointerType: "touch" }));
    const diagnostics = node.getDiagnostics({ trace: true });
    node.src = "/__m7__/asset?session=m8-touch-hover-reload&scenario=exact-range";
    return {
      generation: diagnostics.sourceGeneration,
      pointerEnters: diagnostics.elementTrace
        ?.filter(({ kind }) => kind === "input-pointer-enter").length ?? 0
    };
  });
  await expect.poll(() => motion.evaluate((element) => {
    const node = element as unknown as {
      readiness: string;
      getDiagnostics(options: { trace: boolean }): {
        sourceGeneration: number;
        elementTrace: readonly { kind: string }[];
      };
    };
    const diagnostics = node.getDiagnostics({ trace: true });
    return {
      generation: diagnostics.sourceGeneration,
      readiness: node.readiness,
      pointerEnters: diagnostics.elementTrace
        .filter(({ kind }) => kind === "input-pointer-enter").length
    };
  }), { timeout: 20_000 }).toEqual({
    generation: before.generation + 1,
    readiness: "interactiveReady",
    pointerEnters: before.pointerEnters
  });
});
