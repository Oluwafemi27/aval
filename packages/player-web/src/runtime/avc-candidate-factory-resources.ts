import { DecodeTimeline } from "./decode-timeline.js";
import {
  RuntimePlaybackError,
  normalizeRuntimeFailure
} from "./errors.js";
import type {
  IntegratedCandidateActivationOptions,
  IntegratedCandidateAttemptContext
} from "./integrated-player-contracts.js";
import { createInteractionCachePlan } from "./interaction-cache-plan.js";
import { createAvcCandidateWorkerSetup } from "./avc-candidate-factory-config.js";
import type {
  AvcCandidateCachePreparer,
  AvcCandidateFactoryOptions,
  AvcCandidatePreparedMedia,
  AvcCandidateReadinessSession,
  AvcCandidateRendererReservation,
  AvcCandidateWorker
} from "./avc-candidate-factory-model.js";
import {
  AvcCandidateOperationControl,
  raceAvcCandidateOperation
} from "./avc-candidate-factory-support.js";
import {
  avcCandidateFailureContext,
  avcPhaseFailure,
  captureAvcOwnerMethod,
  requireAvcOwner,
  runAvcResourcePhase,
  stoppedOrAvcPhaseFailure,
  validateAvcCandidateRenderer,
  validateAvcCandidateWorker,
  validateAvcPreparedMedia,
  validateAvcReadinessSession,
  validateAvcRendererReservation
} from "./avc-candidate-factory-validation.js";
import { FrameRenderer } from "./frame-renderer.js";
import { PathScheduler, type PathSchedulerClock } from "./path-scheduler.js";
import { runAllRoutesReadiness } from "./readiness-runner.js";
import {
  MAX_RESOURCE_RING_CAPACITY,
  createRuntimeResourcePlan,
  withRuntimeResourceRingCapacity,
  type RuntimeResourcePlan
} from "./resource-plan.js";
import type { RuntimeCanvasResourceLease } from "./static-resource-plan.js";
import { WorkerSampleFactory } from "./worker-samples.js";

/** Partial-resource owner used by exactly one candidate attempt. */
export class AvcCandidateResources {
  readonly #context: Readonly<IntegratedCandidateAttemptContext>;
  readonly #options: Readonly<AvcCandidateFactoryOptions>;
  readonly #clock: PathSchedulerClock;
  readonly #prepareCache: AvcCandidateCachePreparer;
  readonly #acquireWorker: () => void;
  readonly #releaseWorker: () => void;
  readonly #invokeOwnerDisposer: (operation: () => unknown) => unknown;

  #workerLease = false;
  #worker: AvcCandidateWorker | null = null;
  #workerDispose: (() => unknown) | null = null;
  #reservation: AvcCandidateRendererReservation | null = null;
  #reservationDispose: (() => unknown) | null = null;
  #renderer: FrameRenderer | null = null;
  #rendererDispose: (() => unknown) | null = null;
  #rendererSettled: (() => unknown) | null = null;
  #timeline: DecodeTimeline | null = null;
  #samples: WorkerSampleFactory | null = null;
  #readiness: AvcCandidateReadinessSession | null = null;
  #readinessDispose: (() => unknown) | null = null;
  #scheduler: PathScheduler | null = null;
  #finalResourcePlan: Readonly<RuntimeResourcePlan> | null = null;
  #preparedMedia: AvcCandidatePreparedMedia | null = null;
  #preparedMediaDispose: (() => unknown) | null = null;
  #resourceLease: RuntimeCanvasResourceLease | null = null;
  #disposePromise: Promise<void> | null = null;

  public constructor(options: {
    readonly context: Readonly<IntegratedCandidateAttemptContext>;
    readonly factoryOptions: Readonly<AvcCandidateFactoryOptions>;
    readonly clock: PathSchedulerClock;
    readonly prepareCache: AvcCandidateCachePreparer;
    readonly acquireWorker: () => void;
    readonly releaseWorker: () => void;
    readonly invokeOwnerDisposer: (operation: () => unknown) => unknown;
  }) {
    this.#context = options.context;
    this.#options = options.factoryOptions;
    this.#clock = options.clock;
    this.#prepareCache = options.prepareCache;
    this.#acquireWorker = options.acquireWorker;
    this.#releaseWorker = options.releaseWorker;
    this.#invokeOwnerDisposer = options.invokeOwnerDisposer;
  }

