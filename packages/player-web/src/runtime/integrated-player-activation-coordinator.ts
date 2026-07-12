import type {
  MotionGraphEngine,
  MotionGraphResult
} from "@rendered-motion/graph";

import type { EffectHost } from "./effect-host.js";
import {
  IntegratedPlaybackInvariantError,
  type IntegratedCandidateAttempt,
  type IntegratedStaticSurfaceStore
} from "./integrated-player-contracts.js";
import type { IntegratedAnimatedActivationCommit } from "./integrated-animated-preparation.js";
import type { IntegratedOperationGate } from "./integrated-operation-gate.js";
import type { IntegratedPlayerMotion } from "./integrated-player-motion.js";
import {
  assertIntegratedStaticPresentation,
  sameGraphPresentation,
  throwIfIntegratedAborted,
  validateIntegratedPlaybackTraceState
} from "./integrated-player-support.js";
import type { IntegratedTraceHarness } from "./integrated-trace-harness.js";
import {
  normalizeRuntimeFailure,
  type RuntimeFailure
} from "./errors.js";
import {
  createRuntimeCandidateReport,
  createRuntimeReadinessReport,
  type RuntimeReadinessResult
} from "./model.js";
import type { RealtimeDriver } from "./realtime-driver.js";

interface IntegratedPlayerActivationState {
  readonly isDisposed: () => boolean;
  readonly getActiveCandidate: () => IntegratedCandidateAttempt | null;
  readonly setActiveCandidate: (
    candidate: IntegratedCandidateAttempt | null
  ) => void;
  readonly getReadyResult: () => Readonly<RuntimeReadinessResult> | null;
  readonly setReadyResult: (
    result: Readonly<RuntimeReadinessResult> | null
  ) => void;
  readonly setSelectedRendition: (renditionId: string | null) => void;
}

interface IntegratedPlayerActivationCoordinatorOptions {
  readonly graph: MotionGraphEngine;
  readonly effects: EffectHost;
  readonly staticStore: IntegratedStaticSurfaceStore;
  readonly trace: IntegratedTraceHarness;
  readonly operationGate: IntegratedOperationGate;
  readonly state: Readonly<IntegratedPlayerActivationState>;
  readonly getMotion: () => IntegratedPlayerMotion;
  readonly getRealtime: () => RealtimeDriver | null;
  readonly startRecovery: (failure: Readonly<RuntimeFailure>) => void;
  readonly settleRecovery: () => Promise<void>;
  readonly reportFailure: (failure: Readonly<RuntimeFailure>) => void;
}

/**
 * Coordinates activation and motion-mode transactions without owning playback
 * state. The player remains the sole authority for candidate and readiness
 * fields through the explicit state accessors supplied here.
 */
export class IntegratedPlayerActivationCoordinator {
  readonly #graph: MotionGraphEngine;
  readonly #effects: EffectHost;
  readonly #staticStore: IntegratedStaticSurfaceStore;
  readonly #trace: IntegratedTraceHarness;
  readonly #operationGate: IntegratedOperationGate;
  readonly #state: Readonly<IntegratedPlayerActivationState>;
  readonly #getMotion: () => IntegratedPlayerMotion;
  readonly #getRealtime: () => RealtimeDriver | null;
  readonly #startRecovery: (failure: Readonly<RuntimeFailure>) => void;
  readonly #settleRecovery: () => Promise<void>;
  readonly #reportFailure: (failure: Readonly<RuntimeFailure>) => void;

  public constructor(
    options: Readonly<IntegratedPlayerActivationCoordinatorOptions>
  ) {
    this.#graph = options.graph;
    this.#effects = options.effects;
    this.#staticStore = options.staticStore;
    this.#trace = options.trace;
    this.#operationGate = options.operationGate;
    this.#state = options.state;
    this.#getMotion = options.getMotion;
    this.#getRealtime = options.getRealtime;
    this.#startRecovery = options.startRecovery;
    this.#settleRecovery = options.settleRecovery;
    this.#reportFailure = options.reportFailure;
  }

