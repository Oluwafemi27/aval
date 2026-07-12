import {
  validateCompleteAsset,
  type CompiledManifestV01
} from "@rendered-motion/format";
import {
  BrowserFrameBackend,
  BrowserStaticSurfaceDecoder,
  IntegratedPlayer,
  StaticSurfaceStore,
  asStaticSurfaceCatalog,
  createBrowserAvcCandidateComposition,
  timestampForFrame,
  type BrowserAvcCandidateSnapshot,
  type BrowserPresentationPlanesOptions,
  type DecoderWorkerCommand,
  type DecoderWorkerEvent,
  type OwnedDecoderWorkerPort,
  type PresentableFrameBackend,
  type StaticSurfaceStoreSnapshot
} from "@rendered-motion/player-web";

import { mountProofPlanes } from "./dom";
import { instrumentCandidateFactory } from "./instrumentation";
import {
  decodeBase64,
  deepFreeze,
  presentationLabel,
  requireProof
} from "./shared";
import {
  createPlanes,
  nextAnimationFrame,
  requireStore
} from "./scenario-support";
import type {
  RealtimeOrdinalEvidence,
  ReduceBeforePrepareEvidence
} from "./pixel-motion";

export {
  runContextFailureProof,
  type ContextFailureEvidence
} from "./context-failure-scenario";

export interface ForcedFallbackEvidence {
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
  readonly candidateLifecycle: readonly Readonly<{
    readonly sequence: number;
    readonly phase: string;
    readonly kind: "candidate-dispose-start" | "candidate-dispose-end";
    readonly candidateId: string;
    readonly cleanup: Readonly<BrowserAvcCandidateSnapshot["cleanup"]>;
  }>[];
  readonly cleanup: Readonly<BrowserAvcCandidateSnapshot["cleanup"]>;
  readonly staticStore: Readonly<StaticSurfaceStoreSnapshot>;
}

export async function runForcedFallbackProofs(
  assetBase64: string
): Promise<readonly Readonly<ForcedFallbackEvidence>[]> {
  const reports: ForcedFallbackEvidence[] = [];
  for (const seam of [
    "worker-unavailable",
    "codec-decode",
    "renderer-draw",
    "renderer-upload"
  ] as const) {
    reports.push(await runForcedFallbackProof(assetBase64, seam));
  }
  return deepFreeze(reports);
}


export async function runRealtimeOrdinalProof(
  assetBase64: string
): Promise<Readonly<RealtimeOrdinalEvidence>> {
  const bytes = decodeBase64(assetBase64);
  const manifest = validateCompleteAsset({ bytes }).frontIndex.manifest;
  const mounted = mountProofPlanes(manifest.canvas, "realtime-ordinal");
  const planes = createPlanes(mounted, manifest.canvas);
  const frames = new ManualAnimationFrames();
  const composition = createBrowserAvcCandidateComposition({
    canvas: mounted.animatedCanvas,
    presentationPlanes: planes,
    renderer: { preserveDrawingBuffer: true },
    clock: { now: () => frames.now }
  });
  const diagnostics: string[] = [];
  let store: StaticSurfaceStore | null = null;
  const player = new IntegratedPlayer({
    bytes,
    candidateFactory: composition.factory,
    createStaticStore(catalog) {
      const created = new StaticSurfaceStore(
        asStaticSurfaceCatalog(catalog),
        new BrowserStaticSurfaceDecoder(),
        planes.staticPlane
      );
      store = created;
      return created;
    },
    realtime: {
      requestFrame: frames.request,
      cancelFrame: frames.cancel,
      now: () => frames.now
    },
    now: () => frames.now,
    diagnosticsSink: (failure) => diagnostics.push(`${failure.code}:${failure.message}`)
  });
  try {
    const prepared = await player.prepare({ timeoutMs: 30_000 });
    requireProof(prepared.mode === "animated", "realtime ordinal proof did not animate");
    player.startRealtime();
    await advanceManualRealtime(player, composition, frames, diagnostics, 2);
    const before = requireRealtime(player);
    await player.setMotionPolicy("reduce");
    const reduced = requireRealtime(player);
    requireProof(!reduced.running && reduced.nextPresentationOrdinal === before.nextPresentationOrdinal,
      "reduction changed the rational presentation ordinal");
    await player.setMotionPolicy("full");
    const reentered = requireRealtime(player);
    requireProof(reentered.running && reentered.nextPresentationOrdinal === before.nextPresentationOrdinal,
      "re-entry restarted or skipped the rational presentation ordinal");
    await advanceManualRealtime(
      player,
      composition,
      frames,
      diagnostics,
      reentered.advancedTicks + 1
    );
    const after = requireRealtime(player);
    requireProof(after.nextPresentationOrdinal === before.nextPresentationOrdinal + 1n,
      "first post-policy realtime frame was not the next rational ordinal");
    requireProof(after.underflows === 0 && after.smoothSession,
      "policy transition introduced realtime underflow");
    await player.dispose();
    await composition.controls.settled();
    requireProof(composition.controls.snapshot().cleanup.complete,
      "realtime ordinal proof did not clean up");
    requireProof(requireStore(store).snapshot().retainedSurfaces === 0,
      "realtime ordinal proof retained a static surface");
    return deepFreeze({
      beforeReduction: before.nextPresentationOrdinal.toString(),
      whileReduced: reduced.nextPresentationOrdinal.toString(),
      afterReentry: reentered.nextPresentationOrdinal.toString(),
      afterNextFrame: after.nextPresentationOrdinal.toString(),
      underflows: 0 as const,
      smoothSession: true as const
    });
  } finally {
    if (!player.snapshot().disposed) await player.dispose().catch(() => undefined);
    await composition.controls.settled().catch(() => undefined);
    planes.dispose();
    mounted.dispose();
  }
}

