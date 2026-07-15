import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

const VALID_INTEGRITY = (JSON.parse(readFileSync(new URL(
  "../../fixtures/conformance/m7/reference-packed.provenance.json",
  import.meta.url
), "utf8")) as { readonly asset: { readonly externalIntegrity: string } })
  .asset.externalIntegrity;
const INVALID_INTEGRITY = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

test("loader integrity failures preserve the progressive author fallback", async ({ page }) => {
  await page.goto("/m8-dev-entry.html?fallbacks");
  const result = await page.evaluate(async () => {
    const element = document.createElement("aval-player") as HTMLElement & {
      src: string;
      readiness: string;
      getDiagnostics(): { lastFailure: { code: string } | null };
    };
    const fallback = document.createElement("span");
    fallback.slot = "fallback";
    fallback.textContent = "Still useful without animation";
    element.append(fallback);
    document.body.prepend(element);
    let hostErrors = 0;
    let windowErrors = 0;
    element.addEventListener("error", () => { hostErrors += 1; });
    const windowError = (event: Event): void => {
      if (event instanceof CustomEvent && event.target === element) windowErrors += 1;
    };
    window.addEventListener("error", windowError);
    element.src = "/__m7__/asset?session=m8-fatal-unit&scenario=corrupt-bootstrap-unit";
    await waitUntil(() =>
      element.readiness === "staticReady" &&
      element.getDiagnostics().lastFailure !== null,
    20_000);
    const diagnostics = element.getDiagnostics();
    const afterFailure = visibleLayer(element);
    const fallbackVisible = fallback.getClientRects().length > 0;
    window.removeEventListener("error", windowError);
    return {
      afterFailure,
      fallbackVisible,
      hostErrors,
      windowErrors,
      diagnosticText: JSON.stringify(diagnostics),
      failure: diagnostics.lastFailure
    };

    function visibleLayer(host: HTMLElement): string | null {
      return host.shadowRoot?.querySelector<HTMLElement>(
        "[data-aval-layer]:not([hidden])"
      )?.dataset.avalLayer ?? "fallback";
    }
    async function waitUntil(predicate: () => boolean, timeout = 5_000): Promise<void> {
      const deadline = performance.now() + timeout;
      while (!predicate()) {
        if (performance.now() > deadline) throw new Error("public fallback wait timed out");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
  });
  expect(result).toMatchObject({
    afterFailure: "fallback",
    fallbackVisible: true,
    windowErrors: 0
  });
  expect(result.hostErrors).toBeGreaterThanOrEqual(1);
  expect(result.failure).not.toBeNull();
  expect(result.diagnosticText).not.toContain("m8-fatal-unit");
  expect(result.diagnosticText).not.toContain("Still useful without animation");
});

test("external integrity selects bounded full transport and mismatch fails closed", async ({ page }) => {
  await page.goto("/m8-dev-entry.html?integrity");
  const motion = page.locator("aval-player");
  const before = await motion.evaluate((element) =>
    (element as unknown as { getDiagnostics(): { sourceGeneration: number } })
      .getDiagnostics().sourceGeneration
  );
  await motion.evaluate((element, integrity) => {
    const node = element as unknown as { integrity: string; src: string };
    node.integrity = integrity;
    node.src = "/__m7__/asset?session=m8-valid-integrity&scenario=valid-external-integrity";
  }, VALID_INTEGRITY);
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as {
      getDiagnostics(): {
        sourceGeneration: number;
        readiness: string;
        runtime: { transportMode: string };
      };
    }).getDiagnostics()
  ), { timeout: 20_000 }).toMatchObject({
    sourceGeneration: before + 1,
    readiness: "interactiveReady",
    runtime: { transportMode: "full" }
  });

  await motion.evaluate((element, integrity) => {
    const node = element as unknown as { integrity: string; src: string };
    node.integrity = integrity;
    node.src = "/__m7__/asset?session=m8-invalid-integrity&scenario=invalid-external-integrity";
  }, INVALID_INTEGRITY);
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { readiness: string }).readiness
  ), { timeout: 20_000 }).toBe("error");
  const text = await motion.evaluate((element) => JSON.stringify(
    (element as unknown as { getDiagnostics(): unknown }).getDiagnostics()
  ));
  expect(text).not.toContain("m8-invalid-integrity");
  expect(text).not.toContain(INVALID_INTEGRITY);
});

