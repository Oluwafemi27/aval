import { describe, expect, it } from "vitest";

import type {
  DecoderWorkerMetrics,
  DecoderWorkerSample
} from "../decoder-worker/protocol.js";
import type { ManagedDecoderWorkerFrame } from "../decoder-worker/client.js";
import {
  BrowserReadinessProbe
} from "./browser-readiness-probe.js";
import type {
  VideoCandidateReadinessSessionInput
} from "./video-candidate-model.js";
import type {
  WorkerSampleFrameRequest,
  WorkerSampleGroupRequirement,
  WorkerSampleOutput
} from "./worker-samples.js";

const UNIT = "clip";
const GENERATION = 1;
const LIMITS = Object.freeze({
  maxDecodeQueueSize: 8,
  maxPendingSamples: 8,
  maxOutstandingFrames: 8,
  maxDecodedBytes: 8 * 64 * 64 * 4
});

describe("BrowserReadinessProbe", () => {
  it("submits the next safe group when an H.264-like one-frame probe is retained", async () => {
    const fixture = createProbeFixture({
      frameCount: 5,
      groups: [
        group(0, 1, 1, 2),
        group(1, 4, 4, 2)
      ],
      release: "after-second-submit"
    });

    const measurements = await fixture.probe.measure("h264-prefix", [
      frame(0)
    ]);

    expect(measurements).toHaveLength(1);
    expect(measurements[0]).toMatchObject({
      outputOrdinal: 0,
      media: { path: "h264-prefix", unit: UNIT, localFrame: 0 }
    });
    expect(fixture.worker.submitCalls).toBe(2);
    expect(fixture.worker.waitCalls).toBe(0);
    expect(fixture.renderer.uploadedFrames).toEqual([0]);
    expect(fixture.worker.closedFrames).toEqual([0, 1, 2, 3, 4]);
  });

  it("returns only requested measurements and closes a safe-group suffix", async () => {
    const fixture = createProbeFixture({
      frameCount: 3,
      groups: [group(0, 3, 3, 0)],
      release: "immediate"
    });

    const measurements = await fixture.probe.measure("partial-group", [
      frame(0),
      frame(1)
    ]);

    expect(measurements.map(({ media }) => media.localFrame)).toEqual([0, 1]);
    expect(fixture.worker.submitCalls).toBe(1);
    expect(fixture.renderer.uploadedFrames).toEqual([0, 1]);
    expect(fixture.worker.closedFrames).toEqual([0, 1, 2]);
  });
});

interface ProbeGroup extends WorkerSampleGroupRequirement {}

function group(
  firstUnitFrame: number,
  frameCount: number,
  chunkCount: number,
  reorderFrameCount: number
): Readonly<ProbeGroup> {
  return Object.freeze({
    unitId: UNIT,
    firstUnitFrame,
    frameCount,
    chunkCount,
    reorderFrameCount
  });
}

function frame(unitFrame: number): Readonly<WorkerSampleFrameRequest> {
  return Object.freeze({ unitId: UNIT, unitFrame });
}

function createProbeFixture(options: {
  readonly frameCount: number;
  readonly groups: readonly Readonly<ProbeGroup>[];
  readonly release: "immediate" | "after-second-submit";
}) {
  const samples = new FakeSamples(options.groups);
  const worker = new FakeWorker(samples, options.release);
  const renderer = new FakeRenderer();
  let now = 0;
  const input = {
    context: {
      catalog: {
        manifest: {
          frameRate: { numerator: 30, denominator: 1 },
          units: [{ id: UNIT, frameCount: options.frameCount }]
        }
      }
    },
    worker,
    renderer,
    timeline: { activateNextGeneration: () => GENERATION },
    samples,
    limits: LIMITS,
    clock: { now: () => 0 },
    signal: new AbortController().signal,
    deadlineMs: 10_000
  } as unknown as VideoCandidateReadinessSessionInput;
  return {
    probe: new BrowserReadinessProbe(input, () => now++),
    renderer,
    worker
  };
}

class FakeSamples {
  readonly #groups: ReadonlyMap<number, Readonly<ProbeGroup>>;
  readonly #batches: Array<readonly Readonly<WorkerSampleOutput>[]> = [];
  #ordinal = 0;

  public constructor(groups: readonly Readonly<ProbeGroup>[]) {
    this.#groups = new Map(groups.map((value) => [
      value.firstUnitFrame,
      value
    ]));
  }

  public nextGroupRequirement(
    request: Readonly<WorkerSampleFrameRequest>
  ): Readonly<WorkerSampleGroupRequirement> {
    const value = this.#groups.get(request.unitFrame);
    if (value === undefined || request.unitId !== UNIT) {
      throw new RangeError("unknown fake safe group");
    }
    return value;
  }

  public createBatch(input: {
    readonly frames: readonly Readonly<WorkerSampleFrameRequest>[];
  }) {
    const group = this.nextGroupRequirement(input.frames[0]!);
    const outputs = Object.freeze(input.frames.map((request, index) =>
      Object.freeze({
        ordinal: this.#ordinal + index,
        unitId: request.unitId,
        unitInstance: 0,
        unitFrame: request.unitFrame,
        decodeIndex: request.unitFrame,
        timestamp: (this.#ordinal + index) * 1_000,
        duration: 1_000
      })
    ));
    this.#ordinal += outputs.length;
    this.#batches.push(outputs);
    return Object.freeze({
      generation: GENERATION,
      samples: Object.freeze(Array.from(
        { length: group.chunkCount },
        () => Object.freeze({}) as DecoderWorkerSample
      )),
      outputs,
      release() {}
    });
  }

  public takeBatch(): readonly Readonly<WorkerSampleOutput>[] {
    const value = this.#batches.shift();
    if (value === undefined) throw new Error("fake sample batch is absent");
    return value;
  }
}

