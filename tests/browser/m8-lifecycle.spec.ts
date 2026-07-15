import { expect, test } from "@playwright/test";

test("rapid replacement, real disconnect, reconnect, and final disposal retire ownership", async ({ page }) => {
  await page.goto("/m8-dev-entry.html?lifecycle");
  const motion = page.locator("aval-player");
  await expect.poll(() => diagnostics(page), { timeout: 20_000 }).toMatchObject({
    readiness: expect.stringMatching(/^(interactiveReady|staticReady)$/u),
    sourceGeneration: 1
  });

  const initial = await diagnostics(page);
  await motion.evaluate((element) => {
    const node = element as HTMLElement & { src: string };
    node.src = "/__m7__/asset?session=m8-never-started&scenario=stalled-body";
    node.src = "/__m7__/asset?session=m8-latest-coalesced&scenario=exact-range";
  });
  await expect.poll(() => diagnostics(page), { timeout: 20_000 }).toMatchObject({
    readiness: expect.stringMatching(/^(interactiveReady|staticReady)$/u),
    sourceGeneration: initial.sourceGeneration + 1
  });
  const skipped = await page.request.get("/__m7__/metrics?session=m8-never-started");
  expect((await skipped.json()).requests).toEqual([]);

  const beforeMove = await diagnostics(page);
  await motion.evaluate((element) => {
    const parent = element.parentNode!;
    element.remove();
    parent.prepend(element);
  });
  await page.waitForTimeout(50);
  expect(await diagnostics(page)).toMatchObject({
    connected: true,
    sourceGeneration: beforeMove.sourceGeneration
  });

  const handle = await motion.elementHandle();
  expect(handle).not.toBeNull();
  await motion.evaluate((element) => element.remove());
  await expect.poll(() => handle!.evaluate((element) => {
    const node = element as unknown as {
      getDiagnostics(): {
        connected: boolean;
        readiness: string;
        outstanding: Record<string, number>;
        cleanup: Record<string, unknown> | null;
      };
    };
    return node.getDiagnostics();
  })).toMatchObject({
    connected: false,
    readiness: "unready",
    outstanding: { player: 0, decoder: 0, bytes: 0 },
    cleanup: {
      completed: true,
      participantDisposed: true,
      participantRegistered: false,
      participantLogicalBytes: 0,
      participantActiveLeaseCount: 0,
      participantDecoderTicketCount: 0,
      workerCount: 0,
      openFrames: 0,
      pendingLoads: 0,
      activeTransportBodies: 0,
      interestedWaiters: 0,
      rendererResourceCount: 0
    }
  });
  await handle!.evaluate((element) => {
    document.querySelector("#m8-interaction")!.prepend(element);
  });
  await expect.poll(() => diagnostics(page), { timeout: 20_000 }).toMatchObject({
    connected: true,
    readiness: "interactiveReady",
    sourceGeneration: beforeMove.sourceGeneration + 1
  });

  const beforeStall = await diagnostics(page);
  await motion.evaluate((element) => {
    (element as unknown as { src: string }).src =
      "/__m7__/asset?session=m8-aborted-stall&scenario=stalled-body";
  });
  await expect.poll(async () => {
    const response = await page.request.get("/__m7__/metrics?session=m8-aborted-stall");
    return (await response.json()).activeResponses as number;
  }, { timeout: 20_000 }).toBeGreaterThan(0);
  await motion.evaluate((element) => {
    (element as unknown as { src: string }).src =
      "/__m7__/asset?session=m8-after-stall&scenario=exact-range";
  });
  await expect.poll(() => diagnostics(page), { timeout: 20_000 }).toMatchObject({
    readiness: "interactiveReady",
    sourceGeneration: beforeStall.sourceGeneration + 2
  });
  await expect.poll(async () => {
    const response = await page.request.get("/__m7__/metrics?session=m8-aborted-stall");
    return (await response.json()).activeResponses as number;
  }).toBe(0);

  const terminal = await motion.evaluate(async (element) => {
    const node = element as unknown as {
      dispose(): Promise<void>;
      getDiagnostics(): Record<string, unknown>;
    };
    await node.dispose();
    return node.getDiagnostics();
  });
  expect(terminal).toMatchObject({
    finalDisposed: true,
    readiness: "disposed",
    outstanding: { player: 0, decoder: 0, bytes: 0 },
    cleanup: {
      completed: true,
      failureCount: 0,
      participantDisposed: true,
      participantRegistered: false,
      participantLogicalBytes: 0,
      participantActiveLeaseCount: 0,
      participantDecoderTicketCount: 0,
      workerCount: 0,
      openFrames: 0,
      pendingLoads: 0,
      activeTransportBodies: 0,
      interestedWaiters: 0,
      rendererResourceCount: 0,
      pagePhysicalBytes: 0,
      pageParticipantCount: 0
    }
  });
});

