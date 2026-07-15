import { expect, test } from "@playwright/test";

const RUNTIME_FACTORY_PATH = "/packages/element/src/browser-runtime-factory.ts";

test("definition and a source-free element do not load the player runtime", async ({ page }) => {
  const requestedPaths: string[] = [];
  page.on("request", (request) => {
    requestedPaths.push(new URL(request.url()).pathname);
  });

  await page.goto("/m8-no-js.html");
  await page.evaluate(async () => {
    const existing = document.querySelector("aval-player");
    existing?.removeAttribute("src");

    const apiPath = "/src/m8-element-browser-api.ts";
    const api = await import(apiPath);
    api.defineAvalElement();

    const element = document.createElement("aval-player") as HTMLElement & {
      readiness: string;
    };
    element.id = "lazy-runtime-motion";
    element.style.width = "96px";
    element.style.height = "96px";
    document.body.append(element);
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    if (element.readiness !== "unready") {
      throw new Error(`source-free readiness was ${element.readiness}`);
    }
  });

  expect(requestedPaths.filter(isRuntimeFactoryRequest)).toEqual([]);
  expect(
    requestedPaths.filter(isPlayerRuntimeRequest),
    "source-free element requested player modules"
  ).toEqual([]);

  const requestBoundary = requestedPaths.length;
  const result = await page.locator("#lazy-runtime-motion").evaluate(async (node) => {
    const element = node as HTMLElement & {
      src: string;
      prepare(): Promise<{ mode: string }>;
      dispose(): Promise<void>;
      getDiagnostics(): {
        finalDisposed: boolean;
        readiness: string;
        outstanding: Record<string, number>;
        cleanup: Record<string, unknown> | null;
      };
    };
    element.src = "/__m8__/asset?fixture=one-state&session=m8-lazy-runtime";
    const prepared = await element.prepare();
    await element.dispose();
    return {
      mode: prepared.mode,
      terminal: element.getDiagnostics()
    };
  });

  const sourceRequests = requestedPaths.slice(requestBoundary);
  expect(sourceRequests.filter(isRuntimeFactoryRequest)).toHaveLength(1);
  expect(sourceRequests.some(isPlayerRuntimeRequest)).toBe(true);
  expect(["animated", "static"]).toContain(result.mode);
  expect(result.terminal).toMatchObject({
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

test("a stalled lazy runtime chunk cannot hang terminal disposal", async ({ page }) => {
  let requested = false;
  await page.route(`**${RUNTIME_FACTORY_PATH}*`, async (route) => {
    requested = true;
    await route.fulfill({
      contentType: "text/javascript; charset=utf-8",
      body: "await new Promise(() => undefined); export {};"
    });
  });
  await page.goto("/m8-no-js.html");
  const motion = page.locator("aval-player");
  await motion.evaluate(async (element) => {
    element.removeAttribute("src");
    const apiPath = "/src/m8-element-browser-api.ts";
    const api = await import(apiPath);
    api.defineAvalElement();
    (element as unknown as { src: string }).src =
      "/__m8__/asset?fixture=one-state&session=m8-stalled-runtime-chunk";
  });
  await expect.poll(() => requested).toBe(true);
  const result = await motion.evaluate(async (element) => {
    const node = element as unknown as {
      dispose(): Promise<void>;
      getDiagnostics(): {
        finalDisposed: boolean;
        readiness: string;
        cleanup: { completed: boolean; failureCount: number; playerDisposed: boolean } | null;
      };
    };
    const started = performance.now();
    let message = "";
    try { await node.dispose(); }
    catch (error) { message = error instanceof Error ? error.message : "unknown"; }
    return {
      elapsed: performance.now() - started,
      message,
      diagnostics: node.getDiagnostics()
    };
  });
  expect(result.elapsed).toBeGreaterThanOrEqual(450);
  expect(result.elapsed).toBeLessThan(2_000);
  expect(result.message).toContain("cleanup was incomplete");
  expect(result.diagnostics).toMatchObject({
    finalDisposed: false,
    readiness: "error",
    cleanup: {
      completed: false,
      failureCount: 1,
      playerDisposed: false
    }
  });
  await page.unroute(`**${RUNTIME_FACTORY_PATH}*`);
});

test("a rejected lazy runtime chunk publishes ownerless cleanup and permits replacement", async ({ page }) => {
  let rejectedRequests = 0;
  await page.route(`**${RUNTIME_FACTORY_PATH}*`, async (route) => {
    rejectedRequests += 1;
    await route.abort("failed");
  });
  await page.goto("/m8-no-js.html");
  const motion = page.locator("aval-player");
  await motion.evaluate(async (element) => {
    element.removeAttribute("src");
    const apiPath = "/src/m8-element-browser-api.ts";
    const api = await import(apiPath);
    api.defineAvalElement();
    (element as unknown as { src: string }).src =
      "/__m8__/asset?fixture=one-state&session=m8-runtime-import-rejected-1";
  });

  await expect.poll(() => motion.evaluate((element) => {
    const diagnostics = (element as unknown as {
      getDiagnostics(): {
        sourceGeneration: number;
        readiness: string;
        cleanup: { completed: boolean; playerDisposed: boolean } | null;
      };
    }).getDiagnostics();
    return {
      sourceGeneration: diagnostics.sourceGeneration,
      readiness: diagnostics.readiness,
      cleanup: diagnostics.cleanup
    };
  }), { timeout: 10_000 }).toMatchObject({
    sourceGeneration: 1,
    readiness: "error",
    cleanup: { completed: true, playerDisposed: true }
  });

  await motion.evaluate((element) => {
    (element as unknown as { src: string }).src =
      "/__m8__/asset?fixture=one-state&session=m8-runtime-import-rejected-2";
  });
  await expect.poll(() => motion.evaluate((element) => {
    const diagnostics = (element as unknown as {
      getDiagnostics(): {
        sourceGeneration: number;
        readiness: string;
        cleanup: { completed: boolean; playerDisposed: boolean } | null;
      };
    }).getDiagnostics();
    return {
      sourceGeneration: diagnostics.sourceGeneration,
      readiness: diagnostics.readiness,
      cleanup: diagnostics.cleanup
    };
  }), { timeout: 10_000 }).toMatchObject({
    sourceGeneration: 2,
    readiness: "error",
    cleanup: { completed: true, playerDisposed: true }
  });

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
    cleanup: { completed: true, playerDisposed: true },
    terminalCleanup: { completed: true, sourceCleanupCompleted: true }
  });
  expect(JSON.stringify(terminal)).not.toContain(RUNTIME_FACTORY_PATH);
  expect(rejectedRequests).toBeGreaterThanOrEqual(1);
});

function isRuntimeFactoryRequest(path: string): boolean {
  return path.endsWith(RUNTIME_FACTORY_PATH);
}

function isPlayerRuntimeRequest(path: string): boolean {
  return path.includes("/packages/player-web/src/");
}