test("cross-origin range loading requires explicit CORS permission", async ({ page }) => {
  await page.goto("/m8-dev-entry.html?cors");
  const motion = page.locator("aval-player");
  await motion.evaluate((element) => {
    const node = element as unknown as {
      crossOrigin: string;
      src: string;
      corsFailureCodes: string[];
    };
    node.corsFailureCodes = [];
    element.addEventListener("error", (event) => {
      const detail = (event as CustomEvent<{
        failure: { code: string; operation: string | null };
        fatal: boolean;
      }>).detail;
      node.corsFailureCodes.push(
        `${detail.failure.code}:${detail.failure.operation ?? "none"}:${String(detail.fatal)}`
      );
    });
    node.crossOrigin = "anonymous";
    node.src = `http://127.0.0.1:${String(Number(location.port) + 1)}/__m8__/asset?fixture=one-state&session=m8-cors-ok&cors=anonymous`;
  });
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { readiness: string }).readiness
  ), { timeout: 20_000 }).toMatch(/^(interactiveReady|staticReady)$/u);
  await motion.evaluate((element) => {
    (element as unknown as { corsFailureCodes: string[] }).corsFailureCodes = [];
  });

  await motion.evaluate((element) => {
    (element as unknown as { src: string }).src =
      `http://127.0.0.1:${String(Number(location.port) + 1)}/__m8__/asset?fixture=one-state&session=m8-cors-denied`;
  });
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { readiness: string }).readiness
  ), { timeout: 20_000 }).toBe("error");
  const result = await motion.evaluate((element) => {
    const node = element as unknown as {
      getDiagnostics(): { lastFailure: { code: string } | null };
      corsFailureCodes: string[];
      dispose(): Promise<void>;
    };
    const diagnostic = node.getDiagnostics();
    const visible = element.shadowRoot?.querySelector<HTMLElement>(
      "[data-aval-layer]:not([hidden])"
    )?.dataset.avalLayer ?? "fallback";
    return node.dispose().then(() => ({
      diagnostic,
      visible,
      failureCodes: node.corsFailureCodes
    }));
  });
  // A real browser keeps the disallowed cross-origin response opaque, so the
  // loader must report a bounded fetch failure rather than pretending it read
  // and classified the forbidden response headers.
  expect(result.failureCodes).toEqual(["load-failure:none:true"]);
  expect(result.diagnostic.lastFailure?.code).toBe("load-failure");
  expect(result.visible).toBe("fallback");
  expect(JSON.stringify(result.diagnostic)).not.toContain("localhost");
});

