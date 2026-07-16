import {
  DecoderWorkerCoreError,
  expectedTimestamp,
  normalizeCoreError,
  validateDecodedFrame
} from "./core-validation.js";
import { FrameCreditLedger } from "./frame-credit-ledger.js";
import {
  DECODER_WORKER_PROTOCOL_VERSION,
  type DecoderWorkerEvent,
  type DecoderWorkerLimits,
  type DecoderWorkerOutputExpectation,
  type DecoderWorkerSample
} from "./protocol.js";

export interface WorkerVideoDecoderAdapter {
  readonly decodeQueueSize: number;
  setDequeueCallback(callback: () => void): void;
  configure(config: VideoDecoderConfig): void;
  decode(chunk: EncodedVideoChunk): void;
  flush(): Promise<void>;
  close(): void;
}

interface SubmittedUnit {
  readonly generation: number;
  readonly unitId: string;
  readonly unitInstance: number;
  readonly unitChunkCount: number;
  readonly unitFrameCount: number;
  readonly presentationOrdinalBase: number;
  readonly buffered: Map<number, BufferedFrame>;
  nextPresentationIndex: number;
  retired: boolean;
}

interface ExpectedFrame {
  readonly unit: SubmittedUnit;
  readonly decodeIndex: number;
  readonly presentationIndex: number;
  readonly timestamp: number;
  readonly duration: number;
}

interface BufferedFrame extends ExpectedFrame {
  readonly outputCallbackMicroseconds: number;
  readonly decodedBytes: number;
  readonly frame: VideoFrame;
}

export interface DecoderUnitPipelineMetrics {
  flushCalls: number;
  outputFrames: number;
  deliveredFrames: number;
  releasedFrames: number;
  staleFrames: number;
  closedFrames: number;
}

export interface DecoderUnitPipelineOptions {
  readonly emit: (
    event: Extract<DecoderWorkerEvent, { readonly type: "frame" }>,
    transfer: Transferable[]
  ) => void;
  readonly fail: (error: DecoderWorkerCoreError) => void;
  readonly pump: () => void;
  readonly activeGeneration: () => number | null;
  readonly terminal: () => boolean;
  readonly closeFrame: (frame: VideoFrame) => void;
  readonly metrics: DecoderUnitPipelineMetrics;
}

/**
 * Owns the decoder's independent-unit boundary and presentation-order state.
 *
 * DecoderWorkerCore owns protocol and generation control. This object owns the
 * state that begins when a chunk enters WebCodecs and ends when every decoded
 * frame is either transferred, released, retired, or closed.
 */
export class DecoderUnitPipeline {
  readonly #emit: DecoderUnitPipelineOptions["emit"];
  readonly #fail: DecoderUnitPipelineOptions["fail"];
  readonly #pump: DecoderUnitPipelineOptions["pump"];
  readonly #activeGeneration: DecoderUnitPipelineOptions["activeGeneration"];
  readonly #terminal: DecoderUnitPipelineOptions["terminal"];
  readonly #closeFrame: DecoderUnitPipelineOptions["closeFrame"];
  readonly #metrics: DecoderUnitPipelineMetrics;
  readonly #expectedByTimestamp = new Map<number, ExpectedFrame>();
  readonly #deliveryUnits: SubmittedUnit[] = [];
  readonly #credits = new FrameCreditLedger();

  #decoder: WorkerVideoDecoderAdapter | null = null;
  #expectedOutput: Readonly<DecoderWorkerOutputExpectation> | null = null;
  #limits: Readonly<DecoderWorkerLimits> | null = null;
  #nativeUnit: SubmittedUnit | null = null;
  #flushingUnit: SubmittedUnit | null = null;
  #bufferedFrameCount = 0;
  #bufferedDecodedBytes = 0;

  public constructor(options: DecoderUnitPipelineOptions) {
    this.#emit = options.emit;
    this.#fail = options.fail;
    this.#pump = options.pump;
    this.#activeGeneration = options.activeGeneration;
    this.#terminal = options.terminal;
    this.#closeFrame = options.closeFrame;
    this.#metrics = options.metrics;
  }

