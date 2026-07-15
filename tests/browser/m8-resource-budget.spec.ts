import { expect, test } from "@playwright/test";

test("multiple public elements remain bounded and every participant retires", async ({ page }) => {
  await page.goto("/m8-dev-entry.html?resource-budget");
  const existing = page.locator("aval-player").first();
  await expect.poll(() => existing.evaluate((element) =>
    (element as unknown as { readiness: string }).readiness
  ), { timeout: 20_000 }).toMatch(/^(interactiveReady|staticReady)$/u);
  await page.evaluate(() => {
    for (let index = 0; index < 5; index += 1) {
      const element = document.createElement("aval-player") as HTMLElement & {
        src: string;
        state: string | null;
      };
      element.className = "m8-budget-player";
      element.style.width = "96px";
      element.style.height = "64px";
      element.state = "hover";
      element.src = `/__m8__/asset?fixture=user-states&session=m8-budget-${String(index)}`;
      const fallback = document.createElement("span");
      fallback.slot = "fallback";
      fallback.textContent = `fallback ${String(index)}`;
      element.append(fallback);
      document.body.append(element);
    }
  });
  const players = page.locator("aval-player");
  await expect(players).toHaveCount(6);
  await expect.poll(() => players.evaluateAll((elements) => elements.map((element) =>
    (element as unknown as { readiness: string }).readiness
  )), { timeout: 30_000 }).toEqual(expect.arrayContaining([
    expect.stringMatching(/^(interactiveReady|staticReady)$/u),
    expect.stringMatching(/^(interactiveReady|staticReady)$/u),
    expect.stringMatching(/^(interactiveReady|staticReady)$/u),
    expect.stringMatching(/^(interactiveReady|staticReady)$/u),
    expect.stringMatching(/^(interactiveReady|staticReady)$/u),
    expect.stringMatching(/^(interactiveReady|staticReady)$/u)
  ]));
  const snapshots = await players.evaluateAll((elements) => elements.map((element) =>
    (element as unknown as {
      getDiagnostics(): {
        readiness: string;
        runtime: { decoderLeaseState: string | null; playerTrackedBytes: number };
        outstanding: { player: number; decoder: number; bytes: number };
      };
    }).getDiagnostics()
  ));
  expect(snapshots.filter(({ runtime }) => runtime.decoderLeaseState === "granted").length)
    .toBeLessThanOrEqual(2);
  expect(snapshots.every(({ runtime }) => runtime.playerTrackedBytes <= 64 * 1024 * 1024))
    .toBe(true);

  await players.evaluateAll((elements) => {
    for (const element of elements.slice(0, 3)) {
      (element as HTMLElement).style.display = "none";
    }
  });
  await expect.poll(() => players.evaluateAll((elements) => elements.slice(0, 3).map((element) =>
    (element as unknown as { effectivelyVisible: boolean }).effectivelyVisible
  ))).toEqual([false, false, false]);

  const terminal = await players.evaluateAll(async (elements) => Promise.all(elements.map(async (element) => {
    const node = element as unknown as {
      dispose(): Promise<void>;
      getDiagnostics(): {
        readiness: string;
        outstanding: Record<string, number>;
        cleanup: {
          completed: boolean;
          participantDisposed: boolean;
          participantRegistered: boolean;
          participantLogicalBytes: number;
          participantActiveLeaseCount: number;
          participantDecoderTicketCount: number;
          workerCount: number;
          openFrames: number;
          pendingLoads: number;
          activeTransportBodies: number;
          interestedWaiters: number;
          rendererResourceCount: number;
        } | null;
      };
    };
    await node.dispose();
    return node.getDiagnostics();
  })));
  expect(terminal.every(({ readiness, outstanding }) =>
    readiness === "disposed" &&
    outstanding.player === 0 &&
    outstanding.decoder === 0 &&
    outstanding.bytes === 0
  )).toBe(true);
  expect(terminal.every(({ cleanup }) =>
    cleanup?.completed === true &&
    cleanup.participantDisposed &&
    !cleanup.participantRegistered &&
    cleanup.participantLogicalBytes === 0 &&
    cleanup.participantActiveLeaseCount === 0 &&
    cleanup.participantDecoderTicketCount === 0 &&
    cleanup.workerCount === 0 &&
    cleanup.openFrames === 0 &&
    cleanup.pendingLoads === 0 &&
    cleanup.activeTransportBodies === 0 &&
    cleanup.interestedWaiters === 0 &&
    cleanup.rendererResourceCount === 0
  )).toBe(true);
});
