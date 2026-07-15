import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { parseFrontIndex } from "@pixel-point/aval-format";

import { compileDirectInput } from "../../packages/compiler/dist/index.js";
import { encodeCanonicalRgbaPng } from "../../packages/compiler/dist/compile/png.js";

const AUTHORED_WIDTH = 640;
const AUTHORED_HEIGHT = 360;
const AUTHORED_FRAMES_PER_SECOND = 15;
const FRAME_COUNT = 24;
const ASSET_PATH = "/__m9-author-dimensions.avl";

interface CompilerBackedFixture {
  readonly bytes: Buffer;
  readonly sha256: string;
  readonly integrity: string;
  readonly renditionId: string;
  readonly canvas: Readonly<{ width: number; height: number }>;
  readonly renditionCount: number;
}

let fixtureDirectory = "";
let fixture: Readonly<CompilerBackedFixture>;

test.beforeAll(async () => {
  fixtureDirectory = await mkdtemp(join(tmpdir(), "aval-browser-authored-size-"));
  const inputPattern = join(fixtureDirectory, "frame-%04d.png");
  const shades = Array.from({ length: FRAME_COUNT }, (_value, frame) =>
    112 + Math.round(80 * Math.sin(2 * Math.PI * frame / FRAME_COUNT))
  );
  await Promise.all(shades.map(async (shade, frame) => {
    const rgba = new Uint8Array(AUTHORED_WIDTH * AUTHORED_HEIGHT * 4);
    for (let y = 0; y < AUTHORED_HEIGHT; y += 1) {
      for (let x = 0; x < AUTHORED_WIDTH; x += 1) {
        const offset = (y * AUTHORED_WIDTH + x) * 4;
        const tile = ((Math.floor(x / 80) + Math.floor(y / 60)) & 1) * 24;
        rgba[offset] = Math.min(255, shade + tile);
        rgba[offset + 1] = Math.min(
          255,
          112 + Math.round(
            80 * Math.cos(2 * Math.PI * frame / FRAME_COUNT)
          ) + tile
        );
        rgba[offset + 2] = Math.min(255, 224 - shade / 2 + tile);
        rgba[offset + 3] = 255;
      }
    }
    await writeFile(
      join(fixtureDirectory, `frame-${String(frame).padStart(4, "0")}.png`),
      encodeCanonicalRgbaPng({
        width: AUTHORED_WIDTH,
        height: AUTHORED_HEIGHT,
        rgba
      })
    );
  }));

  const outputPath = join(fixtureDirectory, "authored-size.avl");
  const result = await compileDirectInput({
    inputPath: inputPattern,
    outputPath,
    loop: [0, FRAME_COUNT],
    fps: { numerator: AUTHORED_FRAMES_PER_SECOND, denominator: 1 },
    canvas: [AUTHORED_WIDTH, AUTHORED_HEIGHT],
    frames: { firstNumber: 0, frameCount: FRAME_COUNT },
    alpha: "opaque"
  });
  const bytes = await readFile(outputPath);
  const front = parseFrontIndex(new Uint8Array(bytes));
  const rendition = front.manifest.renditions[0];
  if (rendition === undefined) {
    throw new Error("compiler-backed browser fixture is incomplete");
  }
  fixture = Object.freeze({
    bytes,
    sha256: result.sha256,
    integrity: `sha256-${Buffer.from(result.sha256, "hex").toString("base64")}`,
    renditionId: rendition.id,
    canvas: Object.freeze({
      width: front.manifest.canvas.width,
      height: front.manifest.canvas.height
    }),
    renditionCount: front.manifest.renditions.length
  });
});

