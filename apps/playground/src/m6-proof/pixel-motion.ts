import {
  validateCompleteAsset,
  type CompiledManifestV01
} from "@rendered-motion/format";
import {
  BrowserPresentationPlanes,
  BrowserStaticSurfaceDecoder,
  IntegratedPlayer,
  StaticSurfaceStore,
  asStaticSurfaceCatalog,
  createBrowserAvcCandidateComposition,
  timestampForFrame,
  type BrowserAvcCandidateComposition,
  type BrowserAvcCandidateSnapshot,
  type BrowserPresentationPlanesSnapshot,
  type BrowserStaticSurfaceDecoderSnapshot,
  type StaticSurfaceStoreSnapshot
} from "@rendered-motion/player-web";

import { mountProofPlanes, readCanvasRgba, type PlaneVisibilityEvent } from "./dom";
import {
  GatedStaticSurfaceDecoder,
  createWorkerIdentityTracker,
  identitySnapshot,
  instrumentCandidateFactory,
  type CandidateIdentityTracker,
  type DrawIdentityRecord
} from "./instrumentation";
import {
  BACKGROUNDS,
  PROOF_BACKING_BYTE_LIMIT,
  compareRenderedPlanes,
  deepFreeze,
  mapMetrics,
  measureFrame,
  metrics,
  presentationLabel,
  requireProof,
  safeStringify,
  sourceOrdinalForPresentation,
  type DecodedSourceFrame,
  type ErrorMetrics,
  type FrameQualityEvidence,
  type PlaneComparisonEvidence
} from "./shared";

interface ResizeEvidence {
  readonly fit: "contain" | "cover" | "fill" | "none";
  readonly css: Readonly<{ readonly width: number; readonly height: number }>;
  readonly dpr: number;
  readonly backing: Readonly<{ readonly width: number; readonly height: number }>;
  readonly effectiveDpr: Readonly<{ readonly x: number; readonly y: number }>;
  readonly sourceRect: Readonly<{ readonly x: number; readonly y: number; readonly width: number; readonly height: number }>;
  readonly destinationBackingRect: Readonly<{ readonly x: number; readonly y: number; readonly width: number; readonly height: number }>;
  readonly clampReasons: readonly string[];
  readonly graphTraceLengthBefore: number;
  readonly graphTraceLengthAfter: number;
  readonly contentOrdinalBefore: string;
  readonly contentOrdinalAfter: string;
  readonly presentationBefore: string;
  readonly presentationAfter: string;
  readonly sameFrameComparison: Readonly<PlaneComparisonEvidence>;
}

interface RouteCoverageEvidence {
  readonly uniqueSourceOrdinals: readonly number[];
  readonly unusedSourceOrdinals: readonly number[];
  readonly uniquePresentations: readonly string[];
  readonly forwardReversibleFrames: readonly number[];
  readonly reverseReversibleFrames: readonly number[];
  readonly seams: readonly string[];
  readonly gradedDraws: number;
}

interface MotionEvidence {
  readonly precommitCancellationReductionEntered: true;
  readonly precommitCancellationReusedCandidate: true;
  readonly precommitIdentityBefore: ReturnType<typeof identitySnapshot>;
  readonly precommitIdentityAfter: ReturnType<typeof identitySnapshot>;
  readonly reducedStaticState: string;
  readonly reentryPresentation: string;
  readonly reentryStaticComparison: Readonly<PlaneComparisonEvidence>;
  readonly stateChangedDuringReentry: true;
  readonly stateDuringReentryFinalState: string;
  readonly staleReentryCandidateCount: number;
  readonly rapidFlipsBeganInFlight: true;
  readonly rapidFlipFinalMode: "static";
  readonly realtimeOrdinalContinuity: Readonly<RealtimeOrdinalEvidence>;
  readonly reduceBeforePrepare: Readonly<ReduceBeforePrepareEvidence>;
  readonly introDrawCount: 1;
  readonly finalMode: "animated";
}

