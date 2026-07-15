import {
  avcQuantizationPolicyForRendition,
  deriveAvcRenditionGeometry,
  isAvcCodec,
  maximumAvcDecodedRgbaBytes,
  validateCompleteAsset,
  type AccessUnitRecord,
  type AvcCodecV01,
  type RenditionV01,
  type UnitV01
} from "@pixel-point/aval-format";
import {
  createDecoderWorkerClient,
  durationForFrame,
  timestampForFrame,
  type DecoderWorkerMetrics,
  type DecoderWorkerSample,
  type ManagedDecoderWorkerFrame
} from "@pixel-point/aval-player-web";

const WARMUP_OUTPUTS = 24;
const MEASURED_OUTPUTS = 300;
const MAX_BATCH_FRAMES = 12;
const PROBE_TIMEOUT_MS = 30_000;
const GENERATION = 1;

type ProductionRendition = Extract<RenditionV01, {
  readonly profile:
    | "avc-annexb-opaque-v0"
    | "avc-annexb-packed-alpha-v0"
    | "avc-annexb-opaque-v1"
    | "avc-annexb-packed-alpha-v1";
}>;

interface PlannedOutput {
  readonly outputOrdinal: number;
  readonly mediaTimestampMicroseconds: number;
  readonly mediaDurationMicroseconds: number;
  readonly unitId: string;
  readonly unitInstance: number;
  readonly localFrame: number;
  readonly record: AccessUnitRecord;
}

export interface BrowserDecoderThroughputLedger {
  readonly schemaVersion: "1.0";
  readonly ledgerKind: "decoder-output-throughput";
  readonly candidateManifestDigest: string;
  readonly fixtureDigest: string;
  readonly selectedRendition: Readonly<{
    readonly id: string;
    readonly profile: ProductionRendition["profile"];
    readonly codec: AvcCodecV01;
    readonly codedWidth: number;
    readonly codedHeight: number;
    readonly frameRateNumerator: number;
    readonly frameRateDenominator: number;
  }>;
  readonly outputs: readonly Readonly<{
    readonly outputOrdinal: number;
    readonly phase: "warmup" | "measured";
    readonly mediaTimestampMicroseconds: number;
    readonly mediaDurationMicroseconds: number;
    readonly callbackMicroseconds: number;
    readonly renditionId: string;
    readonly unitId: string;
    readonly unitInstance: number;
    readonly localFrame: number;
  }>[];
  readonly events: readonly Readonly<{
    readonly eventOrdinal: number;
    readonly kind: "configure" | "output-callback" | "frame-close" | "reset" | "flush" | "reconfigure" | "underflow" | "error" | "terminal";
    readonly atMicroseconds: number;
    readonly outputOrdinal: number | null;
  }>[];
  readonly terminal: Readonly<{
    readonly decoderClosed: boolean;
    readonly configureCalls: number;
    readonly resetCalls: number;
    readonly flushCalls: number;
    readonly boundaryFlushCalls: number;
    readonly acceptedSamples: number;
    readonly submittedChunks: number;
    readonly outputFrames: number;
    readonly deliveredFrames: number;
    readonly releasedFrames: number;
    readonly staleFrames: number;
    readonly workerClosedFrames: number;
    readonly errors: number;
    readonly openFrames: number;
    readonly pendingFrames: number;
    readonly decodeQueueSize: number;
  }>;
}

export interface DecoderThroughputProbeResult {
  readonly status: "collected" | "failed";
  readonly ledger: BrowserDecoderThroughputLedger;
  readonly failure: string | null;
}

/**
 * Measures the selected production rendition through the packaged module
 * worker, transfer, and release protocol. Callback time is captured inside
 * DecoderWorkerCore at VideoDecoder output entry, before transfer to main.
 */
