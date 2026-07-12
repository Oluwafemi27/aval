import { validateCompleteAsset } from "@rendered-motion/format";
import {
  BrowserStaticSurfaceDecoder,
  IntegratedPlayer,
  StaticSurfaceStore,
  asStaticSurfaceCatalog,
  createBrowserAvcCandidateComposition,
  type BrowserAvcCandidateSnapshot
} from "@rendered-motion/player-web";

import {
  mountProofPlanes,
  type PlaneVisibilityEvent
} from "./dom";
import { instrumentCandidateFactory } from "./instrumentation";
import {
  createPlanes,
  nextAnimationFrame,
  requireStore
} from "./scenario-support";
import {
  decodeBase64,
  deepFreeze,
  requireProof
} from "./shared";

export interface ContextFailureEvidence {
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
  readonly eventSequence: readonly Readonly<PlaneVisibilityEvent>[];
  readonly candidateLifecycle: readonly Readonly<{
    readonly sequence: number;
    readonly phase: string;
    readonly kind: "candidate-dispose-start" | "candidate-dispose-end";
    readonly candidateId: string;
    readonly cleanup: Readonly<BrowserAvcCandidateSnapshot["cleanup"]>;
  }>[];
  readonly cleanup: Readonly<BrowserAvcCandidateSnapshot["cleanup"]> | null;
}

