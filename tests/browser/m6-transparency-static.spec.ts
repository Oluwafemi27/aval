import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

const FIXTURE_PATH = fileURLToPath(
  new URL("../../fixtures/conformance/m6/packed-alpha-all-routes.rma", import.meta.url)
);
const SOURCE_ROOT = fileURLToPath(
  new URL("../../fixtures/compiler/m6/source/packed-frames/", import.meta.url)
);
// Updated only by the reviewed M6 provenance generator.
const FIXTURE_SHA256 = "aa66fbca787138b692e7fed691cbabec58dd9f9576b63b13d4ed9c69269d9a0f";

interface M6Support {
  readonly status: "supported" | "unsupported";
  readonly reason: string | null;
  readonly profile: "avc-annexb-packed-alpha-v0";
  readonly asset: { readonly sha256: string; readonly bytes: number };
  readonly canvas: { readonly width: number; readonly height: number };
  readonly candidates: readonly {
    readonly id: string;
    readonly rank: number;
    readonly codedWidth: number;
    readonly codedHeight: number;
    readonly exactConfigSupported: boolean;
  }[];
  readonly geometry: readonly {
    readonly id: string;
    readonly visibleColorRect: readonly number[];
    readonly visibleAlphaRect: readonly number[];
    readonly decodedStorageRect: readonly number[];
    readonly codedWidth: number;
    readonly codedHeight: number;
  }[];
}

interface ErrorMetrics {
  readonly sampleCount: number;
  readonly meanAbsoluteError: number;
  readonly p99AbsoluteError: number;
  readonly maximumAbsoluteError: number;
}

