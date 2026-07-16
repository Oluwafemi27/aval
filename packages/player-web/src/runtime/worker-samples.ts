import type {
  ProductionRendition,
  Unit
} from "@pixel-point/aval-format";

import {
  DECODER_WORKER_HARD_LIMITS,
  type DecoderWorkerLimits,
  type DecoderWorkerSample
} from "../decoder-worker/protocol.js";
import type {
  RuntimeCatalogChunk,
  RuntimeCatalogIdIndex,
  RuntimeCatalogChunkIndex
} from "./asset-catalog.js";
import {
  DecodeTimeline,
  type DecodeSampleMetadata,
  type DecodeTimelineFrameRequest
} from "./decode-timeline.js";
import type {
  VideoCodecAdapterInspection,
  VideoCodecUnitInspection,
  VideoDecodeSubmissionMetadata
} from "./video-codec-adapters.js";

export interface WorkerSampleCatalog {
  readonly renditions: Pick<RuntimeCatalogIdIndex<ProductionRendition>, "require">;
  readonly units: Pick<RuntimeCatalogIdIndex<Unit>, "require">;
  readonly chunks: Pick<RuntimeCatalogChunkIndex, "require">;
  copyChunk(rendition: string, unit: string, decodeIndex: number): ArrayBuffer;
}

export interface WorkerSampleFrameRequest {
  readonly unitId: string;
  readonly unitFrame: number;
}

export interface WorkerSampleGroupRequirement {
  readonly unitId: string;
  readonly firstUnitFrame: number;
  readonly frameCount: number;
  readonly chunkCount: number;
  /** Maximum decoded frames held behind presentation-order gaps in this unit. */
  readonly reorderFrameCount: number;
}

export interface WorkerSampleCreditState {
  readonly pendingSamples: number;
  readonly outstandingFrames: number;
}

export interface WorkerSampleGroupCreditPlan {
  readonly chunkCost: number;
  readonly frameCost: number;
  readonly fits: boolean;
}

export interface CreateWorkerSampleBatchInput {
  /** One complete safe presentation group, in local-frame order. */
  readonly frames: readonly WorkerSampleFrameRequest[];
  readonly pendingSamples: number;
  readonly outstandingFrames: number;
}

/** Canonical worker-credit decision for one atomic codec-safe group. */
export function planWorkerSampleGroupCredit(
  requirement: Readonly<
    Pick<WorkerSampleGroupRequirement, "chunkCount" | "frameCount">
  >,
  state: Readonly<WorkerSampleCreditState>,
  limits: Readonly<DecoderWorkerLimits>
): Readonly<WorkerSampleGroupCreditPlan> {
  validatePositiveSafeInteger(requirement.chunkCount, "codec group chunk count");
  validatePositiveSafeInteger(requirement.frameCount, "codec group frame count");
  validateNonNegativeSafeInteger(state.pendingSamples, "pending sample count");
  validateNonNegativeSafeInteger(
    state.outstandingFrames,
    "outstanding frame count"
  );
  const fits =
    state.pendingSamples <= limits.maxPendingSamples &&
    requirement.chunkCount <=
      limits.maxPendingSamples - state.pendingSamples &&
    state.outstandingFrames <= limits.maxOutstandingFrames &&
    requirement.frameCount <=
      limits.maxOutstandingFrames - state.outstandingFrames;
  return Object.freeze({
    chunkCost: requirement.chunkCount,
    frameCost: requirement.frameCount,
    fits
  });
}

/** One expected displayed frame, independent of its decode-order chunk. */
export interface WorkerSampleOutput {
  readonly ordinal: number;
  readonly unitId: string;
  readonly unitInstance: number;
  readonly unitFrame: number;
  readonly decodeIndex: number;
  readonly timestamp: number;
  readonly duration: number;
}

export interface DecoderWorkerSampleBatch {
  readonly generation: number;
  /** Decode-order chunks transferred to the worker. */
  readonly samples: readonly Readonly<DecoderWorkerSample>[];
  /** Presentation-order frames expected from those chunks. */
  readonly outputs: readonly Readonly<WorkerSampleOutput>[];
  /** Release the main-thread transfer claim after submit transfers ownership. */
  release(): void;
}

