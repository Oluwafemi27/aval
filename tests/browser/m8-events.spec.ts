import { expect, test } from "@playwright/test";

test("DOM events stage properties before dispatch and promises settle last", async ({ page }) => {
  await page.goto("/m8-dev-entry.html?events");
  const motion = page.locator("aval-player");
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { readiness: string }).readiness
  ), { timeout: 20_000 }).toBe("interactiveReady");
  const trace = await motion.evaluate(async (element) => {
    const motion = element as unknown as {
      visualState: string | null;
      requestedState: string | null;
      isTransitioning: boolean;
      setState(state: string): Promise<void>;
      addEventListener(type: string, listener: (event: CustomEvent) => void): void;
    };
    const trace: string[] = [];
    for (const type of [
      "requestedstatechange",
      "transitionstart",
      "visualstatechange",
      "transitionend"
    ]) {
      motion.addEventListener(type, () => {
        trace.push(`${type}:${motion.requestedState}:${motion.visualState}:${String(motion.isTransitioning)}`);
      });
    }
    await motion.setState("hover");
    trace.push(`promise:${motion.requestedState}:${motion.visualState}:${String(motion.isTransitioning)}`);
    return trace;
  });
  expect(trace[0]).toMatch(/^requestedstatechange:hover:idle:/u);
  expect(trace).toContain("visualstatechange:hover:hover:true");
  expect(trace.at(-1)).toBe("promise:hover:hover:false");
});

test("listener-triggered state work starts only after the current settlement", async ({ page }) => {
  await page.goto("/m8-dev-entry.html?event-reentrancy");
  const motion = page.locator("aval-player");
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { readiness: string }).readiness
  ), { timeout: 20_000 }).toBe("interactiveReady");
  const result = await motion.evaluate(async (element) => {
    const node = element as unknown as {
      requestedState: string | null;
      visualState: string | null;
      setState(state: string): Promise<void>;
      addEventListener(type: string, listener: (event: CustomEvent) => void, options?: { once: boolean }): void;
    };
    const order: string[] = [];
    let reentrant: Promise<void> | null = null;
    node.addEventListener("transitionend", (event) => {
      if (event.detail.to !== "hover") return;
      order.push("listener");
      reentrant = node.setState("idle").then(() => { order.push("reentrant-settled"); });
    }, { once: true });
    await node.setState("hover");
    order.push("first-settled");
    await reentrant;
    return {
      order,
      requested: node.requestedState,
      visual: node.visualState
    };
  });
  expect(result).toEqual({
    order: ["listener", "first-settled", "reentrant-settled"],
    requested: "idle",
    visual: "idle"
  });
});

test("authored event acceptance remains exact during listener reentrancy", async ({ page }) => {
  await page.goto("/m8-dev-entry.html?event-send-deferral");
  const motion = page.locator("aval-player");
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { readiness: string }).readiness
  ), { timeout: 20_000 }).toBe("interactiveReady");
  const result = await motion.evaluate(async (element) => {
    const node = element as unknown as {
      requestedState: string | null;
      setState(name: string): Promise<void>;
      send(name: string): boolean;
      addEventListener(type: string, listener: (event: CustomEvent<{ to: string }>) => void): void;
    };
    let inListener = false;
    let nested = false;
    let accepted = false;
    let during: string | null = null;
    node.addEventListener("requestedstatechange", (event) => {
      if (event.detail.to === "idle" && inListener) nested = true;
    });
    node.addEventListener("transitionend", (event) => {
      if (event.detail.to !== "hover") return;
      inListener = true;
      accepted = node.send("hover-off");
      during = node.requestedState;
      inListener = false;
    });
    await node.setState("hover");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const afterDispatch = node.requestedState;
    const acceptedAfter = node.send("hover-off");
    for (let attempt = 0; attempt < 200 && node.requestedState !== "idle"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return {
      accepted,
      during,
      nested,
      afterDispatch,
      acceptedAfter,
      after: node.requestedState
    };
  });
  expect(result).toEqual({
    accepted: true,
    during: "hover",
    nested: false,
    afterDispatch: "idle",
    acceptedAfter: true,
    after: "idle"
  });
});

test("listener-triggered source replacement invalidates only after dispatch exits", async ({ page }) => {
  await page.goto("/m8-dev-entry.html?event-source-deferral");
  const motion = page.locator("aval-player");
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { readiness: string }).readiness
  ), { timeout: 20_000 }).toBe("interactiveReady");
  const result = await motion.evaluate(async (element) => {
    const node = element as unknown as {
      src: string;
      setState(name: string): Promise<void>;
      getDiagnostics(): {
        sourceGeneration: number;
        finalDisposed: boolean;
        cleanup: { completed: boolean } | null;
      };
      addEventListener(type: string, listener: (event: CustomEvent<{ to: string }>) => void, options?: { once?: boolean }): void;
    };
    const before = node.getDiagnostics().sourceGeneration;
    let during = -1;
    const dispatched = new Promise<void>((resolve) => {
      node.addEventListener("requestedstatechange", (event) => {
        if (event.detail.to !== "loading") return;
        node.src = "/__m7__/asset?session=m8-event-source-next&scenario=exact-range";
        during = node.getDiagnostics().sourceGeneration;
        resolve();
      }, { once: true });
    });
    await node.setState("loading").catch(() => undefined);
    await dispatched;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const current = node.getDiagnostics();
      if (current.sourceGeneration === before + 1) {
        return { before, during, after: current.sourceGeneration };
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return { before, during, after: node.getDiagnostics().sourceGeneration };
  });
  expect(result).toEqual({
    before: result.before,
    during: result.before,
    after: result.before + 1
  });
});

test("listener-triggered disposal becomes terminal only after dispatch exits", async ({ page }) => {
  await page.goto("/m8-dev-entry.html?event-dispose-deferral");
  const motion = page.locator("aval-player");
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { readiness: string }).readiness
  ), { timeout: 20_000 }).toBe("interactiveReady");
  const result = await motion.evaluate(async (element) => {
    const node = element as unknown as {
      setState(name: string): Promise<void>;
      dispose(): Promise<void>;
      getDiagnostics(): {
        sourceGeneration: number;
        finalDisposed: boolean;
        terminalCleanup: { completed: boolean } | null;
        elementOwnership: { completed: boolean };
      };
      addEventListener(type: string, listener: (event: CustomEvent<{ to: string }>) => void, options?: { once?: boolean }): void;
    };
    const before = node.getDiagnostics().sourceGeneration;
    let during: ReturnType<typeof node.getDiagnostics> | null = null;
    let disposal: Promise<void> = Promise.resolve();
    const dispatched = new Promise<void>((resolve) => {
      node.addEventListener("requestedstatechange", (event) => {
        if (event.detail.to !== "loading") return;
        disposal = node.dispose();
        during = node.getDiagnostics();
        resolve();
      }, { once: true });
    });
    await node.setState("loading").catch(() => undefined);
    await dispatched;
    await disposal;
    return { before, during, after: node.getDiagnostics() };
  });
  expect(result.during).toMatchObject({
    sourceGeneration: result.before,
    finalDisposed: false
  });
  expect(result.after).toMatchObject({
    finalDisposed: true,
    terminalCleanup: { completed: true },
    elementOwnership: { completed: true }
  });
});
