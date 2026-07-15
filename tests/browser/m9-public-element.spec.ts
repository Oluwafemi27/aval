import { expect, test } from "@playwright/test";

test("public-path harness exercises user states, promises, events, and terminal ownership", async ({ page }, testInfo) => {
  await page.goto("/certification.html");
  await ready(page);
  const report = await page.evaluate(async () => {
    const api = (window as unknown as { avalCertification: {
      runPublicHarness(options: Record<string, number>): Promise<Record<string, unknown>>;
    } }).avalCertification;
    return api.runPublicHarness({
      stateTransitions: 8,
      rapidInputs: 32,
      lifecycleCycles: 2,
      soakDurationMs: 50,
      soakPlayers: 3
    });
  });
  expect(report, JSON.stringify({
    failures: (report as { failures?: unknown }).failures,
    soak: (report as { soak?: unknown }).soak,
    decoderThroughput: (report as { decoderThroughput?: unknown }).decoderThroughput
  })).toMatchObject({
    schemaVersion: "1.0",
    reportKind: "public-path-functional-harness",
    evidenceClass: "playwright-functional-engine",
    status: "passed",
    source: { matched: true, byteLength: 38_128 },
    publicElement: {
      readiness: "interactiveReady",
      mode: "animated",
      states: ["done", "hover", "idle", "loading"],
      events: ["reset", "hover-off", "hover-on", "activate-loading", "cancel-loading"],
      transitionsRequested: 8,
      transitionsCompleted: 8,
      rapidInputsRequested: 32,
      rapidInputsSettled: 32,
      exactContentIdentityAvailable: true
    },
    timingCriteria: {
      status: "collected",
      reason: "raw-evidence-collected-for-independent-validator",
      callbackTimestampsRelabeledAsDisplayEvidence: false,
      observedDisplayEvidence: false
    },
    lifecycle: {
      status: "passed",
      requestedCycles: 2,
      completedCycles: 2,
      sourceReplacements: 2,
      adoptionCycles: 2,
      terminalCounters: { player: 0, decoder: 0, bytes: 0 }
    },
    soak: {
      status: "passed",
      playerCount: 3,
      terminalCounters: [
        { player: 0, decoder: 0, bytes: 0 },
        { player: 0, decoder: 0, bytes: 0 },
        { player: 0, decoder: 0, bytes: 0 }
      ]
    }
  });
  expect((report as { publicElement: { routeEvents: number } }).publicElement.routeEvents).toBeGreaterThan(0);
  expect((report as { ledgers: { resourceSnapshots: number } }).ledgers.resourceSnapshots).toBeGreaterThanOrEqual(3);
  expect(JSON.stringify(report)).not.toMatch(/displayedTime|scanoutTime/u);
  expect(testInfo.project.name).toMatch(/^(?:chromium|playwright-(?:chromium|firefox|webkit)-reference|playwright-bundled-(?:chromium|firefox|webkit)-engine-production-probe)$/u);
});

async function ready(page: import("@playwright/test").Page): Promise<void> {
  await page.waitForFunction(() => {
    const api = (window as unknown as { avalCertification?: { ready: Promise<void> } }).avalCertification;
    return api !== undefined;
  });
  await page.evaluate(async () => {
    await (window as unknown as { avalCertification: { ready: Promise<void> } }).avalCertification.ready;
  });
}
