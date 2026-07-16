import {
  DecoderWorkerCoreError,
  normalizeCoreError,
  validateConfiguration,
  validateGeneration,
  validateProbeConfiguration,
  validateProbeSupportResult,
  validateSupportResultConfiguration
} from "./core-validation.js";
import {
  DecoderUnitPipeline,
  type DecoderUnitPipelineMetrics,
  type WorkerVideoDecoderAdapter
} from "./decoder-unit-pipeline.js";
import {
  DECODER_WORKER_PROTOCOL_VERSION,
  type DecoderWorkerCommand,
  type DecoderWorkerErrorEvent,
  type DecoderWorkerEvent,
  type DecoderWorkerLimits,
  type DecoderWorkerMetrics,
  type DecoderWorkerOutputExpectation,
  type DecoderWorkerSample
} from "./protocol.js";
import { DecoderSampleSequence } from "./sample-sequence.js";

export type { WorkerVideoDecoderAdapter } from "./decoder-unit-pipeline.js";

export type WorkerVideoDecoderFactory = (
  init: VideoDecoderInit
) => WorkerVideoDecoderAdapter;

export type WorkerEncodedVideoChunkFactory = (
  init: EncodedVideoChunkInit
) => EncodedVideoChunk;

export type WorkerVideoDecoderSupportProbe = (
  config: VideoDecoderConfig
) => Promise<VideoDecoderSupport>;

export type DecoderWorkerEventSink = (
  event: DecoderWorkerEvent,
  transfer?: Transferable[]
) => void;

export interface DecoderWorkerCoreOptions {
  readonly emit: DecoderWorkerEventSink;
  readonly decoderFactory?: WorkerVideoDecoderFactory;
  readonly chunkFactory?: WorkerEncodedVideoChunkFactory;
  readonly supportProbe?: WorkerVideoDecoderSupportProbe;
}

interface PendingSample {
  readonly generation: number;
  readonly sample: DecoderWorkerSample;
}

interface MutableMetrics extends DecoderUnitPipelineMetrics {
  configureCalls: number;
  flushCalls: number;
  acceptedSamples: number;
  submittedChunks: number;
  outputFrames: number;
  deliveredFrames: number;
  releasedFrames: number;
  staleFrames: number;
  closedFrames: number;
  errors: number;
}

/**
 * Worker-local protocol and generation owner of the sole VideoDecoder.
 *
 * DecoderUnitPipeline owns independent-unit submission boundaries, output
 * ordering, frame credit, and retirement. Keeping those invariants separate
 * leaves this class responsible for commands, configuration, and lifecycle.
 */
