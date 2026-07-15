import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("browser entry reaches only package-root public imports and registers auto entry intentionally", async ({ page }) => {
  await page.goto("/certification.html");
  await page.waitForFunction(() => "avalCertification" in window);
  const facade = await page.evaluate(async () => {
    const specifier = "/src/m8-element-browser-api.ts";
    const module = await import(/* @vite-ignore */ specifier);
    const before = customElements.get("aval-player") !== undefined;
    await module.importAvalAuto();
    return {
      exports: Object.keys(module).sort(),
      before,
      after: customElements.get(module.AVAL_TAG_NAME) !== undefined
    };
  });
  expect(facade.exports).toEqual([
    "AVAL_TAG_NAME",
    "defineAvalElement",
    "importAvalAuto"
  ]);
  expect(facade.before).toBe(true);
  expect(facade.after).toBe(true);

  const source = await readFile("apps/playground/src/certification/app.ts", "utf8");
  expect(source).toContain('from "@aval/element"');
  expect(source).toContain('from "@aval/player-web"');
  expect(source).not.toMatch(/@aval\/.+\/src\/|packages\/.+\/src\//u);
});
