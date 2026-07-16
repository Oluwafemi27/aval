import type { Unit } from "@pixel-point/aval-format";

import type {
  VideoCandidateReadinessSessionInput
} from "./video-candidate-factory.js";
import {
  idealReadinessDeadlineMs,
  ReadinessMetricsRecorder,
  type ReadinessFrameMeasurement
} from "./readiness-metrics.js";
import {
  planReadinessGroup,
  readinessOutstandingFrames
} from "./readiness-group-planner.js";
import type {
  WorkerSampleFrameRequest,
  WorkerSampleOutput
} from "./worker-samples.js";

interface ReadinessExpectedOutput {
  readonly sample: Readonly<WorkerSampleOutput>;
  readonly measured: boolean;
}

/** Testable owner of browser decoder readiness transport and scheduling. */
export class BrowserReadinessProbe {
  readonly #input: Readonly<VideoCandidateReadinessSessionInput>;
  readonly #now: () => number;
  #slot = 0;

  public constructor(
    input: Readonly<VideoCandidateReadinessSessionInput>,
    now: () => number
  ) {
    this.#input = input;
    this.#now = now;
  }

  public async measure(
    path: string,
    frames: readonly Readonly<WorkerSampleFrameRequest>[]
  ): Promise<readonly Readonly<ReadinessFrameMeasurement>[]> {
    throwIfAborted(this.#input.signal);
    const generation = this.#input.timeline.activateNextGeneration();
    await this.#input.worker.activateGeneration(generation);
    const recorder = new ReadinessMetricsRecorder({
      frameRate: this.#input.context.catalog.manifest.frameRate,
      now: this.#now
    });
    const origin = this.#now();
    const expected: ReadinessExpectedOutput[] = [];
    let requestedOffset = 0;
    let sequenceIndex = 0;
    let nextRequest: Readonly<WorkerSampleFrameRequest> | null =
      frames[0] ?? null;
    let reorderLookahead = false;
    while (requestedOffset < frames.length || expected.length > 0) {
      throwIfAborted(this.#input.signal);

      const frame = this.#input.worker.takeFrame();
      if (frame !== undefined) {
        const output = expected.shift();
        if (output === undefined) {
          frame.close();
          throw new Error("readiness worker produced an unexpected frame");
        }
        try {
          assertOutput(frame, output.sample, generation);
        } catch (error) {
          frame.close();
          throw error;
        }
        if (!output.measured) {
          frame.close();
          continue;
        }
        recorder.workerOutput(frame.ordinal);
        const handle = await this.#input.renderer.uploadStreaming(
          this.#slot,
          generation,
          frame
        );
        this.#slot = (this.#slot + 1) % 3;
        if (handle === null) throw new Error("readiness upload became stale");
        recorder.uploadReady(output.sample.ordinal);
        continue;
      }

      if (
        nextRequest !== null &&
        (expected.length === 0 || reorderLookahead)
      ) {
        const request = nextRequest;
        const requirement = this.#input.samples.nextGroupRequirement(request);
        const unitFrameCount = readinessUnitFrameCount(
          this.#input.context.catalog.manifest.units,
          request.unitId
        );
        const metrics = await this.#input.worker.snapshotMetrics();
        const outstandingFrames = readinessOutstandingFrames(metrics);
        const planned = planReadinessGroup({
          first: request,
          requirement,
          requested: frames,
          requestedOffset,
          unitFrameCount,
          pendingSamples: metrics.pendingSamples,
          outstandingFrames,
          limits: this.#input.limits
        });
        if (planned.fits) {
          const batch = this.#input.samples.createBatch({
            frames: planned.requests,
            pendingSamples: metrics.pendingSamples,
            outstandingFrames
          });
          try {
            if (batch.outputs.length !== planned.measured.length) {
              throw new RangeError(
                "readiness sample batch output count diverged from its group"
              );
            }
            for (let index = 0; index < batch.outputs.length; index += 1) {
              const sample = batch.outputs[index]!;
              const measured = planned.measured[index]!;
              if (measured) {
                recorder.submit({
                  outputOrdinal: sample.ordinal,
                  media: {
                    path,
                    unit: sample.unitId,
                    unitInstance: sample.unitInstance,
                    localFrame: sample.unitFrame
                  },
                  idealDeadlineMs: idealReadinessDeadlineMs(
                    origin,
                    sequenceIndex + 1,
                    this.#input.context.catalog.manifest.frameRate
                  )
                });
                sequenceIndex += 1;
              }
            }
            await this.#input.worker.submit(generation, batch.samples);
            expected.push(...batch.outputs.map((sample, index) =>
              Object.freeze({
                sample,
                measured: planned.measured[index]!
              })
            ));
          } finally {
            batch.release?.();
          }
          requestedOffset = planned.nextRequestedOffset;
          nextRequest = planned.nextRequest;
          reorderLookahead = planned.reorderLookahead;
          continue;
        }
      }

      if (expected.length > 0) {
        await this.#input.worker.waitForFrames(1, {
          signal: this.#input.signal,
          timeoutMs: remainingMs(this.#input)
        });
        continue;
      }
      throw new RangeError(
        "readiness probe cannot make progress within worker credit"
      );
    }
    return recorder.report().frames;
  }
}

function readinessUnitFrameCount(
  units: readonly Readonly<Unit>[],
  id: string
): number {
  const unit = units.find((candidate) => candidate.id === id);
  if (unit === undefined) throw new RangeError("readiness codec unit is absent");
  return unit.frameCount;
}

function assertOutput(
  frame: Readonly<{
    readonly generation: number;
    readonly ordinal: number;
    readonly unitId: string;
    readonly unitInstance: number;
    readonly unitFrame: number;
  }>,
  sample: Readonly<WorkerSampleOutput>,
  generation: number
): void {
  if (
    frame.generation !== generation ||
    frame.ordinal !== sample.ordinal ||
    frame.unitId !== sample.unitId ||
    frame.unitInstance !== sample.unitInstance ||
    frame.unitFrame !== sample.unitFrame
  ) throw new Error("readiness worker output identity diverged");
}

function remainingMs(
  input: Readonly<VideoCandidateReadinessSessionInput>
): number {
  const remaining = input.deadlineMs - input.clock.now();
  if (!Number.isFinite(remaining) || remaining <= 0) {
    throw new DOMException("readiness deadline expired", "TimeoutError");
  }
  return remaining;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason;
}