interface M6Report {
  readonly status: "supported";
  readonly support: M6Support & { readonly status: "supported" };
  readonly allRoutes: {
    readonly selectedRendition: string;
    readonly directEdgeCount: number;
    readonly loopCount: number;
    readonly endpointCount: number;
    readonly realtimeAdvancedTicks: number;
    readonly realtimeUnderflows: number;
    readonly manualUnderflows: number;
    readonly recoveryState: string;
    readonly recoveryReason: "animation-failure";
    readonly cleanupComplete: boolean;
  };
  readonly pixelsAndMotion: {
    readonly selectedRendition: string;
    readonly quality: readonly {
      readonly drawSequence: number;
      readonly sourceOrdinal: number;
      readonly presentation: string;
      readonly routePhase: string;
      readonly candidateId: string;
      readonly alpha: ErrorMetrics;
      readonly composites: Record<"black" | "white" | "magenta", ErrorMetrics>;
      readonly transparentEdgeMaximumAlpha: number;
      readonly transparentEdgeMaximumPremultipliedRgb: number;
    }[];
    readonly aggregateAlpha: ErrorMetrics;
    readonly aggregateComposites: Record<"black" | "white" | "magenta", ErrorMetrics>;
    readonly routeCoverage: {
      readonly uniqueSourceOrdinals: readonly number[];
      readonly unusedSourceOrdinals: readonly number[];
      readonly uniquePresentations: readonly string[];
      readonly forwardReversibleFrames: readonly number[];
      readonly reverseReversibleFrames: readonly number[];
      readonly seams: readonly string[];
      readonly gradedDraws: number;
    };
    readonly resize: readonly {
      readonly fit: "contain" | "cover" | "fill" | "none";
      readonly backing: { readonly width: number; readonly height: number };
      readonly graphTraceLengthBefore: number;
      readonly graphTraceLengthAfter: number;
      readonly contentOrdinalBefore: string;
      readonly contentOrdinalAfter: string;
      readonly presentationBefore: string;
      readonly presentationAfter: string;
      readonly sameFrameComparison: {
        readonly alpha: ErrorMetrics;
        readonly composites: Record<"black" | "white" | "magenta", ErrorMetrics>;
      };
    }[];
    readonly equivalentResizeWasNoop: true;
    readonly nativeStatic: {
      readonly nativeSuccesses: number;
      readonly pureSuccesses: number;
      readonly bitmapCloses: number;
    };
    readonly pureStatic: {
      readonly nativeAttempts: number;
      readonly pureAttempts: number;
      readonly pureSuccesses: number;
      readonly bitmapCloses: number;
    };
    readonly motion: {
      readonly precommitCancellationReductionEntered: true;
      readonly precommitCancellationReusedCandidate: true;
      readonly precommitIdentityBefore: {
        readonly candidateIds: readonly string[];
        readonly workerIds: readonly string[];
        readonly lastDrawCandidateId: string;
      };
      readonly precommitIdentityAfter: {
        readonly candidateIds: readonly string[];
        readonly workerIds: readonly string[];
        readonly lastDrawCandidateId: string;
      };
      readonly reducedStaticState: string;
      readonly reentryPresentation: string;
      readonly reentryStaticComparison: {
        readonly alpha: ErrorMetrics;
        readonly composites: Record<"black" | "white" | "magenta", ErrorMetrics>;
      };
      readonly stateChangedDuringReentry: true;
      readonly stateDuringReentryFinalState: string;
      readonly staleReentryCandidateCount: number;
      readonly rapidFlipsBeganInFlight: true;
      readonly introDrawCount: 1;
      readonly rapidFlipFinalMode: "static";
      readonly realtimeOrdinalContinuity: {
        readonly beforeReduction: string;
        readonly whileReduced: string;
        readonly afterReentry: string;
        readonly afterNextFrame: string;
        readonly underflows: 0;
        readonly smoothSession: true;
      };
      readonly reduceBeforePrepare: {
        readonly preparedMode: "static";
        readonly staticOrigin: "reduced-motion";
        readonly reenteredMode: "animated";
        readonly presentation: string;
        readonly cleanupComplete: true;
      };
      readonly finalMode: "animated";
    };
    readonly staticDecodePath: "native" | "pure";
    readonly presentation: {
      readonly generation: number;
      readonly backendAttached: boolean;
      readonly geometry: unknown;
    };
    readonly visibility: readonly {
      readonly sequence: number;
      readonly visible: boolean;
      readonly phase: string;
      readonly connected: boolean;
      readonly overlaid: boolean;
      readonly staticNonTransparentPixels: number;
    }[];
    readonly mountedOverlay: {
      readonly connectedDuringProof: true;
      readonly overlaidDuringProof: true;
    };
    readonly staticStore: {
      readonly state: "disposed";
      readonly retainedSurfaces: 0;
      readonly decodedSurfaces: number;
      readonly closedSurfaces: number;
    };
    readonly cleanup: {
      readonly complete: boolean;
      readonly workersAlive: number;
      readonly openFrames: number;
      readonly renderersAlive: number;
      readonly glResourceCount: number;
      readonly rendererStagingBytes: number;
      readonly sourceCopiesInFlight: number;
      readonly pendingOperations: number;
    };
  };
  readonly forcedFallbacks: readonly {
    readonly seam: "worker-unavailable" | "codec-decode" | "renderer-draw" | "renderer-upload";
    readonly failureBoundary:
      | "worker-transport"
      | "real-worker-webcodecs-error"
      | "renderer-draw"
      | "renderer-upload";
    readonly mode: "static";
    readonly readiness: "staticReady";
    readonly reason: string;
    readonly strictStaticPath: "native" | "pure";
    readonly animatedBeforeFailure: true;
    readonly newestRequestedState: "hover";
    readonly newestVisualState: "hover";
    readonly staticVisible: true;
    readonly staticNonTransparentPixels: number;
    readonly initialCoverSequence: number;
    readonly failureCoverSequence: number;
    readonly candidateCleanupStartSequence: number;
    readonly candidateCleanupEndSequence: number;
    readonly staticCoveredBeforeCandidateCleanup: true;
    readonly candidateLifecycle: readonly {
      readonly sequence: number;
      readonly phase: string;
      readonly kind: "candidate-dispose-start" | "candidate-dispose-end";
      readonly candidateId: string;
      readonly cleanup: {
        readonly workersAlive: number;
        readonly renderersAlive: number;
        readonly complete: boolean;
      };
    }[];
    readonly cleanup: {
      readonly workersAlive: number;
      readonly renderersAlive: number;
      readonly complete: boolean;
    };
    readonly staticStore: { readonly retainedSurfaces: number };
  }[];
  readonly contextFailure: {
    readonly supported: boolean;
    readonly reason: string | null;
    readonly readiness: "staticReady" | null;
    readonly staticOrigin: "animation-failure" | null;
    readonly stickyFailure: boolean;
    readonly staticCoveredBeforeCleanup: boolean;
    readonly staticCoveredBeforeCandidateCleanup: boolean;
    readonly coverEventSequence: number | null;
    readonly candidateCleanupStartSequence: number | null;
    readonly candidateCleanupEndSequence: number | null;
    readonly cleanupEventSequence: number | null;
    readonly coverHadVisiblePixels: boolean;
    readonly retryCreatedWorker: boolean;
    readonly eventSequence: readonly {
      readonly sequence: number;
      readonly visible: boolean;
      readonly phase: string;
      readonly connected: boolean;
      readonly overlaid: boolean;
      readonly staticNonTransparentPixels: number;
    }[];
    readonly candidateLifecycle: readonly {
      readonly sequence: number;
      readonly phase: string;
      readonly kind: "candidate-dispose-start" | "candidate-dispose-end";
      readonly candidateId: string;
      readonly cleanup: {
        readonly workersAlive: number;
        readonly renderersAlive: number;
        readonly complete: boolean;
      };
    }[];
    readonly cleanup: { readonly complete: boolean } | null;
  };
  readonly limits: {
    readonly alphaMaeBytes: 2;
    readonly alphaP99Bytes: 8;
    readonly compositeMaeBytes: 4;
    readonly compositeP99Bytes: 16;
  };
}