export interface WorkerSampleTransferLease {
  release(): void;
}

export interface WorkerSampleResourceHost {
  claim(byteLength: number): WorkerSampleTransferLease;
}

export interface WorkerSampleFactoryOptions {
  readonly catalog: WorkerSampleCatalog;
  readonly timeline: DecodeTimeline;
  readonly rendition: string;
  readonly inspection: Readonly<VideoCodecAdapterInspection>;
  readonly limits: DecoderWorkerLimits;
  readonly resourceHost?: WorkerSampleResourceHost;
}

interface SafeSubmissionGroup {
  readonly firstUnitFrame: number;
  readonly frameCount: number;
  readonly decodeStart: number;
  readonly decodeEnd: number;
}

interface InspectedUnitPlan {
  readonly manifest: Readonly<Unit>;
  readonly inspection: Readonly<VideoCodecUnitInspection>;
  readonly groups: readonly Readonly<SafeSubmissionGroup>[];
  readonly reorderFrameCount: number;
}

interface PlannedChunk {
  readonly catalog: Readonly<RuntimeCatalogChunk>;
  readonly submission: Readonly<VideoDecodeSubmissionMetadata>;
}

/**
 * Joins verified catalog chunks, codec inspection, and the global presentation
 * clock. Safe groups are the smallest decode prefixes whose displayed frames
 * form one contiguous presentation range; callers can therefore preserve
 * bounded output credit without breaking B-frame or hidden-reference order.
 */
export class WorkerSampleFactory {
  readonly #catalog: WorkerSampleCatalog;
  readonly #timeline: DecodeTimeline;
  readonly #rendition: string;
  readonly #limits: Readonly<DecoderWorkerLimits>;
  readonly #units: ReadonlyMap<string, Readonly<InspectedUnitPlan>>;
  readonly #claimTransfer: ((byteLength: number) => WorkerSampleTransferLease) |
    null;

