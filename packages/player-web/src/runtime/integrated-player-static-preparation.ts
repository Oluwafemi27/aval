import {
  MotionGraphEngine,
  type MotionGraphResult
} from "@pixel-point/aval-graph";

import type { RuntimeAssetCatalog } from "./asset-catalog.js";
import type { EffectHost } from "./effect-host.js";
import {
  IntegratedPlaybackInvariantError,
  PlaybackFallbackError,
  type IntegratedFallbackStore,
  type IntegratedTimerHost
} from "./integrated-player-contracts.js";
import {
  assertIntegratedStaticPresentation,
  integratedAbortError,
  integratedAbortReason,
  raceIntegratedAbort,
  validateIntegratedClock
} from "./integrated-player-support.js";
import {
  createRuntimeReadinessReport,
  type RuntimeCandidateReport,
  type RuntimeReadinessResult,
  type StaticReason
} from "./model.js";

export interface IntegratedPreparationControl {
  readonly controller: AbortController;
  readonly deadlineMs: number;
  readonly externalSignal: AbortSignal | null;
  readonly unlink: () => void;
  readonly timerHandle: number;
  timedOut: boolean;
}

interface IntegratedStaticPreparationOptions {
  readonly catalog: RuntimeAssetCatalog;
  readonly graph: MotionGraphEngine;
  readonly effects: EffectHost;
  readonly fallbackStore: IntegratedFallbackStore;
  readonly installResult: Readonly<MotionGraphResult>;
  readonly lifecycleSignal: AbortSignal;
  readonly now: () => number;
  readonly timers: IntegratedTimerHost;
  readonly stageReadyResult: (
    result: Readonly<RuntimeReadinessResult>
  ) => void;
}