class FakeWorker {
  public activeGeneration: number | null = null;
  public submitCalls = 0;
  public waitCalls = 0;
  public readonly closedFrames: number[] = [];
  readonly #samples: FakeSamples;
  readonly #release: "immediate" | "after-second-submit";
  readonly #ready: FakeFrame[] = [];
  readonly #open = new Set<FakeFrame>();
  #retained: readonly Readonly<WorkerSampleOutput>[] = [];

  public constructor(
    samples: FakeSamples,
    release: "immediate" | "after-second-submit"
  ) {
    this.#samples = samples;
    this.#release = release;
  }

  public get queuedFrames(): number {
    return this.#ready.length;
  }

  public get openFrames(): number {
    return this.#open.size;
  }

  public async activateGeneration(generation: number): Promise<void> {
    this.activeGeneration = generation;
  }

  public async submit(
    generation: number,
    _samples: readonly DecoderWorkerSample[]
  ): Promise<void> {
    expect(generation).toBe(GENERATION);
    this.submitCalls += 1;
    const outputs = this.#samples.takeBatch();
    if (this.#release === "after-second-submit" && this.submitCalls === 1) {
      this.#retained = outputs;
      return;
    }
    this.#enqueue([...this.#retained, ...outputs]);
    this.#retained = [];
  }

  public async abortGeneration(): Promise<void> {}

  public takeFrame(): ManagedDecoderWorkerFrame | undefined {
    return this.#ready.shift();
  }

  public async waitForFrames(): Promise<void> {
    this.waitCalls += 1;
    if (this.#ready.length < 1) {
      throw new Error("probe waited before submitting reorder lookahead");
    }
  }

  public async snapshotMetrics(): Promise<DecoderWorkerMetrics> {
    return {
      configureCalls: 1,
      resetCalls: 0,
      flushCalls: 0,
      boundaryFlushCalls: 0,
      acceptedSamples: 0,
      submittedChunks: 0,
      outputFrames: 0,
      deliveredFrames: 0,
      releasedFrames: this.closedFrames.length,
      staleFrames: 0,
      closedFrames: this.closedFrames.length,
      pendingSamples: 0,
      submittedFrames: this.#retained.length,
      leasedFrames: this.#open.size,
      leasedDecodedBytes: this.#open.size * 64,
      decodeQueueSize: 0,
      activeGeneration: this.activeGeneration,
      nextSubmissionOrdinal: 0,
      nextOutputOrdinal: 0,
      errors: 0,
      disposed: false
    };
  }

  public async configure(): Promise<void> {}

  public async dispose(): Promise<void> {}

  #enqueue(outputs: readonly Readonly<WorkerSampleOutput>[]): void {
    for (const output of outputs) {
      const frame = new FakeFrame(output, () => {
        this.#open.delete(frame);
        this.closedFrames.push(frame.unitFrame);
      });
      this.#open.add(frame);
      this.#ready.push(frame);
    }
  }
}

class FakeFrame implements ManagedDecoderWorkerFrame {
  public readonly frame = { close() {} } as unknown as VideoFrame;
  public readonly frameId: number;
  public readonly generation = GENERATION;
  public readonly ordinal: number;
  public readonly unitId: string;
  public readonly unitInstance: number;
  public readonly unitFrame: number;
  public readonly decodeIndex: number;
  public readonly timestamp: number;
  public readonly duration: number;
  public readonly decodedBytes = 64;
  readonly #release: () => void;
  #closed = false;

  public constructor(
    output: Readonly<WorkerSampleOutput>,
    release: () => void
  ) {
    this.frameId = output.ordinal + 1;
    this.ordinal = output.ordinal;
    this.unitId = output.unitId;
    this.unitInstance = output.unitInstance;
    this.unitFrame = output.unitFrame;
    this.decodeIndex = output.decodeIndex;
    this.timestamp = output.timestamp;
    this.duration = output.duration;
    this.#release = release;
  }

  public get closed(): boolean {
    return this.#closed;
  }

  public close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#release();
  }
}

class FakeRenderer {
  public readonly uploadedFrames: number[] = [];

  public async uploadStreaming(
    _slot: number,
    _generation: number,
    source: ManagedDecoderWorkerFrame
  ) {
    this.uploadedFrames.push(source.unitFrame);
    source.close();
    return Object.freeze({ kind: "stream" as const });
  }
}
