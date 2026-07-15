import { expect, test } from "@playwright/test";

test("missing animation capability stays strictly static without a branded-browser claim", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, "VideoDecoder", { value: undefined, configurable: true });
    Object.defineProperty(globalThis, "WebGL2RenderingContext", { value: undefined, configurable: true });
    const getContext = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value(this: HTMLCanvasElement, type: string, ...arguments_: unknown[]) {
        if (type === "webgl2") return null;
        return Reflect.apply(getContext, this, [type, ...arguments_]);
      }
    });
  });
  await page.goto("/certification.html");
  await page.waitForFunction(() => customElements.get("aval-player") !== undefined);
  const result = await page.evaluate(async () => {
    const element = document.createElement("aval-player") as HTMLElement & {
      src: string;
      prepare(): Promise<unknown>;
      dispose(): Promise<void>;
      getDiagnostics(): {
        readiness: string;
        mode: string | null;
        staticReason: string | null;
        outstanding: Record<string, number>;
      };
    };
    element.src = "/__m8__/asset?session=m9-static-fallback&fixture=user-states";
    document.querySelector("[data-certification-stage]")!.append(element);
    await element.prepare();
    const ready = element.getDiagnostics();
    element.remove();
    await element.dispose();
    return { ready, terminal: element.getDiagnostics() };
  });
  expect(result.ready).toMatchObject({
    readiness: "staticReady",
    mode: "static"
  });
  expect(result.ready.staticReason).not.toBeNull();
  expect(result.ready.outstanding.decoder).toBe(0);
  expect(result.terminal.outstanding).toEqual({ player: 0, decoder: 0, bytes: 0 });
  expect(testInfo.project.name).toMatch(/^(?:chromium|playwright-(?:chromium|firefox|webkit)-reference|playwright-bundled-(?:chromium|firefox|webkit)-engine-production-probe)$/u);
  expect(testInfo.project.name).not.toMatch(/(?:^|-)chrome-|(?:^|-)edge-|(?:^|-)safari-/iu);
});