export async function runDecoderThroughputProbe(input: Readonly<{
  readonly assetBytes: Uint8Array;
  readonly selectedRenditionId: string;
  readonly candidateManifestDigest: string;
  readonly fixtureDigest: string;
  readonly requireForeground: boolean;
  readonly signal?: AbortSignal;
}>): Promise<DecoderThroughputProbeResult> {
  const { frontIndex } = validateCompleteAsset({ bytes: input.assetBytes });
  const rendition = requireProductionRendition(frontIndex.manifest.renditions, input.selectedRenditionId);
  const renditionIndex = frontIndex.manifest.renditions.indexOf(rendition);
  const unitIndex = frontIndex.manifest.units.findIndex((unit) => unit.kind === "body" && unit.playback === "loop");
  const unit = frontIndex.manifest.units[unitIndex];
  if (unit?.kind !== "body" || unit.playback !== "loop") throw new Error("throughput probe requires a looping production unit");
  const records = selectedRecords(frontIndex.records, unit, unitIndex, renditionIndex);
  const frameRate = frontIndex.manifest.frameRate;
  const plan = createPlan(records, unit, frameRate);
  const geometry = (
    rendition.profile === "avc-annexb-packed-alpha-v0" ||
    rendition.profile === "avc-annexb-packed-alpha-v1"
  )
    ? deriveAvcRenditionGeometry({
        canvasWidth: frontIndex.manifest.canvas.width,
        canvasHeight: frontIndex.manifest.canvas.height,
        profile: rendition.profile,
        codedWidth: rendition.codedWidth,
        codedHeight: rendition.codedHeight,
        colorRect: rendition.alphaLayout.colorRect,
        alphaRect: rendition.alphaLayout.alphaRect
      })
    : deriveAvcRenditionGeometry({
        canvasWidth: frontIndex.manifest.canvas.width,
        canvasHeight: frontIndex.manifest.canvas.height,
        profile: rendition.profile,
        codedWidth: rendition.codedWidth,
        codedHeight: rendition.codedHeight,
        colorRect: rendition.alphaLayout.colorRect
      });
  const storage = geometry.decodedStorageRect;
  const decodedSurfaceBytes = maximumAvcDecodedRgbaBytes(rendition.codedWidth, rendition.codedHeight);
  const client = createDecoderWorkerClient({
    workerName: "m9-exact-candidate-throughput",
    requestTimeoutMs: PROBE_TIMEOUT_MS,
    disposeTimeoutMs: 5_000
  });
  const outputs: BrowserDecoderThroughputLedger["outputs"][number][] = [];
  const events: BrowserDecoderThroughputLedger["events"][number][] = [];
  let terminalMetrics: DecoderWorkerMetrics | null = null;
  let decoderClosed = false;
  let failure: string | null = null;

  try {
    assertMeasurementActive(input);
    await client.configure({
      config: {
        codec: rendition.codec,
        codedWidth: rendition.codedWidth,
        codedHeight: rendition.codedHeight,
        hardwareAcceleration: "no-preference",
        optimizeForLatency: true
      },
      avcProfile: {
        codedWidth: rendition.codedWidth,
        codedHeight: rendition.codedHeight,
        frameRate,
        averageBitrate: rendition.bitrate.average,
        peakBitrate: rendition.bitrate.peak,
        cpbBufferBits: rendition.bitrate.peak,
        requireBt709LimitedRange: true,
        quantizationPolicy: avcQuantizationPolicyForRendition(rendition.profile)
      },
      expectedOutput: {
        codedWidth: rendition.codedWidth,
        codedHeight: rendition.codedHeight,
        displayWidth: storage[2],
        displayHeight: storage[3],
        visibleRect: { x: storage[0], y: storage[1], width: storage[2], height: storage[3] },
        colorSpace: { fullRange: false, matrix: "bt709", primaries: "bt709", transfer: "bt709" }
      },
      limits: {
        maxDecodeQueueSize: 8,
        maxPendingSamples: MAX_BATCH_FRAMES,
        maxOutstandingFrames: MAX_BATCH_FRAMES,
        maxDecodedBytes: decodedSurfaceBytes * MAX_BATCH_FRAMES
      }
    });
    appendEvent(events, "configure", hostClockMicroseconds(), null);
    await client.activateGeneration(GENERATION);

    for (let start = 0; start < plan.length; start += MAX_BATCH_FRAMES) {
      assertMeasurementActive(input);
      const batch = plan.slice(start, start + MAX_BATCH_FRAMES);
      await client.submit(GENERATION, batch.map((entry) => sample(entry, unit, input.assetBytes)));
      await client.waitForFrames(batch.length, { timeoutMs: PROBE_TIMEOUT_MS, ...(input.signal === undefined ? {} : { signal: input.signal }) });
      const transferred: { readonly managed: ManagedDecoderWorkerFrame; readonly expected: PlannedOutput }[] = [];
      for (const expected of batch) {
        const managed = client.takeFrame();
        if (managed === undefined) throw new Error(`decoder output ${String(expected.outputOrdinal)} was not transferred`);
        recordOutputCallback(managed, expected, rendition, outputs, events);
        transferred.push({ managed, expected });
      }
      // All worker callbacks occurred before waitForFrames settled. Preserve
      // that callback order in the raw event ledger, then record main-thread
      // close/release operations as their later, separate phase.
      for (const { managed, expected } of transferred) {
        managed.close();
        appendEvent(events, "frame-close", hostClockMicroseconds(), expected.outputOrdinal);
      }
    }
    terminalMetrics = await awaitTerminalMetrics(client, input);
    assertTerminalMetrics(terminalMetrics, plan.length, client.openFrames);
  } catch (error) {
    failure = normalizeError(error).message.slice(0, 500);
    appendEvent(events, "error", hostClockMicroseconds(), null);
    terminalMetrics = await client.snapshotMetrics().catch(() => null);
  } finally {
    for (let frame = client.takeFrame(); frame !== undefined; frame = client.takeFrame()) {
      const ordinal = frame.ordinal;
      frame.close();
      appendEvent(events, "frame-close", hostClockMicroseconds(), ordinal);
    }
    try {
      await client.dispose();
      decoderClosed = true;
    } catch (error) {
      failure ??= normalizeError(error).message.slice(0, 500);
      appendEvent(events, "error", hostClockMicroseconds(), null);
    }
    appendEvent(events, "terminal", hostClockMicroseconds(), null);
  }

  const ledger: BrowserDecoderThroughputLedger = Object.freeze({
    schemaVersion: "1.0",
    ledgerKind: "decoder-output-throughput",
    candidateManifestDigest: input.candidateManifestDigest,
    fixtureDigest: input.fixtureDigest,
    selectedRendition: Object.freeze({
      id: rendition.id,
      profile: rendition.profile,
      codec: rendition.codec,
      codedWidth: rendition.codedWidth,
      codedHeight: rendition.codedHeight,
      frameRateNumerator: frameRate.numerator,
      frameRateDenominator: frameRate.denominator
    }),
    outputs: Object.freeze(outputs),
    events: Object.freeze(events),
    terminal: Object.freeze({
      decoderClosed,
      configureCalls: terminalMetrics?.configureCalls ?? 0,
      resetCalls: terminalMetrics?.resetCalls ?? 0,
      flushCalls: terminalMetrics?.flushCalls ?? 0,
      boundaryFlushCalls: terminalMetrics?.boundaryFlushCalls ?? 0,
      acceptedSamples: terminalMetrics?.acceptedSamples ?? 0,
      submittedChunks: terminalMetrics?.submittedChunks ?? 0,
      outputFrames: terminalMetrics?.outputFrames ?? 0,
      deliveredFrames: terminalMetrics?.deliveredFrames ?? 0,
      releasedFrames: terminalMetrics?.releasedFrames ?? 0,
      staleFrames: terminalMetrics?.staleFrames ?? 0,
      workerClosedFrames: terminalMetrics?.closedFrames ?? 0,
      errors: terminalMetrics?.errors ?? 0,
      openFrames: client.openFrames,
      pendingFrames: terminalMetrics === null ? client.openFrames : terminalMetrics.pendingSamples + terminalMetrics.submittedFrames + terminalMetrics.leasedFrames,
      decodeQueueSize: terminalMetrics?.decodeQueueSize ?? 0
    })
  });
  return Object.freeze({ status: failure === null ? "collected" : "failed", ledger, failure });
}