interface M6Harness {
  probeM6TransparencyStaticSupport(assetBase64: string): Promise<M6Support>;
  runM6TransparencyStaticProof(
    assetBase64: string,
    expectedFrames: readonly { readonly sourceOrdinal: number; readonly pngBase64: string }[]
  ): Promise<M6Report | M6Support>;
}

test("probes the exact packed-alpha profile without substitution", async ({ page }) => {
  const fixture = await readFile(FIXTURE_PATH);
  expect(createHash("sha256").update(fixture).digest("hex")).toBe(FIXTURE_SHA256);
  await page.goto("/src/m6-transparency-static-proof.ts");
  const support = await callProbe(page, fixture.toString("base64"));

  expect(support.asset).toMatchObject({
    sha256: FIXTURE_SHA256,
    bytes: fixture.byteLength
  });
  expect(support.profile).toBe("avc-annexb-packed-alpha-v0");
  expect(support.canvas).toEqual({ width: 45, height: 27 });
  expect(support.candidates.map(({ id, rank, codedWidth, codedHeight }) => ({
    id, rank, codedWidth, codedHeight
  }))).toEqual([
    { id: "packed.1x", rank: 0, codedWidth: 48, codedHeight: 64 },
    { id: "packed.0.333x", rank: 1, codedWidth: 16, codedHeight: 32 }
  ]);
  expect(support.geometry).toEqual([
    {
      id: "packed.0.333x",
      visibleColorRect: [0, 0, 15, 9],
      visibleAlphaRect: [0, 18, 15, 9],
      decodedStorageRect: [0, 0, 16, 28],
      codedWidth: 16,
      codedHeight: 32
    },
    {
      id: "packed.1x",
      visibleColorRect: [0, 0, 45, 27],
      visibleAlphaRect: [0, 36, 45, 27],
      decodedStorageRect: [0, 0, 46, 64],
      codedWidth: 48,
      codedHeight: 64
    }
  ]);
  if (support.status === "unsupported") {
    expect(support.reason).toEqual(expect.any(String));
  } else {
    expect(support.reason).toBeNull();
    expect(support.candidates.some(({ exactConfigSupported }) => exactConfigSupported))
      .toBe(true);
  }
});