  public constructor(options: WorkerSampleFactoryOptions) {
    validateWorkerLimits(options.limits);
    options.catalog.renditions.require(options.rendition);
    this.#catalog = options.catalog;
    this.#timeline = options.timeline;
    this.#rendition = options.rendition;
    this.#limits = Object.freeze({
      maxDecodeQueueSize: options.limits.maxDecodeQueueSize,
      maxPendingSamples: options.limits.maxPendingSamples,
      maxOutstandingFrames: options.limits.maxOutstandingFrames,
      maxDecodedBytes: options.limits.maxDecodedBytes
    });
    this.#units = buildUnitPlans(
      options.catalog,
      options.rendition,
      options.inspection
    );
    this.#claimTransfer = options.resourceHost === undefined
      ? null
      : captureResourceHost(options.resourceHost);
  }

  /** Return the exact next safe group beginning at one presentation frame. */
  public nextGroupRequirement(
    request: Readonly<WorkerSampleFrameRequest>
  ): Readonly<WorkerSampleGroupRequirement> {
    validateFrameRequest(request);
    const unit = this.#requireUnit(request.unitId);
    const group = unit.groups.find(
      ({ firstUnitFrame }) => firstUnitFrame === request.unitFrame
    );
    if (group === undefined) {
      throw new RangeError(
        "worker sample request must begin at a safe presentation-group boundary"
      );
    }
    return Object.freeze({
      unitId: request.unitId,
      firstUnitFrame: group.firstUnitFrame,
      frameCount: group.frameCount,
      chunkCount: group.decodeEnd - group.decodeStart,
      reorderFrameCount: unit.reorderFrameCount
    });
  }

  public createBatch(
    input: CreateWorkerSampleBatchInput
  ): Readonly<DecoderWorkerSampleBatch> {
    validateBatchEnvelope(input);
    const first = input.frames[0]!;
    const unit = this.#requireUnit(first.unitId);
    const group = requireExactGroup(unit, input.frames);
    const plannedChunks = planChunks(
      this.#catalog,
      this.#rendition,
      unit,
      group
    );
    validateBatchCredit(
      input,
      plannedChunks.length,
      group.frameCount,
      this.#limits
    );

    const timelineFrames: DecodeTimelineFrameRequest[] = input.frames.map(
      (request) => Object.freeze({
        unitId: request.unitId,
        unitFrame: request.unitFrame,
        unitFrameCount: unit.manifest.frameCount
      })
    );
    const timelinePlan = this.#timeline.planSampleBatch(timelineFrames);
    const metadata = timelinePlan.samples;
    const metadataByUnitFrame = new Map(
      metadata.map((frame) => [frame.unitFrame, frame] as const)
    );
    const firstMetadata = metadata[0]!;
    const presentationOrdinalBase = checkedSubtract(
      firstMetadata.ordinal,
      firstMetadata.unitFrame,
      "presentation ordinal base"
    );
    const transferBytes = plannedChunks.reduce(
      (total, chunk) => checkedTransferSum(total, chunk.catalog.range.length),
      0
    );
    const transferLease = this.#claimTransfer === null
      ? NOOP_TRANSFER_LEASE
      : captureTransferLease(this.#claimTransfer(transferBytes));
    const samples: DecoderWorkerSample[] = [];
    const buffers = new Set<ArrayBuffer>();
    try {
      for (const planned of plannedChunks) {
        const data = this.#catalog.copyChunk(
          this.#rendition,
          unit.manifest.id,
          planned.submission.decodeIndex
        );
        validateCopiedChunk(data, planned.catalog, buffers);
        buffers.add(data);
        const timing = submissionTiming(
          planned.submission,
          metadataByUnitFrame,
          firstMetadata
        );
        samples.push(Object.freeze({
          unitId: unit.manifest.id,
          unitInstance: firstMetadata.unitInstance,
          decodeIndex: planned.submission.decodeIndex,
          unitChunkCount: unit.inspection.submissions.length,
          unitFrameCount: unit.manifest.frameCount,
          presentationOrdinalBase,
          presentationIndices: planned.submission.presentationIndices,
          presentationTimestamp: timing.timestamp,
          duration: timing.duration,
          randomAccess: planned.submission.chunkType === "key",
          displayedFrameCount: planned.submission.displayedFrameCount,
          data
        }));
      }

      const decodeIndexByFrame = new Map<number, number>();
      for (const planned of plannedChunks) {
        for (const unitFrame of planned.submission.presentationIndices) {
          decodeIndexByFrame.set(unitFrame, planned.submission.decodeIndex);
        }
      }
      const outputs = Object.freeze(metadata.map((frame) => Object.freeze({
        ordinal: frame.ordinal,
        unitId: frame.unitId,
        unitInstance: frame.unitInstance,
        unitFrame: frame.unitFrame,
        decodeIndex: requireDecodeIndex(decodeIndexByFrame, frame.unitFrame),
        timestamp: frame.timestamp,
        duration: frame.duration
      })));
      const batch = {
        generation: timelinePlan.generation,
        samples: Object.freeze(samples),
        outputs
      } as DecoderWorkerSampleBatch;
      Object.defineProperty(batch, "release", {
        enumerable: false,
        configurable: false,
        writable: false,
        value: transferLease.release
      });
      Object.freeze(batch);
      timelinePlan.commit();
      return batch;
    } catch (error) {
      transferLease.release();
      throw error;
    }
  }

  #requireUnit(id: string): Readonly<InspectedUnitPlan> {
    const unit = this.#units.get(id);
    if (unit === undefined) {
      throw new RangeError(`codec inspection has no unit ${id}`);
    }
    return unit;
  }
}

function buildUnitPlans(
  catalog: WorkerSampleCatalog,
  rendition: string,
  inspection: Readonly<VideoCodecAdapterInspection>
): ReadonlyMap<string, Readonly<InspectedUnitPlan>> {
  if (inspection === null || typeof inspection !== "object") {
    throw new TypeError("worker sample codec inspection is unavailable");
  }
  const result = new Map<string, Readonly<InspectedUnitPlan>>();
  for (const inspected of inspection.units) {
    const manifest = catalog.units.require(inspected.id);
    const span = manifest.chunks.find((candidate) =>
      candidate.rendition === rendition
    );
    if (
      span === undefined ||
      span.chunkCount !== inspected.submissions.length ||
      span.frameCount !== inspected.displayedFrameCount ||
      span.frameCount !== manifest.frameCount
    ) {
      throw new RangeError(
        `codec inspection disagrees with unit ${inspected.id}`
      );
    }
    if (result.has(inspected.id)) {
      throw new RangeError("codec inspection contains a duplicate unit");
    }
    result.set(inspected.id, Object.freeze({
      manifest,
      inspection: inspected,
      groups: createSafeSubmissionGroups(inspected),
      reorderFrameCount: maximumReorderFrameCount(inspected)
    }));
  }
  return result;
}