test.afterAll(async () => {
  if (fixtureDirectory !== "") {
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
});

test("compiler output above 512 keeps authored manifest, backing, digest, and decoded identity", async ({ page }) => {
  test.setTimeout(90_000);
  const requests: string[] = [];
  await serveFixture(page, requests);
  await page.goto("/certification.html");
  await page.waitForFunction(() => customElements.get("aval-player") !== undefined);

  const result = await page.evaluate(async ({
    assetPath,
    integrity,
    width,
    height
  }) => {
    type Diagnostics = {
      readonly readiness: string;
      readonly mode: string | null;
      readonly presentation: {
        readonly cssWidth: number;
        readonly cssHeight: number;
        readonly backingWidth: number;
        readonly backingHeight: number;
        readonly resolutionScale: number;
        readonly clampReasons: readonly string[];
      };
      readonly runtime: {
        readonly selectedRendition: string | null;
        readonly transportMode: string | null;
        readonly declaredFileBytes: number;
        readonly verifiedBytes: number;
      };
      readonly runtimeTrace?: readonly {
        readonly scheduler: { readonly decodedCursor: Record<string, unknown> | null };
        readonly media: Record<string, unknown> | null;
      }[];
      readonly outstanding: Record<string, number>;
    };
    const element = document.createElement("aval-player") as HTMLElement & {
      src: string;
      integrity: string;
      prepare(): Promise<unknown>;
      dispose(): Promise<void>;
      getDiagnostics(options?: Readonly<{ trace?: boolean }>): Diagnostics;
    };
    element.style.display = "block";
    element.style.width = `${String(width)}px`;
    element.style.height = `${String(height)}px`;
    element.src = assetPath;
    element.integrity = integrity;
    document.querySelector("[data-certification-stage]")!.append(element);

    const preparation = await element.prepare();
    const deadline = performance.now() + 10_000;
    let diagnostics = element.getDiagnostics({ trace: true });
    let decoded = diagnostics.runtimeTrace?.find((record) =>
      record.scheduler.decodedCursor !== null && record.media?.kind === "frame"
    ) ?? null;
    while (
      (diagnostics.presentation.backingWidth !== width ||
        diagnostics.presentation.backingHeight !== height ||
        decoded === null) &&
      performance.now() < deadline
    ) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      diagnostics = element.getDiagnostics({ trace: true });
      decoded = diagnostics.runtimeTrace?.find((record) =>
        record.scheduler.decodedCursor !== null && record.media?.kind === "frame"
      ) ?? null;
    }
    element.remove();
    await element.dispose();
    return {
      preparation,
      diagnostics,
      decoded,
      terminal: element.getDiagnostics().outstanding
    };
  }, {
    assetPath: ASSET_PATH,
    integrity: fixture.integrity,
    width: AUTHORED_WIDTH,
    height: AUTHORED_HEIGHT
  });

  expect(fixture.sha256).toBe(createHash("sha256").update(fixture.bytes).digest("hex"));
  expect(fixture.canvas).toEqual({ width: AUTHORED_WIDTH, height: AUTHORED_HEIGHT });
  expect(fixture.renditionCount).toBe(1);
  expect(result.preparation).toMatchObject({
    mode: "animated",
    report: {
      readiness: "interactiveReady",
      selectedRendition: fixture.renditionId,
      candidates: [{
        rendition: fixture.renditionId,
        rank: 0,
        outcome: "selected",
        failure: null
      }]
    }
  });
  expect(result.diagnostics).toMatchObject({
    readiness: "interactiveReady",
    mode: "animated",
    presentation: {
      cssWidth: AUTHORED_WIDTH,
      cssHeight: AUTHORED_HEIGHT,
      backingWidth: AUTHORED_WIDTH,
      backingHeight: AUTHORED_HEIGHT,
      resolutionScale: 1,
      clampReasons: []
    },
    runtime: {
      selectedRendition: fixture.renditionId,
      transportMode: "full",
      declaredFileBytes: fixture.bytes.byteLength
    }
  });
  expect(result.diagnostics.runtime.verifiedBytes).toBeGreaterThan(0);
  expect(result.decoded).toMatchObject({
    scheduler: { decodedCursor: { unit: "body.default" } },
    media: {
      kind: "frame",
      frame: { rendition: fixture.renditionId, unit: "body.default" }
    }
  });
  expect(requests).toEqual([ASSET_PATH]);
  expect(result.terminal).toEqual({ player: 0, decoder: 0, bytes: 0 });
});

