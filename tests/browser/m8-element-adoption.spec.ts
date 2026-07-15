import { expect, test } from "@playwright/test";

test("public element loads the real M7 asset, exposes authored data, and cleans up", async ({ page }) => {
  await page.goto("/m8-dev-entry.html");
  const motion = page.locator("aval-player");
  await expect.poll(
    () => motion.evaluate((element) =>
      (element as unknown as { readiness: string }).readiness
    ),
    { timeout: 20_000 }
  ).toMatch(/^(interactiveReady|staticReady)$/u);
  const prepared = await motion.evaluate(async (element) => {
    const publicElement = element as unknown as {
      prepare(): Promise<{ mode: string }>;
      stateNames: readonly string[];
      eventNames: readonly string[];
      inputBindings: readonly unknown[];
      mode: string | null;
      readiness: string;
      getDiagnostics(): Record<string, unknown>;
    };
    const result = await publicElement.prepare();
    return {
      result,
      stateNames: publicElement.stateNames,
      eventNames: publicElement.eventNames,
      bindings: publicElement.inputBindings,
      mode: publicElement.mode,
      readiness: publicElement.readiness,
      diagnostics: publicElement.getDiagnostics()
    };
  });
  expect(prepared.stateNames.length).toBeGreaterThan(1);
  expect(prepared.eventNames.length).toBeGreaterThan(0);
  expect(prepared.bindings.length).toBeGreaterThan(0);
  expect(["animated", "static"]).toContain(prepared.mode);
  expect(["interactiveReady", "staticReady"]).toContain(prepared.readiness);

  const terminal = await motion.evaluate(async (element) => {
    const publicElement = element as unknown as {
      dispose(): Promise<void>;
      getDiagnostics(options?: { trace?: boolean }): {
        finalDisposed: boolean;
        readiness: string;
        outstanding: Record<string, number>;
      };
    };
    await publicElement.dispose();
    return publicElement.getDiagnostics({ trace: true });
  });
  expect(terminal.finalDisposed).toBe(true);
  expect(terminal.readiness).toBe("disposed");
  expect(terminal.outstanding).toEqual({ player: 0, decoder: 0, bytes: 0 });
});