function maximumReorderFrameCount(
  unit: Readonly<VideoCodecUnitInspection>
): number {
  const decoded = new Set<number>();
  let decodedFrameCount = 0;
  let contiguousPresentationCount = 0;
  let maximum = 0;
  for (const submission of unit.submissions) {
    for (const presentationIndex of submission.presentationIndices) {
      if (decoded.has(presentationIndex)) {
        throw new RangeError(`unit ${unit.id} repeats a presentation frame`);
      }
      decoded.add(presentationIndex);
      decodedFrameCount += 1;
    }
    while (decoded.has(contiguousPresentationCount)) {
      contiguousPresentationCount += 1;
    }
    maximum = Math.max(
      maximum,
      decodedFrameCount - contiguousPresentationCount
    );
  }
  if (
    decodedFrameCount !== unit.displayedFrameCount ||
    contiguousPresentationCount !== unit.displayedFrameCount
  ) {
    throw new RangeError(`unit ${unit.id} presentation timeline is incomplete`);
  }
  return maximum;
}

function createSafeSubmissionGroups(
  unit: Readonly<VideoCodecUnitInspection>
): readonly Readonly<SafeSubmissionGroup>[] {
  const groups: SafeSubmissionGroup[] = [];
  const accumulated = new Set<number>();
  let decodeStart = 0;
  let firstUnitFrame = 0;
  for (let decodeIndex = 0; decodeIndex < unit.submissions.length; decodeIndex += 1) {
    const submission = unit.submissions[decodeIndex]!;
    if (submission.decodeIndex !== decodeIndex) {
      throw new RangeError(`unit ${unit.id} inspection is not in decode order`);
    }
    for (const presentationIndex of submission.presentationIndices) {
      if (accumulated.has(presentationIndex)) {
        throw new RangeError(`unit ${unit.id} repeats a presentation frame`);
      }
      accumulated.add(presentationIndex);
    }
    if (!isContiguousRange(accumulated, firstUnitFrame)) continue;
    groups.push({
      firstUnitFrame,
      frameCount: accumulated.size,
      decodeStart,
      decodeEnd: decodeIndex + 1
    });
    firstUnitFrame += accumulated.size;
    decodeStart = decodeIndex + 1;
    accumulated.clear();
  }
  if (decodeStart < unit.submissions.length) {
    if (accumulated.size !== 0 || groups.length === 0) {
      throw new RangeError(
        `unit ${unit.id} cannot be divided into safe presentation groups`
      );
    }
    const last = groups[groups.length - 1]!;
    groups[groups.length - 1] = {
      ...last,
      decodeEnd: unit.submissions.length
    };
  }
  if (firstUnitFrame !== unit.displayedFrameCount || groups.length === 0) {
    throw new RangeError(`unit ${unit.id} presentation timeline is incomplete`);
  }
  return Object.freeze(groups.map((group) => Object.freeze(group)));
}

function isContiguousRange(values: ReadonlySet<number>, start: number): boolean {
  if (values.size === 0) return false;
  for (let offset = 0; offset < values.size; offset += 1) {
    if (!values.has(start + offset)) return false;
  }
  return true;
}

function requireExactGroup(
  unit: Readonly<InspectedUnitPlan>,
  frames: readonly WorkerSampleFrameRequest[]
): Readonly<SafeSubmissionGroup> {
  const first = frames[0]!;
  const group = unit.groups.find(
    ({ firstUnitFrame }) => firstUnitFrame === first.unitFrame
  );
  if (group === undefined || frames.length !== group.frameCount) {
    throw new RangeError("worker sample batch must contain one complete safe group");
  }
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index]!;
    validateFrameRequest(frame);
    if (
      frame.unitId !== unit.manifest.id ||
      frame.unitFrame !== group.firstUnitFrame + index
    ) {
      throw new RangeError(
        "worker sample batch frames must be one contiguous presentation group"
      );
    }
  }
  return group;
}

