import { expect, test } from "@playwright/test";

test("one-state markup plays its intro once and repeats only the authored body", async ({ page }) => {
  await page.goto("/m8-dev-entry.html?one-state-loop");
  const motion = page.locator("aval-player");
  const before = await motion.evaluate((element) =>
    (element as unknown as { getDiagnostics(): { sourceGeneration: number } })
      .getDiagnostics().sourceGeneration
  );
  await motion.evaluate((element) => {
    (element as unknown as { src: string }).src =
      "/__m8__/asset?fixture=one-state&session=m8-one-state-loop";
  });
  await expect.poll(() => motion.evaluate((element) => {
    const node = element as unknown as {
      readiness: string;
      getDiagnostics(): { sourceGeneration: number };
    };
    return {
      readiness: node.readiness,
      generation: node.getDiagnostics().sourceGeneration
    };
  }), { timeout: 20_000 }).toEqual({
    readiness: "interactiveReady",
    generation: before + 1
  });
  await expect.poll(() => motion.evaluate((element) => {
    const records = (element as unknown as {
      getDiagnostics(options: { trace: boolean }): {
        runtimeTrace: readonly {
          kind: string;
          graph: { presentation: { kind: string } | null } | null;
        }[];
      };
    }).getDiagnostics({ trace: true }).runtimeTrace;
    return records.filter((record) =>
      record.kind === "content-tick" &&
      record.graph?.presentation?.kind === "body"
    ).length;
  }), { timeout: 20_000 }).toBeGreaterThanOrEqual(24);

  const ledger = await motion.evaluate((element) => {
    const node = element as unknown as {
      pause(): void;
      getDiagnostics(options: { trace: boolean }): {
        runtimeTrace: readonly {
          index: number;
          kind: string;
          presentationOrdinal: string | null;
          graph: { presentation: { kind: string; frameIndex?: number } | null } | null;
          scheduler: {
            displayedCursor: { unit: string; localFrame: number } | null;
            smoothSession: boolean;
          };
          media: {
            kind: string;
            graphKind?: string;
            state?: string | null;
            edge?: string | null;
            frame?: { unit: string; localFrame: number };
          } | null;
          readbackTag: string | null;
          callbackStartMicroseconds: number | null;
          canvasSubmissionCompleteMicroseconds: number | null;
          eligibleAnimationFrameOrdinal: number | null;
          counters: { underflows: number; fallbacks: number };
        }[];
      };
    };
    node.pause();
    const trace = node.getDiagnostics({ trace: true }).runtimeTrace;
    const activation = trace.find((record) =>
      record.kind === "readiness" &&
      record.graph?.presentation?.kind === "intro"
    );
    const content = trace.flatMap((record) => {
      const presentation = record.graph?.presentation;
      if (record.kind !== "content-tick" || presentation === null || presentation === undefined) {
        return [];
      }
      return [{
        traceIndex: record.index,
        ordinal: record.presentationOrdinal,
        kind: presentation.kind,
        frame: presentation.frameIndex ?? null,
        mediaKind: record.media?.kind ?? null,
        mediaGraphKind: record.media?.graphKind ?? null,
        mediaState: record.media?.state ?? null,
        mediaEdge: record.media?.edge ?? null,
        mediaUnit: record.media?.frame?.unit ?? null,
        mediaFrame: record.media?.frame?.localFrame ?? null,
        readbackTag: record.readbackTag,
        start: record.callbackStartMicroseconds,
        submitted: record.canvasSubmissionCompleteMicroseconds,
        eligible: record.eligibleAnimationFrameOrdinal,
        underflows: record.counters.underflows,
        fallbacks: record.counters.fallbacks
      }];
    });
    return {
      activation: activation === undefined ? null : {
        kind: activation.graph?.presentation?.kind ?? null,
        frame: activation.graph?.presentation?.frameIndex ?? null,
        displayedUnit: activation.scheduler.displayedCursor?.unit ?? null,
        displayedFrame: activation.scheduler.displayedCursor?.localFrame ?? null,
        smoothSession: activation.scheduler.smoothSession,
        readbackTag: activation.readbackTag
      },
      content,
      finalCounters: trace.at(-1)?.counters ?? { underflows: -1, fallbacks: -1 }
    };
  });
  expect(ledger.activation).toEqual({
    kind: "intro",
    frame: 0,
    displayedUnit: null,
    displayedFrame: null,
    smoothSession: true,
    readbackTag: "intro:default:intro:0"
  });
  expect(ledger.finalCounters).toMatchObject({ underflows: 0, fallbacks: 0 });
  expect(ledger.content.length).toBeGreaterThanOrEqual(26);
  const graded = ledger.content.slice(0, 26);
  expect(graded.slice(0, 2).map(({ kind, frame }) => ({ kind, frame }))).toEqual([
    { kind: "intro", frame: 1 },
    { kind: "intro", frame: 2 }
  ]);
  expect(graded.slice(2).map(({ frame }) => frame)).toEqual([
    0, 1, 2, 3, 4, 5, 6, 7,
    0, 1, 2, 3, 4, 5, 6, 7,
    0, 1, 2, 3, 4, 5, 6, 7
  ]);
  for (const [index, record] of ledger.content.entries()) {
    const expected = index < 2
      ? { kind: "intro", frame: index + 1 }
      : { kind: "body", frame: (index - 2) % 8 };
    expect.soft(
      { kind: record.kind, frame: record.frame },
      `semantic presentation ${index}`
    ).toEqual(expected);
    expect.soft(record.mediaKind, `media kind ${index}`).toBe("frame");
    expect.soft(record.mediaGraphKind, `media graph kind ${index}`).toBe(expected.kind);
    expect.soft(record.mediaFrame, `media frame ${index}`).toBe(expected.frame);
    expect.soft(record.readbackTag, `readback identity ${index}`).toBe(
      `${record.mediaGraphKind}:${record.mediaState ?? record.mediaEdge}:${record.mediaUnit}:${String(record.mediaFrame)}`
    );
    expect.soft(record.ordinal, `presentation ordinal ${index}`).toBe(String(index + 1));
    expect.soft(record.underflows, `underflows ${index}`).toBe(0);
    expect.soft(record.fallbacks, `fallbacks ${index}`).toBe(0);
    expect.soft(record.start, `callback start ${index}`).not.toBeNull();
    expect.soft(record.submitted, `submission completion ${index}`).not.toBeNull();
    expect.soft(record.eligible, `eligible RAF ${index}`).not.toBeNull();
    if (record.start !== null && record.submitted !== null) {
      expect.soft(record.submitted, `submission order ${index}`).toBeGreaterThanOrEqual(record.start);
    }
    if (index > 0) {
      expect.soft(record.traceIndex, `trace order ${index}`).toBeGreaterThan(
        ledger.content[index - 1]!.traceIndex
      );
      if (record.eligible !== null && ledger.content[index - 1]!.eligible !== null) {
        expect.soft(record.eligible, `RAF order ${index}`).toBeGreaterThan(
          ledger.content[index - 1]!.eligible!
        );
      }
    }
  }
  expect(await page.locator("video").count()).toBe(0);
});