export interface RealtimeOrdinalEvidence {
  readonly beforeReduction: string;
  readonly whileReduced: string;
  readonly afterReentry: string;
  readonly afterNextFrame: string;
  readonly underflows: 0;
  readonly smoothSession: true;
}

export interface ReduceBeforePrepareEvidence {
  readonly preparedMode: "static";
  readonly staticOrigin: "reduced-motion";
  readonly reenteredMode: "animated";
  readonly presentation: string;
  readonly cleanupComplete: true;
}

export interface M6PixelMotionEvidence {
  readonly selectedRendition: string;
  readonly quality: readonly Readonly<FrameQualityEvidence>[];
  readonly routeCoverage: Readonly<RouteCoverageEvidence>;
  readonly aggregateAlpha: Readonly<ErrorMetrics>;
  readonly aggregateComposites: Readonly<Record<keyof typeof BACKGROUNDS, ErrorMetrics>>;
  readonly resize: readonly Readonly<ResizeEvidence>[];
  readonly equivalentResizeWasNoop: true;
  readonly nativeStatic: Readonly<BrowserStaticSurfaceDecoderSnapshot>;
  readonly pureStatic: Readonly<BrowserStaticSurfaceDecoderSnapshot>;
  readonly staticDecodePath: "native" | "pure";
  readonly motion: Readonly<MotionEvidence>;
  readonly presentation: Readonly<BrowserPresentationPlanesSnapshot>;
  readonly staticStore: Readonly<StaticSurfaceStoreSnapshot>;
  readonly cleanup: Readonly<BrowserAvcCandidateSnapshot["cleanup"]>;
  readonly visibility: readonly Readonly<PlaneVisibilityEvent>[];
  readonly mountedOverlay: Readonly<{
    readonly connectedDuringProof: true;
    readonly overlaidDuringProof: true;
  }>;
}

const EXPECTED_PRESENTATIONS = Object.freeze([
  ...labels("intro", 3),
  ...labels("idle-body", 8),
  ...labels("hover-shift", 6),
  ...labels("hover-body", 8),
  ...labels("loading-bridge", 1),
  ...labels("loading-body", 3),
  ...labels("done-body", 1)
]);

const EXPECTED_SEAMS = Object.freeze([
  "intro:2->idle-body:0",
  "idle-body:7->idle-body:0",
  "idle-body:7->hover-shift:0",
  "hover-shift:5->hover-body:0",
  "hover-body:7->hover-body:0",
  "hover-body:7->hover-shift:5",
  "hover-shift:0->idle-body:0",
  "idle-body:7->loading-bridge:0",
  "loading-bridge:0->loading-body:0",
  "loading-body:2->done-body:0"
]);