function planChunks(
  catalog: WorkerSampleCatalog,
  rendition: string,
  unit: Readonly<InspectedUnitPlan>,
  group: Readonly<SafeSubmissionGroup>
): readonly Readonly<PlannedChunk>[] {
  return Object.freeze(unit.inspection.submissions
    .slice(group.decodeStart, group.decodeEnd)
    .map((submission) => {
      const chunk = catalog.chunks.require(
        rendition,
        unit.manifest.id,
        submission.decodeIndex
      );
      validateCatalogChunk(chunk, rendition, unit.manifest.id, submission);
      return Object.freeze({ catalog: chunk, submission });
    }));
}

function validateCatalogChunk(
  chunk: Readonly<RuntimeCatalogChunk>,
  rendition: string,
  unit: string,
  submission: Readonly<VideoDecodeSubmissionMetadata>
): void {
  const record = chunk.record;
  if (
    chunk.rendition !== rendition ||
    chunk.unit !== unit ||
    chunk.decodeIndex !== submission.decodeIndex ||
    record.presentationTimestamp !== submission.presentationTimestamp ||
    record.duration !== submission.duration ||
    record.displayedFrameCount !== submission.displayedFrameCount ||
    record.randomAccess !== (submission.chunkType === "key")
  ) {
    throw new RangeError("catalog chunk disagrees with codec inspection");
  }
  validatePositiveSafeInteger(chunk.range.length, "encoded chunk byte length");
}

function submissionTiming(
  submission: Readonly<VideoDecodeSubmissionMetadata>,
  metadata: ReadonlyMap<number, Readonly<DecodeSampleMetadata>>,
  fallback: Readonly<DecodeSampleMetadata>
): Readonly<{ timestamp: number; duration: number }> {
  if (submission.presentationIndices.length === 0) {
    return Object.freeze({ timestamp: fallback.timestamp, duration: 0 });
  }
  const first = metadata.get(submission.presentationIndices[0]!);
  if (first === undefined) {
    throw new RangeError("submission presentation frame is outside its safe group");
  }
  for (let index = 0; index < submission.presentationIndices.length; index += 1) {
    const frame = metadata.get(submission.presentationIndices[index]!);
    if (
      frame === undefined ||
      frame.timestamp !== first.timestamp + index * first.duration
    ) {
      throw new RangeError(
        "multi-frame chunk cannot be represented by the global presentation clock"
      );
    }
  }
  return Object.freeze({ timestamp: first.timestamp, duration: first.duration });
}

function validateCopiedChunk(
  data: ArrayBuffer,
  chunk: Readonly<RuntimeCatalogChunk>,
  buffers: ReadonlySet<ArrayBuffer>
): void {
  if (!(data instanceof ArrayBuffer)) {
    throw new RangeError("catalog chunk copy must be an ArrayBuffer");
  }
  if (data.byteLength !== chunk.range.length) {
    throw new RangeError("catalog chunk copy must have the exact record length");
  }
  if (buffers.has(data)) {
    throw new RangeError("every worker chunk must own a distinct ArrayBuffer");
  }
}

function requireDecodeIndex(
  values: ReadonlyMap<number, number>,
  unitFrame: number
): number {
  const value = values.get(unitFrame);
  if (value === undefined) {
    throw new RangeError("safe group is missing a displayed frame");
  }
  return value;
}

const NOOP_TRANSFER_LEASE: WorkerSampleTransferLease = Object.freeze({
  release(): void {}
});

function captureResourceHost(
  value: WorkerSampleResourceHost
): (byteLength: number) => WorkerSampleTransferLease {
  if (value === null || typeof value !== "object") {
    throw new TypeError("worker sample resource host is malformed");
  }
  const claim = Reflect.get(value, "claim");
  if (typeof claim !== "function") {
    throw new TypeError("worker sample resource host is malformed");
  }
  return (byteLength) => Reflect.apply(
    claim,
    value,
    [byteLength]
  ) as WorkerSampleTransferLease;
}