export async function runReduceBeforePrepareProof(
  assetBase64: string
): Promise<Readonly<ReduceBeforePrepareEvidence>> {
  const bytes = decodeBase64(assetBase64);
  const manifest = validateCompleteAsset({ bytes }).frontIndex.manifest;
  const mounted = mountProofPlanes(manifest.canvas, "reduce-before-prepare");
  const planes = createPlanes(mounted, manifest.canvas);
  const composition = createBrowserAvcCandidateComposition({
    canvas: mounted.animatedCanvas,
    presentationPlanes: planes,
    renderer: { preserveDrawingBuffer: true },
    clock: { now: () => performance.now() }
  });
  const candidates = instrumentCandidateFactory(composition.factory);
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
    motionPolicy: "reduce",
    now: () => performance.now()
  });
  try {
    mounted.setPhase("reduced-initial-prepare");
    const prepared = await player.prepare({ timeoutMs: 30_000 });
    requireProof(prepared.mode === "static" && prepared.reason === "reduced-motion",
      "reduce-before-prepare did not install strict static readiness");
    requireProof(mounted.snapshot().staticVisible,
      "reduce-before-prepare did not visibly cover with the static plane");
    mounted.setPhase("reduced-initial-reentry");
    await player.setMotionPolicy("full");
    requireProof(player.motionSnapshot().actualMode === "animated",
      "reduce-before-prepare could not enter full motion");
    const draw = candidates.drawRecords.at(-1);
    requireProof(draw !== undefined, "reduce-before-prepare re-entry did not draw");
    const presentation = presentationLabel(draw.presentation);
    requireProof(presentation === "idle-body:0",
      `reduce-before-prepare replayed an intro or wrong body: ${presentation}`);
    await player.dispose();
    await composition.controls.settled();
    const cleanup = composition.controls.snapshot().cleanup;
    requireProof(cleanup.complete, "reduce-before-prepare proof did not clean up");
    requireProof(requireStore(store).snapshot().retainedSurfaces === 0,
      "reduce-before-prepare proof retained a static surface");
    return deepFreeze({
      preparedMode: "static" as const,
      staticOrigin: "reduced-motion" as const,
      reenteredMode: "animated" as const,
      presentation,
      cleanupComplete: true as const
    });
  } finally {
    if (!player.snapshot().disposed) await player.dispose().catch(() => undefined);
    await composition.controls.settled().catch(() => undefined);
    planes.dispose();
    mounted.dispose();
  }
}