function recordOutputCallback(
  managed: ManagedDecoderWorkerFrame,
  expected: PlannedOutput,
  rendition: ProductionRendition,
  outputs: BrowserDecoderThroughputLedger["outputs"][number][],
  events: BrowserDecoderThroughputLedger["events"][number][]
): void {
  const callbackMicroseconds = managed.outputCallbackMicroseconds;
  if (!Number.isSafeInteger(callbackMicroseconds) || (callbackMicroseconds ?? -1) < 0) throw new Error("decoder worker omitted its output callback clock");
  if (
    managed.ordinal !== expected.outputOrdinal || managed.generation !== GENERATION ||
    managed.unitId !== expected.unitId || managed.unitInstance !== expected.unitInstance || managed.unitFrame !== expected.localFrame ||
    managed.timestamp !== expected.mediaTimestampMicroseconds || managed.duration !== expected.mediaDurationMicroseconds
  ) throw new Error(`decoder output identity mismatch at ${String(expected.outputOrdinal)}`);
  // DecoderWorkerCore emitted this frame only after strict native timestamp,
  // duration, crop, geometry, color, output-order, and byte-budget validation.
  appendEvent(events, "output-callback", callbackMicroseconds as number, expected.outputOrdinal);
  outputs.push(Object.freeze({
    outputOrdinal: expected.outputOrdinal,
    phase: expected.outputOrdinal < WARMUP_OUTPUTS ? "warmup" : "measured",
    mediaTimestampMicroseconds: expected.mediaTimestampMicroseconds,
    mediaDurationMicroseconds: expected.mediaDurationMicroseconds,
    callbackMicroseconds: callbackMicroseconds as number,
    renditionId: rendition.id,
    unitId: expected.unitId,
    unitInstance: expected.unitInstance,
    localFrame: expected.localFrame
  }));
}

