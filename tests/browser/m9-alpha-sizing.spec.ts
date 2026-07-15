import { expect, test } from "@playwright/test";

test("packed-alpha public element keeps exact animated geometry through fractional sizing", async ({ page }) => {
  await page.goto("/certification.html");
  await page.waitForFunction(() => customElements.get("aval-player") !== undefined);
  const report = await page.evaluate(async () => {
    const host = document.querySelector<HTMLElement>("[data-certification-stage]")!;
    const element = document.createElement("aval-player") as HTMLElement & {
      src: string;
      fit: string;
      prepare(): Promise<unknown>;
      dispose(): Promise<void>;
      getDiagnostics(): {
        mode: string | null;
        presentation: {
          cssWidth: number;
          cssHeight: number;
          backingWidth: number;
          backingHeight: number;
          fit: string | null;
        };
        outstanding: Record<string, number>;
      };
    };
    element.src = "/__m8__/asset?session=m9-alpha-sizing&fixture=user-states";
    element.style.width = "213.5px";
    element.style.height = "127.25px";
    host.append(element);
    await element.prepare();
    const presentations = [];
    for (const fit of ["contain", "cover", "fill", "none"]) {
      element.fit = fit;
      const deadline = performance.now() + 5_000;
      while (element.getDiagnostics().presentation.fit !== fit) {
        if (performance.now() >= deadline) {
          throw new Error(`presentation fit ${fit} did not settle`);
        }
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      presentations.push(element.getDiagnostics().presentation);
    }
    const mode = element.getDiagnostics().mode;
    element.remove();
    await element.dispose();
    return { mode, presentations, terminal: element.getDiagnostics().outstanding };
  });
  expect(report.mode).toBe("animated");
  expect(report.presentations.map(({ fit }) => fit)).toEqual(["contain", "cover", "fill", "none"]);
  for (const presentation of report.presentations) {
    expect(presentation.cssWidth).toBeCloseTo(213.5, 0);
    expect(presentation.cssHeight).toBeCloseTo(127.25, 0);
    expect(presentation.backingWidth).toBeGreaterThan(0);
    expect(presentation.backingHeight).toBeGreaterThan(0);
  }
  expect(report.terminal).toEqual({ player: 0, decoder: 0, bytes: 0 });
});