async function runForcedFallbackProof(
  assetBase64: string,
  seam: ForcedFallbackEvidence["seam"]
): Promise<Readonly<ForcedFallbackEvidence>> {
  const bytes = decodeBase64(assetBase64);
  const manifest = validateCompleteAsset({ bytes }).frontIndex.manifest;
  let causalSequence = 0;
  const nextCausalSequence = (): number => ++causalSequence;
  let causalPhase = "setup";
  const mounted = mountProofPlanes(manifest.canvas, `forced-${seam}`, {
    nextSequence: nextCausalSequence
  });
  const setPhase = (phase: string): void => {
    causalPhase = phase;
    mounted.setPhase(phase);
  };
  const codecFailure = new LiveCodecFailureController();
  const rendererFailure = new LiveRendererFailureController();
  const createBackend = seam === "renderer-draw" || seam === "renderer-upload"
    ? rendererFailure.createBackend
    : undefined;
  const planes = createPlanes(mounted, manifest.canvas, createBackend);
  const composition = createBrowserAvcCandidateComposition({
    canvas: mounted.animatedCanvas,
    presentationPlanes: planes,
    renderer: { preserveDrawingBuffer: true },
    clock: { now: () => performance.now() },
    ...(seam === "codec-decode"
      ? {
          testDependencies: {
            createWorkerPort: codecFailure.createWorkerPort
          }
        }
      : {})
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
  const decoder = new BrowserStaticSurfaceDecoder();
  const diagnostics: string[] = [];
  let store: StaticSurfaceStore | null = null;
  const player = new IntegratedPlayer({
    bytes,
    candidateFactory: candidates.factory,
    createStaticStore(catalog) {
      const created = new StaticSurfaceStore(
        asStaticSurfaceCatalog(catalog),
        decoder,
        planes.staticPlane
      );
      store = created;
      return created;
    },
    motionPolicy: "full",
    now: () => performance.now(),
    diagnosticsSink: (failure) => diagnostics.push(`${failure.code}:${failure.message}`)
  });
  let nextOrdinal = 1n;
  try {
    setPhase("initial-prepare");
    const prepared = await player.prepare({ timeoutMs: 30_000 });
    requireProof(prepared.mode === "animated",
      `${seam} seam did not first reach animated readiness`);
    const initialCover = mounted.visibility.find((event) =>
      event.visible && event.phase === "initial-prepare"
    );
    requireProof(initialCover !== undefined,
      `${seam} proof did not identify its ordinary initial static cover`);

    for (let count = 0; count < 3; count += 1) {
      await driveAnimatedTick(player, composition, manifest, nextOrdinal, seam);
      nextOrdinal += 1n;
    }
    const stateRequest = player.requestState("hover");
    for (let count = 0; count < 40; count += 1) {
      if (
        player.snapshot().visualState === "hover" &&
        !player.snapshot().isTransitioning
      ) break;
      await driveAnimatedTick(player, composition, manifest, nextOrdinal, seam);
      nextOrdinal += 1n;
    }
    await stateRequest;
    requireProof(
      player.snapshot().visualState === "hover" &&
        player.snapshot().requestedState === "hover" &&
        !player.snapshot().isTransitioning,
      `${seam} proof did not commit the distinct newest hover state`
    );
    await composition.controls.settled();

    setPhase("live-failure");
    if (seam === "worker-unavailable") {
      composition.controls.induceWorkerFailure();
    } else if (seam === "codec-decode") {
      codecFailure.induceLiveCodecFailure();
    } else if (seam === "renderer-draw") {
      rendererFailure.armDrawFailure();
    } else {
      rendererFailure.armUploadFailure();
    }

    let stopped = false;
    for (let count = 0; count < 60 && !stopped; count += 1) {
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 34));
      const result = player.tryContentTick({
        presentationOrdinal: nextOrdinal,
        rationalDeadlineUs: timestampForFrame(Number(nextOrdinal), manifest.frameRate)
      });
      if (result.status === "advanced") nextOrdinal += 1n;
      else if (result.status === "stopped") stopped = true;
      // A deliberately terminal worker/codec boundary rejects the active
      // playback waiter before the player's recovery lane owns cleanup.
      await composition.controls.settled().catch(() => undefined);
    }
    requireProof(stopped, `${seam} did not fail the live animated candidate`);
    await player.settled();
    await composition.controls.settled();
    if (seam === "codec-decode") {
      requireProof(codecFailure.corruptedSubmissions === 1,
        "codec proof did not corrupt exactly one real worker submission");
      requireProof(codecFailure.webCodecsFailures > 0,
        "codec proof did not observe the real worker WebCodecs error boundary");
    }

    const snapshot = player.snapshot();
    const motion = player.motionSnapshot();
    requireProof(
      snapshot.readiness === "staticReady" &&
        snapshot.requestedState === "hover" &&
        snapshot.visualState === "hover" &&
        motion.staticOrigin === "animation-failure" &&
        motion.stickyFailure,
      `${seam} did not recover the newest hover state: ${JSON.stringify({
        snapshot,
        motion,
        diagnostics
      })}`
    );

    const decoderSnapshot = decoder.snapshot();
    const strictStaticPath = decoderSnapshot.nativeSuccesses > 0 ? "native" : "pure";
    requireProof(decoderSnapshot.nativeSuccesses + decoderSnapshot.pureSuccesses > 0,
      `${seam} fallback did not use the production strict static decoder`);
    const cover = mounted.visibility.find((event) =>
      event.visible && event.phase === "live-failure"
    );
    const candidateCleanupStart = candidateLifecycle.find((event) =>
      event.kind === "candidate-dispose-start" && event.phase === "live-failure"
    );
    const candidateCleanupEnd = candidateLifecycle.find((event) =>
      event.kind === "candidate-dispose-end" && event.phase === "live-failure"
    );
    requireProof(
      cover !== undefined && cover.connected && cover.overlaid &&
        cover.staticNonTransparentPixels > 0 && mounted.snapshot().staticVisible,
      `${seam} live fallback did not cover the newest strict-static surface`
    );
    requireProof(
      candidateCleanupStart !== undefined && candidateCleanupEnd !== undefined &&
        initialCover.sequence < cover.sequence &&
        cover.sequence < candidateCleanupStart.sequence &&
        candidateCleanupStart.sequence < candidateCleanupEnd.sequence,
      `${seam} did not cover the newest static before candidate cleanup`
    );
    requireProof(
      !candidateCleanupStart.cleanup.complete &&
        candidateCleanupStart.cleanup.workersAlive +
          candidateCleanupStart.cleanup.renderersAlive > 0 &&
        candidateCleanupEnd.cleanup.complete,
      `${seam} candidate lifecycle did not bracket animated resource cleanup`
    );

    setPhase("cleanup");
    await player.dispose();
    await composition.controls.settled();
    const cleanup = composition.controls.snapshot().cleanup;
    const staticStore = requireStore(store).snapshot();
    requireProof(cleanup.complete, `${seam} fallback composition did not clean up`);
    requireProof(staticStore.retainedSurfaces === 0,
      `${seam} fallback retained a static surface`);
    return deepFreeze({
      seam,
      failureBoundary: seam === "worker-unavailable"
        ? "worker-transport" as const
        : seam === "codec-decode"
          ? "real-worker-webcodecs-error" as const
          : seam,
      mode: "static" as const,
      readiness: "staticReady" as const,
      reason: "animation-failure",
      strictStaticPath,
      animatedBeforeFailure: true as const,
      newestRequestedState: "hover" as const,
      newestVisualState: "hover" as const,
      staticVisible: true as const,
      staticNonTransparentPixels: cover.staticNonTransparentPixels,
      initialCoverSequence: initialCover.sequence,
      failureCoverSequence: cover.sequence,
      candidateCleanupStartSequence: candidateCleanupStart.sequence,
      candidateCleanupEndSequence: candidateCleanupEnd.sequence,
      staticCoveredBeforeCandidateCleanup: true as const,
      candidateLifecycle,
      cleanup,
      staticStore
    });
  } finally {
    if (!player.snapshot().disposed) await player.dispose().catch(() => undefined);
    await composition.controls.settled().catch(() => undefined);
    planes.dispose();
    mounted.dispose();
  }
}