async function awaitTerminalMetrics(
  client: ReturnType<typeof createDecoderWorkerClient>,
  input: Readonly<{ requireForeground: boolean; signal?: AbortSignal }>
): Promise<DecoderWorkerMetrics> {
  const deadline = performance.now() + PROBE_TIMEOUT_MS;
  for (;;) {
    assertMeasurementActive(input);
    const metrics = await client.snapshotMetrics();
    if (metrics.pendingSamples === 0 && metrics.submittedFrames === 0 && metrics.leasedFrames === 0 && metrics.decodeQueueSize === 0 && client.openFrames === 0) return metrics;
    if (performance.now() >= deadline) throw new Error("decoder throughput terminal-settlement watchdog expired");
    await abortableDelay(10, input.signal);
  }
}

function assertTerminalMetrics(metrics: DecoderWorkerMetrics, expectedFrames: number, openFrames: number): void {
  if (
    metrics.configureCalls !== 1 || metrics.resetCalls !== 0 || metrics.flushCalls !== 0 || metrics.boundaryFlushCalls !== 0 ||
    metrics.acceptedSamples !== expectedFrames || metrics.submittedChunks !== expectedFrames || metrics.outputFrames !== expectedFrames ||
    metrics.deliveredFrames !== expectedFrames || metrics.releasedFrames !== expectedFrames || metrics.staleFrames !== 0 ||
    metrics.closedFrames !== 0 || metrics.pendingSamples !== 0 || metrics.submittedFrames !== 0 || metrics.leasedFrames !== 0 ||
    metrics.leasedDecodedBytes !== 0 || metrics.decodeQueueSize !== 0 || metrics.errors !== 0 || openFrames !== 0
  ) throw new Error("decoder throughput worker counters did not settle exactly");
}

