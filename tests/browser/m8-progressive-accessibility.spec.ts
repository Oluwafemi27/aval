import { expect, test } from "@playwright/test";

test("JavaScript-disabled fallback remains visible and sized", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/m8-no-js.html");
  const fallback = page.locator("aval-player > img");
  await expect(fallback).toBeVisible();
  expect(await page.locator("aval-player").boundingBox()).toMatchObject({
    width: 96,
    height: 96
  });
  await context.close();
});

test("native control owns name, focus, keyboard activation, and semantic state", async ({ page }) => {
  await page.goto("/m8-no-js.html");
  await page.evaluate(async () => {
    const modulePath = "/src/m8-accessible-control.ts";
    const { mountAccessibleAvalControl } = await import(modulePath);
    mountAccessibleAvalControl(document.body);
  });
  const button = page.getByRole("button", { name: "Favorite" });
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Tab");
  await expect(button).toBeFocused();
  await page.keyboard.press("Space");
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Enter");
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  const primitive = button.locator("aval-player");
  expect(await primitive.evaluate((element) => ({
    role: element.getAttribute("role"),
    tabindex: element.getAttribute("tabindex"),
    live: element.getAttribute("aria-live"),
    hidden: element.getAttribute("aria-hidden")
  }))).toEqual({ role: null, tabindex: null, live: null, hidden: "true" });
});

test("a failed foreign-definition collision leaves author fallback intact", async ({ page }) => {
  await page.goto("/m8-no-js.html");
  const result = await page.evaluate(async () => {
    class Foreign extends HTMLElement {}
    customElements.define("aval-player", Foreign);
    const modulePath = "/src/m8-element-browser-api.ts";
    const api = await import(modulePath);
    let name: string | null = null;
    try { api.defineAvalElement(); }
    catch (error) { name = error instanceof Error ? error.name : null; }
    const fallback = document.querySelector("aval-player > img")!;
    return {
      name,
      visible: fallback.getClientRects().length > 0,
      width: document.querySelector("aval-player")!.getBoundingClientRect().width
    };
  });
  expect(result).toEqual({ name: "NotSupportedError", visible: true, width: 96 });
});