export class DecoderWorkerCore {
  readonly #emitEvent: DecoderWorkerEventSink;
  readonly #decoderFactory: WorkerVideoDecoderFactory;
  readonly #chunkFactory: WorkerEncodedVideoChunkFactory;
  readonly #supportProbe: WorkerVideoDecoderSupportProbe;
  readonly #pending: PendingSample[] = [];
  readonly #sequence = new DecoderSampleSequence();
  readonly #metrics: MutableMetrics = {
    configureCalls: 0,
    flushCalls: 0,
    acceptedSamples: 0,
    submittedChunks: 0,
    outputFrames: 0,
    deliveredFrames: 0,
    releasedFrames: 0,
    staleFrames: 0,
    closedFrames: 0,
    errors: 0
  };
  readonly #unitPipeline: DecoderUnitPipeline;

  #decoder: WorkerVideoDecoderAdapter | null = null;
  #expectedOutput: DecoderWorkerOutputExpectation | null = null;
  #limits: DecoderWorkerLimits | null = null;
  #activeGeneration: number | null = null;
  #lastGeneration = 0;
  #lastRequestId = 0;
  #failure: DecoderWorkerCoreError | null = null;
  #disposed = false;
  #decoderClosed = false;
  #configuring = false;

  public constructor(options: DecoderWorkerCoreOptions) {
    this.#emitEvent = options.emit;
    this.#decoderFactory = options.decoderFactory ?? defaultDecoderFactory;
    this.#chunkFactory = options.chunkFactory ?? defaultChunkFactory;
    this.#supportProbe = options.supportProbe ?? defaultSupportProbe;
    this.#unitPipeline = new DecoderUnitPipeline({
      emit: (event, transfer) => this.#emitEvent(event, transfer),
      fail: (error) => this.#fail(error, null),
      pump: () => this.#pump(),
      activeGeneration: () => this.#activeGeneration,
      terminal: () => this.#disposed || this.#failure !== null,
      closeFrame: (frame) => this.#closeFrame(frame),
      metrics: this.#metrics
    });
  }

  public async handle(command: DecoderWorkerCommand): Promise<void> {
    if (command.type !== "release-frame") {
      if (command.requestId <= this.#lastRequestId) {
        this.#fail(
          new DecoderWorkerCoreError(
            "PROTOCOL_ERROR",
            "decoder worker request ids must increase monotonically",
            true
          ),
          command.requestId
        );
        return;
      }
      this.#lastRequestId = command.requestId;
    }
    if (command.type === "dispose") {
      this.#dispose(command.requestId);
      return;
    }
    if (this.#disposed) {
      this.#emitError(
        command.type === "release-frame" ? null : command.requestId,
        new DecoderWorkerCoreError("DISPOSED", "decoder worker is disposed")
      );
      return;
    }
    if (command.type === "snapshot") {
      this.#emit({
        type: "snapshot",
        protocolVersion: DECODER_WORKER_PROTOCOL_VERSION,
        requestId: command.requestId,
        metrics: this.snapshotMetrics()
      });
      return;
    }
    if (this.#failure !== null) {
      this.#emitError(
        command.type === "release-frame" ? null : command.requestId,
        this.#failure
      );
      return;
    }

    try {
      switch (command.type) {
        case "probe-config":
          await this.#probeConfig(command);
          break;
        case "configure":
          await this.#configure(command);
          break;
        case "activate-generation":
          this.#activateGeneration(command.requestId, command.generation);
          break;
        case "submit":
          this.#submit(command.requestId, command.generation, command.samples);
          break;
        case "abort-generation":
          this.#abortGeneration(command.requestId, command.generation);
          break;
        case "release-frame":
          this.#releaseFrame(command.frameId);
          break;
        default:
          command satisfies never;
      }
    } catch (error) {
      const normalized = normalizeCoreError(
        error,
        "PROTOCOL_ERROR",
        "decoder worker command failed",
        false
      );
      if (normalized.fatal) {
        this.#fail(
          normalized,
          command.type === "release-frame" ? null : command.requestId
        );
      } else {
        this.#emitError(
          command.type === "release-frame" ? null : command.requestId,
          normalized
        );
      }
    }
  }

  public rejectMalformedCommand(requestId: number | null): void {
    this.#fail(
      new DecoderWorkerCoreError(
        "PROTOCOL_ERROR",
        "decoder worker received a malformed command",
        true
      ),
      requestId
    );
  }

  public snapshotMetrics(): DecoderWorkerMetrics {
    return Object.freeze({
      configureCalls: this.#metrics.configureCalls,
      resetCalls: 0 as const,
      flushCalls: this.#metrics.flushCalls,
      boundaryFlushCalls: this.#metrics.flushCalls,
      acceptedSamples: this.#metrics.acceptedSamples,
      submittedChunks: this.#metrics.submittedChunks,
      outputFrames: this.#metrics.outputFrames,
      deliveredFrames: this.#metrics.deliveredFrames,
      releasedFrames: this.#metrics.releasedFrames,
      staleFrames: this.#metrics.staleFrames,
      closedFrames: this.#metrics.closedFrames,
      pendingSamples: this.#pending.length,
      submittedFrames:
        this.#pendingDisplayedFrameCount() +
        this.#unitPipeline.expectedFrameCount +
        this.#unitPipeline.bufferedFrameCount,
      leasedFrames: this.#unitPipeline.leasedFrameCount,
      leasedDecodedBytes: this.#unitPipeline.leasedDecodedBytes,
      decodeQueueSize: this.#readDecodeQueueSize(),
      activeGeneration: this.#activeGeneration,
      nextSubmissionOrdinal: this.#sequence.acceptedChunks,
      nextOutputOrdinal:
        this.#metrics.deliveredFrames + this.#metrics.staleFrames,
      errors: this.#metrics.errors,
      disposed: this.#disposed
    });
  }

  async #probeConfig(
    command: Extract<DecoderWorkerCommand, { readonly type: "probe-config" }>
  ): Promise<void> {
    if (
      this.#decoder !== null ||
      this.#metrics.configureCalls !== 0 ||
      this.#configuring
    ) {
      throw new DecoderWorkerCoreError(
        "ALREADY_CONFIGURED",
        "decoder support probes are allowed only before configuration"
      );
    }
    validateProbeConfiguration(command.config);
    let support: VideoDecoderSupport;
    try {
      support = await this.#supportProbe(command.config);
    } catch (error) {
      throw normalizeCoreError(
        error,
        "DECODER_PROBE_FAILED",
        "WebCodecs decoder support probe failed",
        false
      );
    }
    const supported = validateProbeSupportResult(support, command.config);
    this.#emit({
      type: "probe-result",
      protocolVersion: DECODER_WORKER_PROTOCOL_VERSION,
      requestId: command.requestId,
      supported
    });
  }

  async #configure(
    command: Extract<DecoderWorkerCommand, { readonly type: "configure" }>
  ): Promise<void> {
    if (
      this.#decoder !== null ||
      this.#metrics.configureCalls !== 0 ||
      this.#configuring
    ) {
      throw new DecoderWorkerCoreError(
        "ALREADY_CONFIGURED",
        "decoder worker may be configured only once"
      );
    }
    validateConfiguration(
      command.config,
      command.videoProfile,
      command.expectedOutput,
      command.limits
    );
    this.#configuring = true;

    let decoder: WorkerVideoDecoderAdapter | null = null;
    try {
      const support = await this.#supportProbe(command.config);
      if (!support.supported || support.config === undefined) {
        throw new DecoderWorkerCoreError(
          "DECODER_CONFIGURE_FAILED",
          "WebCodecs does not support the requested decoder configuration",
          true
        );
      }
      validateSupportResultConfiguration(support.config, command.config);
      decoder = this.#decoderFactory({
        output: (frame) => {
          this.#unitPipeline.handleOutput(frame);
        },
        error: (error) => {
          this.#fail(
            normalizeCoreError(
              error,
              "DECODER_OUTPUT_INVALID",
              "WebCodecs decoder failed",
              true
            ),
            null
          );
        }
      });
      decoder.setDequeueCallback(() => {
        this.#pump();
      });
      decoder.configure(command.config);
      if (this.#failure !== null) throw this.#failure;
    } catch (error) {
      const normalized = normalizeCoreError(
        error,
        "DECODER_CONFIGURE_FAILED",
        "failed to configure WebCodecs decoder",
        true
      );
      try {
        decoder?.close();
      } catch {
        // Preserve the original configure failure.
      }
      throw normalized;
    } finally {
      this.#configuring = false;
    }

    if (decoder === null) {
      throw new DecoderWorkerCoreError(
        "DECODER_CONFIGURE_FAILED",
        "decoder factory did not return an adapter",
        true
      );
    }
    this.#decoder = decoder;
    this.#expectedOutput = command.expectedOutput;
    this.#limits = command.limits;
    this.#unitPipeline.configure(
      decoder,
      command.expectedOutput,
      command.limits
    );
    this.#metrics.configureCalls += 1;
    this.#emitAck(command.requestId, "configure");
  }

  #activateGeneration(requestId: number, generation: number): void {
    this.#assertConfigured();
    validateGeneration(generation);
    if (generation <= this.#lastGeneration) {
      throw new DecoderWorkerCoreError(
        "GENERATION_MISMATCH",
        "decoder generations must increase monotonically"
      );
    }

    this.#retirePendingBefore(generation);
    this.#unitPipeline.retireBefore(generation);
    this.#sequence.activate(generation);
    this.#activeGeneration = generation;
    this.#lastGeneration = generation;
    this.#emitAck(requestId, "activate-generation");
    this.#pump();
  }

  #submit(
    requestId: number,
    generation: number,
    samples: readonly DecoderWorkerSample[]
  ): void {
    this.#assertConfigured();
    if (generation !== this.#activeGeneration) {
      throw new DecoderWorkerCoreError(
        "GENERATION_MISMATCH",
        "decode submission does not target the active generation"
      );
    }
    const limits = this.#requireLimits();
    if (samples.length < 1) {
      throw new DecoderWorkerCoreError(
        "PROTOCOL_ERROR",
        "decode submission must contain at least one sample",
        true
      );
    }
    if (this.#pending.length + samples.length > limits.maxPendingSamples) {
      throw new DecoderWorkerCoreError(
        "BACKPRESSURE_LIMIT",
        "decode submission exceeds the pending-sample budget"
      );
    }
    const newDisplayedFrames = sumDisplayedFrames(samples);
    const outstandingFrames =
      this.#pendingDisplayedFrameCount() +
      this.#unitPipeline.expectedFrameCount +
      this.#unitPipeline.bufferedFrameCount +
      this.#unitPipeline.leasedFrameCount;
    if (
      newDisplayedFrames > limits.maxOutstandingFrames - outstandingFrames
    ) {
      throw new DecoderWorkerCoreError(
        "BACKPRESSURE_LIMIT",
        "decode submission exceeds the outstanding-frame budget"
      );
    }

    this.#sequence.accept(generation, samples);
    for (const sample of samples) {
      this.#pending.push({ generation, sample });
    }
    this.#metrics.acceptedSamples += samples.length;
    this.#emitAck(requestId, "submit");
    this.#pump();
  }

  #abortGeneration(requestId: number, generation: number): void {
    this.#assertConfigured();
    validateGeneration(generation);
    if (generation !== this.#activeGeneration) {
      throw new DecoderWorkerCoreError(
        "GENERATION_MISMATCH",
        "only the active decoder generation can be aborted"
      );
    }
    this.#activeGeneration = null;
    this.#retirePendingGeneration(generation);
    this.#unitPipeline.retireGeneration(generation);
    this.#sequence.abort(generation);
    this.#emitAck(requestId, "abort-generation");
    this.#pump();
  }

  #releaseFrame(frameId: number): void {
    this.#unitPipeline.releaseFrame(frameId);
  }

  #pump(): void {
    if (
      this.#failure !== null ||
      this.#disposed ||
      this.#decoder === null ||
      this.#limits === null
    ) {
      return;
    }
    this.#unitPipeline.drain();
    if (this.#unitPipeline.flushing) return;

    while (
      this.#pending.length > 0 &&
      this.#readDecodeQueueSize() < this.#limits.maxDecodeQueueSize
    ) {
      const pending = this.#pending[0]!;
      if (pending.generation !== this.#activeGeneration) {
        this.#pending.shift();
        continue;
      }
      if (!this.#unitPipeline.beginSample(pending.generation, pending.sample)) {
        return;
      }
      this.#pending.shift();
      const sample = pending.sample;
      let chunk: EncodedVideoChunk;
      try {
        chunk = this.#chunkFactory({
          type: sample.randomAccess ? "key" : "delta",
          timestamp: sample.presentationTimestamp,
          duration: sample.duration,
          data: sample.data
        });
        this.#unitPipeline.registerExpectedFrames(sample);
        this.#decoder.decode(chunk);
      } catch (error) {
        this.#fail(
          normalizeCoreError(
            error,
            "DECODER_SUBMIT_FAILED",
            "WebCodecs rejected an encoded chunk",
            true
          ),
          null
        );
        return;
      }
      this.#metrics.submittedChunks += 1;
      if (sample.decodeIndex === sample.unitChunkCount - 1) {
        this.#unitPipeline.finishUnit();
        return;
      }
    }
  }

  #retirePendingBefore(generation: number): void {
    let write = 0;
    for (const pending of this.#pending) {
      if (pending.generation >= generation) {
        this.#pending[write] = pending;
        write += 1;
      }
    }
    this.#pending.length = write;
  }

  #retirePendingGeneration(generation: number): void {
    let write = 0;
    for (const pending of this.#pending) {
      if (pending.generation !== generation) {
        this.#pending[write] = pending;
        write += 1;
      }
    }
    this.#pending.length = write;
  }

  #pendingDisplayedFrameCount(): number {
    let count = 0;
    for (const pending of this.#pending) {
      count += pending.sample.displayedFrameCount;
    }
    return count;
  }

  #dispose(requestId: number): void {
    if (!this.#disposed) {
      this.#disposed = true;
      this.#activeGeneration = null;
      this.#clearOwnedState();
      this.#sequence.clearActive();
      this.#closeDecoder();
    }
    this.#emit({
      type: "disposed",
      protocolVersion: DECODER_WORKER_PROTOCOL_VERSION,
      requestId
    });
  }

  #fail(error: DecoderWorkerCoreError, requestId: number | null): void {
    if (this.#failure !== null || this.#disposed) return;
    this.#failure = error;
    this.#metrics.errors += 1;
    this.#activeGeneration = null;
    this.#clearOwnedState();
    this.#sequence.clearActive();
    this.#closeDecoder();
    this.#emitError(requestId, error);
  }

  #clearOwnedState(): void {
    this.#pending.length = 0;
    this.#unitPipeline.clear();
  }

  #emitAck(
    requestId: number,
    operation: Extract<DecoderWorkerEvent, { type: "ack" }>["operation"]
  ): void {
    this.#emit({
      type: "ack",
      protocolVersion: DECODER_WORKER_PROTOCOL_VERSION,
      requestId,
      operation
    });
  }

  #emitError(requestId: number | null, error: DecoderWorkerCoreError): void {
    this.#metrics.errors += error.fatal && this.#failure === error ? 0 : 1;
    const event: DecoderWorkerErrorEvent = {
      type: "error",
      protocolVersion: DECODER_WORKER_PROTOCOL_VERSION,
      requestId,
      code: error.code,
      message: error.message,
      fatal: error.fatal
    };
    this.#emit(event);
  }

  #emit(event: DecoderWorkerEvent): void {
    try {
      this.#emitEvent(event);
    } catch (error) {
      if (this.#failure === null && !this.#disposed) {
        this.#fail(
          normalizeCoreError(
            error,
            "TRANSPORT_FAILED",
            "decoder worker transport failed",
            true
          ),
          null
        );
      }
    }
  }

  #assertConfigured(): void {
    if (
      this.#decoder === null ||
      this.#expectedOutput === null ||
      this.#limits === null
    ) {
      throw new DecoderWorkerCoreError(
        "NOT_CONFIGURED",
        "decoder worker must be configured before use"
      );
    }
  }

  #requireLimits(): DecoderWorkerLimits {
    const limits = this.#limits;
    if (limits === null) {
      throw new DecoderWorkerCoreError(
        "NOT_CONFIGURED",
        "decoder limits are unavailable",
        true
      );
    }
    return limits;
  }

  #readDecodeQueueSize(): number {
    if (this.#decoder === null || this.#decoderClosed) return 0;
    const size = this.#decoder.decodeQueueSize;
    if (!Number.isSafeInteger(size) || size < 0) {
      this.#fail(
        new DecoderWorkerCoreError(
          "DECODER_OUTPUT_INVALID",
          "WebCodecs reported an invalid decodeQueueSize",
          true
        ),
        null
      );
      return 0;
    }
    return size;
  }

  #closeFrame(frame: VideoFrame): void {
    try {
      frame.close();
    } finally {
      this.#metrics.closedFrames += 1;
    }
  }

  #closeDecoder(): void {
    if (this.#decoder === null || this.#decoderClosed) return;
    this.#decoderClosed = true;
    try {
      this.#decoder.close();
    } catch {
      // Decoder closure is best effort after a terminal failure.
    }
  }
}

