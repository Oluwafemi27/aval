import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { startDevServer } from "../../packages/compiler/dist/commands/dev-server.js";

test("avl dev serves a self-contained public-element playground", async ({ page }) => {
  const assetPath = resolve(
    process.cwd(),
    "fixtures/conformance/m8/user-states-all-routes-alpha.avl"
  );
  const bytes = await readFile(assetPath);
  const server = await startDevServer({ assetPath, port: 0 });
  try {
    server.publish({
      generation: 1,
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      warnings: [],
      report: {
        frameRate: "30/1 fps",
        units: [
          {
            id: "idle.body",
            kind: "body",
            frameRange: [0, 8],
            timeRange: ["0s", "0.266667s"]
          },
          {
            id: "idle.engaged",
            kind: "transition",
            frameRange: [8, 14],
            timeRange: ["0.266667s", "0.466667s"]
          },
          {
            id: "engaged.body",
            kind: "body",
            frameRange: [14, 22],
            timeRange: ["0.466667s", "0.733333s"]
          }
        ],
        geometry: {
          visibleWidth: 45,
          visibleHeight: 27,
          codedWidth: 48,
          codedHeight: 64
        },
        alpha: "packed",
        continuityPassed: 1,
        continuityCuts: 1,
        alphaAuditedFrames: 30
      }
    });
    const workerRequest = page.waitForRequest((request) => request.url().endsWith("/modules/player-web/decoder-worker/entry.js"));
    const workerResponse = page.waitForResponse((response) => response.url().endsWith("/modules/player-web/decoder-worker/entry.js"));
    await page.goto(server.url);
    const [request, response] = await Promise.all([workerRequest, workerResponse]);
    const requestHeaders = await request.allHeaders();
    expect(requestHeaders).toMatchObject({
      "sec-fetch-dest": "worker",
      "sec-fetch-mode": "same-origin",
      "sec-fetch-site": "same-origin"
    });
    expect(requestHeaders.origin).toBeUndefined();
    expect(response.status()).toBe(200);
    const workerCsp = (await response.allHeaders())["content-security-policy"] ?? "";
    expect(workerCsp).toContain("default-src 'none'");
    expect(workerCsp).toContain("script-src 'self'");
    expect(workerCsp).toContain("connect-src 'self'");
    expect(workerCsp).toContain("worker-src 'self'");
    expect(workerCsp).not.toMatch(/blob:|data:|unsafe-inline|unsafe-eval/u);
    const motion = page.locator("aval-player#motion");
    await expect.poll(() => motion.evaluate((element) =>
      (element as unknown as { readiness: string }).readiness
    ), { timeout: 20_000 }).toBe("interactiveReady");
    await expect(page.locator("#status")).toContainText("Build 1");
    await expect(page.locator("#report")).toContainText("sourceGeneration");
    await expect(page.locator("#summary")).toContainText("DPR");
    await expect(page.locator("#summary")).toContainText("interactiveReady");
    await expect(page.locator("#timeline")).toHaveAttribute("aria-label", /Compiled unit frame map/);
    await expect(page.locator("#state option")).toHaveCount(4);
    expect(await page.locator("video").count()).toBe(0);
  } finally {
    await server.close();
  }
});
