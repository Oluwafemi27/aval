import { deriveAvcRenditionGeometry } from "@pixel-point/aval-format";
import { describe, expect, it, vi } from "vitest";

import type { IntegratedCandidateAttemptContext } from "./integrated-player-contracts.js";
import {
  BrowserAvcCandidateRendererFactory,
  BrowserAvcCandidateWorkerFactory
} from "./browser-avc-candidate-factories.js";
import { createBrowserAvcCandidateComposition } from "./browser-avc-candidate.js";
import { BrowserAvcCandidateHub } from "./browser-avc-candidate-hub.js";
import { BrowserAvcReadinessSession } from "./browser-avc-candidate-readiness.js";
import { BrowserAvcPlaybackSession } from "./browser-avc-playback-session.js";
import type {
  AvcCandidateActivationInput,
  AvcCandidateReadinessSessionInput
} from "./avc-candidate-factory.js";
import { BrowserProductionReadinessRehearsal } from "./browser-production-readiness-rehearsal.js";
import type {
  BrowserTrackedRenderer,
  BrowserTrackedWorker
} from "./browser-avc-candidate-hub.js";
import { calculateReadinessMetrics } from "./readiness-metrics.js";
import type {
  FrameRenderer,
  FrameRendererSnapshot,
  FrameRendererBackend,
  FrameTextureKind,
  FrameTextureLayout
} from "./frame-renderer.js";

