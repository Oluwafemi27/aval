import { expect, test } from "@playwright/test";

test("shadow layers are ordered, inert, and preserve the author fallback", async ({ page }) => {
  await page.goto("/m8-no-js.html");
  const result = await page.evaluate(async () => {
    const apiPath = "/src/m8-element-browser-api.ts";
    const api = await import(apiPath);
    api.defineAvalElement();
    const element = document.createElement("aval-player");
    const fallback = document.createElement("span");
    fallback.slot = "fallback";
    fallback.textContent = "fallback";
    element.append(fallback);
    document.body.append(element);
    const layers = [...element.shadowRoot!.children]
      .filter((node) => node instanceof HTMLElement && node.dataset.avalLayer)
      .map((node) => ({
        layer: (node as HTMLElement).dataset.avalLayer,
        hidden: (node as HTMLElement).hidden,
        ariaHidden: (node as HTMLElement).getAttribute("aria-hidden")
      }));
    return {
      layers,
      fallbackStillOwned: element.firstElementChild === fallback,
      preMetadataBox: {
        width: element.getBoundingClientRect().width,
        height: element.getBoundingClientRect().height
      },
      adoptedSheets: element.shadowRoot!.adoptedStyleSheets.length,
      role: element.getAttribute("role"),
      tabindex: element.getAttribute("tabindex")
    };
  });
  expect(result.fallbackStillOwned).toBe(true);
  expect(result.role).toBeNull();
  expect(result.tabindex).toBeNull();
  expect(result.adoptedSheets).toBe(1);
  expect(result.preMetadataBox.width).toBeGreaterThan(0);
  expect(result.preMetadataBox.height).toBeGreaterThan(0);
  expect(result.layers.map(({ layer }) => layer)).toEqual([
    "fallback", "animated"
  ]);
  expect(result.layers.find(({ layer }) => layer === "fallback")?.hidden).toBe(false);
});

test("missing constructed stylesheet support leaves the fallback usable and never starts media", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "CSSStyleSheet", {
      value: undefined,
      configurable: true
    });
  });
  await page.goto("/m8-no-js.html");
  const result = await page.locator("aval-player").evaluate(async (element) => {
    element.removeAttribute("src");
    const apiPath = "/src/m8-element-browser-api.ts";
    const api = await import(apiPath);
    api.defineAvalElement();
    const node = element as unknown as {
      src: string;
      readiness: string;
      getDiagnostics(): { lastFailure: { code: string } | null };
    };
    node.src = "/__m8__/asset?fixture=one-state&session=m8-no-constructed-css";
    await new Promise((resolve) => setTimeout(resolve, 100));
    const fallback = element.querySelector<HTMLElement>("[slot=fallback]");
    return {
      readiness: node.readiness,
      failure: node.getDiagnostics().lastFailure,
      fallbackVisible: (fallback?.getClientRects().length ?? 0) > 0,
      sheets: element.shadowRoot?.adoptedStyleSheets.length ?? 0
    };
  });
  expect(result).toMatchObject({
    readiness: "unready",
    failure: { code: "unsupported-browser" },
    fallbackVisible: true,
    sheets: 0
  });
  const metrics = await page.request.get("/__m8__/metrics?session=m8-no-constructed-css");
  expect((await metrics.json()).requests).toEqual([]);
});
