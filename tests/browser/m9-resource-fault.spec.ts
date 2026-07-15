import { expect, test } from "@playwright/test";

test("short PR resource/fault profile exports terminal counters for every isolated scenario", async ({ page }) => {
  await page.goto("/certification.html");
  await page.waitForFunction(() => "avalCertification" in window);
  const report = await page.evaluate(async () => {
    const api = (window as unknown as { avalCertification: {
      ready: Promise<void>;
      runResourceFaultProfile(): Promise<{
        status: string;
        lifecycle: { peakCounters: Record<string, number>; terminalCounters: Record<string, number> };
        network: readonly { status: string; outstandingSettled: boolean; failureCode: string | null }[];
      }>;
    } }).avalCertification;
    await api.ready;
    return api.runResourceFaultProfile();
  });
  expect(report.status).toBe("passed");
  expect(report.lifecycle.peakCounters["page.physical-bytes"]).toBeGreaterThan(0);
  expect(report.lifecycle.terminalCounters).toEqual({ player: 0, decoder: 0, bytes: 0 });
  expect(report.network).toHaveLength(3);
  expect(report.network.every(({ status, outstandingSettled }) => status === "passed" && outstandingSettled)).toBe(true);
});