  public configure(
    decoder: WorkerVideoDecoderAdapter,
    expectedOutput: Readonly<DecoderWorkerOutputExpectation>,
    limits: Readonly<DecoderWorkerLimits>
  ): void {
    if (this.#decoder !== null) {
      throw new DecoderWorkerCoreError(
        "ALREADY_CONFIGURED",
        "decoder unit pipeline may be configured only once",
        true
      );
    }
    this.#decoder = decoder;
    this.#expectedOutput = expectedOutput;
    this.#limits = limits;
  }

  public get expectedFrameCount(): number {
    return this.#expectedByTimestamp.size;
  }

  public get bufferedFrameCount(): number {
    return this.#bufferedFrameCount;
  }

  public get leasedFrameCount(): number {
    return this.#credits.count;
  }

  public get leasedDecodedBytes(): number {
    return this.#credits.decodedBytes;
  }

  public get flushing(): boolean {
    return this.#flushingUnit !== null;
  }

  /**
   * Selects the native independent unit for a sample. A false result means the
   * previous unit is flushing and the caller must leave the sample pending.
   */
  public beginSample(generation: number, sample: DecoderWorkerSample): boolean {
    if (this.#nativeUnit === null) {
      this.#nativeUnit = createSubmittedUnit(generation, sample);
      this.#deliveryUnits.push(this.#nativeUnit);
    }
    if (!sameUnit(this.#nativeUnit, generation, sample)) {
      this.#startFlush(this.#nativeUnit);
      return false;
    }
    return true;
  }

  public registerExpectedFrames(sample: DecoderWorkerSample): void {
    const unit = this.#nativeUnit;
    if (unit === null) {
      throw new DecoderWorkerCoreError(
        "DECODER_SUBMIT_FAILED",
        "decoder sample has no active independent unit",
        true
      );
    }
    for (let index = 0; index < sample.presentationIndices.length; index += 1) {
      const presentationIndex = sample.presentationIndices[index]!;
      const timestamp = expectedTimestamp(sample, index);
      if (this.#expectedByTimestamp.has(timestamp)) {
        throw new DecoderWorkerCoreError(
          "DECODER_SUBMIT_FAILED",
          "displayed chunks must have unique in-flight presentation timestamps",
          true
        );
      }
      this.#expectedByTimestamp.set(timestamp, Object.freeze({
        unit,
        decodeIndex: sample.decodeIndex,
        presentationIndex,
        timestamp,
        duration: sample.duration
      }));
    }
  }

  public finishUnit(): void {
    if (this.#nativeUnit !== null) this.#startFlush(this.#nativeUnit);
  }

  public releaseFrame(frameId: number): void {
    this.#credits.release(frameId);
    this.#metrics.releasedFrames += 1;
    this.drain();
    this.#pump();
  }

  public handleOutput(frame: VideoFrame): void {
    const outputCallbackMicroseconds = workerClockMicroseconds();
    this.#metrics.outputFrames += 1;
    if (this.#terminal()) {
      this.#closeFrame(frame);
      return;
    }

    const expected = this.#expectedByTimestamp.get(frame.timestamp);
    if (expected === undefined) {
      this.#closeFrame(frame);
      this.#fail(new DecoderWorkerCoreError(
        "DECODER_OUTPUT_INVALID",
        "decoder produced an output with an unknown presentation timestamp",
        true
      ));
      return;
    }
    this.#expectedByTimestamp.delete(frame.timestamp);
    let ownsFrame = true;
    try {
      const decodedBytes = validateDecodedFrame(
        frame,
        this.#requireExpectedOutput(),
        expected.timestamp,
        expected.duration
      );
      if (
        expected.unit.retired ||
        expected.unit.generation !== this.#activeGeneration()
      ) {
        this.#metrics.staleFrames += 1;
        this.#closeFrame(frame);
        ownsFrame = false;
        this.#pump();
        return;
      }
      const limits = this.#requireLimits();
      if (
        decodedBytes >
          limits.maxDecodedBytes -
            this.#bufferedDecodedBytes -
            this.#credits.decodedBytes
      ) {
        throw new DecoderWorkerCoreError(
          "DECODED_BYTE_BUDGET_EXCEEDED",
          "decoded output exceeds the worker frame-byte budget",
          true
        );
      }
      if (expected.unit.buffered.has(expected.presentationIndex)) {
        throw new DecoderWorkerCoreError(
          "DECODER_OUTPUT_INVALID",
          "decoder produced a duplicate unit presentation frame",
          true
        );
      }
      expected.unit.buffered.set(expected.presentationIndex, {
        ...expected,
        outputCallbackMicroseconds,
        decodedBytes,
        frame
      });
      this.#bufferedFrameCount += 1;
      this.#bufferedDecodedBytes += decodedBytes;
      ownsFrame = false;
      this.drain();
      this.#pump();
    } catch (error) {
      if (ownsFrame) this.#closeFrame(frame);
      this.#fail(normalizeCoreError(
        error,
        "DECODER_OUTPUT_INVALID",
        "decoder output validation failed",
        true
      ));
    }
  }

  public drain(): void {
    const limits = this.#limits;
    if (limits === null || this.#terminal()) return;
    while (this.#deliveryUnits.length > 0) {
      const unit = this.#deliveryUnits[0]!;
      if (unit.retired) {
        this.#deliveryUnits.shift();
        continue;
      }
      const buffered = unit.buffered.get(unit.nextPresentationIndex);
      if (buffered === undefined) return;
      if (this.#credits.count >= limits.maxOutstandingFrames) return;

      unit.buffered.delete(unit.nextPresentationIndex);
      this.#bufferedFrameCount -= 1;
      this.#bufferedDecodedBytes -= buffered.decodedBytes;
      const frameId = this.#credits.lease(
        unit.generation,
        buffered.decodedBytes,
        limits.maxDecodedBytes - this.#bufferedDecodedBytes
      );
      try {
        this.#emit({
          type: "frame",
          protocolVersion: DECODER_WORKER_PROTOCOL_VERSION,
          frameId,
          generation: unit.generation,
          ordinal: unit.presentationOrdinalBase + buffered.presentationIndex,
          unitId: unit.unitId,
          unitInstance: unit.unitInstance,
          unitFrame: buffered.presentationIndex,
          decodeIndex: buffered.decodeIndex,
          timestamp: buffered.timestamp,
          duration: buffered.duration,
          outputCallbackMicroseconds: buffered.outputCallbackMicroseconds,
          decodedBytes: buffered.decodedBytes,
          frame: buffered.frame
        }, [buffered.frame]);
      } catch (error) {
        this.#credits.revoke(frameId);
        this.#closeFrame(buffered.frame);
        this.#fail(normalizeCoreError(
          error,
          "TRANSPORT_FAILED",
          "failed to transfer decoded frame",
          true
        ));
        return;
      }
      this.#metrics.deliveredFrames += 1;
      unit.nextPresentationIndex += 1;
      if (unit.nextPresentationIndex === unit.unitFrameCount) {
        this.#deliveryUnits.shift();
      }
    }
  }

  public retireBefore(generation: number): void {
    const generations = new Set<number>();
    for (const unit of this.#deliveryUnits) {
      if (unit.generation < generation) generations.add(unit.generation);
    }
    if (this.#nativeUnit !== null && this.#nativeUnit.generation < generation) {
      generations.add(this.#nativeUnit.generation);
    }
    for (const retired of generations) this.retireGeneration(retired);
  }

  public retireGeneration(generation: number): void {
    for (const unit of this.#deliveryUnits) {
      if (unit.generation !== generation) continue;
      unit.retired = true;
      for (const buffered of unit.buffered.values()) {
        this.#bufferedFrameCount -= 1;
        this.#bufferedDecodedBytes -= buffered.decodedBytes;
        this.#metrics.staleFrames += 1;
        this.#closeFrame(buffered.frame);
      }
      unit.buffered.clear();
    }
    let write = 0;
    for (const unit of this.#deliveryUnits) {
      if (unit.generation !== generation) {
        this.#deliveryUnits[write] = unit;
        write += 1;
      }
    }
    this.#deliveryUnits.length = write;
    if (
      this.#nativeUnit !== null &&
      this.#nativeUnit.generation === generation
    ) {
      this.#nativeUnit.retired = true;
      if (this.#flushingUnit === null) this.#startFlush(this.#nativeUnit);
    }
  }

  public clear(): void {
    this.#expectedByTimestamp.clear();
    for (const unit of this.#deliveryUnits) {
      for (const buffered of unit.buffered.values()) {
        this.#closeFrame(buffered.frame);
      }
      unit.buffered.clear();
    }
    this.#deliveryUnits.length = 0;
    this.#nativeUnit = null;
    this.#flushingUnit = null;
    this.#bufferedFrameCount = 0;
    this.#bufferedDecodedBytes = 0;
    this.#credits.clear();
  }

  #startFlush(unit: SubmittedUnit): void {
    const decoder = this.#decoder;
    if (this.#flushingUnit !== null || decoder === null) return;
    this.#flushingUnit = unit;
    this.#metrics.flushCalls += 1;
    let promise: Promise<void>;
    try {
      promise = decoder.flush();
    } catch (error) {
      this.#fail(normalizeCoreError(
        error,
        "DECODER_SUBMIT_FAILED",
        "WebCodecs failed to drain an independent unit",
        true
      ));
      return;
    }
    void promise.then(
      () => {
        if (this.#terminal()) return;
        if (this.#expectedForUnit(unit) !== 0) {
          this.#fail(new DecoderWorkerCoreError(
            "DECODER_OUTPUT_INVALID",
            "decoder flush completed before every displayed frame was output",
            true
          ));
          return;
        }
        if (this.#flushingUnit === unit) this.#flushingUnit = null;
        if (this.#nativeUnit === unit) this.#nativeUnit = null;
        this.drain();
        this.#pump();
      },
      (error: unknown) => {
        this.#fail(normalizeCoreError(
          error,
          "DECODER_SUBMIT_FAILED",
          "WebCodecs failed to drain an independent unit",
          true
        ));
      }
    );
  }

  #expectedForUnit(unit: SubmittedUnit): number {
    let count = 0;
    for (const expected of this.#expectedByTimestamp.values()) {
      if (expected.unit === unit) count += 1;
    }
    return count;
  }

  #requireExpectedOutput(): Readonly<DecoderWorkerOutputExpectation> {
    if (this.#expectedOutput === null) {
      throw new DecoderWorkerCoreError(
        "NOT_CONFIGURED",
        "decoder output expectation is unavailable",
        true
      );
    }
    return this.#expectedOutput;
  }

  #requireLimits(): Readonly<DecoderWorkerLimits> {
    if (this.#limits === null) {
      throw new DecoderWorkerCoreError(
        "NOT_CONFIGURED",
        "decoder limits are unavailable",
        true
      );
    }
    return this.#limits;
  }
}

function createSubmittedUnit(
  generation: number,
  sample: DecoderWorkerSample
): SubmittedUnit {
  return {
    generation,
    unitId: sample.unitId,
    unitInstance: sample.unitInstance,
    unitChunkCount: sample.unitChunkCount,
    unitFrameCount: sample.unitFrameCount,
    presentationOrdinalBase: sample.presentationOrdinalBase,
    buffered: new Map<number, BufferedFrame>(),
    nextPresentationIndex: 0,
    retired: false
  };
}

function sameUnit(
  unit: SubmittedUnit,
  generation: number,
  sample: DecoderWorkerSample
): boolean {
  return generation === unit.generation &&
    sample.unitId === unit.unitId &&
    sample.unitInstance === unit.unitInstance &&
    sample.unitChunkCount === unit.unitChunkCount &&
    sample.unitFrameCount === unit.unitFrameCount &&
    sample.presentationOrdinalBase === unit.presentationOrdinalBase;
}

function workerClockMicroseconds(): number {
  const value = Math.floor(
    performance.timeOrigin * 1_000 + performance.now() * 1_000
  );
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DecoderWorkerCoreError(
      "DECODER_OUTPUT_INVALID",
      "worker output callback clock is invalid",
      true
    );
  }
  return value;
}