function captureTransferLease(
  value: WorkerSampleTransferLease
): WorkerSampleTransferLease {
  if (value === null || typeof value !== "object") {
    throw new TypeError("worker sample transfer lease is malformed");
  }
  const release = Reflect.get(value, "release");
  if (typeof release !== "function") {
    throw new TypeError("worker sample transfer lease is malformed");
  }
  let released = false;
  return Object.freeze({
    release(): void {
      if (released) return;
      released = true;
      Reflect.apply(release, value, []);
    }
  });
}

function checkedTransferSum(total: number, bytes: number): number {
  if (
    !Number.isSafeInteger(total) ||
    total < 0 ||
    !Number.isSafeInteger(bytes) ||
    bytes <= 0 ||
    total > Number.MAX_SAFE_INTEGER - bytes
  ) {
    throw new RangeError("worker sample transfer bytes exceed the safe range");
  }
  return total + bytes;
}

function checkedSubtract(left: number, right: number, label: string): number {
  if (
    !Number.isSafeInteger(left) ||
    !Number.isSafeInteger(right) ||
    left < right ||
    right < 0
  ) {
    throw new RangeError(`${label} is outside the safe range`);
  }
  return left - right;
}

function validateWorkerLimits(limits: DecoderWorkerLimits): void {
  validateBoundedPositiveInteger(
    limits.maxDecodeQueueSize,
    DECODER_WORKER_HARD_LIMITS.maxDecodeQueueSize,
    "worker decode queue limit"
  );
  validateBoundedPositiveInteger(
    limits.maxPendingSamples,
    DECODER_WORKER_HARD_LIMITS.maxPendingSamples,
    "worker pending sample limit"
  );
  validateBoundedPositiveInteger(
    limits.maxOutstandingFrames,
    DECODER_WORKER_HARD_LIMITS.maxOutstandingFrames,
    "worker outstanding frame limit"
  );
  validateBoundedPositiveInteger(
    limits.maxDecodedBytes,
    DECODER_WORKER_HARD_LIMITS.maxDecodedBytes,
    "worker decoded byte limit"
  );
}

function validateBatchEnvelope(input: CreateWorkerSampleBatchInput): void {
  if (!Array.isArray(input.frames) || input.frames.length < 1) {
    throw new RangeError("worker sample batch requires presentation frames");
  }
  validateNonNegativeSafeInteger(input.pendingSamples, "pending sample count");
  validateNonNegativeSafeInteger(
    input.outstandingFrames,
    "outstanding frame count"
  );
}

function validateBatchCredit(
  input: CreateWorkerSampleBatchInput,
  chunkCount: number,
  frameCount: number,
  limits: Readonly<DecoderWorkerLimits>
): void {
  const plan = planWorkerSampleGroupCredit(
    { chunkCount, frameCount },
    input,
    limits
  );
  if (plan.fits) return;
  if (
    input.pendingSamples > limits.maxPendingSamples ||
    chunkCount > limits.maxPendingSamples - input.pendingSamples
  ) {
    throw new RangeError("worker sample batch exceeds the pending sample limit");
  }
  if (
    input.outstandingFrames > limits.maxOutstandingFrames ||
    frameCount > limits.maxOutstandingFrames - input.outstandingFrames
  ) {
    throw new RangeError("worker sample batch exceeds the outstanding frame limit");
  }
  throw new RangeError("worker sample batch exceeds configured credit");
}

function validateFrameRequest(request: WorkerSampleFrameRequest): void {
  if (
    typeof request.unitId !== "string" ||
    request.unitId.length < 1 ||
    request.unitId.length > 128
  ) {
    throw new RangeError("worker sample unit ID length must be 1-128");
  }
  validateNonNegativeSafeInteger(request.unitFrame, "worker sample unit frame");
}

function validateBoundedPositiveInteger(
  value: number,
  maximum: number,
  label: string
): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(
      `${label} must be a positive integer no greater than ${String(maximum)}`
    );
  }
}

function validatePositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
}

function validateNonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a nonnegative safe integer`);
  }
}