class LiveRendererFailureController {
  #liveBackends = 0;
  #failNextDraw = false;
  #failNextUpload = false;

  public readonly createBackend: NonNullable<
    BrowserPresentationPlanesOptions["createBackend"]
  > = (canvas, options): PresentableFrameBackend => {
    const inner = new BrowserFrameBackend(canvas, {
      ...options,
      preserveDrawingBuffer: true
    });
    this.#liveBackends += 1;
    let disposed = false;
    const backend: PresentableFrameBackend = {
      limits: inner.limits,
      setPresentationGeometry: (geometry) =>
        inner.setPresentationGeometry(geometry),
      allocate: (layout, streamingSlots) => inner.allocate(layout, streamingSlots),
      upload: (kind, index, pixels) => {
        if (this.#failNextUpload) {
          this.#failNextUpload = false;
          throw new Error("forced live renderer texture upload failure");
        }
        inner.upload(kind, index, pixels);
      },
      draw: (kind, index) => {
        if (this.#failNextDraw) {
          this.#failNextDraw = false;
          throw new Error("forced live renderer draw failure");
        }
        inner.draw(kind, index);
      },
      readPixels: () => inner.readPixels(),
      dispose: () => {
        if (disposed) return;
        disposed = true;
        this.#liveBackends -= 1;
        inner.dispose();
      }
    };
    return backend;
  };