export async function runPixelMotionProof(
  assetBase64: string,
  expectedFrames: readonly Readonly<DecodedSourceFrame>[],
  runRealtime: (assetBase64: string) => Promise<Readonly<RealtimeOrdinalEvidence>>,
  runReducedStartup: (assetBase64: string) => Promise<Readonly<ReduceBeforePrepareEvidence>>
): Promise<Readonly<M6PixelMotionEvidence>> {
  const bytes = decodeAsset(assetBase64);
  const manifest = assetManifest(bytes);
  const mounted = mountProofPlanes(manifest.canvas, "pixel-motion");
  const planes = new BrowserPresentationPlanes({
    animatedCanvas: mounted.animatedCanvas,
    staticCanvas: mounted.staticCanvas,
    canvas: manifest.canvas,
    maxBackingBytes: PROOF_BACKING_BYTE_LIMIT,
    setStaticVisible: (visible) => mounted.setStaticVisible(visible)
  });
  planes.resize({
    cssWidth: manifest.canvas.width,
    cssHeight: manifest.canvas.height,
    devicePixelRatio: 1,
    fit: "fill"
  });
  const workers = createWorkerIdentityTracker();
  const composition = createBrowserAvcCandidateComposition({
    canvas: mounted.animatedCanvas,
    presentationPlanes: planes,
    renderer: { preserveDrawingBuffer: true },
    clock: { now: () => performance.now() },
    testDependencies: { createWorkerPort: workers.create }
  });
  const candidates = instrumentCandidateFactory(composition.factory);
  const productionDecoder = new BrowserStaticSurfaceDecoder();
  const gatedDecoder = new GatedStaticSurfaceDecoder(productionDecoder);
  const diagnostics: string[] = [];
  let store: StaticSurfaceStore | null = null;
  const player = new IntegratedPlayer({
    bytes,
    candidateFactory: candidates.factory,
    createStaticStore(catalog) {
      const created = new StaticSurfaceStore(
        asStaticSurfaceCatalog(catalog),
        gatedDecoder,
        planes.staticPlane
      );
      store = created;
      return created;
    },
    motionPolicy: "full",
    now: () => performance.now(),
    diagnosticsSink: (failure) => diagnostics.push(`${failure.code}:${failure.message}`)
  });

  const expectedByOrdinal = new Map(
    expectedFrames.map((frame) => [frame.sourceOrdinal, frame] as const)
  );
  const quality: FrameQualityEvidence[] = [];
  const aggregateAlpha: number[] = [];
  const aggregateComposites: Record<keyof typeof BACKGROUNDS, number[]> = {
    black: [], white: [], magenta: []
  };
  const resize: ResizeEvidence[] = [];
  let routePhase = "activation";
  let nextOrdinal = 1n;
  let lastGradedDraw = 0;
  let presentationSnapshot: BrowserPresentationPlanesSnapshot | null = null;
  let finalStore: StaticSurfaceStoreSnapshot | null = null;
  let finalCleanup: BrowserAvcCandidateSnapshot["cleanup"] | null = null;

  const gradeLatest = (): Readonly<DrawIdentityRecord> => {
    const draw = latestDraw(candidates);
    requireProof(draw.sequence > lastGradedDraw, "M6 proof tried to grade the same draw twice");
    const sourceOrdinal = sourceOrdinalForPresentation(draw.presentation);
    const expected = expectedByOrdinal.get(sourceOrdinal);
    requireProof(expected !== undefined,
      `M6 proof has no expected source frame ${String(sourceOrdinal)}`);
    quality.push(measureFrame(
      composition,
      expected,
      {
        drawSequence: draw.sequence,
        presentation: presentationLabel(draw.presentation),
        routePhase,
        candidateId: draw.candidateId
      },
      aggregateAlpha,
      aggregateComposites
    ));
    lastGradedDraw = draw.sequence;
    return draw;
  };

  const advanceAndGrade = async (): Promise<Readonly<DrawIdentityRecord>> => {
    await advanceOne(player, composition, manifest, nextOrdinal, routePhase, diagnostics);
    nextOrdinal += 1n;
    return gradeLatest();
  };

  const advanceUntil = async (
    predicate: (draw: Readonly<DrawIdentityRecord>) => boolean,
    label: string,
    maximum = 96
  ): Promise<Readonly<DrawIdentityRecord>> => {
    for (let count = 0; count < maximum; count += 1) {
      const draw = await advanceAndGrade();
      if (predicate(draw)) return draw;
    }
    throw new Error(`M6 pixel route did not reach ${label}`);
  };

  try {
    mounted.setPhase("initial-prepare");
    const prepared = await player.prepare({ timeoutMs: 30_000 });
    requireProof(prepared.mode === "animated",
      `M6 packed candidate did not animate: ${safeStringify({
        prepared,
        player: player.snapshot(),
        browser: composition.controls.snapshot(),
        candidates: candidates.candidateIds,
        workers: workers.identities
      })}`);
    await composition.controls.settled();
    requireProof(
      presentationLabel(latestDraw(candidates).presentation) === "intro:0",
      "M6 activation did not draw intro zero"
    );
    gradeLatest();

    routePhase = "intro";
    await advanceUntil(
      (draw) => presentationLabel(draw.presentation) === "idle-body:0",
      "intro into idle body zero"
    );

    const beforeResizeTrace = player.getTrace();
    const beforeResizeOrdinal = requireTraceContentOrdinal(beforeResizeTrace);
    const beforeResizePresentation = presentationLabel(latestDraw(candidates).presentation);
    requireProof(beforeResizePresentation === "idle-body:0",
      "resize proof did not hold authored idle body zero");
    for (const input of [
      { fit: "contain" as const, cssWidth: 91, cssHeight: 73, devicePixelRatio: 1.25 },
      { fit: "cover" as const, cssWidth: 73, cssHeight: 91, devicePixelRatio: 1.5 },
      { fit: "fill" as const, cssWidth: 87, cssHeight: 53, devicePixelRatio: 2 },
      { fit: "none" as const, cssWidth: 31, cssHeight: 19, devicePixelRatio: 1.75 }
    ]) {
      const before = player.getTrace();
      const beforeOrdinal = requireTraceContentOrdinal(before);
      const beforePresentation = presentationLabel(latestDraw(candidates).presentation);
      const geometry = planes.resize(input);
      const after = player.getTrace();
      const afterOrdinal = requireTraceContentOrdinal(after);
      const afterPresentation = presentationLabel(latestDraw(candidates).presentation);
      requireProof(
        after.length === before.length && afterOrdinal === beforeOrdinal &&
          afterPresentation === beforePresentation,
        `${input.fit} resize advanced graph time or changed the current frame`
      );
      requireProof(
        mounted.animatedCanvas.width === mounted.staticCanvas.width &&
          mounted.animatedCanvas.height === mounted.staticCanvas.height,
        `${input.fit} planes diverged in backing size`
      );
      const animated = composition.controls.readPixels();
      const staticPixels = readCanvasRgba(mounted.staticCanvas);
      const comparison = compareRenderedPlanes(
        animated,
        staticPixels,
        `${input.fit} same-frame static/WebGL crop`
      );
      resize.push(deepFreeze({
        fit: input.fit,
        css: { width: input.cssWidth, height: input.cssHeight },
        dpr: input.devicePixelRatio,
        backing: geometry.backing,
        effectiveDpr: geometry.effectiveDevicePixelRatio,
        sourceRect: geometry.sourceRect,
        destinationBackingRect: geometry.destinationBackingRect,
        clampReasons: geometry.clampReasons,
        graphTraceLengthBefore: before.length,
        graphTraceLengthAfter: after.length,
        contentOrdinalBefore: beforeOrdinal.toString(),
        contentOrdinalAfter: afterOrdinal.toString(),
        presentationBefore: beforePresentation,
        presentationAfter: afterPresentation,
        sameFrameComparison: comparison
      }));
    }

    planes.resize({
      cssWidth: manifest.canvas.width,
      cssHeight: manifest.canvas.height,
      devicePixelRatio: 1,
      fit: "fill"
    });
    const beforeEquivalent = planes.snapshot();
    planes.resize({
      cssWidth: manifest.canvas.width,
      cssHeight: manifest.canvas.height,
      devicePixelRatio: 1,
      fit: "fill"
    });
    const afterEquivalent = planes.snapshot();
    requireProof(
      afterEquivalent.generation === beforeEquivalent.generation &&
        afterEquivalent.equivalentResizeCount === beforeEquivalent.equivalentResizeCount + 1,
      "equivalent presentation resize was not a no-op"
    );
    requireProof(
      player.getTrace().length === beforeResizeTrace.length &&
        requireTraceContentOrdinal(player.getTrace()) === beforeResizeOrdinal &&
        presentationLabel(latestDraw(candidates).presentation) === beforeResizePresentation,
      "resize sequence changed graph time before the next content tick"
    );

    routePhase = "idle-loop";
    await advanceUntil(
      (_draw) => hasAdjacentLabels(quality, "idle-body:7", "idle-body:0"),
      "idle loop seam"
    );
    routePhase = "idle-hover-forward";
    const forwardRequest = player.requestState("hover");
    await advanceUntil(
      (draw) => presentationLabel(draw.presentation) === "hover-body:0",
      "forward reversible endpoint"
    );
    await forwardRequest;
    routePhase = "hover-loop";
    await advanceUntil(
      (_draw) => hasAdjacentLabels(quality, "hover-body:7", "hover-body:0"),
      "hover loop seam"
    );
    routePhase = "hover-idle-reverse";
    const reverseRequest = player.requestState("idle");
    await advanceUntil(
      (draw) => presentationLabel(draw.presentation) === "idle-body:0",
      "reverse reversible endpoint"
    );
    await reverseRequest;
    routePhase = "idle-loading";
    const loadingRequest = player.requestState("loading");
    await advanceUntil(
      (draw) => presentationLabel(draw.presentation) === "loading-body:0",
      "loading body zero"
    );
    await loadingRequest;
    routePhase = "loading-completion";
    await advanceUntil(
      (draw) => presentationLabel(draw.presentation) === "done-body:0",
      "finite completion into done"
    );

    const routeCoverage = summarizeRouteCoverage(quality, expectedFrames);

    const initialState = manifest.states.find(({ id }) => id === manifest.initialState)!;
    const staticPng = player.catalog.copyStaticPng(initialState.staticFrame);
    const pureDecoder = new BrowserStaticSurfaceDecoder({ nativeInflater: null });
    const pureSurface = await pureDecoder.decode(staticPng, {
      signal: new AbortController().signal,
      expectedWidth: manifest.canvas.width,
      expectedHeight: manifest.canvas.height
    });
    requireProof(pureSurface.inflatePath === "pure", "forced pure PNG path was not used");
    pureSurface.close();
    const pureStatic = pureDecoder.snapshot();

    mounted.setPhase("precommit-reduction");
    const precommitIdentityBefore = identitySnapshot(candidates, workers);
    gatedDecoder.gate.arm("precommit-reduction");
    const cancelReduce = player.setMotionPolicy("reduce");
    await gatedDecoder.gate.waitUntilEntered("precommit-reduction");
    const cancelFull = player.setMotionPolicy("full");
    gatedDecoder.gate.release();
    await Promise.all([cancelReduce, cancelFull]);
    const precommitIdentityAfter = identitySnapshot(candidates, workers);
    requireProof(player.motionSnapshot().actualMode === "animated",
      "pre-cover reduction did not cancel");
    requireProof(
      sameIdentity(precommitIdentityBefore, precommitIdentityAfter),
      `pre-cover cancellation replaced the live candidate: ${safeStringify({
        before: precommitIdentityBefore,
        after: precommitIdentityAfter
      })}`
    );

    // The pixel route intentionally ends in done so the cancelled reduction
    // must decode a not-current static. Return through the authored portal
    // before exercising the direct idle -> hover static state change.
    const resetToIdle = player.requestState("idle");
    for (let count = 0; count < 24; count += 1) {
      await advanceOne(
        player,
        composition,
        manifest,
        nextOrdinal,
        "motion-reset-to-idle",
        diagnostics
      );
      nextOrdinal += 1n;
      if (presentationLabel(latestDraw(candidates).presentation) === "idle-body:0") break;
    }
    requireProof(presentationLabel(latestDraw(candidates).presentation) === "idle-body:0",
      "motion proof could not reset done to idle");
    await resetToIdle;

    mounted.setPhase("committed-reduction");
    await player.setMotionPolicy("reduce");
    requireProof(player.motionSnapshot().actualMode === "static",
      "reduction did not commit static");
    await player.requestState("hover");
    const reducedStaticState = player.snapshot().visualState;
    requireProof(reducedStaticState === "hover",
      "reduced request did not present newest static");
    const hoverStaticPixels = readCanvasRgba(mounted.staticCanvas);

    mounted.setPhase("full-reentry");
    await player.setMotionPolicy("full");
    requireProof(player.motionSnapshot().actualMode === "animated",
      `full re-entry remained static: ${safeStringify({
        player: player.snapshot(),
        motion: player.motionSnapshot(),
        diagnostics,
        browser: composition.controls.snapshot()
      })}`);
    const reentryPresentation = presentationLabel(latestDraw(candidates).presentation);
    requireProof(reentryPresentation === "hover-body:0",
      `full re-entry did not draw hover body zero: ${reentryPresentation}`);
    const reentryStaticComparison = compareRenderedPlanes(
      composition.controls.readPixels(),
      hoverStaticPixels,
      "hover static/WebGL re-entry crop"
    );

    mounted.setPhase("state-change-during-reentry");
    await player.setMotionPolicy("reduce");
    const beforeStateReentryCandidates = candidates.candidateIds.length;
    candidates.activationGate.arm("state-change-during-reentry");
    const stateReentry = player.setMotionPolicy("full");
    await candidates.activationGate.waitUntilEntered("state-change-during-reentry");
    const stateChange = player.requestState("idle");
    await stateChange;
    candidates.activationGate.release();
    await stateReentry;
    requireProof(
      player.motionSnapshot().actualMode === "animated" &&
        player.snapshot().visualState === "idle" &&
        presentationLabel(latestDraw(candidates).presentation) === "idle-body:0",
      `state-changing re-entry did not restage newest body zero: ${safeStringify({
        player: player.snapshot(),
        motion: player.motionSnapshot(),
        diagnostics,
        draw: presentationLabel(latestDraw(candidates).presentation)
      })}`
    );
    const staleReentryCandidateCount =
      candidates.candidateIds.length - beforeStateReentryCandidates;
    requireProof(staleReentryCandidateCount >= 2,
      "state-changing re-entry did not dispose and restage a stale candidate");

    mounted.setPhase("rapid-inflight-policy-flips");
    await player.setMotionPolicy("reduce");
    candidates.activationGate.arm("rapid-inflight-policy-flips");
    const firstFull = player.setMotionPolicy("full");
    await candidates.activationGate.waitUntilEntered("rapid-inflight-policy-flips");
    const rapid = [
      firstFull,
      player.setMotionPolicy("reduce"),
      player.setMotionPolicy("full"),
      player.setMotionPolicy("reduce")
    ];
    candidates.activationGate.release();
    await Promise.all(rapid);
    requireProof(player.motionSnapshot().actualMode === "static",
      "in-flight rapid policy flips were not latest-wins");
    await player.setMotionPolicy("full");
    requireProof(player.motionSnapshot().actualMode === "animated",
      "final full policy did not re-enter");

    const introDrawCount = candidates.drawRecords.filter((record) =>
      presentationLabel(record.presentation) === "intro:0"
    ).length;
    requireProof(introDrawCount === 1, "full re-entry replayed intro frame zero");
    const nativeStatic = productionDecoder.snapshot();
    requireProof(nativeStatic.nativeSuccesses + nativeStatic.pureSuccesses > 0,
      "production strict static decoder did not validate surfaces");
    const staticDecodePath = nativeStatic.nativeSuccesses > 0 ? "native" : "pure";
    presentationSnapshot = planes.snapshot();
    const selectedRendition = player.snapshot().selectedRendition;
    requireProof(selectedRendition !== null, "final re-entry has no selected rendition");
    const realtimeOrdinalContinuity = await runRealtime(assetBase64);
    const reduceBeforePrepare = await runReducedStartup(assetBase64);

    const connectedSnapshot = mounted.snapshot();
    requireProof(connectedSnapshot.connected && connectedSnapshot.overlaid,
      "M6 overlaid DOM planes detached before cleanup");
    mounted.setPhase("cleanup");
    await player.dispose();
    await composition.controls.settled();
    finalStore = requireStore(store).snapshot();
    finalCleanup = composition.controls.snapshot().cleanup;
    planes.dispose();
    requireProof(finalCleanup.complete, "M6 pixel/motion composition did not clean up");
    requireProof(finalStore.retainedSurfaces === 0, "M6 static store retained a bitmap");

    return deepFreeze({
      selectedRendition,
      quality,
      routeCoverage,
      aggregateAlpha: metrics(aggregateAlpha),
      aggregateComposites: mapMetrics(aggregateComposites),
      resize,
      equivalentResizeWasNoop: true as const,
      nativeStatic,
      pureStatic,
      staticDecodePath,
      motion: {
        precommitCancellationReductionEntered: true as const,
        precommitCancellationReusedCandidate: true as const,
        precommitIdentityBefore,
        precommitIdentityAfter,
        reducedStaticState,
        reentryPresentation,
        reentryStaticComparison,
        stateChangedDuringReentry: true as const,
        stateDuringReentryFinalState: "idle",
        staleReentryCandidateCount,
        rapidFlipsBeganInFlight: true as const,
        rapidFlipFinalMode: "static" as const,
        realtimeOrdinalContinuity,
        reduceBeforePrepare,
        introDrawCount: 1 as const,
        finalMode: "animated" as const
      },
      presentation: presentationSnapshot,
      staticStore: finalStore,
      cleanup: finalCleanup,
      visibility: mounted.visibility,
      mountedOverlay: {
        connectedDuringProof: true as const,
        overlaidDuringProof: true as const
      }
    });
  } finally {
    if (!player.snapshot().disposed) await player.dispose().catch(() => undefined);
    await composition.controls.settled().catch(() => undefined);
    planes.dispose();
    mounted.dispose();
  }
}