/** Initial static guarantee and bounded preparation fallback owner. */
export class IntegratedStaticPreparation {
  readonly #catalog: RuntimeAssetCatalog;
  readonly #graph: MotionGraphEngine;
  readonly #effects: EffectHost;
  readonly #fallbackStore: IntegratedFallbackStore;
  readonly #installResult: Readonly<MotionGraphResult>;
  readonly #lifecycleSignal: AbortSignal;
  readonly #now: () => number;
  readonly #timers: IntegratedTimerHost;
  readonly #stageReadyResult: (
    result: Readonly<RuntimeReadinessResult>
  ) => void;

  #installApplied = false;
  #visualReady = false;
  #staticReady = false;
  #presentation: {
    readonly state: string;
    readonly controller: AbortController;
  } | null = null;

  public constructor(options: Readonly<IntegratedStaticPreparationOptions>) {
    this.#catalog = options.catalog;
    this.#graph = options.graph;
    this.#effects = options.effects;
    this.#fallbackStore = options.fallbackStore;
    this.#installResult = options.installResult;
    this.#lifecycleSignal = options.lifecycleSignal;
    this.#now = options.now;
    this.#timers = options.timers;
    this.#stageReadyResult = options.stageReadyResult;
  }

  public get staticReady(): boolean {
    return this.#staticReady;
  }

  public async ensure(signal: AbortSignal): Promise<void> {
    if (!this.#visualReady) {
      const initial = this.#catalog.manifest.initialState;
      await raceIntegratedAbort(
        this.#fallbackStore.installInitial({ state: initial, signal }),
        signal
      );
      if (this.#fallbackStore.currentState() !== initial) {
        throw new IntegratedPlaybackInvariantError(
          "initial fallback store committed the wrong state"
        );
      }
      if (!this.#installApplied) {
        const snapshot = this.#graph.snapshot();
        const stagedInstall = Object.freeze({
          ...this.#installResult,
          presentation: snapshot.presentation,
          snapshot
        });
        this.#effects.apply(stagedInstall, (presentation) => {
          assertIntegratedStaticPresentation(presentation, initial);
        });
        this.#installApplied = true;
      }
      this.#effects.publishVisualReady();
      this.#visualReady = true;
    }
    if (!this.#staticReady) {
      await raceIntegratedAbort(
        this.#fallbackStore.validateAll({ signal }),
        signal
      );
      this.#staticReady = true;
    }
  }

  public async finish(
    reason: StaticReason,
    reports: readonly Readonly<RuntimeCandidateReport>[],
    signal: AbortSignal,
    commitBeforeReady?: () => void
  ): Promise<Readonly<RuntimeReadinessResult>> {
    let requested: string;
    let result: Readonly<MotionGraphResult>;
    for (;;) {
      requested = await this.#presentLatest(signal, true);
      if (this.#graph.snapshot().requestedState !== requested) continue;
      commitBeforeReady?.();
      result = this.#graph.beginStatic(reason);
      break;
    }
    const ready = Object.freeze({
      mode: "static" as const,
      reason,
      report: createRuntimeReadinessReport({
        readiness: "staticReady",
        selectedRendition: null,
        candidates: reports
      })
    });
    this.#stageReadyResult(ready);
    this.#effects.apply(result, (presentation) => {
      assertIntegratedStaticPresentation(presentation, requested);
      // #presentLatest(..., true) already atomically covered the animated
      // plane with host fallback. This callback is the ordering barrier only.
    });
    return ready;
  }

  /** Stage the newest logical fallback state without covering animation. */
  public stageLatest(signal: AbortSignal): Promise<string> {
    return this.#presentLatest(signal, false);
  }

  async #presentLatest(signal: AbortSignal, cover: boolean): Promise<string> {
    let requested: string;
    for (;;) {
      const latest = this.#graph.snapshot().requestedState;
      if (latest === null) {
        throw new PlaybackFallbackError("graph has no requested static state");
      }
      requested = latest;
      const controller = new AbortController();
      const forwardAbort = (): void => controller.abort(
        integratedAbortReason(signal)
      );
      if (signal.aborted) forwardAbort();
      else signal.addEventListener("abort", forwardAbort, { once: true });
      const presentation = Object.freeze({ state: requested, controller });
      this.#presentation = presentation;
      try {
        await raceIntegratedAbort(
          this.#fallbackStore.presentState(requested, {
            signal: controller.signal,
            cover
          }),
          controller.signal
        );
        if (this.#fallbackStore.currentState() !== requested) {
          throw new IntegratedPlaybackInvariantError(
            "static preparation store committed the wrong state"
          );
        }
      } catch (error) {
        if (signal.aborted) throw integratedAbortReason(signal);
        if (controller.signal.aborted) continue;
        throw error;
      } finally {
        signal.removeEventListener("abort", forwardAbort);
        if (this.#presentation === presentation) this.#presentation = null;
      }
      if (controller.signal.aborted) continue;
      if (this.#graph.snapshot().requestedState === requested) break;
    }
    return requested;
  }

  /** Prevent obsolete fallback state from committing after newer intent. */
  public supersedePresentation(requestedState: string | null): void {
    const presentation = this.#presentation;
    if (
      presentation === null ||
      presentation.state === requestedState ||
      presentation.controller.signal.aborted
    ) {
      return;
    }
    presentation.controller.abort(new DOMException(
      "static preparation presentation was superseded",
      "AbortError"
    ));
  }

  public async finishBounded(
    reason: StaticReason,
    reports: readonly Readonly<RuntimeCandidateReport>[],
    timeoutMs: number,
    commitBeforeReady?: () => void
  ): Promise<Readonly<RuntimeReadinessResult>> {
    const fallback = this.createControl(this.#lifecycleSignal, timeoutMs);
    try {
      return await this.finish(
        reason,
        reports,
        fallback.controller.signal,
        commitBeforeReady
      );
    } finally {
      this.releaseControl(fallback);
    }
  }

  /** Best-effort host cleanup must never replace the operation's outcome. */
  public releaseControl(control: IntegratedPreparationControl): void {
    try {
      control.unlink();
    } catch {
      // Host signal cleanup is observational to the preparation result.
    }
    try {
      this.#timers.clearTimeout(control.timerHandle);
    } catch {
      // A hostile timer host cannot strand preparation or mask its result.
    }
  }

  public fail(message: string): void {
    try {
      this.#effects.apply(this.#graph.failStatic(message));
    } catch {
      // The original static installation failure remains the useful boundary.
    }
  }

  public createControl(
    externalSignal: AbortSignal | undefined,
    timeoutMs: number
  ): IntegratedPreparationControl {
    const startedAt = this.#now();
    validateIntegratedClock(startedAt);
    const deadlineMs = startedAt + timeoutMs;
    if (!Number.isFinite(deadlineMs) || deadlineMs > Number.MAX_SAFE_INTEGER) {
      throw new RangeError("preparation deadline exceeds safe range");
    }
    const controller = new AbortController();
    const signal = externalSignal ?? null;
    const forward = (): void => controller.abort(
      signal === null ? integratedAbortError() : integratedAbortReason(signal)
    );
    if (signal?.aborted === true) forward();
    else signal?.addEventListener("abort", forward, { once: true });
    const control: IntegratedPreparationControl = {
      controller,
      deadlineMs,
      externalSignal: signal,
      unlink: () => signal?.removeEventListener("abort", forward),
      timerHandle: 0,
      timedOut: false
    };
    let timerHandle: unknown;
    try {
      timerHandle = this.#timers.setTimeout(() => {
        control.timedOut = true;
        controller.abort(new DOMException(
          "animation preparation timed out",
          "TimeoutError"
        ));
      }, timeoutMs);
      if (!Number.isSafeInteger(timerHandle) || (timerHandle as number) < 0) {
        throw new RangeError("preparation timer handle must be an integer");
      }
      Object.defineProperty(control, "timerHandle", { value: timerHandle });
      return control;
    } catch (error) {
      control.unlink();
      if (timerHandle !== undefined) {
        try {
          this.#timers.clearTimeout(timerHandle as number);
        } catch {
          // Preserve the timer creation/validation failure.
        }
      }
      throw error;
    }
  }
}