  public armDrawFailure(): void {
    requireProof(this.#liveBackends > 0,
      "renderer draw failure was armed before animated readiness");
    requireProof(!this.#failNextDraw, "renderer draw failure is already armed");
    this.#failNextDraw = true;
  }

  public armUploadFailure(): void {
    requireProof(this.#liveBackends > 0,
      "renderer upload failure was armed before animated readiness");
    requireProof(!this.#failNextUpload, "renderer upload failure is already armed");
    this.#failNextUpload = true;
  }
}

class LiveCodecFailureController {
  readonly #workers: CorruptingCodecWorkerPort[] = [];

  public get corruptedSubmissions(): number {
    return this.#workers.reduce((sum, worker) =>
      sum + worker.corruptedSubmissions, 0);
  }

  public get webCodecsFailures(): number {
    return this.#workers.reduce((sum, worker) =>
      sum + worker.webCodecsFailures, 0);
  }

  public readonly createWorkerPort = (
    url: URL,
    options: WorkerOptions
  ): OwnedDecoderWorkerPort => {
    const worker = new CorruptingCodecWorkerPort(new Worker(url, options));
    this.#workers.push(worker);
    return worker;
  };

  public induceLiveCodecFailure(): void {
    const worker = this.#workers.at(-1) ?? null;
    requireProof(worker !== null,
      "codec failure was induced before animated readiness");
    worker.armCorruption();
  }
}

class CorruptingCodecWorkerPort implements OwnedDecoderWorkerPort {
  readonly #worker: Worker;
  #armed = false;
  #corruptedSubmissions = 0;
  #webCodecsFailures = 0;

  public constructor(worker: Worker) {
    this.#worker = worker;
    worker.addEventListener("message", (event: MessageEvent<unknown>) => {
      const data = event.data as Partial<DecoderWorkerEvent>;
      if (
        data.type === "error" &&
        data.code === "DECODER_OUTPUT_INVALID" &&
        data.message === "WebCodecs decoder failed" &&
        data.fatal === true
      ) {
        this.#webCodecsFailures += 1;
      }
    });
  }

  public get corruptedSubmissions(): number {
    return this.#corruptedSubmissions;
  }

  public get webCodecsFailures(): number {
    return this.#webCodecsFailures;
  }

  public armCorruption(): void {
    requireProof(!this.#armed, "codec corruption is already armed");
    this.#armed = true;
  }

  public postMessage(message: unknown, transfer?: Transferable[]): void {
    const command = message as DecoderWorkerCommand;
    if (this.#armed && command.type === "submit") {
      const index = command.samples.findIndex((sample) =>
        sample.type === "delta" && sample.data.byteLength > 16
      );
      const sample = command.samples[index];
      if (sample !== undefined) {
        const original = sample.data;
        const corrupted = original.slice(0, 16);
        structuredClone(null, { transfer: [original] });
        const samples = command.samples.map((entry, sampleIndex) =>
          sampleIndex === index
            ? Object.freeze({ ...entry, data: corrupted })
            : entry
        );
        const nextTransfer = (transfer ?? []).filter((entry) => entry !== original);
        nextTransfer.push(corrupted);
        this.#armed = false;
        this.#corruptedSubmissions += 1;
        this.#worker.postMessage(Object.freeze({ ...command, samples }), nextTransfer);
        return;
      }
    }
    this.#worker.postMessage(message, transfer ?? []);
  }

  public addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void
  ): void;
  public addEventListener(
    type: "messageerror",
    listener: (event: MessageEvent<unknown>) => void
  ): void;
  public addEventListener(
    type: "error",
    listener: (event: ErrorEvent) => void
  ): void;
  public addEventListener(
    type: "message" | "messageerror" | "error",
    listener:
      | ((event: MessageEvent<unknown>) => void)
      | ((event: ErrorEvent) => void)
  ): void {
    this.#worker.addEventListener(type, listener as EventListener);
  }