async function advanceOne(
  player: IntegratedPlayer,
  composition: Readonly<BrowserAvcCandidateComposition>,
  manifest: Readonly<CompiledManifestV01>,
  ordinal: bigint,
  phase: string,
  diagnostics: readonly string[]
): Promise<void> {
  // Drive at the authored 30 fps cadence so asynchronous endpoint runway
  // preparation has the same opportunity it receives in the real clock.
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 34));
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const result = player.tryContentTick({
      presentationOrdinal: ordinal,
      rationalDeadlineUs: timestampForFrame(Number(ordinal), manifest.frameRate)
    });
    if (result.status === "advanced") return;
    if (result.status === "stopped") {
      await player.settled();
      await composition.controls.settled();
      throw new Error(`M6 content clock stopped during ${phase}: ${safeStringify({
        ordinal,
        player: player.snapshot(),
        motion: player.motionSnapshot(),
        diagnostics,
        browser: composition.controls.snapshot()
      })}`);
    }
    await composition.controls.settled();
    await nextAnimationFrame();
  }
  throw new Error("M6 content tick remained underflowed");
}

function summarizeRouteCoverage(
  quality: readonly Readonly<FrameQualityEvidence>[],
  expectedFrames: readonly Readonly<DecodedSourceFrame>[]
): Readonly<RouteCoverageEvidence> {
  const uniqueSourceOrdinals = [...new Set(quality.map(({ sourceOrdinal }) => sourceOrdinal))]
    .sort((left, right) => left - right);
  const expectedReachable = Array.from({ length: 29 }, (_value, index) => index);
  requireProof(JSON.stringify(uniqueSourceOrdinals) === JSON.stringify(expectedReachable),
    `M6 pixel route did not grade every reachable source ordinal: ${safeStringify(uniqueSourceOrdinals)}`);
  const uniquePresentations = [...new Set(quality.map(({ presentation }) => presentation))]
    .sort();
  requireProof(
    EXPECTED_PRESENTATIONS.every((label) => uniquePresentations.includes(label)),
    `M6 pixel route missed authored presentations: ${safeStringify(uniquePresentations)}`
  );
  const forwardReversibleFrames = uniqueLocalFrames(quality, "idle-hover-forward", "hover-shift");
  const reverseReversibleFrames = uniqueLocalFrames(quality, "hover-idle-reverse", "hover-shift");
  requireProof(
    JSON.stringify(forwardReversibleFrames) === JSON.stringify([0, 1, 2, 3, 4, 5]) &&
      JSON.stringify(reverseReversibleFrames) === JSON.stringify([0, 1, 2, 3, 4, 5]),
    "M6 pixel route did not grade both directions of every reversible frame"
  );
  const seams = adjacentLabels(quality).filter((pair) => EXPECTED_SEAMS.includes(pair));
  requireProof(EXPECTED_SEAMS.every((pair) => seams.includes(pair)),
    `M6 pixel route missed a seam: ${safeStringify(seams)}`);
  const supplied = expectedFrames.map(({ sourceOrdinal }) => sourceOrdinal);
  const unusedSourceOrdinals = supplied.filter((ordinal) => !uniqueSourceOrdinals.includes(ordinal));
  requireProof(JSON.stringify(unusedSourceOrdinals) === JSON.stringify([29]),
    "M6 fixture source 29 must remain the sole unreferenced source PNG");
  return deepFreeze({
    uniqueSourceOrdinals,
    unusedSourceOrdinals,
    uniquePresentations,
    forwardReversibleFrames,
    reverseReversibleFrames,
    seams: [...new Set(seams)],
    gradedDraws: quality.length
  });
}

