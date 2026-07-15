import { expect, test } from "@playwright/test";

test("public lifecycle profile retires replacement, adoption, transport, and element ownership", async ({ page }) => {
  await page.goto("/certification.html");
  await page.waitForFunction(() => "avalCertification" in window);
  const report = await page.evaluate(async () => {
    const api = (window as unknown as { avalCertification: {
      ready: Promise<void>;
      runResourceFaultProfile(): Promise<{
        status: string;
        lifecycle: Record<string, unknown>;
        network: readonly Record<string, unknown>[];
        failures: readonly string[];
      }>;
    } }).avalCertification;
    await api.ready;
    return api.runResourceFaultProfile();
  });
  expect(report.status).toBe("passed");
  expect(report.failures).toEqual([]);
  expect(report.lifecycle).toMatchObject({
    requestedCycles: 3,
    completedCycles: 3,
    sourceReplacements: 3,
    adoptionCycles: 3,
    status: "passed",
    terminalCounters: { player: 0, decoder: 0, bytes: 0 }
  });
  expect(report.network).toHaveLength(3);
  expect(report.network).toEqual(expect.arrayContaining([
    expect.objectContaining({ scenario: "ignored-initial-range", status: "passed", outstandingSettled: true }),
    expect.objectContaining({ scenario: "changed-etag", status: "passed", outstandingSettled: true }),
    expect.objectContaining({ scenario: "corrupt-bootstrap-unit", status: "passed", outstandingSettled: true })
  ]));
});
