import { expect, test } from "@playwright/test";

test("pre-definition framework properties upgrade and same-task config coalesces", async ({ page }) => {
  await page.goto("/m8-no-js.html");
  const result = await page.evaluate(async () => {
    const element = document.createElement("aval-player") as unknown as
      HTMLElement & Record<string, unknown>;
    element.src = "";
    element.state = "idle";
    element.motion = "reduce";
    document.body.append(element);
    const apiPath = "/src/m8-element-browser-api.ts";
    const api = await import(apiPath);
    api.defineAvalElement();
    element.src = "/first.avl";
    element.src = "";
    element.state = "newest";
    await Promise.resolve();
    return {
      src: element.src,
      state: element.state,
      motion: element.motion,
      generations: (element as unknown as { getDiagnostics(): { sourceGeneration: number } }).getDiagnostics().sourceGeneration
    };
  });
  expect(result).toEqual({ src: "", state: "newest", motion: "reduce", generations: 0 });
});

test("invalid property writes throw without mutation", async ({ page }) => {
  await page.goto("/m8-no-js.html");
  const result = await page.evaluate(async () => {
    const apiPath = "/src/m8-element-browser-api.ts";
    const api = await import(apiPath);
    api.defineAvalElement();
    const element = document.createElement("aval-player") as unknown as
      HTMLElement & Record<string, unknown>;
    element.motion = "full";
    let threw = false;
    try { element.motion = "maybe"; } catch { threw = true; }
    return { threw, motion: element.motion };
  });
  expect(result).toEqual({ threw: true, motion: "full" });
});

test("removing declarative state returns to the authored initial state", async ({ page }) => {
  await page.goto("/m8-dev-entry.html?state-default");
  const motion = page.locator("aval-player");
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { readiness: string }).readiness
  ), { timeout: 20_000 }).toBe("interactiveReady");
  await motion.evaluate((element) => {
    (element as unknown as { state: string | null }).state = "hover";
  });
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { visualState: string | null }).visualState
  )).toBe("hover");
  await motion.evaluate((element) => {
    (element as unknown as { state: string | null }).state = null;
  });
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { visualState: string | null }).visualState
  )).toBe("idle");
});

test("removing declarative state supersedes an in-flight imperative command", async ({ page }) => {
  await page.goto("/m8-dev-entry.html?state-default-supersession");
  const motion = page.locator("aval-player");
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { readiness: string }).readiness
  ), { timeout: 20_000 }).toBe("interactiveReady");
  const result = await motion.evaluate(async (element) => {
    const node = element as unknown as {
      state: string | null;
      requestedState: string | null;
      visualState: string | null;
      pause(): void;
      setState(name: string): Promise<void>;
      getDiagnostics(): { elementOwnership: { pendingCommandCount: number } };
    };
    node.state = "idle";
    await Promise.resolve();
    node.pause();
    const pending = node.setState("hover");
    while (node.requestedState !== "hover") {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    node.state = null;
    let rejection = "";
    try { await pending; }
    catch (error) { rejection = error instanceof Error ? error.name : "unknown"; }
    const deadline = performance.now() + 5_000;
    while (String(node.requestedState) !== "idle" && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return {
      rejection,
      requestedState: node.requestedState,
      visualState: node.visualState,
      pendingCommands: node.getDiagnostics().elementOwnership.pendingCommandCount
    };
  });
  expect(result).toEqual({
    rejection: "AbortError",
    requestedState: "idle",
    visualState: "idle",
    pendingCommands: 0
  });
});

test("imperative state intent is generation-scoped across source replacement", async ({ page }) => {
  await page.goto("/m8-dev-entry.html?imperative-state-rebase");
  const motion = page.locator("aval-player");
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { readiness: string }).readiness
  ), { timeout: 20_000 }).toBe("interactiveReady");
  await motion.evaluate(async (element) => {
    const node = element as unknown as { setState(name: string): Promise<void> };
    await node.setState("hover");
  });
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { visualState: string | null }).visualState
  )).toBe("hover");
  const before = await motion.evaluate((element) =>
    (element as unknown as { getDiagnostics(): { sourceGeneration: number } })
      .getDiagnostics().sourceGeneration
  );
  await motion.evaluate((element) => {
    const node = element as unknown as {
      src: string;
      state: string | null;
      bindings: string;
    };
    node.bindings = "none";
    node.src = "/__m8__/asset?fixture=user-states&session=m8-imperative-rebase-target";
  });
  await expect.poll(() => motion.evaluate((element) => {
    const node = element as unknown as {
      state: string | null;
      requestedState: string | null;
      visualState: string | null;
      readiness: string;
      getDiagnostics(): { sourceGeneration: number; lastFailure: unknown };
    };
    return {
      generation: node.getDiagnostics().sourceGeneration,
      readiness: node.readiness,
      state: node.state,
      requestedState: node.requestedState,
      visualState: node.visualState,
      lastFailure: node.getDiagnostics().lastFailure
    };
  }), { timeout: 20_000 }).toEqual({
    generation: before + 1,
    readiness: "interactiveReady",
    state: null,
    requestedState: "idle",
    visualState: "idle",
    lastFailure: null
  });
});

test("explicit declarative state persists across compatible source replacement", async ({ page }) => {
  await page.goto("/m8-dev-entry.html?declarative-state-rebase");
  const motion = page.locator("aval-player");
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { readiness: string }).readiness
  ), { timeout: 20_000 }).toBe("interactiveReady");
  const before = await motion.evaluate((element) => {
    const node = element as unknown as {
      state: string | null;
      getDiagnostics(): { sourceGeneration: number };
    };
    node.state = "hover";
    return node.getDiagnostics().sourceGeneration;
  });
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { visualState: string | null }).visualState
  )).toBe("hover");
  await motion.evaluate((element) => {
    (element as unknown as { src: string }).src =
      "/__m8__/asset?fixture=user-states&session=m8-declarative-rebase-target";
  });
  await expect.poll(() => motion.evaluate((element) => {
    const node = element as unknown as {
      state: string | null;
      requestedState: string | null;
      visualState: string | null;
      readiness: string;
      getDiagnostics(): { sourceGeneration: number; lastFailure: unknown };
    };
    return {
      generation: node.getDiagnostics().sourceGeneration,
      readiness: node.readiness,
      state: node.state,
      requestedState: node.requestedState,
      visualState: node.visualState,
      lastFailure: node.getDiagnostics().lastFailure
    };
  }), { timeout: 20_000 }).toEqual({
    generation: before + 1,
    readiness: "interactiveReady",
    state: "hover",
    requestedState: "hover",
    visualState: "hover",
    lastFailure: null
  });
});
