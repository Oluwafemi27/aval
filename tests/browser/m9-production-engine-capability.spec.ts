import { expect, test } from "@playwright/test";

test("built public element records an honest functional-engine capability outcome", async ({ page }, testInfo) => {
  await page.goto("/certification.html");
  await page.waitForFunction(() => customElements.get("aval-player") !== undefined);
  const result = await page.evaluate(async (session) => {
    const element = document.createElement("aval-player") as unknown as HTMLElement & {
      src: string;
      prepare(): Promise<unknown>;
      dispose(): Promise<void>;
      getDiagnostics(): {
        readiness: string;
        mode: string | null;
        staticReason: string | null;
        lastFailure: { code: string } | null;
        runtime: { selectedRendition: string | null };
        outstanding: { player: number; decoder: number; bytes: number };
      };
    };
    element.style.display = "block";
    element.style.width = "192px";
    element.style.height = "108px";
    element.src = `/__m8__/asset?session=${encodeURIComponent(session)}&fixture=user-states`;
    document.querySelector("[data-certification-stage]")!.append(element);
    await element.prepare();
    const ready = element.getDiagnostics();
    element.remove();
    await element.dispose();
    return { ready, terminal: element.getDiagnostics().outstanding };
  }, `m9-engine-${testInfo.project.name}`);

  const supported = result.ready.readiness === "interactiveReady";
  testInfo.annotations.push({
    type: "functional-engine-capability",
    description: supported ? "production-animation-supported" : "production-animation-unsupported"
  });
  if (supported) {
    expect(result.ready).toMatchObject({ mode: "animated", staticReason: null, lastFailure: null });
    expect(result.ready.runtime.selectedRendition).not.toBeNull();
  } else {
    expect(result.ready).toMatchObject({ readiness: "staticReady", mode: "static" });
    expect(result.ready.staticReason).not.toBeNull();
    expect(result.ready.outstanding.decoder).toBe(0);
  }
  expect(result.terminal).toEqual({ player: 0, decoder: 0, bytes: 0 });
  expect(testInfo.project.name).toMatch(/^playwright-bundled-(?:chromium|firefox|webkit)-engine-production-probe$/u);
});