function uniqueLocalFrames(
  quality: readonly Readonly<FrameQualityEvidence>[],
  routePhase: string,
  unit: string
): number[] {
  return [...new Set(quality
    .filter((frame) => frame.routePhase === routePhase && frame.presentation.startsWith(`${unit}:`))
    .map(({ presentation }) => Number(presentation.slice(presentation.lastIndexOf(":") + 1))))]
    .sort((left, right) => left - right);
}

function adjacentLabels(quality: readonly Readonly<FrameQualityEvidence>[]): string[] {
  const pairs: string[] = [];
  for (let index = 1; index < quality.length; index += 1) {
    pairs.push(`${quality[index - 1]!.presentation}->${quality[index]!.presentation}`);
  }
  return pairs;
}

function hasAdjacentLabels(
  quality: readonly Readonly<FrameQualityEvidence>[],
  left: string,
  right: string
): boolean {
  return adjacentLabels(quality).includes(`${left}->${right}`);
}

function sameIdentity(
  left: ReturnType<typeof identitySnapshot>,
  right: ReturnType<typeof identitySnapshot>
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function latestDraw(
  tracker: Readonly<CandidateIdentityTracker>
): Readonly<DrawIdentityRecord> {
  const draw = tracker.drawRecords.at(-1);
  requireProof(draw !== undefined, "M6 candidate has no draw identity");
  return draw;
}

function requireStore(value: StaticSurfaceStore | null): StaticSurfaceStore {
  requireProof(value !== null, "M6 static store was not created");
  return value;
}

function requireTraceContentOrdinal(trace: ReturnType<IntegratedPlayer["getTrace"]>): bigint {
  for (const record of [...trace].reverse()) {
    const value = record.graph?.snapshot.contentOrdinal ?? null;
    if (value !== null) return typeof value === "bigint" ? value : BigInt(value);
  }
  throw new Error("M6 trace has no content ordinal");
}

function labels(unit: string, count: number): string[] {
  return Array.from({ length: count }, (_value, index) => `${unit}:${String(index)}`);
}

function decodeAsset(assetBase64: string): Uint8Array {
  const binary = atob(assetBase64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function assetManifest(bytes: Uint8Array): Readonly<CompiledManifestV01> {
  return validateCompleteAsset({ bytes }).frontIndex.manifest;
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