test("proves packed pixels, strict statics, resize, motion re-entry, and cleanup", async ({
  page
}) => {
  test.setTimeout(120_000);
  const browserErrors = collectBrowserErrors(page);
  const fixture = await readFile(FIXTURE_PATH);
  const expectedFrames = await Promise.all(
    Array.from({ length: 30 }, (_value, sourceOrdinal) => sourceOrdinal)
      .map(async (sourceOrdinal) => ({
      sourceOrdinal,
      pngBase64: (await readFile(
        `${SOURCE_ROOT}frame-${String(sourceOrdinal).padStart(4, "0")}.png`
      )).toString("base64")
    }))
  );
  const assetBase64 = fixture.toString("base64");
  await page.goto("/src/m6-transparency-static-proof.ts");
  const support = await callProbe(page, assetBase64);
  test.skip(
    support.status === "unsupported",
    `exact M6 browser profile unsupported: ${support.reason ?? "no reason"}`
  );

  const result = await page.evaluate(async ({ assetBase64, expectedFrames }) => {
    const moduleUrl = "/src/m6-transparency-static-proof.ts";
    const harness = (await import(moduleUrl)) as unknown as M6Harness;
    return harness.runM6TransparencyStaticProof(assetBase64, expectedFrames);
  }, { assetBase64, expectedFrames });
  expect(result.status).toBe("supported");
  const report = result as M6Report;

  expect(report.allRoutes).toMatchObject({
    selectedRendition: "packed.1x",
    directEdgeCount: 6,
    loopCount: 2,
    endpointCount: 2,
    realtimeAdvancedTicks: 43,
    realtimeUnderflows: 0,
    manualUnderflows: 0,
    recoveryState: "hover",
    recoveryReason: "animation-failure",
    cleanupComplete: true
  });
  expect(report.limits).toEqual({
    alphaMaeBytes: 2,
    alphaP99Bytes: 8,
    compositeMaeBytes: 4,
    compositeP99Bytes: 16
  });
  expect(report.pixelsAndMotion.routeCoverage.uniqueSourceOrdinals)
    .toEqual(Array.from({ length: 29 }, (_value, index) => index));
  expect(report.pixelsAndMotion.routeCoverage.unusedSourceOrdinals).toEqual([29]);
  expect(report.pixelsAndMotion.routeCoverage.uniquePresentations).toHaveLength(30);
  expect(report.pixelsAndMotion.routeCoverage.forwardReversibleFrames)
    .toEqual([0, 1, 2, 3, 4, 5]);
  expect(report.pixelsAndMotion.routeCoverage.reverseReversibleFrames)
    .toEqual([0, 1, 2, 3, 4, 5]);
  expect(report.pixelsAndMotion.routeCoverage.seams).toEqual(expect.arrayContaining([
    "intro:2->idle-body:0",
    "idle-body:7->idle-body:0",
    "hover-shift:5->hover-body:0",
    "hover-body:7->hover-body:0",
    "hover-shift:0->idle-body:0",
    "loading-bridge:0->loading-body:0",
    "loading-body:2->done-body:0"
  ]));
  expect(report.pixelsAndMotion.routeCoverage.gradedDraws)
    .toBe(report.pixelsAndMotion.quality.length);
  expect(report.pixelsAndMotion.quality.length).toBeGreaterThanOrEqual(46);
  for (const frame of report.pixelsAndMotion.quality) {
    expect(frame.alpha.meanAbsoluteError).toBeLessThanOrEqual(2);
    expect(frame.alpha.p99AbsoluteError).toBeLessThanOrEqual(8);
    for (const composite of Object.values(frame.composites)) {
      expect(composite.meanAbsoluteError).toBeLessThanOrEqual(4);
      expect(composite.p99AbsoluteError).toBeLessThanOrEqual(16);
    }
    expect(frame.transparentEdgeMaximumAlpha).toBeLessThanOrEqual(8);
    expect(frame.transparentEdgeMaximumPremultipliedRgb).toBeLessThanOrEqual(8);
  }
  expect(report.pixelsAndMotion.aggregateAlpha.meanAbsoluteError)
    .toBeLessThanOrEqual(2);
  expect(report.pixelsAndMotion.aggregateAlpha.p99AbsoluteError)
    .toBeLessThanOrEqual(8);
  for (const composite of Object.values(report.pixelsAndMotion.aggregateComposites)) {
    expect(composite.meanAbsoluteError).toBeLessThanOrEqual(4);
    expect(composite.p99AbsoluteError).toBeLessThanOrEqual(16);
  }

  expect(report.pixelsAndMotion.resize.map(({ fit }) => fit)).toEqual([
    "contain", "cover", "fill", "none"
  ]);
  for (const resize of report.pixelsAndMotion.resize) {
    expect(resize.backing.width).toBeGreaterThan(0);
    expect(resize.backing.height).toBeGreaterThan(0);
    expect(resize.graphTraceLengthAfter).toBe(resize.graphTraceLengthBefore);
    expect(resize.contentOrdinalAfter).toBe(resize.contentOrdinalBefore);
    expect(resize.presentationAfter).toBe(resize.presentationBefore);
    // Canvas2D and WebGL use different scaler implementations. Keep the
    // comparison bounded while the decoded source-grade limits above remain
    // the normative byte thresholds.
    expect(resize.sameFrameComparison.alpha.meanAbsoluteError).toBeLessThanOrEqual(10);
    expect(resize.sameFrameComparison.alpha.p99AbsoluteError).toBeLessThanOrEqual(112);
    for (const composite of Object.values(resize.sameFrameComparison.composites)) {
      expect(composite.meanAbsoluteError).toBeLessThanOrEqual(12);
      expect(composite.p99AbsoluteError).toBeLessThanOrEqual(112);
    }
  }
  expect(report.pixelsAndMotion.equivalentResizeWasNoop).toBe(true);
  expect(report.pixelsAndMotion.pureStatic).toMatchObject({
    nativeAttempts: 0,
    pureAttempts: 1,
    pureSuccesses: 1,
    bitmapCloses: 1
  });
  expect(
    report.pixelsAndMotion.nativeStatic.nativeSuccesses +
    report.pixelsAndMotion.nativeStatic.pureSuccesses
  ).toBeGreaterThan(0);
  expect(report.pixelsAndMotion.motion).toMatchObject({
    precommitCancellationReductionEntered: true,
    precommitCancellationReusedCandidate: true,
    reducedStaticState: "hover",
    reentryPresentation: "hover-body:0",
    stateChangedDuringReentry: true,
    stateDuringReentryFinalState: "idle",
    rapidFlipsBeganInFlight: true,
    introDrawCount: 1,
    rapidFlipFinalMode: "static",
    finalMode: "animated"
  });
  expect(report.pixelsAndMotion.motion.precommitIdentityAfter)
    .toEqual(report.pixelsAndMotion.motion.precommitIdentityBefore);
  expect(report.pixelsAndMotion.motion.precommitIdentityBefore.candidateIds).toHaveLength(1);
  expect(report.pixelsAndMotion.motion.precommitIdentityBefore.workerIds).toHaveLength(1);
  expect(report.pixelsAndMotion.motion.staleReentryCandidateCount).toBeGreaterThanOrEqual(2);
  expect(report.pixelsAndMotion.motion.reentryStaticComparison.alpha.p99AbsoluteError)
    .toBeLessThanOrEqual(8);
  for (const composite of Object.values(
    report.pixelsAndMotion.motion.reentryStaticComparison.composites
  )) {
    expect(composite.meanAbsoluteError).toBeLessThanOrEqual(4);
    expect(composite.p99AbsoluteError).toBeLessThanOrEqual(16);
  }
  const ordinal = report.pixelsAndMotion.motion.realtimeOrdinalContinuity;
  expect(ordinal.whileReduced).toBe(ordinal.beforeReduction);
  expect(ordinal.afterReentry).toBe(ordinal.beforeReduction);
  expect(BigInt(ordinal.afterNextFrame)).toBe(BigInt(ordinal.beforeReduction) + 1n);
  expect(ordinal).toMatchObject({ underflows: 0, smoothSession: true });
  expect(report.pixelsAndMotion.motion.reduceBeforePrepare).toEqual({
    preparedMode: "static",
    staticOrigin: "reduced-motion",
    reenteredMode: "animated",
    presentation: "idle-body:0",
    cleanupComplete: true
  });
  expect(["native", "pure"]).toContain(report.pixelsAndMotion.staticDecodePath);
  expect(report.pixelsAndMotion.presentation).toMatchObject({
    backendAttached: true
  });
  expect(report.pixelsAndMotion.presentation.generation).toBeGreaterThan(0);
  expect(report.pixelsAndMotion.presentation.geometry).not.toBeNull();
  expect(report.pixelsAndMotion.mountedOverlay).toEqual({
    connectedDuringProof: true,
    overlaidDuringProof: true
  });
  expect(report.pixelsAndMotion.visibility.some((event) =>
    event.visible && event.connected && event.overlaid && event.staticNonTransparentPixels > 0
  )).toBe(true);
  expect(report.pixelsAndMotion.visibility.at(-1)).toMatchObject({
    visible: false,
    phase: "cleanup",
    connected: true,
    overlaid: true
  });
  expect(report.pixelsAndMotion.staticStore).toMatchObject({
    state: "disposed",
    retainedSurfaces: 0
  });
  expect(report.pixelsAndMotion.staticStore.decodedSurfaces)
    .toBe(report.pixelsAndMotion.staticStore.closedSurfaces);
  expect(report.pixelsAndMotion.cleanup).toEqual({
    workersAlive: 0,
    openFrames: 0,
    renderersAlive: 0,
    glResourceCount: 0,
    rendererStagingBytes: 0,
    sourceCopiesInFlight: 0,
    pendingOperations: 0,
    complete: true
  });
  expect(report.forcedFallbacks.map(({ seam }) => seam)).toEqual([
    "worker-unavailable",
    "codec-decode",
    "renderer-draw",
    "renderer-upload"
  ]);
  expect(report.forcedFallbacks.map(({ failureBoundary }) => failureBoundary))
    .toEqual([
      "worker-transport",
      "real-worker-webcodecs-error",
      "renderer-draw",
      "renderer-upload"
    ]);
  for (const fallback of report.forcedFallbacks) {
    expect(fallback).toMatchObject({
      mode: "static",
      readiness: "staticReady",
      reason: "animation-failure",
      animatedBeforeFailure: true,
      newestRequestedState: "hover",
      newestVisualState: "hover",
      staticVisible: true,
      staticCoveredBeforeCandidateCleanup: true,
      cleanup: { complete: true },
      staticStore: { retainedSurfaces: 0 }
    });
    expect(["native", "pure"]).toContain(fallback.strictStaticPath);
    expect(fallback.staticNonTransparentPixels).toBeGreaterThan(0);
    expect(fallback.initialCoverSequence).toBeLessThan(
      fallback.failureCoverSequence
    );
    expect(fallback.failureCoverSequence).toBeLessThan(
      fallback.candidateCleanupStartSequence
    );
    expect(fallback.candidateCleanupStartSequence).toBeLessThan(
      fallback.candidateCleanupEndSequence
    );
    const liveCandidateLifecycle = fallback.candidateLifecycle.filter((event) =>
      event.phase === "live-failure"
    );
    expect(liveCandidateLifecycle).toEqual([
      expect.objectContaining({
        phase: "live-failure",
        kind: "candidate-dispose-start",
        cleanup: expect.objectContaining({ complete: false })
      }),
      expect.objectContaining({
        phase: "live-failure",
        kind: "candidate-dispose-end",
        cleanup: expect.objectContaining({
          workersAlive: 0,
          renderersAlive: 0,
          complete: true
        })
      })
    ]);
    expect(liveCandidateLifecycle[0]!.candidateId)
      .toBe(liveCandidateLifecycle[1]!.candidateId);
    expect(liveCandidateLifecycle[0]!.candidateId).toMatch(/^candidate-[1-9]\d*$/);
    expect(
      liveCandidateLifecycle[0]!.cleanup.workersAlive +
      liveCandidateLifecycle[0]!.cleanup.renderersAlive
    ).toBeGreaterThan(0);
  }
  if (report.contextFailure.supported) {
    expect(report.contextFailure).toMatchObject({
      reason: null,
      readiness: "staticReady",
      staticOrigin: "animation-failure",
      stickyFailure: true,
      staticCoveredBeforeCleanup: true,
      staticCoveredBeforeCandidateCleanup: true,
      coverHadVisiblePixels: true,
      retryCreatedWorker: false,
      cleanup: { complete: true }
    });
    expect(report.contextFailure.coverEventSequence).toBeLessThan(
      report.contextFailure.candidateCleanupStartSequence!
    );
    expect(report.contextFailure.candidateCleanupStartSequence).toBeLessThan(
      report.contextFailure.candidateCleanupEndSequence!
    );
    expect(report.contextFailure.candidateCleanupEndSequence).toBeLessThan(
      report.contextFailure.cleanupEventSequence!
    );
    const contextCandidateLifecycle = report.contextFailure.candidateLifecycle.filter(
      (event) => event.phase === "context-failure"
    );
    expect(contextCandidateLifecycle).toEqual([
      expect.objectContaining({
        phase: "context-failure",
        kind: "candidate-dispose-start",
        cleanup: expect.objectContaining({
          complete: false
        })
      }),
      expect.objectContaining({
        phase: "context-failure",
        kind: "candidate-dispose-end",
        cleanup: expect.objectContaining({
          workersAlive: 0,
          renderersAlive: 0,
          complete: true
        })
      })
    ]);
    expect(contextCandidateLifecycle[0]!.candidateId)
      .toBe(contextCandidateLifecycle[1]!.candidateId);
    expect(contextCandidateLifecycle[0]!.candidateId).toMatch(/^candidate-[1-9]\d*$/);
    expect(
      contextCandidateLifecycle[0]!.cleanup.workersAlive +
      contextCandidateLifecycle[0]!.cleanup.renderersAlive
    ).toBeGreaterThan(0);
    expect(report.contextFailure.eventSequence.some((event) =>
      event.phase === "context-failure" && event.visible &&
      event.connected && event.overlaid && event.staticNonTransparentPixels > 0
    )).toBe(true);
  } else {
    expect(report.contextFailure.reason).toEqual(expect.any(String));
  }
  expect(browserErrors).toEqual([]);
});

async function callProbe(page: Page, assetBase64: string): Promise<M6Support> {
  return page.evaluate(async (base64) => {
    const moduleUrl = "/src/m6-transparency-static-proof.ts";
    const harness = (await import(moduleUrl)) as unknown as M6Harness;
    return harness.probeM6TransparencyStaticSupport(base64);
  }, assetBase64);
}

function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror:${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console:${message.text()}`);
  });
  return errors;
}
