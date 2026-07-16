import type { DecoderWorkerLimits } from "../decoder-worker/protocol.js";
import type {
  PathSchedulerPumpOptions,
  PathSchedulerPumpReport,
  PathSchedulerWorkerAdapter
} from "./path-scheduler-model.js";
import {
  type PathSchedulerExpectedOutput,
  type PathSchedulerOutputDrainReport,
  PathSchedulerOutput
} from "./path-scheduler-output.js";
import {
  clonePathSequenceState,
  type PathFramePlan,
  type PathSequenceState
} from "./path-sequence.js";
import {
  planWorkerSampleGroupCredit,
  type WorkerSampleFactory
} from "./worker-samples.js";

const DEFAULT_PUMP_TIMEOUT_MS = 2_000;
const MAX_PUMP_ITERATIONS = 256;

export interface PumpPathSchedulerInput {
  readonly options: Readonly<PathSchedulerPumpOptions>;
  readonly ringCapacity: number;
  readonly limits: Readonly<DecoderWorkerLimits>;
  readonly maxBatchSamples: number;
  readonly worker: PathSchedulerWorkerAdapter;
  readonly samples: WorkerSampleFactory;
  readonly output: PathSchedulerOutput;
  readonly build: PathSequenceState;
  readonly buildFrame: (
    state: PathSequenceState,
    continueCodecGroup: boolean
  ) => Readonly<PathFramePlan> | null;
  readonly commitBuild: (state: PathSequenceState) => void;
  readonly recordSubmitted: (
    outputs: readonly Readonly<PathSchedulerExpectedOutput>[]
  ) => void;
  readonly onDrain: (
    report: Readonly<PathSchedulerOutputDrainReport>
  ) => void;
}

