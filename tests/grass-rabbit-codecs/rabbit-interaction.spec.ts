import { expect, test } from "@playwright/test";

import {
  CODECS,
  CODEC_PATTERNS,
  activePlayerSnapshot,
  activeTraceUnits,
  captureBrowserFailures,
  capturePreviousPlayer,
  codecPanel,
  expectActiveCodecPlayer,
  expectNoBrowserFailures,
  expectOrderedSubsequence,
  expectPreviousPlayerCleanup,
  expectVisualState,
  openExample,
  supportSnapshot,
  traceContainsUnit
} from "./support/browser-harness.js";

test("plays the complete rabbit interaction on every supported codec", async ({
  page
}) => {
  test.setTimeout(5 * 60_000);
  const failures = captureBrowserFailures(page);
  await openExample(page);
  const support = await supportSnapshot(page);
  const supported = CODECS.filter((codec) => support[codec] === "supported");
  let cleanupProofs = 0;

  for (const codec of supported) {
    await page.mouse.move(1, 1);
    const previous = await capturePreviousPlayer(page);
    await page.evaluate(async (requested) => {
      await window.grassRabbitCodecs.activate(requested);
    }, codec);
    if (await expectPreviousPlayerCleanup(page, previous, codec)) {
      cleanupProofs += 1;
    }

    await expectActiveCodecPlayer(page, codec);
    await expect.poll(() => activePlayerSnapshot(page), { timeout: 45_000 })
      .toMatchObject({
        readiness: "interactiveReady",
        selectedCodec: expect.stringMatching(CODEC_PATTERNS[codec]),
        lastFailure: null,
        underflow: 0
      });
    await expect.poll(() => traceContainsUnit(page, "intro"), { timeout: 15_000 })
      .toBe(true);
    await expectVisualState(page, "idle");

    const player = codecPanel(page, codec).locator("aval-player");
    await player.hover();
    await expectVisualState(page, "entering");
    await expectVisualState(page, "hover");
    await expect.poll(() => activePlayerSnapshot(page)).toMatchObject({
      requestedState: "hover",
      visualState: "hover",
      isTransitioning: false
    });

    await page.mouse.move(1, 1);
    await expectVisualState(page, "exiting");
    await expectVisualState(page, "idle");
    await expect.poll(() => activePlayerSnapshot(page)).toMatchObject({
      requestedState: "idle",
      visualState: "idle",
      isTransitioning: false,
      selectedCodec: expect.stringMatching(CODEC_PATTERNS[codec]),
      lastFailure: null,
      underflow: 0
    });

    const units = await activeTraceUnits(page);
    expectOrderedSubsequence(units, [
      "intro",
      "idle-loop",
      "hover-in",
      "hover-loop",
      "hover-out",
      "idle-loop"
    ]);
    expectNoBrowserFailures(failures);
  }

  if (supported.length > 0 && cleanupProofs === 0) {
    const inactiveCodec = CODECS.find((codec) => support[codec] !== "supported");
    expect(inactiveCodec).toBeDefined();
    const previous = await capturePreviousPlayer(page);
    await page.evaluate(async (requested) => {
      await window.grassRabbitCodecs.activate(requested);
    }, inactiveCodec!);
    expect(await expectPreviousPlayerCleanup(page, previous, inactiveCodec!)).toBe(true);
    cleanupProofs += 1;
  }

  if (supported.length > 0) expect(cleanupProofs).toBeGreaterThan(0);
  expectNoBrowserFailures(failures);
});

test("finishes hover-in before hover-out when engagement ends early", async ({
  page
}) => {
  test.setTimeout(2 * 60_000);
  const failures = captureBrowserFailures(page);
  await openExample(page);
  const support = await supportSnapshot(page);
  const codec = CODECS.find((candidate) => support[candidate] === "supported");
  test.skip(codec === undefined, "this browser exposes no supported codec fixture");

  await page.evaluate(async (requested) => {
    await window.grassRabbitCodecs.activate(requested);
  }, codec!);
  await expectActiveCodecPlayer(page, codec!);
  await expect.poll(() => activePlayerSnapshot(page), { timeout: 45_000 })
    .toMatchObject({ readiness: "interactiveReady", lastFailure: null, underflow: 0 });
  await expectVisualState(page, "idle");
  await page.mouse.move(1, 1);

  const traceStart = await page.evaluate(() => {
    const trace = window.grassRabbitCodecs.activePlayer
      ?.getDiagnostics({ trace: true }).runtimeTrace ?? [];
    return trace.at(-1)?.index ?? -1;
  });
  await codecPanel(page, codec!).locator("aval-player").hover();
  await expect.poll(() => page.evaluate(() => {
    const trace = window.grassRabbitCodecs.activePlayer
      ?.getDiagnostics({ trace: true }).runtimeTrace ?? [];
    const presentation = trace.at(-1)?.graph?.presentation;
    return presentation?.unitId === "hover-in" &&
      typeof presentation.frameIndex === "number" &&
      presentation.frameIndex >= 8 && presentation.frameIndex < 50;
  }), { timeout: 15_000 }).toBe(true);

  await page.mouse.move(1, 1);
  await expect.poll(() => activePlayerSnapshot(page)).toMatchObject({
    requestedState: "exiting"
  });
  await expectVisualState(page, "idle");

  const routeFrames = await page.evaluate((startIndex) => {
    const trace = window.grassRabbitCodecs.activePlayer
      ?.getDiagnostics({ trace: true }).runtimeTrace ?? [];
    return trace.flatMap((record) => {
      if (record.index <= startIndex) return [];
      const media = record.media;
      if (
        media?.kind !== "frame" ||
        typeof media.frame?.unit !== "string" ||
        typeof media.frame.localFrame !== "number" ||
        !["hover-in", "hover-loop", "hover-out"].includes(media.frame.unit)
      ) return [];
      return [{ unit: media.frame.unit, frame: media.frame.localFrame }];
    });
  }, traceStart);
  expect(routeFrames.length).toBeLessThanOrEqual(128);
  const framesFor = (unit: string): number[] => routeFrames
    .filter((record) => record.unit === unit)
    .map((record) => record.frame);
  expect(framesFor("hover-in")).toEqual(
    Array.from({ length: 67 }, (_, frame) => frame)
  );
  expect(framesFor("hover-loop")).toEqual([]);
  expect(framesFor("hover-out")).toEqual(
    Array.from({ length: 48 }, (_, frame) => frame)
  );
  await expect.poll(() => activePlayerSnapshot(page)).toMatchObject({
    requestedState: "idle",
    visualState: "idle",
    isTransitioning: false,
    lastFailure: null,
    underflow: 0
  });
  expectNoBrowserFailures(failures);
});
