import { expect, test } from "@playwright/test";

test("harness exports exact public trace and worker-output evidence without inventing display timing", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/certification.html");
  const banner = page.locator("[data-certification-banner]");
  await expect(banner).toContainText("functional engine run");
  await expect(banner).toContainText("not branded-browser or observed-display certification");
  await page.waitForFunction(() => "avalCertification" in window);
  const result = await page.evaluate(async () => {
    const api = (window as unknown as { avalCertification: {
      ready: Promise<void>;
      runPublicHarness(options: Record<string, number>): Promise<Record<string, unknown>>;
      getLastExport(): { sha256: string; canonicalJson: string; bytes: Uint8Array } | null;
    } }).avalCertification;
    await api.ready;
    const report = await api.runPublicHarness({
      // Route-volume and route-class coverage are exercised by the dedicated
      // public-element and scheduler profiles; one transition is enough to
      // bind this raw-trace export to a real authored route.
      stateTransitions: 1,
      // The separate public-element profile owns high-volume input stress.
      // This proof keeps one routed input so trace/throughput evidence stays
      // isolated from a second long-running stress workload.
      rapidInputs: 1,
      lifecycleCycles: 1,
      soakDurationMs: 0,
      soakPlayers: 2
    });
    const exported = api.getLastExport();
    return {
      report,
      exportDigest: exported?.sha256,
      exportBytes: exported?.bytes.byteLength,
      canonical: exported?.canonicalJson
    };
  });
  expect(result.report).toMatchObject({
    status: "passed",
    publicElement: { exactContentIdentityAvailable: true },
    timingCriteria: {
      status: "collected",
      reason: "raw-evidence-collected-for-independent-validator",
      callbackTimestampsRelabeledAsDisplayEvidence: false,
      observedDisplayEvidence: false
    },
    decoderThroughput: {
      status: "collected",
      failure: null,
      ledger: { ledgerKind: "decoder-output-throughput" }
    }
  });
  const report = result.report as any;
  expect(report.ledgers.frameEntries).toBeGreaterThan(0);
  expect(report.runtimeTrace.coverage).toMatchObject({ traceGaps: 0, underflows: 0, wrongContentIdentities: 0 });
  expect(report.decoderThroughput.ledger.outputs).toHaveLength(324);
  expect(report.decoderThroughput.ledger.terminal).toMatchObject({ decoderClosed: true, openFrames: 0, pendingFrames: 0, decodeQueueSize: 0 });
  expect(result.exportDigest).toMatch(/^[0-9a-f]{64}$/u);
  expect(result.exportBytes).toBeGreaterThan(100);
  expect(result.exportBytes).toBeLessThan(16 * 1024 * 1024);
  expect(result.canonical).not.toMatch(/displayedTime|scanoutTime|\/Users\/|\/home\//u);
  expect(JSON.parse(result.canonical!)).toEqual(result.report);
});