test("WebGL texture rejection keeps the host fallback and does not try a lower rendition", async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript((maximumTextureSize) => {
    const workerUrls: string[] = [];
    Object.defineProperty(globalThis, "__avalWorkerUrls", {
      value: workerUrls,
      configurable: true
    });
    const NativeWorker = globalThis.Worker;
    Object.defineProperty(globalThis, "Worker", {
      configurable: true,
      value: new Proxy(NativeWorker, {
        construct(target, argumentsList, newTarget) {
          workerUrls.push(String(argumentsList[0]));
          return Reflect.construct(target, argumentsList, newTarget);
        }
      })
    });
    const nativeGetParameter = WebGL2RenderingContext.prototype.getParameter;
    Object.defineProperty(globalThis, "__avalMaxTextureQueries", {
      value: 0,
      writable: true,
      configurable: true
    });
    Object.defineProperty(WebGL2RenderingContext.prototype, "getParameter", {
      configurable: true,
      value(this: WebGL2RenderingContext, parameter: number) {
        if (parameter === this.MAX_TEXTURE_SIZE) {
          const state = globalThis as typeof globalThis & {
            __avalMaxTextureQueries: number;
          };
          state.__avalMaxTextureQueries += 1;
          return maximumTextureSize;
        }
        return Reflect.apply(nativeGetParameter, this, [parameter]);
      }
    });
  }, 512);
  const requests: string[] = [];
  await serveFixture(page, requests);
  await page.goto("/certification.html");
  await page.waitForFunction(() => customElements.get("aval-player") !== undefined);

  const result = await page.evaluate(async ({ assetPath, integrity, width, height }) => {
    const element = document.createElement("aval-player") as HTMLElement & {
      src: string;
      integrity: string;
      prepare(): Promise<unknown>;
      dispose(): Promise<void>;
      getDiagnostics(): {
        readonly readiness: string;
        readonly mode: string | null;
        readonly staticReason: string | null;
        readonly runtime: { readonly selectedRendition: string | null };
        readonly presentation: Record<string, unknown>;
        readonly outstanding: Record<string, number>;
      };
    };
    element.style.display = "block";
    element.style.width = `${String(width)}px`;
    element.style.height = `${String(height)}px`;
    element.src = assetPath;
    element.integrity = integrity;
    document.querySelector("[data-certification-stage]")!.append(element);
    const preparation = await element.prepare();
    const diagnostics = element.getDiagnostics();
    const instrumentation = globalThis as typeof globalThis & {
      __avalMaxTextureQueries: number;
      __avalWorkerUrls: readonly string[];
    };
    element.remove();
    await element.dispose();
    return {
      preparation,
      diagnostics,
      maxTextureQueries: instrumentation.__avalMaxTextureQueries,
      workerUrls: [...instrumentation.__avalWorkerUrls],
      terminal: element.getDiagnostics().outstanding
    };
  }, {
    assetPath: ASSET_PATH,
    integrity: fixture.integrity,
    width: AUTHORED_WIDTH,
    height: AUTHORED_HEIGHT
  });

  expect(fixture.renditionCount).toBe(1);
  expect(result.preparation).toMatchObject({
    mode: "static",
    reason: "resource-budget",
    report: {
      readiness: "staticReady",
      selectedRendition: null,
      candidates: [{
        rendition: fixture.renditionId,
        rank: 0,
        outcome: "rejected",
        failure: { code: "resource-rejection" }
      }]
    }
  });
  expect(result.diagnostics).toMatchObject({
    readiness: "staticReady",
    mode: "static",
    staticReason: "resource-budget",
    runtime: { selectedRendition: null },
    presentation: {
      cssWidth: AUTHORED_WIDTH,
      cssHeight: AUTHORED_HEIGHT,
      backingWidth: AUTHORED_WIDTH,
      backingHeight: AUTHORED_HEIGHT,
      resolutionScale: 1,
      clampReasons: []
    }
  });
  expect(result.maxTextureQueries).toBeGreaterThan(0);
  expect(result.workerUrls).toEqual([]);
  expect(requests).toEqual([ASSET_PATH]);
  expect(result.terminal).toEqual({ player: 0, decoder: 0, bytes: 0 });
});

async function serveFixture(page: Page, requests: string[]): Promise<void> {
  await page.route(`**${ASSET_PATH}`, async (route) => {
    const request = route.request();
    requests.push(new URL(request.url()).pathname);
    await route.fulfill({
      status: 200,
      contentType: "application/vnd.aval",
      headers: {
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
        "Content-Length": String(fixture.bytes.byteLength),
        ETag: `"m9-${fixture.sha256}"`
      },
      body: fixture.bytes
    });
  });
}