function sumDisplayedFrames(samples: readonly DecoderWorkerSample[]): number {
  let count = 0;
  for (const sample of samples) {
    count += sample.displayedFrameCount;
    if (!Number.isSafeInteger(count)) {
      throw new DecoderWorkerCoreError(
        "PROTOCOL_ERROR",
        "decode batch displayed-frame count is unsafe",
        true
      );
    }
  }
  return count;
}

function defaultDecoderFactory(init: VideoDecoderInit): WorkerVideoDecoderAdapter {
  const decoder = new VideoDecoder(init);
  let dequeue: (() => void) | undefined;
  return {
    get decodeQueueSize(): number {
      return decoder.decodeQueueSize;
    },
    setDequeueCallback(callback): void {
      if (dequeue !== undefined) {
        decoder.removeEventListener("dequeue", dequeue);
      }
      dequeue = callback;
      decoder.addEventListener("dequeue", callback);
    },
    configure(config): void {
      decoder.configure(config);
    },
    decode(chunk): void {
      decoder.decode(chunk);
    },
    flush(): Promise<void> {
      return decoder.flush();
    },
    close(): void {
      if (dequeue !== undefined) {
        decoder.removeEventListener("dequeue", dequeue);
        dequeue = undefined;
      }
      decoder.close();
    }
  };
}

function defaultChunkFactory(init: EncodedVideoChunkInit): EncodedVideoChunk {
  return new EncodedVideoChunk(init);
}

async function defaultSupportProbe(
  config: VideoDecoderConfig
): Promise<VideoDecoderSupport> {
  return VideoDecoder.isConfigSupported(config);
}