describe("browser AVC candidate composition", () => {
  it("keeps the default candidate worker on the packaged bundler-visible path", () => {
    const created: RecordingWorker[] = [];
    class CapturingWorker extends RecordingWorker {
      public constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        created.push(this);
      }
    }
    vi.stubGlobal("Worker", CapturingWorker);
    try {
      const canvas = fakeCanvas();
      const hub = new BrowserAvcCandidateHub(canvas);
      const factory = new BrowserAvcCandidateWorkerFactory({ hub });

      factory.create(candidateContext());

      expect(created).toHaveLength(1);
      expect(created[0]?.url.pathname).toMatch(/decoder-worker\/entry\.js$/u);
      expect(created[0]?.options).toEqual({ type: "module" });
      expect(hub.snapshot().worker.alive).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("forwards only the planes' narrow context-event capability", () => {
    const canvas = fakeCanvas();
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const composition = createBrowserAvcCandidateComposition({
      canvas,
      presentationPlanes: {
        createFrameBackend: () => new FakeBackend(),
        ownsAnimatedCanvas: () => true,
        currentCanvasBacking: () => Object.freeze({ width: 1, height: 1 }),
        reserveCanvasResources: () => Object.freeze({ release() {} }),
        animatedContextTarget: () => ({
          addEventListener,
          removeEventListener
        })
      }
    });
    const listener = (): void => undefined;

    composition.factory.contextTarget?.addEventListener(
      "webglcontextlost",
      listener
    );
    composition.factory.contextTarget?.removeEventListener(
      "webglcontextlost",
      listener
    );

    expect(addEventListener).toHaveBeenCalledOnce();
    expect(removeEventListener).toHaveBeenCalledOnce();
  });

  it("routes renderer creation through shared presentation planes", () => {
    const canvas = fakeCanvas();
    const backend = new FakeBackend();
    const rendererOptions = Object.freeze({ checkErrors: true });
    const createFrameBackend = vi.fn(() => backend);
    const factory = new BrowserAvcCandidateRendererFactory({
      canvas,
      hub: new BrowserAvcCandidateHub(canvas),
      backend: rendererOptions,
      presentationPlanes: {
        createFrameBackend,
        ownsAnimatedCanvas: () => true,
        currentCanvasBacking: () => Object.freeze({ width: 1, height: 1 }),
        reserveCanvasResources: () => Object.freeze({ release() {} })
      }
    });

    const reservation = factory.create(candidateContext());

    expect(createFrameBackend).toHaveBeenCalledExactlyOnceWith(rendererOptions);
    reservation.dispose();
    expect(backend.disposals).toBe(1);
  });

  it("keeps absent tracked readback nonterminal", () => {
    const canvas = fakeCanvas();
    const backend = new FakeBackend();
    const factory = new BrowserAvcCandidateRendererFactory({
      canvas,
      hub: new BrowserAvcCandidateHub(canvas),
      createFrameBackend: () => backend
    });
    const reservation = factory.create(candidateContext());
    const renderer = reservation.allocate({
      geometry: deriveAvcRenditionGeometry({
        profile: "avc-annexb-opaque-v0",
        canvasWidth: 4,
        canvasHeight: 2,
        colorRect: [0, 0, 4, 2],
        codedWidth: 16,
        codedHeight: 16
      }),
      logicalWidth: 4,
      logicalHeight: 2,
      residentLayerCount: 0
    });

    expect(() => renderer.readPixels()).toThrow("pixel readback is unavailable");
    expect(renderer.snapshot().state).toBe("active");
    renderer.dispose();
    expect(backend.disposals).toBe(1);
  });

  it("allocates the unchanged opaque renderer layout for AVC-v1", () => {
    const canvas = fakeCanvas();
    const backend = new FakeBackend();
    const factory = new BrowserAvcCandidateRendererFactory({
      canvas,
      hub: new BrowserAvcCandidateHub(canvas),
      createFrameBackend: () => backend
    });
    const reservation = factory.create(candidateContext());
    const renderer = reservation.allocate({
      geometry: deriveAvcRenditionGeometry({
        profile: "avc-annexb-opaque-v1",
        canvasWidth: 4,
        canvasHeight: 2,
        colorRect: [0, 0, 4, 2],
        codedWidth: 16,
        codedHeight: 16
      }),
      logicalWidth: 4,
      logicalHeight: 2,
      residentLayerCount: 0
    });

    expect(renderer.snapshot().state).toBe("active");
    renderer.dispose();
  });

  it("retains an older retired renderer until its native source copy settles", () => {
    const hub = new BrowserAvcCandidateHub(fakeCanvas());
    let oldCopies = 1;
    hub.registerRenderer(trackedRenderer(() => oldCopies));
    hub.registerRenderer(trackedRenderer(() => 0));

    expect(hub.snapshot().cleanup).toMatchObject({
      sourceCopiesInFlight: 1,
      rendererStagingBytes: 0,
      complete: false
    });

    oldCopies = 0;
    expect(hub.snapshot().cleanup).toMatchObject({
      sourceCopiesInFlight: 0,
      rendererStagingBytes: 0,
      complete: true
    });
  });

  it("retains an older retired worker until every owned operation settles", () => {
    const hub = new BrowserAvcCandidateHub(fakeCanvas());
    let oldPending = 1;
    hub.registerWorker(trackedWorker(() => oldPending));
    hub.registerWorker(trackedWorker(() => 0));

    expect(hub.snapshot().cleanup).toMatchObject({
      pendingOperations: 1,
      complete: false
    });

    oldPending = 0;
    expect(hub.snapshot().cleanup).toMatchObject({
      pendingOperations: 0,
      complete: true
    });
  });

  it("primes one cold upload outside the 24-output warm-cache measurement", async () => {
    const controller = new AbortController();
    const activations: number[] = [];
    const submissionSizes: number[] = [];
    const uploadTimes: number[] = [];
    const queued: ProbeWorkerFrame[] = [];
    let activeGeneration = 0;
    let nextGeneration = 0;
    let nextOrdinal = 0;
    let probeNow = 0;
    const manifest = {
      frameRate: { numerator: 24, denominator: 1 },
      units: [{
        id: "idle-loop",
        kind: "body",
        playback: "loop",
        frameCount: 70
      }]
    } as const;
    const rehearsal = vi.spyOn(
      BrowserProductionReadinessRehearsal.prototype,
      "run"
    ).mockResolvedValue(Object.freeze({}) as never);
    const input = {
      context: { catalog: { manifest } },
      timeline: {
        activateNextGeneration() {
          nextGeneration += 1;
          return nextGeneration;
        }
      },
      worker: {
        async activateGeneration(generation: number) {
          activeGeneration = generation;
          activations.push(generation);
        },
        async snapshotMetrics() {
          return {
            pendingSamples: 0,
            submittedFrames: 0,
            leasedFrames: 0
          };
        },
        async submit(
          generation: number,
          samples: readonly Readonly<ProbeWorkerSample>[]
        ) {
          expect(generation).toBe(activeGeneration);
          submissionSizes.push(samples.length);
          queued.push(...samples.map((sample) => ({
            generation,
            ordinal: sample.ordinal,
            unitId: sample.unitId,
            unitInstance: sample.unitInstance,
            unitFrame: sample.unitFrame
          })));
        },
        async waitForFrames(count: number) {
          expect(queued).toHaveLength(count);
        },
        takeFrame() {
          return queued.shift();
        }
      },
      samples: {
        createBatch(batch: Readonly<{
          readonly frames: readonly Readonly<{
            readonly unitId: string;
            readonly unitFrame: number;
          }>[];
        }>) {
          const samples = batch.frames.map((frame) => ({
            ordinal: nextOrdinal++,
            unitId: frame.unitId,
            unitInstance: 0,
            unitFrame: frame.unitFrame,
            unitFrameCount: 70,
            type: "key" as const,
            timestamp: 0,
            duration: 1,
            data: new ArrayBuffer(1)
          }));
          return {
            generation: activeGeneration,
            samples,
            release() {}
          };
        }
      },
      renderer: {
        async uploadStreaming(
          _slot: number,
          generation: number,
          frame: Readonly<ProbeWorkerFrame>
        ) {
          expect(generation).toBe(frame.generation);
          probeNow += uploadTimes.length === 0 ? 62 : 6;
          uploadTimes.push(probeNow);
          return Object.freeze({ kind: "stream" });
        }
      },
      limits: {
        maxPendingSamples: 24,
        maxOutstandingFrames: 24
      },
      clock: { now: () => 0 },
      signal: controller.signal,
      deadlineMs: 10_000
    } as unknown as AvcCandidateReadinessSessionInput;
    const readiness = new BrowserAvcReadinessSession(
      input,
      new BrowserAvcCandidateHub(fakeCanvas()),
      () => probeNow
    );

    try {
      const warmup = await readiness.adapters.measureWarmup({
        manifest,
        graph: {}
      } as never);
      const metrics = calculateReadinessMetrics({
        frameRate: manifest.frameRate,
        measurements: warmup.measurements
      });

      expect(activations).toEqual([1, 2]);
      expect(submissionSizes).toEqual([1, 24]);
      expect(uploadTimes).toHaveLength(25);
      expect(uploadTimes[0]).toBe(62);
      expect(uploadTimes[0]).toBeGreaterThan(1_000 / 24);
      expect(warmup.measurements).toHaveLength(24);
      expect(warmup.measurements[0]).toMatchObject({
        outputOrdinal: 1,
        submitTimeMs: 62,
        uploadReadyTimeMs: 68,
        media: { path: "warmup:idle-loop", localFrame: 0 }
      });
      expect(warmup.measurements.every(({ media }) =>
        media.path === "warmup:idle-loop"
      )).toBe(true);
      expect(metrics).toMatchObject({
        passed: true,
        sampleCount: 24,
        failureReasons: [],
        ringPassed: true,
        ringCapacity: 6
      });
      expect(metrics.throughputMultiple).toBeGreaterThan(6);
      expect(rehearsal).toHaveBeenCalledOnce();
    } finally {
      readiness.dispose();
      rehearsal.mockRestore();
    }
  });

  it("quarantines a playback session that resolves after readiness disposal", async () => {
    const hub = new BrowserAvcCandidateHub(fakeCanvas());
    const late = deferred<BrowserAvcPlaybackSession>();
    const dispose = vi.fn(async () => undefined);
    const playback = {
      dispose,
      drawInitial() {}
    } as unknown as BrowserAvcPlaybackSession;
    const create = vi.spyOn(BrowserAvcPlaybackSession, "create")
      .mockReturnValue(late.promise);
    try {
      const readiness = new BrowserAvcReadinessSession(
        {} as AvcCandidateReadinessSessionInput,
        hub,
        () => 0
      );
      const controller = new AbortController();
      const activation = {
        signal: controller.signal
      } as AvcCandidateActivationInput;
      const preparing = readiness.prepareActivation(activation);

      expect(create).toHaveBeenCalledOnce();
      readiness.dispose();
      late.resolve(playback);

      await expect(preparing).rejects.toMatchObject({ name: "AbortError" });
      expect(dispose).toHaveBeenCalledOnce();
      expect(hub.snapshot().activeRendition).toBeNull();
    } finally {
      create.mockRestore();
    }
  });

  it("rolls back a partially constructed playback session and preserves its initial error", async () => {
    const failure = new Error("selected initial preparation failure");
    const schedulerDispose = vi.fn(async () => undefined);
    const controller = new AbortController();
    const scheduler = {
      snapshot: () => Object.freeze({ generation: null }),
      dispose: schedulerDispose
    };
    const candidate = {
      context: { candidate: { rendition: { id: "packed" } } },
      interactionCache: { reversibleClips: [] },
      timeline: { activateNextGeneration: () => 1 },
      worker: {
        activeGeneration: 1,
        snapshotMetrics: async () => ({
          pendingSamples: 0,
          submittedFrames: 0,
          leasedFrames: 0
        }),
        submit: async () => undefined,
        waitForFrames: async () => { throw failure; }
      },
      samples: {
        createBatch: () => ({ samples: [{}] })
      },
      renderer: {
        resourceGeneration: 1,
        residentHandle: () => ({ kind: "resident" }),
        draw() {},
        uploadStreaming: async () => null
      }
    } as unknown as AvcCandidateReadinessSessionInput;
    const activation = {
      graphSnapshot: {
        contentOrdinal: null,
        pendingEdgeId: null,
        activeEdgeId: null,
        followOnEdgeId: null
      },
      expectedPresentation: {
        kind: "intro",
        state: "idle",
        unitId: "intro",
        frameIndex: 0
      },
      scheduler,
      finalResourcePlan: { ringCapacity: 2 },
      signal: controller.signal,
      deadlineMs: 1_000
    } as unknown as AvcCandidateActivationInput;

    await expect(BrowserAvcPlaybackSession.create({
      candidate,
      activation,
      hub: new BrowserAvcCandidateHub(fakeCanvas())
    })).rejects.toBe(failure);
    expect(schedulerDispose).toHaveBeenCalledOnce();
  });
});

function trackedWorker(pending: () => number): BrowserTrackedWorker {
  return {
    settled: async () => undefined,
    induceFailure() {},
    snapshot() {
      return Object.freeze({
        metrics: null,
        openFrames: 0,
        pendingRequests: pending(),
        pendingWaiters: 0,
        alive: false
      });
    }
  };
}

interface ProbeWorkerSample {
  readonly ordinal: number;
  readonly unitId: string;
  readonly unitInstance: number;
  readonly unitFrame: number;
}

interface ProbeWorkerFrame extends ProbeWorkerSample {
  readonly generation: number;
}

function trackedRenderer(
  copies: () => number
): BrowserTrackedRenderer {
  return {
    renderer: null as unknown as FrameRenderer,
    snapshot() {
      return Object.freeze({
        snapshot: retiredRendererSnapshot(copies()),
        backendAlive: false,
        glResourceCount: 0
      });
    }
  };
}

function retiredRendererSnapshot(
  sourceCopiesInFlight: number
): Readonly<FrameRendererSnapshot> {
  return Object.freeze({
    state: "disposed",
    resourceGeneration: 2,
    stagingBytes: 0,
    sourceCopiesInFlight,
    codedTextureBytesPerLayer: 0,
    allocatedTextureBytes: 0,
    allocatedTextureLayers: 0,
    allocatedLayers: 0,
    uploadedResidentLayers: 0,
    uploadedStreamingSlots: 0,
    residentUploads: 0,
    streamingUploads: 0,
    draws: 0,
    closedSourceFrames: 0,
    staleUploads: 0,
    errors: 0
  });
}

class FakeBackend implements FrameRendererBackend {
  public readonly limits = Object.freeze({
    maxTextureSize: 2_048,
    maxArrayTextureLayers: 128
  });
  public disposals = 0;

  public allocate(_layout: FrameTextureLayout, _slots: number): void {}
  public setPresentationGeometry(): boolean {
    return true;
  }
  public upload(
    _kind: FrameTextureKind,
    _index: number,
    _pixels: Uint8Array
  ): void {}
  public draw(_kind: FrameTextureKind, _index: number): void {}
  public dispose(): void {
    this.disposals += 1;
  }
}

class RecordingWorker {
  public readonly url: URL;
  public readonly options: WorkerOptions | undefined;

  public constructor(url: string | URL, options?: WorkerOptions) {
    this.url = new URL(String(url));
    this.options = options;
  }

  public postMessage(_message: unknown, _transfer?: Transferable[]): void {}
  public addEventListener(_type: string, _listener: EventListener): void {}
  public removeEventListener(_type: string, _listener: EventListener): void {}
  public terminate(): void {}
}

function fakeCanvas(): HTMLCanvasElement {
  return {
    width: 1,
    height: 1,
    getContext: () => null
  } as unknown as HTMLCanvasElement;
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function candidateContext(): Readonly<IntegratedCandidateAttemptContext> {
  return {
    candidate: {
      visibleColorArea: 4_096,
      rendition: {
        id: "packed",
        bitrate: { peak: 2_000 }
      }
    }
  } as unknown as Readonly<IntegratedCandidateAttemptContext>;
}
