import { expect, test } from "@playwright/test";

test("runs the public end-user interaction", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/");

  const motion = page.locator("#favorite-motion");
  await expect(motion.locator('img[slot="fallback"]')).toHaveAttribute(
    "src",
    "/favorite.png"
  );
  await expect
    .poll(
      () =>
        motion.evaluate(
          (node) =>
            (node as HTMLElement & { readiness: string }).readiness
        ),
      { timeout: 20_000 }
    )
    .toBe("interactiveReady");

  await expect(page.locator("#runtime-status")).toContainText("idle");
  await page.locator("#toggle-state").click();
  await expect
    .poll(() =>
      motion.evaluate(
        (node) =>
          (node as HTMLElement & { visualState: string | null }).visualState
      )
    )
    .toBe("engaged");
  await expect(page.locator("#runtime-status")).toContainText("engaged");
  await expect(page.locator("#toggle-state")).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  expect(consoleErrors).toEqual([]);
});