  public removeEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void
  ): void;
  public removeEventListener(
    type: "messageerror",
    listener: (event: MessageEvent<unknown>) => void
  ): void;
  public removeEventListener(
    type: "error",
    listener: (event: ErrorEvent) => void
  ): void;
  public removeEventListener(
    type: "message" | "messageerror" | "error",
    listener:
      | ((event: MessageEvent<unknown>) => void)
      | ((event: ErrorEvent) => void)
  ): void {
    this.#worker.removeEventListener(type, listener as EventListener);
  }

  public terminate(): void {
    this.#worker.terminate();
  }
}

async function driveAnimatedTick(
  player: IntegratedPlayer,
  composition: ReturnType<typeof createBrowserAvcCandidateComposition>,
  manifest: Readonly<CompiledManifestV01>,
  presentationOrdinal: bigint,
  label: string
): Promise<void> {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 34));
    const result = player.tryContentTick({
      presentationOrdinal,
      rationalDeadlineUs: timestampForFrame(presentationOrdinal, manifest.frameRate)
    });
    if (result.status === "advanced") return;
    requireProof(result.status !== "stopped",
      `${label} animation stopped before its live failure was induced`);
    await composition.controls.settled();
    await nextAnimationFrame();
  }
  throw new Error(
    `${label} animation could not advance ordinal ${presentationOrdinal.toString()}`
  );
}

async function advanceManualRealtime(
  player: IntegratedPlayer,
  composition: ReturnType<typeof createBrowserAvcCandidateComposition>,
  frames: ManualAnimationFrames,
  diagnostics: readonly string[],
  minimum: number
): Promise<void> {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const before = requireRealtime(player);
    if (before.advancedTicks >= minimum) return;
    await composition.controls.settled();
    const deadline = requireRealtime(player).nextDeadlineMs;
    requireProof(deadline !== null, "realtime proof has no rational deadline");
    requireProof(frames.pending === 1,
      `realtime proof lost its callback: ${JSON.stringify(
        {
          realtime: player.realtimeSnapshot(),
          player: player.snapshot(),
          diagnostics,
          browser: composition.controls.snapshot()
        },
        (_key, value: unknown) => typeof value === "bigint" ? value.toString() : value
      )}`);
    frames.run(deadline + 0.001);
    await composition.controls.settled();
  }
  throw new Error(
    `realtime proof did not advance ${String(minimum)} ticks: ${JSON.stringify(
      player.realtimeSnapshot(),
      (_key, value: unknown) => typeof value === "bigint" ? value.toString() : value
    )}`
  );
}

class ManualAnimationFrames {
  readonly #callbacks = new Map<number, FrameRequestCallback>();
  #nextHandle = 1;
  public now = performance.now();

  public get pending(): number {
    return this.#callbacks.size;
  }

  public readonly request = (callback: FrameRequestCallback): number => {
    const handle = this.#nextHandle++;
    this.#callbacks.set(handle, callback);
    return handle;
  };

  public readonly cancel = (handle: number): void => {
    this.#callbacks.delete(handle);
  };

  public run(timestamp: number): void {
    requireProof(this.#callbacks.size === 1,
      `realtime proof expected one callback, observed ${String(this.#callbacks.size)}`);
    const [entry] = this.#callbacks.entries();
    requireProof(entry !== undefined, "realtime proof callback is unavailable");
    this.#callbacks.delete(entry[0]);
    this.now = timestamp;
    entry[1](timestamp);
  }
}

function requireRealtime(player: IntegratedPlayer): NonNullable<ReturnType<IntegratedPlayer["realtimeSnapshot"]>> {
  const snapshot = player.realtimeSnapshot();
  requireProof(snapshot !== null, "M6 realtime snapshot is unavailable");
  return snapshot;
}