export async function runContextFailureProof(
  assetBase64: string
): Promise<Readonly<ContextFailureEvidence>> {
  const bytes = decodeBase64(assetBase64);
  const manifest = validateCompleteAsset({ bytes }).frontIndex.manifest;
  let causalSequence = 0;
  const nextCausalSequence = (): number => ++causalSequence;
  let causalPhase = "setup";
  const mounted = mountProofPlanes(manifest.canvas, "context-failure", {
    nextSequence: nextCausalSequence
  });
  const setPhase = (phase: string): void => {
    causalPhase = phase;
    mounted.setPhase(phase);
  };
  const planes = createPlanes(mounted, manifest.canvas);
  const workerIds: string[] = [];
  const composition = createBrowserAvcCandidateComposition({
    canvas: mounted.animatedCanvas,
    presentationPlanes: planes,
    renderer: { preserveDrawingBuffer: true },
    clock: { now: () => performance.now() },
    testDependencies: {
      createWorkerPort(url, options) {
        workerIds.push(`worker-${String(workerIds.length + 1)}`);
        return new Worker(url, options);
      }
    }
  });
  const candidateLifecycle: Array<{
    readonly sequence: number;
    readonly phase: string;
    readonly kind: "candidate-dispose-start" | "candidate-dispose-end";
    readonly candidateId: string;
    readonly cleanup: Readonly<BrowserAvcCandidateSnapshot["cleanup"]>;
  }> = [];
  const candidates = instrumentCandidateFactory(composition.factory, {
    onLifecycle(event) {
      candidateLifecycle.push(deepFreeze({
        sequence: nextCausalSequence(),
        phase: causalPhase,
        kind: event.kind,
        candidateId: event.candidateId,
        cleanup: composition.controls.snapshot().cleanup
      }));
    }
  });
  let store: StaticSurfaceStore | null = null;
  const player = new IntegratedPlayer({
    bytes,
    candidateFactory: candidates.factory,
    createStaticStore(catalog) {
      const created = new StaticSurfaceStore(
        asStaticSurfaceCatalog(catalog),
        new BrowserStaticSurfaceDecoder(),
        planes.staticPlane
      );
      store = created;
      return created;
    },
    motionPolicy: "full",
    now: () => performance.now()
  });
  try {
    setPhase("initial-prepare");
    const prepared = await player.prepare({ timeoutMs: 30_000 });
    requireProof(prepared.mode === "animated", "context-loss proof did not animate");
    requireProof(prepared.mode === "animated", "context-loss proof did not animate");
    await composition.controls.settled();
    const workersBeforeFailure = [...workerIds];
    const gl = mounted.animatedCanvas.getContext("webgl2");
    const extension = gl?.getExtension("WEBGL_lose_context") ?? null;
    if (gl === null || extension === null) {
      setPhase("cleanup");
      await player.dispose();
      await composition.controls.settled();
      return deepFreeze({
        supported: false,
        reason: "WEBGL_lose_context is unavailable",
        readiness: null,
        staticOrigin: null,
        stickyFailure: false,
        staticCoveredBeforeCleanup: false,
        staticCoveredBeforeCandidateCleanup: false,
        coverEventSequence: null,
        candidateCleanupStartSequence: null,
        candidateCleanupEndSequence: null,
        cleanupEventSequence: null,
        coverHadVisiblePixels: false,
        retryCreatedWorker: false,
        eventSequence: mounted.visibility,
        candidateLifecycle,
        cleanup: composition.controls.snapshot().cleanup
      });
    }

    setPhase("context-failure");
    extension.loseContext();
    await nextAnimationFrame();
    const result = player.tryContentTick({
      presentationOrdinal: 1n,
      rationalDeadlineUs: 33_333
    });
    requireProof(result.status === "stopped", "context loss did not stop animation");
    await player.settled();
    await composition.controls.settled();
    const snapshot = player.snapshot();
    const motion = player.motionSnapshot();
    const cover = mounted.visibility.find((event) =>
      event.visible && event.phase === "context-failure"
    );
    const candidateCleanupStart = candidateLifecycle.find((event) =>
      event.kind === "candidate-dispose-start" &&
        event.phase === "context-failure"
    );
    const candidateCleanupEnd = candidateLifecycle.find((event) =>
      event.kind === "candidate-dispose-end" &&
        event.phase === "context-failure"
    );
    requireProof(cover !== undefined,
      "context failure did not causally cover the connected static plane");
    requireProof(cover.connected && cover.overlaid && cover.staticNonTransparentPixels > 0,
      "context failure covered a blank or detached static plane");
    requireProof(
      candidateCleanupStart !== undefined && candidateCleanupEnd !== undefined,
      "context failure did not expose candidate cleanup lifecycle evidence"
    );
    requireProof(
      cover.sequence < candidateCleanupStart.sequence &&
        candidateCleanupStart.sequence < candidateCleanupEnd.sequence,
      "context failure began animated candidate cleanup before strict-static cover"
    );
    requireProof(
      !candidateCleanupStart.cleanup.complete &&
        candidateCleanupStart.cleanup.workersAlive +
          candidateCleanupStart.cleanup.renderersAlive > 0 &&
        candidateCleanupEnd.cleanup.complete,
      "candidate cleanup lifecycle did not bracket live animated resources"
    );
    await player.setMotionPolicy("reduce");
    await player.setMotionPolicy("full");
    const retryCreatedWorker = workerIds.length > workersBeforeFailure.length;
    requireProof(snapshot.readiness === "staticReady", "context loss did not recover static");
    requireProof(
      motion.staticOrigin === "animation-failure" && motion.stickyFailure,
      "context loss did not become a sticky animation failure"
    );
    requireProof(!retryCreatedWorker, "sticky context failure retried animation");

    setPhase("cleanup");
    await player.dispose();
    await composition.controls.settled();
    const cleanupEvent = mounted.visibility.findLast((event) =>
      !event.visible && event.phase === "cleanup"
    );
    requireProof(cleanupEvent !== undefined && cover.sequence < cleanupEvent.sequence,
      "static cover was not observed before cleanup hid the overlay");
    const cleanup = composition.controls.snapshot().cleanup;
    requireProof(cleanup.complete, "context-loss composition did not clean up");
    requireProof(requireStore(store).snapshot().retainedSurfaces === 0,
      "context-loss static store retained a surface");
    return deepFreeze({
      supported: true,
      reason: null,
      readiness: "staticReady" as const,
      staticOrigin: "animation-failure" as const,
      stickyFailure: true,
      staticCoveredBeforeCleanup: true,
      staticCoveredBeforeCandidateCleanup: true,
      coverEventSequence: cover.sequence,
      candidateCleanupStartSequence: candidateCleanupStart.sequence,
      candidateCleanupEndSequence: candidateCleanupEnd.sequence,
      cleanupEventSequence: cleanupEvent.sequence,
      coverHadVisiblePixels: true,
      retryCreatedWorker,
      eventSequence: mounted.visibility,
      candidateLifecycle,
      cleanup
    });
  } finally {
    if (!player.snapshot().disposed) await player.dispose().catch(() => undefined);
    await composition.controls.settled().catch(() => undefined);
    planes.dispose();
    mounted.dispose();
  }
}
