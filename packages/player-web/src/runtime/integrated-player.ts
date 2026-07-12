import {
  MotionGraphEngine,
  type MotionGraphResult,
  type MotionGraphTickOptions
} from "@rendered-motion/graph";

import {
  RuntimeAssetCatalog
} from "./asset-catalog.js";
import {
  EffectHost
} from "./effect-host.js";
import {
  isRuntimePlaybackError,
  normalizeRuntimeFailure,
  type RuntimeFailure,
  type RuntimeFailureCode
} from "./errors.js";
import {
  IntegratedPlaybackInvariantError,
  PlaybackFallbackError,
  type IntegratedCandidateAttempt,
  type IntegratedContentTickContext,
  type IntegratedContentTickResult,
  type IntegratedPlaybackTraceState,
  type IntegratedPlayerTrace,
  type IntegratedPlayerOptions,
  type IntegratedRealtimeDriverOptions,
  type IntegratedPlayerSnapshot,
  type IntegratedPrepareOptions,
  type IntegratedStaticSurfaceStore,
  type IntegratedTimerHost
} from "./integrated-player-contracts.js";
import {
  DEFAULT_INTEGRATED_TIMERS,
  assertIntegratedPresentationIdentity as assertPresentationIdentity,
  defaultIntegratedNow,
  integratedAbortError as abortError,
  integratedDisposedError as disposedError,
  validateIntegratedContentTickContext as validateContentTickContext,
  validateIntegratedPlayerOptions as validateOptions,
  validateIntegratedPlaybackTraceState as validatePlaybackTraceState,
  validateIntegratedPreparedContentTick as validatePreparedContentTick,
  validateIntegratedStaticStore as validateStaticStore
} from "./integrated-player-support.js";
import {
  IntegratedAnimatedPreparation
} from "./integrated-animated-preparation.js";
import {
  IntegratedPlayerActivationCoordinator
} from "./integrated-player-activation-coordinator.js";
import { IntegratedTraceHarness } from "./integrated-trace-harness.js";
import { IntegratedRecoveryCoordinator } from "./integrated-player-recovery.js";
import { IntegratedOperationGate } from "./integrated-operation-gate.js";
import { IntegratedStaticPreparation } from "./integrated-player-static-preparation.js";
import { IntegratedPlayerMotion } from "./integrated-player-motion.js";
import {
  type RuntimeReadinessResult
} from "./model.js";
import type {
  MotionPolicy,
  MotionPolicySnapshot
} from "./motion-policy.js";
import {
  RealtimeDriver,
  type RealtimeDriverSnapshot
} from "./realtime-driver.js";
import { RequestPromises } from "./request-promises.js";
import {
  admitIntegratedPlayerResources
} from "./integrated-player-resource-admission.js";
import type { RuntimeCanvasResourceLease } from "./static-resource-plan.js";

export {
  IntegratedPlaybackInvariantError,
  PlaybackFallbackError,
  type IntegratedCandidateAttempt,
  type IntegratedCandidateActivationOptions,
  type IntegratedCandidateAvailability,
  type IntegratedCandidateAttemptContext,
  type IntegratedCandidateFactory,
  type IntegratedCandidatePrepareOptions,
  type IntegratedContentTickContext,
  type IntegratedContentTickResult,
  type IntegratedPlaybackSession,
  type IntegratedPlaybackTickContext,
  type IntegratedPlaybackTraceState,
  type IntegratedPlayerOptions,
  type IntegratedPlayerSnapshot,
  type IntegratedPlayerTrace,
  type IntegratedRealtimeDriverOptions,
  type IntegratedPreparedActivation,
  type IntegratedPreparedContentTick,
  type IntegratedPrepareOptions,
  type IntegratedPrepareResult,
  type IntegratedStaticSurfaceStore,
  type IntegratedTimerHost
} from "./integrated-player-contracts.js";