  public async prepare(control: AvcCandidateOperationControl): Promise<void> {
    const setup = runAvcResourcePhase(
      () => createAvcCandidateWorkerSetup(this.#context),
      this.#context
    );
    control.throwIfStopped();

    const reservation = this.#options.rendererFactory.create(this.#context);
    this.#reservation = reservation;
    this.#reservationDispose = captureAvcOwnerMethod(
      reservation,
      "dispose",
      "renderer reservation"
    );
    validateAvcRendererReservation(reservation);
    control.throwIfStopped();

    const interactionCache = runAvcResourcePhase(
      () => createInteractionCachePlan({
        manifest: this.#context.catalog.manifest,
        rendition: this.#context.candidate.rendition.id,
        deviceLimits: reservation.limits
      }),
      this.#context
    );
    const provisionalResourcePlan = runAvcResourcePhase(
      () => this.#createResourcePlan(
        interactionCache,
        MAX_RESOURCE_RING_CAPACITY
      ),
      this.#context
    );
    const resourceHost = this.#options.resourceHost;
    if (resourceHost !== undefined) {
      this.#resourceLease = runAvcResourcePhase(
        () => resourceHost.reserveCanvasResources(provisionalResourcePlan),
        this.#context
      );
    }
    control.throwIfStopped();

    this.#acquireWorker();
    this.#workerLease = true;
    const worker = this.#options.workerFactory.create(this.#context);
    this.#worker = worker;
    this.#workerDispose = captureAvcOwnerMethod(
      worker,
      "dispose",
      "worker"
    );
    validateAvcCandidateWorker(worker);
    await this.#runWorkerOperation(
      () => worker.configure(setup.configure),
      control
    );

    let renderer: FrameRenderer;
    try {
      renderer = reservation.allocate(Object.freeze({
        geometry: this.#context.candidate.geometry,
        logicalWidth: this.#context.catalog.manifest.canvas.width,
        logicalHeight: this.#context.catalog.manifest.canvas.height,
        residentLayerCount: interactionCache.layerCount
      }));
    } catch (error) {
      throw avcPhaseFailure("renderer-failure", error, this.#context);
    }
    this.#renderer = renderer;
    this.#rendererDispose = captureAvcOwnerMethod(
      renderer,
      "dispose",
      "renderer"
    );
    this.#rendererSettled = captureAvcOwnerMethod(
      renderer,
      "settled",
      "renderer"
    );
    validateAvcCandidateRenderer(renderer);

    const timeline = new DecodeTimeline(this.#context.catalog.manifest.frameRate);
    const samples = new WorkerSampleFactory({
      catalog: this.#context.catalog,
      timeline,
      rendition: this.#context.candidate.rendition.id,
      limits: setup.limits
    });
    this.#timeline = timeline;
    this.#samples = samples;
    const generation = timeline.activateNextGeneration();
    await this.#runWorkerOperation(
      () => worker.activateGeneration(generation),
      control
    );

    try {
      await raceAvcCandidateOperation(
        this.#prepareCache(
          {
            plan: interactionCache,
            catalog: this.#context.catalog,
            samples,
            worker,
            renderer,
            limits: setup.limits
          },
          {
            signal: control.signal,
            timeoutMs: control.remainingMs()
          }
        ),
        control.signal
      );
    } catch (error) {
      throw stoppedOrAvcPhaseFailure(
        control,
        "worker-decode-failure",
        error,
        this.#context
      );
    }
    control.throwIfStopped();

    let readiness: AvcCandidateReadinessSession;
    try {
      readiness = this.#options.readinessFactory.create(Object.freeze({
        context: this.#context,
        worker,
        renderer,
        interactionCache,
        provisionalResourcePlan,
        timeline,
        samples,
        limits: setup.limits,
        clock: this.#clock,
        signal: control.signal,
        deadlineMs: control.deadlineMs
      }));
    } catch (error) {
      throw avcPhaseFailure("readiness-failure", error, this.#context);
    }
    this.#readiness = readiness;
    this.#readinessDispose = captureAvcOwnerMethod(
      readiness,
      "dispose",
      "readiness session"
    );
    validateAvcReadinessSession(readiness);
    const result = await raceAvcCandidateOperation(
      runAllRoutesReadiness({
        manifest: this.#context.catalog.manifest,
        graph: this.#context.catalog.graph,
        adapters: readiness.adapters
      }),
      control.signal
    );
    readiness.observeResult?.(result);
    control.throwIfStopped();
    if (!result.passed || result.evaluation === null) {
      throw new RuntimePlaybackError(
        result.failure ?? normalizeRuntimeFailure(
          "readiness-failure",
          "all-routes readiness did not produce a passing evaluation",
          avcCandidateFailureContext(this.#context)
        )
      );
    }

    const ringCapacity = result.evaluation.ringCapacity;
    const finalResourcePlan = runAvcResourcePhase(
      () => withRuntimeResourceRingCapacity(
        provisionalResourcePlan,
        ringCapacity
      ),
      this.#context
    );
    const scheduler = new PathScheduler({
      timeline,
      samples,
      worker,
      rendition: this.#context.candidate.rendition.id,
      ringCapacity,
      limits: setup.limits,
      clock: this.#clock
    });
    this.#finalResourcePlan = finalResourcePlan;
    this.#scheduler = scheduler;
    control.throwIfStopped();
  }

  public async prepareActivation(
    options: Readonly<IntegratedCandidateActivationOptions>,
    control: AvcCandidateOperationControl
  ): Promise<AvcCandidatePreparedMedia> {
    const readiness = requireAvcOwner(this.#readiness, "readiness session");
    const scheduler = requireAvcOwner(this.#scheduler, "path scheduler");
    const finalResourcePlan = requireAvcOwner(
      this.#finalResourcePlan,
      "final resource plan"
    );
    let prepared: AvcCandidatePreparedMedia;
    try {
      prepared = await raceAvcCandidateOperation(
        readiness.prepareActivation(Object.freeze({
          graphSnapshot: options.graphSnapshot,
          expectedPresentation: options.expectedPresentation,
          scheduler,
          finalResourcePlan,
          signal: control.signal,
          deadlineMs: control.deadlineMs
        })),
        control.signal
      );
    } catch (error) {
      throw stoppedOrAvcPhaseFailure(
        control,
        "readiness-failure",
        error,
        this.#context
      );
    }
    this.#preparedMedia = prepared;
    this.#preparedMediaDispose = captureAvcOwnerMethod(
      prepared,
      "dispose",
      "prepared media"
    );
    validateAvcPreparedMedia(prepared);
    control.throwIfStopped();
    return prepared;
  }

  public drawInitial(): void {
    requireAvcOwner(
      this.#preparedMedia,
      "prepared initial media"
    ).drawInitial();
  }

  public dispose(): Promise<void> {
    if (this.#disposePromise === null) {
      // Assign before injected disposers can run and re-enter this owner.
      this.#disposePromise = Promise.resolve().then(
        async () => this.#disposeResources()
      );
    }
    return this.#disposePromise;
  }

  async #runWorkerOperation(
    operation: () => Promise<void>,
    control: AvcCandidateOperationControl
  ): Promise<void> {
    try {
      await raceAvcCandidateOperation(
        Promise.resolve().then(operation),
        control.signal
      );
      control.throwIfStopped();
    } catch (error) {
      throw stoppedOrAvcPhaseFailure(
        control,
        "worker-decode-failure",
        error,
        this.#context
      );
    }
  }

  #createResourcePlan(
    interactionCache: Parameters<typeof createRuntimeResourcePlan>[0]["interactionCache"],
    ringCapacity: number
  ): Readonly<RuntimeResourcePlan> {
    return createRuntimeResourcePlan({
      catalog: this.#context.catalog,
      rendition: this.#context.candidate.rendition.id,
      interactionCache,
      ringCapacity,
      ...(this.#options.resourceHost === undefined
        ? {}
        : { canvasBacking: this.#options.resourceHost.currentCanvasBacking() }),
      ...(this.#context.hostMaxRuntimeBytes === null
        ? {}
        : { hostMaxRuntimeBytes: this.#context.hostMaxRuntimeBytes })
    });
  }

  async #disposeResources(): Promise<void> {
    let firstError: unknown = null;
    const clean = async (operation: () => unknown): Promise<void> => {
      try {
        await this.#invokeOwnerDisposer(operation);
      } catch (error) {
        if (firstError === null) firstError = error;
      }
    };

    this.#preparedMedia = null;
    const preparedMediaDispose = this.#preparedMediaDispose;
    this.#preparedMediaDispose = null;
    if (preparedMediaDispose !== null) await clean(preparedMediaDispose);

    this.#readiness = null;
    const readinessDispose = this.#readinessDispose;
    this.#readinessDispose = null;
    if (readinessDispose !== null) await clean(readinessDispose);

    const scheduler = this.#scheduler;
    this.#scheduler = null;
    if (scheduler !== null) await clean(() => scheduler.dispose());

    this.#renderer = null;
    const rendererDispose = this.#rendererDispose;
    this.#rendererDispose = null;
    if (rendererDispose !== null) await clean(rendererDispose);
    const rendererSettled = this.#rendererSettled;
    this.#rendererSettled = null;
    if (rendererSettled !== null) await clean(rendererSettled);

    this.#reservation = null;
    const reservationDispose = this.#reservationDispose;
    this.#reservationDispose = null;
    if (reservationDispose !== null) await clean(reservationDispose);

    this.#worker = null;
    const workerDispose = this.#workerDispose;
    this.#workerDispose = null;
    if (workerDispose !== null) await clean(workerDispose);
    if (this.#workerLease) {
      this.#workerLease = false;
      await clean(this.#releaseWorker);
    }
    const resourceLease = this.#resourceLease;
    this.#resourceLease = null;
    if (resourceLease !== null) await clean(() => resourceLease.release());
    this.#timeline = null;
    this.#samples = null;
    this.#finalResourcePlan = null;

    if (firstError !== null) throw firstError;
  }
}

/** @deprecated Use AvcCandidateResources. */
export { AvcCandidateResources as OpaqueCandidateResources };