test("one batched source/config transaction reaches only the newest generation", async ({ page }) => {
  await page.goto("/m8-dev-entry.html?batched-source-config");
  const motion = page.locator("aval-player");
  await expect.poll(() => diagnostics(page), { timeout: 20_000 }).toMatchObject({
    readiness: "interactiveReady",
    sourceGeneration: 1
  });
  const result = await motion.evaluate(async (element) => {
    const node = element as unknown as {
      src: string;
      state: string | null;
      motion: string;
      fit: string | null;
      autoplay: string;
      bindings: string;
      readiness: string;
      getDiagnostics(): {
        sourceGeneration: number;
        requestedState: string | null;
        configuredMotion: string;
        autoplay: string;
        presentation: { fit: string | null };
      };
    };
    const generations: number[] = [];
    for (const type of ["readinesschange", "requestedstatechange", "visualstatechange"]) {
      element.addEventListener(type, (event) => {
        generations.push((event as CustomEvent<{ generation: number }>).detail.generation);
      });
    }
    node.src = "/__m8__/asset?fixture=user-states&session=m8-batch-never";
    node.state = "hover";
    node.motion = "reduce";
    node.fit = "cover";
    node.autoplay = "manual";
    node.bindings = "none";
    node.src = "/__m8__/asset?fixture=user-states&session=m8-batch-final";
    const deadline = performance.now() + 20_000;
    while (node.readiness !== "staticReady") {
      if (performance.now() > deadline) throw new Error("batched generation timed out");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return { generations, diagnostics: node.getDiagnostics() };
  });
  const skipped = await page.request.get("/__m8__/metrics?session=m8-batch-never");
  expect((await skipped.json()).requests).toEqual([]);
  expect(result.diagnostics).toMatchObject({
    sourceGeneration: 2,
    requestedState: "hover",
    configuredMotion: "reduce",
    autoplay: "manual",
    presentation: { fit: "cover" }
  });
  expect(result.generations.length).toBeGreaterThan(0);
  expect(result.generations.every((generation) => generation === 2)).toBe(true);
});

test("cross-root and cross-document adoption retire and rebind the realm", async ({ page }) => {
  await page.goto("/m8-dev-entry.html?realm-adoption");
  await expect.poll(() => diagnostics(page), { timeout: 20_000 }).toMatchObject({
    readiness: "interactiveReady",
    sourceGeneration: 1
  });
  await page.evaluate(() => {
    const motion = document.querySelector("aval-player") as HTMLElement & {
      interactionTarget: Element | null;
    };
    motion.interactionTarget = document.querySelector("#m8-interaction");
    const host = document.createElement("div");
    host.id = "realm-shadow-host";
    const root = host.attachShadow({ mode: "open" });
    const target = document.createElement("button");
    target.id = "m8-interaction";
    root.append(target);
    document.body.append(host);
    target.append(motion);
    (window as unknown as { adoptedMotion: HTMLElement }).adoptedMotion = motion;
  });
  await expect.poll(() => page.evaluate(() => {
    const motion = (window as unknown as { adoptedMotion: HTMLElement & {
      interactionTarget: Element | null;
      getDiagnostics(): { sourceGeneration: number; readiness: string; cleanup: { completed: boolean } | null };
    } }).adoptedMotion;
    return {
      ...motion.getDiagnostics(),
      overrideCleared: motion.interactionTarget === null
    };
  }), { timeout: 20_000 }).toMatchObject({
    sourceGeneration: 2,
    readiness: expect.stringMatching(/^(interactiveReady|staticReady)$/u),
    overrideCleared: true,
    cleanup: { completed: true }
  });

  await page.evaluate(async () => {
    const motion = (window as unknown as { adoptedMotion: HTMLElement }).adoptedMotion;
    const iframe = document.createElement("iframe");
    iframe.id = "realm-frame";
    iframe.srcdoc = "<!doctype html><button id='m8-interaction'></button>";
    const loaded = new Promise<void>((resolve) => {
      iframe.addEventListener("load", () => resolve(), { once: true });
    });
    document.body.append(iframe);
    await loaded;
    const frameDocument = iframe.contentDocument!;
    const adopted = frameDocument.adoptNode(motion);
    frameDocument.querySelector("#m8-interaction")!.append(adopted);
  });
  await expect.poll(() => page.evaluate(() => {
    const motion = (window as unknown as { adoptedMotion: HTMLElement & {
      ownerDocument: Document;
      getDiagnostics(): {
        sourceGeneration: number;
        readiness: string;
        cleanup: { completed: boolean; participantRegistered: boolean } | null;
      };
    } }).adoptedMotion;
    return {
      ...motion.getDiagnostics(),
      inFrame: motion.ownerDocument !== document,
      adoptedSheets: motion.shadowRoot?.adoptedStyleSheets.length ?? 0
    };
  }), { timeout: 20_000 }).toMatchObject({
    sourceGeneration: 3,
    readiness: expect.stringMatching(/^(interactiveReady|staticReady)$/u),
    inFrame: true,
    adoptedSheets: 1,
    cleanup: { completed: true, participantRegistered: false }
  });
  await page.evaluate(async () => {
    const motion = (window as unknown as { adoptedMotion: { dispose(): Promise<void> } }).adoptedMotion;
    await motion.dispose();
  });
});

async function diagnostics(page: import("@playwright/test").Page): Promise<{
  readiness: string;
  sourceGeneration: number;
  connected: boolean;
}> {
  return page.locator("aval-player").evaluate((element) => {
    const node = element as unknown as {
      getDiagnostics(): {
        readiness: string;
        sourceGeneration: number;
        connected: boolean;
      };
    };
    return node.getDiagnostics();
  });
}