/**
 * Internal playback facade. Concrete preparation, worker, renderer, cache,
 * and readiness owners are composed behind narrow collaborators; this class
 * retains graph staging, host effects/promises, recovery, and lifecycle.
 */
export class IntegratedPlayer {
  readonly #catalog: RuntimeAssetCatalog;
  readonly #graph = new MotionGraphEngine();
  readonly #requests = new RequestPromises();
  readonly #effects: EffectHost;
  readonly #staticStore: IntegratedStaticSurfaceStore;
  readonly #diagnostics: (failure: Readonly<RuntimeFailure>) => void;
  readonly #now: () => number;
  readonly #timers: IntegratedTimerHost;
  readonly #installResult: Readonly<MotionGraphResult>;
  readonly #trace = new IntegratedTraceHarness();
  readonly #lifecycleController = new AbortController();
  readonly #recovery: IntegratedRecoveryCoordinator;
  readonly #staticPreparation: IntegratedStaticPreparation;
  readonly #activation: IntegratedPlayerActivationCoordinator;
  readonly #animatedPreparation: IntegratedAnimatedPreparation;
  readonly #motion: IntegratedPlayerMotion;
  readonly #realtime: RealtimeDriver | null;
  readonly #operationGate = new IntegratedOperationGate();
  readonly #staticResourceLease: RuntimeCanvasResourceLease | null;

  #selectedRendition: string | null = null;
  #activeCandidate: IntegratedCandidateAttempt | null = null;
  #preparePromise: Promise<RuntimeReadinessResult> | null = null;
  #initialPreparationGeneration = 0n;
  #readyResult: Readonly<RuntimeReadinessResult> | null = null;
  #disposePromise: Promise<void> | null = null;
  #terminalOwnerCallbackDepth = 0;
  #lastPresentationOrdinal = 0n;
  #disposed = false;