/** Bounded credit/request loop; graph routing remains in PathScheduler. */
export async function pumpPathScheduler(
  input: PumpPathSchedulerInput
): Promise<Readonly<PathSchedulerPumpReport>> {
  const targetRingFrames = input.options.targetRingFrames ?? input.ringCapacity;
  if (
    !Number.isSafeInteger(targetRingFrames) ||
    targetRingFrames < 1 ||
    targetRingFrames > input.ringCapacity
  ) {
    throw new RangeError("pump target must fit the presentation ring");
  }
  const timeoutMs = input.options.timeoutMs ?? DEFAULT_PUMP_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("pump timeout must be finite and positive");
  }

  let submittedFrames = 0;
  let decodedFrames = 0;
  let discardedFrames = 0;
  let staleFrames = 0;
  let waits = 0;
  let build = input.build;
  for (let iteration = 0; iteration < MAX_PUMP_ITERATIONS; iteration += 1) {
    const drained = input.output.drain();
    input.onDrain(drained);
    decodedFrames += drained.decodedFrames;
    discardedFrames += drained.discardedFrames;
    staleFrames += drained.staleFrames;

    const ringSize = input.output.ringSize;
    if (ringSize >= targetRingFrames) {
      return report(input.output, {
        submittedFrames,
        decodedFrames,
        discardedFrames,
        staleFrames,
        waits
      });
    }

    const metrics = await input.worker.snapshotMetrics();
    const deficit = targetRingFrames - ringSize -
      input.output.presentableExpectedCount();
    const outstanding = checkedAdd(
      metrics.submittedFrames,
      metrics.leasedFrames,
      "worker outstanding frames"
    );
    const reorderWaitCandidate =
      ringSize < targetRingFrames &&
      input.output.hasExpected() &&
      input.worker.queuedFrames === 0 &&
      metrics.pendingSamples === 0 &&
      metrics.decodeQueueSize === 0 &&
      metrics.submittedFrames > 0;
    if (
      metrics.pendingSamples < input.limits.maxPendingSamples &&
      outstanding < input.limits.maxOutstandingFrames &&
      (deficit > 0 || reorderWaitCandidate)
    ) {
      const draft = clonePathSequenceState(build);
      const plans: Readonly<PathFramePlan>[] = [];
      const first = input.buildFrame(draft, false);
      if (first !== null) {
        const requirement = input.samples.nextGroupRequirement({
          unitId: first.unitId,
          unitFrame: first.unitFrame
        });
        const credit = planWorkerSampleGroupCredit(
          requirement,
          {
            pendingSamples: metrics.pendingSamples,
            outstandingFrames: outstanding
          },
          input.limits
        );
        if (
          !Number.isSafeInteger(requirement.reorderFrameCount) ||
          requirement.reorderFrameCount < 0 ||
          requirement.frameCount > input.maxBatchSamples ||
          requirement.chunkCount > input.maxBatchSamples ||
          requirement.frameCount > input.limits.maxOutstandingFrames ||
          requirement.chunkCount > input.limits.maxPendingSamples ||
          requirement.reorderFrameCount > input.limits.maxOutstandingFrames
        ) {
          throw new RangeError(
            "codec presentation group exceeds the configured scheduler limits"
          );
        }
        const freeRingSlots = input.ringCapacity - ringSize -
          input.output.presentableExpectedCount();
        // A codec may retain already-submitted frames behind a presentation
        // gap until this whole safe group arrives. Those retained frames do
        // not need presentation-ring slots for every newly submitted frame:
        // drain() leaves any decoded overflow queued once the ring is full.
        const fitsReorderAdjustedRing = freeRingSlots >= 0 &&
          requirement.frameCount <= checkedAdd(
            freeRingSlots,
            requirement.reorderFrameCount,
            "reorder-adjusted presentation-ring slots"
          );
        // A fully idle decoder can be retaining an earlier output until the
        // next safe group supplies its future references. Outstanding-frame
        // credit bounds both the decoder-held frames and the worker-side
        // overflow that drain() intentionally leaves outside a full ring.
        const unblocksReorderedOutput =
          reorderWaitCandidate && requirement.reorderFrameCount > 0;
        if (
          credit.fits &&
          (fitsReorderAdjustedRing || unblocksReorderedOutput)
        ) {
          plans.push(first);
          for (let index = 1; index < requirement.frameCount; index += 1) {
            // The first frame already passed the unresolved-source horizon.
            // Finish its atomic codec group without reapplying that horizon
            // to each continuation frame. The path-sequence builder keeps a
            // selected route exact by marking its dependency tail discarded.
            const plan = input.buildFrame(draft, true);
            if (plan === null) {
              throw new RangeError(
                "path ended inside a codec presentation group"
              );
            }
            plans.push(plan);
          }
        }
      }
      // A phase-only transition is semantic progress too. Persist terminal
      // finite state even when it emits no decoder request, otherwise reserve
      // reports an underflow forever instead of a held presentation.
      if (first === null || plans.length > 0) {
        input.commitBuild(draft);
        build = draft;
      }
      if (plans.length > 0) {
        const batch = input.samples.createBatch({
          frames: plans.map((plan) => ({
            unitId: plan.unitId,
            unitFrame: plan.unitFrame
          })),
          pendingSamples: metrics.pendingSamples,
          outstandingFrames: outstanding
        });
        try {
          const outputs = input.output.schedule(plans, batch.outputs);
          input.recordSubmitted(outputs);
          submittedFrames += batch.outputs.length;
          await input.worker.submit(batch.generation, batch.samples);
        } finally {
          batch.release?.();
        }
        continue;
      }
    }

    if (reorderWaitCandidate && ringSize > 0) {
      // A decoder can retain presentation-reordered frames until its next
      // codec-safe group arrives. If that group needs more outstanding-frame
      // credit than remains, waiting cannot make progress: consuming one of
      // the already-presentable ring frames is what releases the credit.
      return report(input.output, {
        submittedFrames,
        decodedFrames,
        discardedFrames,
        staleFrames,
        waits
      });
    }

    if (input.output.hasExpected()) {
      const queuedBefore = input.worker.queuedFrames;
      waits += 1;
      await input.worker.waitForFrames(1, {
        ...(input.options.signal === undefined
          ? {}
          : { signal: input.options.signal }),
        timeoutMs
      });
      if (
        input.worker.queuedFrames <= queuedBefore &&
        input.worker.queuedFrames === 0
      ) {
        throw new RangeError("worker frame wait resolved without output");
      }
      continue;
    }

    return report(input.output, {
      submittedFrames,
      decodedFrames,
      discardedFrames,
      staleFrames,
      waits
    });
  }
  throw new RangeError("path scheduler pump exceeded its bounded iterations");
}

function report(
  output: PathSchedulerOutput,
  input: Omit<PathSchedulerPumpReport, "ringSize" | "expectedOutputs">
): Readonly<PathSchedulerPumpReport> {
  return Object.freeze({
    ...input,
    ringSize: output.ringSize,
    expectedOutputs: output.expectedCount
  });
}

function checkedAdd(left: number, right: number, label: string): number {
  if (
    !Number.isSafeInteger(left) ||
    !Number.isSafeInteger(right) ||
    left < 0 ||
    right < 0 ||
    left > Number.MAX_SAFE_INTEGER - right
  ) {
    throw new RangeError(`${label} exceeded the safe-integer range`);
  }
  return left + right;
}