function requireProductionRendition(renditions: readonly RenditionV01[], id: string): ProductionRendition {
  const rendition = renditions.find((candidate) => candidate.id === id);
  if (
    rendition === undefined ||
    (
      rendition.profile !== "avc-annexb-opaque-v0" &&
      rendition.profile !== "avc-annexb-packed-alpha-v0" &&
      rendition.profile !== "avc-annexb-opaque-v1" &&
      rendition.profile !== "avc-annexb-packed-alpha-v1"
    ) ||
    !isAvcCodec(rendition.codec)
  ) {
    throw new Error("public player selected an invalid production rendition");
  }
  return rendition;
}

function selectedRecords(records: readonly AccessUnitRecord[], unit: UnitV01, unitIndex: number, renditionIndex: number): readonly AccessUnitRecord[] {
  if (renditionIndex < 0) throw new Error("selected production rendition is absent");
  const selected = records.filter((record) => record.unitIndex === unitIndex && record.renditionIndex === renditionIndex);
  if (selected.length !== unit.frameCount || selected[0]?.key !== true) throw new Error("selected throughput unit has an incomplete independently keyed stream");
  for (let index = 0; index < selected.length; index += 1) if (selected[index]?.frameIndex !== index) throw new Error("selected throughput unit is not canonical");
  return selected;
}

function createPlan(records: readonly AccessUnitRecord[], unit: UnitV01, frameRate: Readonly<{ numerator: number; denominator: number }>): readonly PlannedOutput[] {
  return Object.freeze(Array.from({ length: WARMUP_OUTPUTS + MEASURED_OUTPUTS }, (_, outputOrdinal): PlannedOutput => {
    const localFrame = outputOrdinal % records.length;
    const record = records[localFrame];
    if (record === undefined) throw new Error("throughput access-unit record is absent");
    return Object.freeze({
      outputOrdinal,
      mediaTimestampMicroseconds: timestampForFrame(outputOrdinal, frameRate),
      mediaDurationMicroseconds: durationForFrame(outputOrdinal, frameRate),
      unitId: unit.id,
      unitInstance: Math.floor(outputOrdinal / records.length),
      localFrame,
      record
    });
  }));
}

function sample(entry: PlannedOutput, unit: UnitV01, bytes: Uint8Array): DecoderWorkerSample {
  return {
    ordinal: entry.outputOrdinal,
    unitId: entry.unitId,
    unitInstance: entry.unitInstance,
    unitFrame: entry.localFrame,
    unitFrameCount: unit.frameCount,
    type: entry.record.key ? "key" : "delta",
    timestamp: entry.mediaTimestampMicroseconds,
    duration: entry.mediaDurationMicroseconds,
    data: bytes.slice(entry.record.payloadOffset, entry.record.payloadOffset + entry.record.payloadLength).buffer
  };
}

function appendEvent(events: BrowserDecoderThroughputLedger["events"][number][], kind: BrowserDecoderThroughputLedger["events"][number]["kind"], atMicroseconds: number, outputOrdinal: number | null): void {
  events.push(Object.freeze({ eventOrdinal: events.length, kind, atMicroseconds, outputOrdinal }));
}

function assertMeasurementActive(input: Readonly<{ requireForeground: boolean; signal?: AbortSignal }>): void {
  if (input.signal?.aborted === true) throw input.signal.reason instanceof Error ? input.signal.reason : new DOMException("throughput probe aborted", "AbortError");
  if (input.requireForeground && (document.visibilityState !== "visible" || !document.hasFocus())) throw new Error("decoder throughput probe was interrupted by visibility or focus loss");
}

function hostClockMicroseconds(): number {
  const value = Math.floor(performance.timeOrigin * 1_000 + performance.now() * 1_000);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("host clock is invalid");
  return value;
}

function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timeout = window.setTimeout(done, milliseconds);
    const abort = (): void => done();
    signal?.addEventListener("abort", abort, { once: true });
    function done(): void { window.clearTimeout(timeout); signal?.removeEventListener("abort", abort); resolve(); }
  });
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error("unknown decoder throughput failure");
}