  public constructor(options: IntegratedPlayerOptions) {
    validateOptions(options);
    // Host option objects are capability boundaries. Snapshot every value the
    // constructor will need before acquiring catalog, canvas, or static-store
    // ownership so a hostile or time-varying getter cannot strand them.
    const bytes = options.bytes;
    const createStaticStore = options.createStaticStore;
    const candidateFactory = options.candidateFactory;
    const candidateAvailability = candidateFactory.availability;
    const availability = Object.freeze({
      workerAvailable: candidateAvailability.workerAvailable,
      rendererAvailable: candidateAvailability.rendererAvailable
    });
    const eventSink = options.eventSink;
    const diagnosticsSink = options.diagnosticsSink;
    const hostMaxRuntimeBytesOption = options.hostMaxRuntimeBytes;
    const motionPolicy = options.motionPolicy;
    const hostReducedMotion = options.hostReducedMotion;
    const now = options.now;
    const timers = options.timers;
    const realtimeSource = options.realtime;
    const realtime = realtimeSource === undefined
      ? undefined
      : snapshotIntegratedRealtimeOptions(realtimeSource);
    const admission = admitIntegratedPlayerResources({
      bytes,
      candidateFactory,
      ...(hostMaxRuntimeBytesOption === undefined
        ? {}
        : { hostMaxRuntimeBytes: hostMaxRuntimeBytesOption })
    });
    this.#catalog = admission.catalog;
    const hostMaxRuntimeBytes = admission.hostMaxRuntimeBytes;
    const staticResourceLease = admission.staticResourceLease;
    let staticStoreCandidate: unknown = null;
    try {
      this.#installResult = this.#graph.install(this.#catalog.graph);
      this.#effects = new EffectHost({
        requestPromises: this.#requests,
        initialGraphSnapshot: this.#installResult.snapshot,
        ...(eventSink === undefined
          ? {}
          : {
              eventSink: (event) => this.#operationGate.run(() => {
                eventSink(event);
              })
            })
      });
      staticStoreCandidate = createStaticStore.call(options, this.#catalog);
      this.#staticStore = staticStoreCandidate as IntegratedStaticSurfaceStore;
      validateStaticStore(this.#staticStore);
      this.#staticResourceLease = staticResourceLease;
      this.#diagnostics = diagnosticsSink ?? (() => undefined);
      this.#now = now ?? defaultIntegratedNow;
      this.#timers = timers ?? DEFAULT_INTEGRATED_TIMERS;
      this.#staticPreparation = new IntegratedStaticPreparation({
        catalog: this.#catalog,
        graph: this.#graph,
        effects: this.#effects,
        staticStore: this.#staticStore,
        installResult: this.#installResult,
        lifecycleSignal: this.#lifecycleController.signal,
        now: this.#now,
        timers: this.#timers,
        stageReadyResult: (result) => this.#stageStaticReadyResult(result)
      });
      this.#recovery = new IntegratedRecoveryCoordinator({
        catalog: this.#catalog,
        graph: this.#graph,
        effects: this.#effects,
        staticStore: this.#staticStore,
        trace: this.#trace,
        getActiveCandidate: () => this.#activeCandidate,
        detachActiveCandidate: (candidate) => {
          if (this.#activeCandidate === candidate) this.#activeCandidate = null;
        },
        getReadyResult: () => this.#readyResult,
        registerRequest: (requestId) => this.#requests.register(requestId),
        stageReadyResult: (result) => this.#stageStaticReadyResult(result),
        reportFailure: (failure) => this.#reportFailure(failure)
      });
      this.#activation = new IntegratedPlayerActivationCoordinator({
        graph: this.#graph,
        effects: this.#effects,
        staticStore: this.#staticStore,
        trace: this.#trace,
        operationGate: this.#operationGate,
        state: {
          isDisposed: () => this.#disposed,
          getActiveCandidate: () => this.#activeCandidate,
          setActiveCandidate: (candidate) => {
            this.#activeCandidate = candidate;
          },
          getReadyResult: () => this.#readyResult,
          setReadyResult: (result) => {
            this.#readyResult = result;
          },
          setSelectedRendition: (renditionId) => {
            this.#selectedRendition = renditionId;
          }
        },
        getMotion: () => this.#motion,
        getRealtime: () => this.#realtime,
        startRecovery: (failure) => this.#startRecovery(failure),
        settleRecovery: () => this.#recovery.settled(),
        reportFailure: (failure) => this.#reportFailure(failure)
      });
      this.#animatedPreparation = new IntegratedAnimatedPreparation({
        catalog: this.#catalog,
        graph: this.#graph,
        staticPreparation: this.#staticPreparation,
        candidateFactory,
        availability,
        hostMaxRuntimeBytes,
        isDisposed: () => this.#disposed,
        commitActivation: (commit) =>
          this.#activation.commitAnimatedActivation(commit),
        commitReentryActivation: (commit) =>
          this.#activation.commitAnimatedReentry(commit),
        rollbackActivation: (attempt) =>
          this.#activation.rollbackAnimatedActivation(attempt),
        recoverActivation: (failure) =>
          this.#activation.recoverAnimatedActivation(failure),
        reportFailure: (failure) => this.#reportFailure(failure)
      });
      this.#motion = new IntegratedPlayerMotion({
        policy: motionPolicy ?? "auto",
        hostReducedMotion: hostReducedMotion ?? false,
        staticPreparation: this.#staticPreparation,
        isDisposed: () => this.#disposed,
        invalidateInitialPreparation: () =>
          this.#invalidateInitialPreparation(),
        pauseForPolicy: () => this.#activation.pauseForMotionPolicy(),
        resumeAfterCancelledReduction: (wasRunning) =>
          this.#activation.resumeAfterCancelledReduction(wasRunning),
        resumeAfterReentry: (wasRunning) =>
          this.#activation.resumeRealtimeAfterReentry(wasRunning),
        coverReducedSurface: (state) =>
          this.#activation.coverReducedSurface(state),
        commitReducedState: (state) =>
          this.#activation.commitReducedState(state),
        failReduction: (error) => this.#activation.failReduction(error),
        prepareFull: (signal) => this.#animatedPreparation.reenter({ signal }),
        rejectReentry: (error, result) =>
          this.#activation.rejectAnimatedReentry(error, result),
        reportTransitionFailure: (error, transition) =>
          this.#reportFailure(normalizeRuntimeFailure(
            "readiness-failure",
            error,
            { operation: `motion-policy-${transition}` }
          ))
      });
      this.#realtime = realtime === undefined
        ? null
        : this.#createRealtimeDriver(realtime);
      this.#effects.publishMetadataReady();
    } catch (error) {
      disposeInvalidIntegratedStaticStore(staticStoreCandidate);
      try {
        staticResourceLease?.release();
      } catch {
        // Resource-host cleanup cannot replace the constructor failure.
      }
      this.#catalog.dispose();
      throw error;
    }
  }

  public get catalog(): RuntimeAssetCatalog {
    return this.#catalog;
  }

  public snapshot(): Readonly<IntegratedPlayerSnapshot> {
    const mirror = this.#effects.snapshot();
    return Object.freeze({
      readiness: mirror.readiness,
      requestedState: mirror.requestedState,
      visualState: mirror.visualState,
      isTransitioning: mirror.isTransitioning,
      selectedRendition: this.#selectedRendition,
      preparing: this.#preparePromise !== null && this.#readyResult === null,
      disposed: this.#disposed
    });
  }

  public getTrace(): IntegratedPlayerTrace {
    return this.#trace.getTrace();
  }

  public motionSnapshot(): Readonly<MotionPolicySnapshot> {
    return this.#motion.snapshot();
  }

  public setMotionPolicy(
    policy: MotionPolicy
  ): Promise<Readonly<MotionPolicySnapshot>> {
    if (this.#disposed) return Promise.reject(disposedError());
    if (this.#recovery.active) {
      return this.#recovery.settled().then(() => {
        if (this.#disposed) throw disposedError();
        return this.#operationGate.active
          ? this.#operationGate.enqueue(() =>
              this.#setMotionPolicyNow(policy)
            )
          : this.#setMotionPolicyNow(policy);
      });
    }
    if (this.#operationGate.active) {
      return this.#operationGate.enqueue(() => this.setMotionPolicy(policy));
    }
    return this.#setMotionPolicyNow(policy);
  }

  public setHostReducedMotion(
    reduced: boolean
  ): Promise<Readonly<MotionPolicySnapshot>> {
    if (this.#disposed) return Promise.reject(disposedError());
    if (this.#recovery.active) {
      return this.#recovery.settled().then(() => {
        if (this.#disposed) throw disposedError();
        return this.#operationGate.active
          ? this.#operationGate.enqueue(() =>
              this.#setHostReducedMotionNow(reduced)
            )
          : this.#setHostReducedMotionNow(reduced);
      });
    }
    if (this.#operationGate.active) {
      return this.#operationGate.enqueue(() =>
        this.setHostReducedMotion(reduced)
      );
    }
    return this.#setHostReducedMotionNow(reduced);
  }

  /** Starts the player-owned M5.5 presentation clock after animated readiness. */
  public startRealtime(): void {
    if (this.#disposed) throw disposedError();
    if (this.#operationGate.active) {
      throw new IntegratedPlaybackInvariantError(
        "realtime playback cannot start inside an effect transaction"
      );
    }
    if (this.#realtime === null) {
      throw new IntegratedPlaybackInvariantError(
        "no realtime presentation source is configured"
      );
    }
    if (this.#effects.readiness !== "interactiveReady") {
      throw new IntegratedPlaybackInvariantError(
        "realtime presentation requires interactive readiness"
      );
    }
    this.#realtime.start();
  }

  public realtimeSnapshot(): Readonly<RealtimeDriverSnapshot> | null {
    return this.#realtime?.snapshot() ?? null;
  }

  /** Synchronous adapter used by both the realtime driver and proof harness. */
  public tryContentTick(
    context: IntegratedContentTickContext
  ): Readonly<IntegratedContentTickResult> {
    if (this.#disposed) throw disposedError();
    if (this.#operationGate.active) {
      throw new IntegratedPlaybackInvariantError(
        "content ticks cannot reenter an effect transaction"
      );
    }
    if (this.#realtime !== null) {
      throw new IntegratedPlaybackInvariantError(
        "manual content ticks are unavailable with a player-owned realtime clock"
      );
    }
    return this.#operationGate.run(() =>
      this.#tryContentTickInternal(context)
    );
  }

  #tryContentTickInternal(
    context: IntegratedContentTickContext
  ): Readonly<IntegratedContentTickResult> {
    if (this.#disposed) throw disposedError();
    validateContentTickContext(context);
    if (this.#effects.readiness !== "interactiveReady") {
      throw new IntegratedPlaybackInvariantError(
        "content ticks require an interactive-ready candidate"
      );
    }
    if (this.#recovery.active) {
      return Object.freeze({ status: "stopped" });
    }
    if (context.presentationOrdinal !== this.#lastPresentationOrdinal + 1n) {
      throw new IntegratedPlaybackInvariantError(
        "content presentation ordinals must remain consecutive"
      );
    }
    const candidate = this.#activeCandidate;
    if (candidate === null) {
      throw new IntegratedPlaybackInvariantError(
        "interactive readiness has no active playback session"
      );
    }
    const playback = candidate.playback;
    let failureCode: RuntimeFailureCode = "worker-decode-failure";
    try {
      const prepared = playback.prepareContentTick(Object.freeze({
        presentationOrdinal: context.presentationOrdinal,
        rationalDeadlineUs: context.rationalDeadlineUs,
        graphSnapshot: this.#graph.snapshot(),
        previewTick: (options: Readonly<MotionGraphTickOptions>) =>
          this.#graph.previewTick(options)
      }));
      if (prepared === null) {
        const traceState = playback.traceState();
        validatePlaybackTraceState(traceState);
        this.#trace.recordUnderflow({
          context,
          playback: traceState,
          readiness: this.#effects.readiness
        });
        return Object.freeze({ status: "underflow" });
      }
      validatePreparedContentTick(prepared);

      failureCode = "readiness-failure";
      const result = this.#graph.tick({
        contentOrdinal: context.presentationOrdinal - 1n,
        routeReady: prepared.routeReady
      });
      const presentation = result.presentation;
      if (presentation === null) {
        throw new IntegratedPlaybackInvariantError(
          "animated graph tick produced no presentation"
        );
      }
      assertPresentationIdentity(
        presentation,
        prepared.media,
        context.presentationOrdinal
      );

      failureCode = "renderer-failure";
      let readbackTag: string | null = null;
      this.#effects.apply(result, (drawPresentation) => {
        assertPresentationIdentity(
          drawPresentation,
          prepared.media,
          context.presentationOrdinal
        );
        readbackTag = playback.drawContentTick(prepared, drawPresentation);
        if (readbackTag !== null && typeof readbackTag !== "string") {
          throw new IntegratedPlaybackInvariantError(
            "playback readback tag must be a string or null"
          );
        }
      });
      failureCode = "readiness-failure";
      playback.synchronizeGraph(result);
      this.#lastPresentationOrdinal = context.presentationOrdinal;
      this.#trace.recordContentTick({
        context,
        result,
        prepared,
        readbackTag,
        readiness: this.#effects.readiness
      });
      return Object.freeze({ status: "advanced" });
    } catch (error) {
      const failure = normalizeAnimatedFailure(error, failureCode, context);
      this.#startRecovery(failure);
      return Object.freeze({ status: "stopped" });
    }
  }

  public prepare(
    options: IntegratedPrepareOptions = {}
  ): Promise<RuntimeReadinessResult> {
    if (this.#disposed) {
      return Promise.reject(disposedError());
    }
    if (this.#recovery.promise !== null) {
      return this.#recovery.promise.then(() => {
        if (this.#readyResult === null) {
          throw new PlaybackFallbackError(
            "animation recovery completed without a ready result"
          );
        }
        return this.#readyResult;
      });
    }
    if (this.#readyResult !== null) {
      return Promise.resolve(this.#readyResult);
    }
    if (this.#preparePromise !== null) return this.#preparePromise;

    const operation = Promise.resolve().then(() =>
      this.#prepareLatestMotionMode(options)
    );
    this.#preparePromise = operation;
    void operation.finally(() => {
      if (this.#preparePromise === operation && this.#readyResult === null) {
        this.#preparePromise = null;
      }
    }).catch(() => undefined);
    return operation;
  }

  async #prepareLatestMotionMode(
    options: IntegratedPrepareOptions
  ): Promise<Readonly<RuntimeReadinessResult>> {
    for (;;) {
      if (this.#disposed) throw disposedError();
      const generation = this.#initialPreparationGeneration;
      try {
        return this.#motion.shouldPrepareReduced()
          ? await this.#motion.prepareReduced(options)
          : await this.#animatedPreparation.run(options);
      } catch (error) {
        if (
          this.#disposed ||
          options.signal?.aborted === true ||
          generation === this.#initialPreparationGeneration
        ) {
          throw error;
        }
        // A policy change aborted this generation. Candidate/static owners
        // settle their exact resources before the same public prepare promise
        // starts the newest effective mode.
      }
    }
  }

  #invalidateInitialPreparation(): void {
    if (this.#readyResult !== null || this.#preparePromise === null) return;
    this.#initialPreparationGeneration += 1n;
    this.#animatedPreparation.abort();
  }

  #setMotionPolicyNow(
    policy: MotionPolicy
  ): Promise<Readonly<MotionPolicySnapshot>> {
    const initialPreparation = this.#readyResult === null
      ? this.#preparePromise
      : null;
    return this.#motion.setPolicy(policy).then(async () => {
      if (initialPreparation !== null) await initialPreparation;
      return this.#motion.snapshot();
    });
  }

  #setHostReducedMotionNow(
    reduced: boolean
  ): Promise<Readonly<MotionPolicySnapshot>> {
    const initialPreparation = this.#readyResult === null
      ? this.#preparePromise
      : null;
    return this.#motion.setHostReducedMotion(reduced).then(async () => {
      if (initialPreparation !== null) await initialPreparation;
      return this.#motion.snapshot();
    });
  }

  public requestState(target: string): Promise<void> {
    if (this.#operationGate.active) {
      return this.#operationGate.enqueue(() => this.requestState(target));
    }
    return this.#operationGate.run(() => this.#requestStateNow(target));
  }

  #requestStateNow(target: string): Promise<void> {
    if (this.#disposed) return Promise.reject(disposedError());
    if (this.#effects.readiness === "staticReady") {
      return this.#recovery.requestStaticState(target);
    }
    const result = this.#graph.request(target);
    const request = result.requestId === undefined
      ? Promise.resolve()
      : this.#requests.register(result.requestId);

    const playback = this.#activeCandidate?.playback ?? null;
    if (this.#recovery.active) {
      this.#effects.applyRecoveryIntent(result);
      this.#recovery.supersedeRecoveryPresentation(
        result.snapshot.requestedState
      );
      return request;
    }
    try {
      playback?.synchronizeGraph(result);
    } catch (error) {
      // The graph intent is already admitted. Mirror it before recovering so
      // the returned graph-issued promise remains the only public outcome.
      this.#effects.apply(result);
      this.#startRecovery(normalizeRuntimeFailure(
        "readiness-failure",
        error,
        { state: target, operation: "request-synchronization" }
      ));
      return request;
    }
    this.#effects.apply(result);
    if (playback === null && this.#readyResult === null) {
      this.#staticPreparation.supersedePresentation(
        result.snapshot.requestedState
      );
    }
    if (playback !== null) {
      try {
        const traceState = playback.traceState();
        validatePlaybackTraceState(traceState);
        this.#trace.recordOperation({
          result,
          playback: traceState,
          readiness: this.#effects.readiness
        });
      } catch (error) {
        this.#startRecovery(normalizeRuntimeFailure(
          "readiness-failure",
          error,
          { state: target, operation: "request-trace" }
        ));
      }
    }
    return request;
  }

  /** Await all recovery/static presentation work currently owned by the player. */
  public async settled(): Promise<void> {
    await this.#recovery.settled();
    await this.#motion.settled();
  }

  public dispose(): Promise<void> {
    if (this.#terminalOwnerCallbackDepth > 0) {
      // This owner is already being retired by the active player transaction.
      // Joining that transaction from inside its callback would self-await.
      return Promise.resolve();
    }
    if (this.#disposePromise !== null) return this.#disposePromise;
    const operation = this.#operationGate.active
      ? Promise.resolve().then(() => this.#disposeInternal())
      : this.#disposeInternal();
    this.#disposePromise = operation;
    return operation;
  }

  #reportFailure(failure: Readonly<RuntimeFailure>): void {
    try {
      this.#diagnostics(failure);
    } catch {
      // Diagnostics are observational and never own playback lifecycle.
    }
  }

  async #disposeInternal(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    // Capture the serialized motion tail after invalidating its transition.
    // Await it only after aborting the media/recovery producers below: a
    // reduced-to-full re-entry can otherwise be waiting on their work.
    const motionDisposal = this.#motion.dispose();
    try {
      this.#realtime?.dispose();
    } catch (error) {
      this.#reportFailure(normalizeRuntimeFailure(
        "disposed",
        error,
        { operation: "realtime-driver-disposal" }
      ));
    }
    this.#lifecycleController.abort(abortError());
    this.#animatedPreparation.abort();
    const recoveryDisposal = this.#recovery.dispose();
    await this.#preparePromise?.catch(() => undefined);
    await recoveryDisposal;
    await motionDisposal;

    let traceState: Readonly<IntegratedPlaybackTraceState> | null = null;
    if (this.#activeCandidate !== null) {
      try {
        traceState = this.#activeCandidate.playback.traceState();
        validatePlaybackTraceState(traceState);
      } catch (error) {
        traceState = null;
        this.#reportFailure(normalizeRuntimeFailure(
          "readiness-failure",
          error,
          { operation: "player-disposal-trace" }
        ));
      }
    }

    const candidates = new Set<IntegratedCandidateAttempt>();
    if (this.#activeCandidate !== null) candidates.add(this.#activeCandidate);
    this.#activeCandidate = null;
    for (const candidate of candidates) {
      try {
        await this.#invokeTerminalOwner(() => candidate.dispose());
      } catch (error) {
        this.#reportFailure(normalizeRuntimeFailure(
          "readiness-failure",
          error,
          { operation: "player-disposal" }
        ));
      }
    }

    try {
      const retainedVisualState = this.#effects.visualState;
      const result = this.#graph.dispose(
        retainedVisualState === null ? {} : { retainedVisualState }
      );
      const resultForHost = this.#effects.applyDisposal(result);
      if (traceState !== null) {
        this.#trace.recordOperation({
          result: resultForHost,
          playback: traceState,
          readiness: this.#effects.readiness
        });
      }
    } finally {
      try {
        this.#requests.dispose();
      } catch (error) {
        this.#reportFailure(normalizeRuntimeFailure(
          "disposed",
          error,
          { operation: "request-ledger-disposal" }
        ));
      }
      try {
        this.#staticStore.dispose();
      } catch (error) {
        this.#reportFailure(normalizeRuntimeFailure(
          "disposed",
          error,
          { operation: "static-store-disposal" }
        ));
      }
      try {
        await this.#invokeTerminalOwner(() => this.#staticStore.settled());
      } catch (error) {
        this.#reportFailure(normalizeRuntimeFailure(
          "disposed",
          error,
          { operation: "static-store-settlement" }
        ));
      }
      try {
        this.#staticResourceLease?.release();
      } catch {
        this.#reportFailure(normalizeRuntimeFailure(
          "disposed",
          undefined,
          { operation: "static-resource-release" }
        ));
      }
      try {
        this.#catalog.dispose();
      } catch (error) {
        this.#reportFailure(normalizeRuntimeFailure(
          "disposed",
          error,
          { operation: "catalog-disposal" }
        ));
      }
    }
  }

  #invokeTerminalOwner(operation: () => unknown): unknown {
    this.#terminalOwnerCallbackDepth += 1;
    try {
      return operation();
    } finally {
      this.#terminalOwnerCallbackDepth -= 1;
    }
  }

  #createRealtimeDriver(
    options: Readonly<IntegratedRealtimeDriverOptions>
  ): RealtimeDriver {
    return new RealtimeDriver({
      frameRate: this.#catalog.manifest.frameRate,
      requestFrame: options.requestFrame,
      cancelFrame: options.cancelFrame,
      now: options.now ?? this.#now,
      tryContentTick: (context) => this.#operationGate.run(() =>
        this.#tryContentTickInternal({
          presentationOrdinal: context.presentationOrdinal,
          rationalDeadlineUs: realtimeDeadlineUs(context.deadlineMs)
        })
      ),
      ...(options.onUnderflow === undefined
        ? {}
        : { onUnderflow: options.onUnderflow })
    });
  }

  #startRecovery(failure: Readonly<RuntimeFailure>): void {
    try {
      this.#realtime?.stopAfterFailure();
    } catch (error) {
      this.#reportFailure(normalizeRuntimeFailure(
        "disposed",
        error,
        { operation: "realtime-recovery-stop" }
      ));
    }
    this.#recovery.start(failure);
  }

  #stageStaticReadyResult(
    result: Readonly<RuntimeReadinessResult> | null
  ): void {
    this.#selectedRendition = null;
    this.#readyResult = result;
    if (result !== null) this.#motion.stageReadyResult(result);
  }

}

