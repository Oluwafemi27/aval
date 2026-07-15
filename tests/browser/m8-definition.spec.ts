import { expect, test } from "@playwright/test";

import { buildIndependentElementBundles } from "./m8-definition-bundle-copies.js";

test("root definition is explicit, idempotent, and compatible", async ({ page }) => {
  await page.goto("/m8-no-js.html");
  const result = await page.evaluate(async () => {
    const apiPath = "/src/m8-element-browser-api.ts";
    const api = await import(apiPath);
    const before = customElements.get("aval-player") ?? null;
    const first = api.defineAvalElement();
    const second = api.defineAvalElement();
    const element = document.createElement("aval-player");
    return {
      before: before === null,
      same: first === second && second === customElements.get("aval-player"),
      upgraded: element.shadowRoot !== null
    };
  });
  expect(result).toEqual({ before: true, same: true, upgraded: true });
});

test("auto entry registers in an otherwise fresh page", async ({ page }) => {
  await page.goto("/m8-no-js.html");
  await page.evaluate(async () => {
    const apiPath = "/src/m8-element-browser-api.ts";
    const api = await import(apiPath);
    await api.importAvalAuto();
  });
  expect(await page.evaluate(() => customElements.get("aval-player") !== undefined)).toBe(true);
});

test("two independently bundled public package copies share one compatible definition", async ({ page }) => {
  const [copyA, copyB] = await buildIndependentElementBundles();
  expect(copyA.bytes).toBeGreaterThan(0);
  expect(copyB.bytes).toBeGreaterThan(0);
  await page.route("**/__m8-element-copy-a.js", (route) => route.fulfill({
    status: 200,
    contentType: "text/javascript; charset=utf-8",
    headers: { "Cache-Control": "no-store" },
    body: copyA.code
  }), { times: 1 });
  await page.route("**/__m8-element-copy-b.js", (route) => route.fulfill({
    status: 200,
    contentType: "text/javascript; charset=utf-8",
    headers: { "Cache-Control": "no-store" },
    body: copyB.code
  }), { times: 1 });
  await page.goto("/m8-no-js.html");
  const result = await page.evaluate(async ([copyAUrl, copyBUrl]) => {
    type ElementPublicEntry = Readonly<{
      defineAvalElement: () => CustomElementConstructor;
      AVAL_TAG_NAME: string;
    }>;
    const [firstCopy, secondCopy] = await Promise.all([
      import(copyAUrl) as Promise<ElementPublicEntry>,
      import(copyBUrl) as Promise<ElementPublicEntry>
    ]);
    const independentEvaluation = firstCopy.defineAvalElement !== secondCopy.defineAvalElement;
    const before = customElements.get(firstCopy.AVAL_TAG_NAME);
    const firstConstructor = firstCopy.defineAvalElement();
    const secondResult = secondCopy.defineAvalElement();
    const created = document.createElement(firstCopy.AVAL_TAG_NAME) as HTMLElement & { getDiagnostics?: unknown };
    return {
      before: before === undefined,
      independentEvaluation,
      samePublicTag: firstCopy.AVAL_TAG_NAME === secondCopy.AVAL_TAG_NAME,
      reused: firstConstructor === secondResult && customElements.get(firstCopy.AVAL_TAG_NAME) === firstConstructor,
      genuineConstructor: Array.isArray((firstConstructor as typeof HTMLElement & { observedAttributes?: unknown }).observedAttributes) && typeof created.getDiagnostics === "function",
      upgraded: created.shadowRoot !== null
    };
  }, ["/__m8-element-copy-a.js", "/__m8-element-copy-b.js"] as const);
  expect(result).toEqual({
    before: true,
    independentEvaluation: true,
    samePublicTag: true,
    reused: true,
    genuineConstructor: true,
    upgraded: true
  });
});

test("a foreign definition is rejected without replacing it", async ({ page }) => {
  await page.goto("/m8-no-js.html");
  const result = await page.evaluate(async () => {
    class ForeignElement extends HTMLElement {}
    customElements.define("aval-player", ForeignElement);
    const apiPath = "/src/m8-element-browser-api.ts";
    const api = await import(apiPath);
    try {
      api.defineAvalElement();
      return null;
    } catch (error) {
      return {
        name: error instanceof Error ? error.name : null,
        message: error instanceof Error ? error.message : null,
        unchanged: customElements.get("aval-player") === ForeignElement
      };
    }
  });
  expect(result).toEqual({
    name: "NotSupportedError",
    message: "aval-player is already defined by incompatible code",
    unchanged: true
  });
});