  public commitAnimatedActivation(
    commit: Readonly<IntegratedAnimatedActivationCommit>
  ): Readonly<RuntimeReadinessResult> {
    return this.#operationGate.run(() => {
      throwIfIntegratedAborted(commit.signal);

      // Listener-visible readiness state is staged before graph effects.
      this.#state.setActiveCandidate(commit.attempt);
      this.#state.setSelectedRendition(commit.renditionId);
      this.#state.setReadyResult(commit.result);
      this.#getMotion().stageReadyResult(commit.result);
      const animated = this.#graph.beginAnimated();
      if (!sameGraphPresentation(
        animated.presentation,
        commit.expectedPresentation
      )) {
        throw new IntegratedPlaybackInvariantError(
          "committed activation diverged from its prepared presentation"
        );
      }
      commit.attempt.playback.synchronizeGraph(animated);
      this.#effects.apply(animated, (presentation) => {
        if (!sameGraphPresentation(
          presentation,
          commit.expectedPresentation
        )) {
          throw new IntegratedPlaybackInvariantError(
            "activation draw diverged from its prepared presentation"
          );
        }
        commit.attempt.drawInitial(commit.activation, presentation);
      });
      // Keep the strict static visibly covering until the prepared first
      // animated frame has crossed the synchronous draw barrier. A reveal
      // failure now occurs with an owned active candidate and therefore runs
      // through the ordinary cover-before-cleanup recovery lane.
      this.#staticStore.revealAnimated();
      throwIfIntegratedAborted(commit.signal);
      this.#recordOperation(animated, commit.attempt);
      return commit.result;
    });
  }

  public commitAnimatedReentry(
    commit: Readonly<IntegratedAnimatedActivationCommit>
  ): Readonly<RuntimeReadinessResult> {
    return this.#operationGate.run(() => {
      throwIfIntegratedAborted(commit.signal);
      this.#state.setActiveCandidate(commit.attempt);
      this.#state.setSelectedRendition(commit.renditionId);
      this.#state.setReadyResult(commit.result);
      const animated = this.#graph.resumeAnimated();
      if (!sameGraphPresentation(
        animated.presentation,
        commit.expectedPresentation
      )) {
        throw new IntegratedPlaybackInvariantError(
          "re-entry activation diverged from body frame zero"
        );
      }
      commit.attempt.playback.synchronizeGraph(animated);
      this.#effects.apply(animated, (presentation) => {
        if (!sameGraphPresentation(
          presentation,
          commit.expectedPresentation
        )) {
          throw new IntegratedPlaybackInvariantError(
            "re-entry draw diverged from its prepared presentation"
          );
        }
        commit.attempt.drawInitial(commit.activation, presentation);
      });
      if (!this.#getMotion().commitReentry()) {
        throw new IntegratedPlaybackInvariantError(
          "animated re-entry motion transition became stale"
        );
      }
      this.#staticStore.revealAnimated();
      this.#recordOperation(animated, commit.attempt);
      return commit.result;
    });
  }

  public rollbackAnimatedActivation(attempt: IntegratedCandidateAttempt): void {
    // A precommit attempt never revealed animated pixels, so the retained
    // strict static is already authoritative. Rollback only detaches state;
    // replaying a fallible visibility host would add no visual transition.
    if (this.#state.getActiveCandidate() === attempt) {
      this.#state.setActiveCandidate(null);
      this.#state.setSelectedRendition(null);
      this.#state.setReadyResult(null);
    }
  }

  public pauseForMotionPolicy(): boolean {
    const realtime = this.#getRealtime();
    const wasRunning = realtime?.snapshot().running ?? false;
    try {
      realtime?.pauseForPolicy();
    } catch (error) {
      // RealtimeDriver clears running/pending ownership before invoking the
      // hostile cancellation host. A cancellation exception therefore cannot
      // unwind the serialized reduction and strand its transition; report it
      // observationally and continue to the strict-static cover barrier.
      this.#reportFailure(normalizeRuntimeFailure(
        "readiness-failure",
        error,
        { operation: "motion-policy-realtime-pause" }
      ));
    }
    return wasRunning;
  }

  public resumeAfterCancelledReduction(wasRunning: boolean): void {
    if (
      this.#state.isDisposed() ||
      this.#state.getActiveCandidate() === null
    ) return;
    // stageLatest used cover:false and cancellation is checked before the
    // first cover, so animated pixels never stopped being authoritative.
    if (wasRunning) {
      try {
        this.#getRealtime()?.start();
      } catch (error) {
        this.#reportFailure(normalizeRuntimeFailure(
          "readiness-failure",
          error,
          { operation: "cancelled-reduction-realtime-resume" }
        ));
      }
    }
  }

  public resumeRealtimeAfterReentry(wasRunning: boolean): void {
    if (wasRunning && !this.#state.isDisposed()) {
      try {
        this.#getRealtime()?.start();
      } catch (error) {
        // Re-entry is already graph-, candidate-, draw-, and visibility-
        // committed. A hostile RAF host is observational here: report it and
        // leave the coherent animated state paused for an explicit retry.
        this.#reportFailure(normalizeRuntimeFailure(
          "readiness-failure",
          error,
          { operation: "reentry-realtime-resume" }
        ));
      }
    }
  }

  public coverReducedSurface(state: string): void {
    this.#operationGate.run(() => {
      const snapshot = this.#graph.snapshot();
      if (snapshot.requestedState !== state) {
        throw new IntegratedPlaybackInvariantError(
          "staged reduced-motion surface became stale"
        );
      }
      if (this.#staticStore.currentState() !== state) {
        throw new IntegratedPlaybackInvariantError(
          "staged reduced-motion surface has the wrong state identity"
        );
      }
      this.#staticStore.coverCurrent();
    });
  }

  public async commitReducedState(state: string): Promise<void> {
    const candidate = this.#operationGate.run(() => {
      const reports = (
        this.#state.getReadyResult()?.report.candidates ?? []
      ).map((report) => createRuntimeCandidateReport({
        ...report,
        outcome: report.outcome === "selected" ? "eligible" : report.outcome,
        failure: report.outcome === "selected" ? null : report.failure
      }));
      const ready = Object.freeze({
        mode: "static" as const,
        reason: "reduced-motion" as const,
        report: createRuntimeReadinessReport({
          readiness: "staticReady",
          selectedRendition: null,
          candidates: reports
        })
      });
      const reduced = this.#graph.recoverStatic("reduced-motion");
      this.#state.setSelectedRendition(null);
      this.#state.setReadyResult(ready);
      this.#getMotion().stageReadyResult(ready);
      this.#effects.applyRecovery(reduced, (presentation) => {
        assertIntegratedStaticPresentation(presentation, state);
        // coverReducedSurface already completed the visible static barrier.
        // This callback orders the graph effects without replaying a fallible
        // visibility host after the motion-mode commit.
      });
      const active = this.#state.getActiveCandidate();
      if (active !== null) {
        this.#recordOperationBestEffort(
          reduced,
          active,
          "reduced-motion-trace"
        );
        this.#state.setActiveCandidate(null);
      }
      return active;
    });
    await this.#disposeCandidate(
      candidate,
      "reduced-motion-candidate-cleanup"
    );
  }

  public async failReduction(error: unknown): Promise<void> {
    const candidate = this.#operationGate.run(() => {
      const retainedVisualState = this.#effects.visualState;
      const failure = normalizeRuntimeFailure(
        "renderer-failure",
        error,
        { operation: "reduced-motion-static-surface" }
      );
      let staticCovered = false;
      let retainedStaticMatches = false;
      try {
        retainedStaticMatches = retainedVisualState !== null &&
          this.#staticStore.currentState() === retainedVisualState;
      } catch {
        // The reduction staging failure remains authoritative.
      }
      if (retainedStaticMatches) {
        try {
          this.#staticStore.coverCurrent();
          staticCovered = true;
        } catch {
          // The animated candidate remains the only proven matching pixels.
        }
      }
      if (!staticCovered) {
        const failed = this.#graph.failStatic(
          failure.message,
          retainedVisualState === null ? {} : { retainedVisualState }
        );
        this.#state.setSelectedRendition(null);
        this.#state.setReadyResult(null);
        const failedForHost = this.#effects.applyFailure(failed);
        const active = this.#state.getActiveCandidate();
        if (active !== null) {
          this.#recordOperationBestEffort(
            failedForHost,
            active,
            "failed-reduction-terminal-trace"
          );
        }
        return null;
      }
      const ready = Object.freeze({
        mode: "static" as const,
        reason: "animation-failure" as const,
        report: createRuntimeReadinessReport({
          readiness: "staticReady",
          selectedRendition: null,
          candidates: []
        })
      });
      const recovered = this.#graph.recoverStatic(
        "animation-failure",
        retainedVisualState === null ? {} : { retainedVisualState }
      );
      this.#state.setSelectedRendition(null);
      this.#state.setReadyResult(ready);
      this.#getMotion().stageReadyResult(ready);
      this.#effects.applyRecovery(recovered, (presentation) => {
        if (retainedVisualState === null) {
          throw new IntegratedPlaybackInvariantError(
            "failed reduction has no retained visual state"
          );
        }
        assertIntegratedStaticPresentation(presentation, retainedVisualState);
      });
      const active = this.#state.getActiveCandidate();
      if (active !== null) {
        this.#recordOperationBestEffort(
          recovered,
          active,
          "failed-reduction-trace"
        );
        this.#state.setActiveCandidate(null);
      }
      return active;
    });
    await this.#disposeCandidate(
      candidate,
      "failed-reduction-candidate-cleanup"
    );
  }

  public rejectAnimatedReentry(
    _error: unknown,
    result: Readonly<RuntimeReadinessResult> | null
  ): void {
    // The visible surface remains intact, while readiness records the failed
    // attempt and its deterministic candidate reports.
    this.#state.setSelectedRendition(null);
    if (result?.mode === "static") this.#state.setReadyResult(result);
  }

  public async recoverAnimatedActivation(
    failure: Readonly<RuntimeFailure>
  ): Promise<Readonly<RuntimeReadinessResult> | null> {
    this.#startRecovery(failure);
    await this.#settleRecovery();
    return this.#state.getReadyResult();
  }

  #recordOperation(
    result: Readonly<MotionGraphResult>,
    candidate: IntegratedCandidateAttempt
  ): void {
    const traceState = candidate.playback.traceState();
    validateIntegratedPlaybackTraceState(traceState);
    this.#trace.recordOperation({
      result,
      playback: traceState,
      readiness: this.#effects.readiness
    });
  }

  #recordOperationBestEffort(
    result: Readonly<MotionGraphResult>,
    candidate: IntegratedCandidateAttempt,
    operation: string
  ): void {
    try {
      this.#recordOperation(result, candidate);
    } catch (error) {
      this.#reportFailure(normalizeRuntimeFailure(
        "readiness-failure",
        error,
        { operation }
      ));
    }
  }

  async #disposeCandidate(
    candidate: IntegratedCandidateAttempt | null,
    operation: string
  ): Promise<void> {
    if (candidate === null) return;
    try {
      await candidate.dispose();
    } catch (error) {
      this.#reportFailure(normalizeRuntimeFailure(
        "readiness-failure",
        error,
        { operation }
      ));
    }
  }
}