function disposeInvalidIntegratedStaticStore(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  try {
    const dispose = Reflect.get(value, "dispose");
    if (typeof dispose === "function") dispose.call(value);
  } catch {
    // The original constructor validation/factory failure remains stable.
  }
}

function snapshotIntegratedRealtimeOptions(
  source: Readonly<IntegratedRealtimeDriverOptions>
): Readonly<IntegratedRealtimeDriverOptions> {
  const requestFrame = source.requestFrame;
  const cancelFrame = source.cancelFrame;
  const now = source.now;
  const onUnderflow = source.onUnderflow;
  return Object.freeze({
    requestFrame,
    cancelFrame,
    ...(now === undefined ? {} : { now }),
    ...(onUnderflow === undefined ? {} : { onUnderflow })
  });
}

function normalizeAnimatedFailure(
  error: unknown,
  fallbackCode: RuntimeFailureCode,
  context: Readonly<IntegratedContentTickContext>
): Readonly<RuntimeFailure> {
  if (isRuntimePlaybackError(error)) return error.failure;
  const ordinal = context.presentationOrdinal <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(context.presentationOrdinal)
    : undefined;
  return normalizeRuntimeFailure(
    fallbackCode,
    error,
    ordinal === undefined
      ? { operation: "content-tick" }
      : { operation: "content-tick", ordinal }
  );
}

function realtimeDeadlineUs(deadlineMs: number): number {
  const value = Math.round(deadlineMs * 1_000);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("realtime deadline exceeds integer-microsecond range");
  }
  return value;
}