test("use-credentials is the only cross-origin mode that sends the sentinel cookie", async ({ page, context }) => {
  await page.goto("/m8-dev-entry.html?credentialed-cors");
  const main = new URL(page.url());
  const crossOrigin = `http://127.0.0.1:${String(Number(main.port) + 1)}`;
  await context.addCookies([{
    name: "aval_m8_credential",
    value: "present",
    url: crossOrigin,
    sameSite: "Lax",
    secure: false
  }]);
  const motion = page.locator("aval-player");
  await motion.evaluate((element, origin) => {
    const node = element as unknown as { crossOrigin: string; src: string };
    node.crossOrigin = "anonymous";
    node.src = `${origin}/__m8__/asset?fixture=one-state&session=m8-cookie-anonymous&cors=credentials&requireCredential=1`;
  }, crossOrigin);
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { readiness: string }).readiness
  ), { timeout: 20_000 }).toBe("error");
  await motion.evaluate((element, origin) => {
    const node = element as unknown as { crossOrigin: string; src: string };
    node.crossOrigin = "use-credentials";
    node.src = `${origin}/__m8__/asset?fixture=one-state&session=m8-cookie-credentials&cors=credentials&requireCredential=1`;
  }, crossOrigin);
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { readiness: string }).readiness
  ), { timeout: 20_000 }).toMatch(/^(interactiveReady|staticReady)$/u);
  const anonymous = await (
    await page.request.get(new URL("/__m8__/metrics?session=m8-cookie-anonymous", main).href)
  ).json() as { requests: Array<{ credentialPresent?: boolean }> };
  const credentialed = await (
    await page.request.get(new URL("/__m8__/metrics?session=m8-cookie-credentials", main).href)
  ).json() as { requests: Array<{ credentialPresent?: boolean }> };
  expect(anonymous.requests).toEqual(expect.arrayContaining([
    expect.objectContaining({ credentialPresent: false })
  ]));
  expect(credentialed.requests.length).toBeGreaterThan(0);
  expect(credentialed.requests.every(({ credentialPresent }) => credentialPresent === true)).toBe(true);
  expect(JSON.stringify({ anonymous, credentialed })).not.toContain("aval_m8_credential");
});

test("missing animation capability resolves as honest host-fallback usability", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, "WebGL2RenderingContext", {
      value: undefined,
      configurable: true
    });
    const getContext = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value(this: HTMLCanvasElement, type: string, ...arguments_: unknown[]) {
        if (type === "webgl2") return null;
        return Reflect.apply(getContext, this, [type, ...arguments_]);
      }
    });
  });
  await page.goto("/m8-dev-entry.html?unsupported-animation");
  const motion = page.locator("aval-player");
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { readiness: string }).readiness
  ), { timeout: 20_000 }).toBe("staticReady");
  const snapshot = await motion.evaluate((element) => {
    const node = element as unknown as {
      mode: string | null;
      staticReason: string | null;
      getDiagnostics(): { outstanding: Record<string, number> };
    };
    return {
      mode: node.mode,
      reason: node.staticReason,
      outstanding: node.getDiagnostics().outstanding
    };
  });
  expect(snapshot.mode).toBe("static");
  expect(snapshot.reason).not.toBeNull();
  expect(snapshot.outstanding.decoder).toBe(0);
});

test("a self-hosted CSP needs no inline style, unsafe-eval, or blob workers", async ({ page }) => {
  await page.route("**/m8-strict-csp.html", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: {
        ...response.headers(),
        "content-security-policy": [
          "default-src 'self'",
          "script-src 'self'",
          "style-src 'self'",
          "style-src-elem 'self'",
          "style-src-attr 'none'",
          "connect-src 'self' ws://127.0.0.1:4173",
          "worker-src 'self'",
          "img-src 'self'",
          "object-src 'none'",
          "base-uri 'self'"
        ].join("; ")
      }
    });
  });
  const violations: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (/content security policy/iu.test(message.text())) violations.push(message.text());
  });
  page.on("pageerror", (error) => { pageErrors.push(error.message); });
  await page.goto("/m8-strict-csp.html");
  const motion = page.locator("aval-player");
  await expect.poll(() => motion.evaluate((element) =>
    (element as unknown as { readiness: string }).readiness
  ), { timeout: 20_000 }).toMatch(/^(interactiveReady|staticReady)$/u);
  const styleProof = await motion.evaluate((element) => ({
    adoptedSheets: element.shadowRoot?.adoptedStyleSheets.length ?? 0,
    inlineStyle: element.getAttribute("style"),
    width: getComputedStyle(element).width,
    height: getComputedStyle(element).height
  }));
  expect(styleProof).toMatchObject({
    adoptedSheets: 1,
    inlineStyle: null,
    width: "45px",
    height: "27px"
  });
  await motion.evaluate(async (element) => {
    await (element as unknown as { dispose(): Promise<void> }).dispose();
  });
  expect(violations).toEqual([]);
  expect(pageErrors).toEqual([]);
});
