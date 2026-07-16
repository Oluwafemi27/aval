import {
  isVideoCodecString,
  PACKED_ALPHA_GUTTER,
  VIDEO_CODECS,
  type AlphaLayout,
  type Rect,
  type VideoBitDepth,
  type VideoCodec
} from "@pixel-point/aval-format";

import { SHA256_PATTERN } from "./model.js";

export interface DecoderThroughputOutput {
  readonly outputOrdinal: number;
  readonly phase: "warmup" | "measured";
  readonly mediaTimestampMicroseconds: number;
  readonly mediaDurationMicroseconds: number;
  readonly callbackMicroseconds: number;
  readonly renditionId: string;
  readonly unitId: string;
  readonly unitInstance: number;
  readonly localFrame: number;
}

export interface DecoderThroughputEvent {
  readonly eventOrdinal: number;
  readonly kind: "configure" | "output-callback" | "frame-close" | "reset" | "flush" | "reconfigure" | "underflow" | "error" | "terminal";
  readonly atMicroseconds: number;
  readonly outputOrdinal: number | null;
}

export interface DecoderThroughputLedger {
  readonly schemaVersion: "1.0";
  readonly ledgerKind: "decoder-output-throughput";
  readonly candidateManifestDigest: string;
  readonly fixtureDigest: string;
  readonly selectedRendition: Readonly<{
    readonly id: string;
    readonly codecFamily: VideoCodec;
    readonly codec: string;
    readonly bitDepth: VideoBitDepth;
    readonly codedWidth: number;
    readonly codedHeight: number;
    readonly alphaLayout: AlphaLayout;
    readonly frameRateNumerator: number;
    readonly frameRateDenominator: number;
  }>;
  readonly outputs: readonly DecoderThroughputOutput[];
  readonly events: readonly DecoderThroughputEvent[];
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

export interface DecoderThroughputEvaluation {
  readonly passed: boolean;
  readonly warmupOutputs: number;
  readonly measuredOutputs: number;
  readonly elapsedMicroseconds: number;
  readonly mediaDurationMicroseconds: number;
  readonly ratioMillionths: number;
  readonly counters: Readonly<{
    readonly configure: number;
    readonly reset: number;
    readonly flush: number;
    readonly reconfigure: number;
    readonly underflow: number;
    readonly errors: number;
    readonly outputCallbacks: number;
    readonly closedFrames: number;
  }>;
  readonly failures: readonly string[];
}

const IDENTIFIER = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/u;
const EXACT_KEYS = Object.freeze({
  root: ["schemaVersion", "ledgerKind", "candidateManifestDigest", "fixtureDigest", "selectedRendition", "outputs", "events", "terminal"],
  rendition: ["id", "codecFamily", "codec", "bitDepth", "codedWidth", "codedHeight", "alphaLayout", "frameRateNumerator", "frameRateDenominator"],
  output: ["outputOrdinal", "phase", "mediaTimestampMicroseconds", "mediaDurationMicroseconds", "callbackMicroseconds", "renditionId", "unitId", "unitInstance", "localFrame"],
  event: ["eventOrdinal", "kind", "atMicroseconds", "outputOrdinal"],
  terminal: ["decoderClosed", "configureCalls", "resetCalls", "flushCalls", "boundaryFlushCalls", "acceptedSamples", "submittedChunks", "outputFrames", "deliveredFrames", "releasedFrames", "staleFrames", "workerClosedFrames", "errors", "openFrames", "pendingFrames", "decodeQueueSize"]
} as const);

/** Parse raw decoder callback evidence and recompute the 1.5x claim. */
export function evaluateDecoderThroughputLedger(input: unknown, expected?: Readonly<{
  readonly candidateManifestDigest?: string;
  readonly fixtureDigest?: string;
  readonly selectedRendition?: DecoderThroughputLedger["selectedRendition"];
}>): Readonly<{
  ledger: DecoderThroughputLedger;
  evaluation: DecoderThroughputEvaluation;
}> {
  const root = exactRecord(input, EXACT_KEYS.root, "$throughput");
  literal(root.schemaVersion, "1.0", "$throughput.schemaVersion");
  literal(root.ledgerKind, "decoder-output-throughput", "$throughput.ledgerKind");
  const candidateManifestDigest = digest(root.candidateManifestDigest, "$throughput.candidateManifestDigest");
  const fixtureDigest = digest(root.fixtureDigest, "$throughput.fixtureDigest");
  const renditionInput = exactRecord(root.selectedRendition, EXACT_KEYS.rendition, "$throughput.selectedRendition");
  const codecFamily = enumeration(
    renditionInput.codecFamily,
    VIDEO_CODECS,
    "$throughput.selectedRendition.codecFamily"
  );
  const bitDepth = supportedBitDepth(
    renditionInput.bitDepth,
    codecFamily,
    "$throughput.selectedRendition.bitDepth"
  );
  const codec = supportedVideoCodec(
    renditionInput.codec,
    codecFamily,
    bitDepth,
    "$throughput.selectedRendition.codec"
  );
  const codedWidth = positiveInteger(renditionInput.codedWidth, "$throughput.selectedRendition.codedWidth");
  const codedHeight = positiveInteger(renditionInput.codedHeight, "$throughput.selectedRendition.codedHeight");
  if (codedWidth % 2 !== 0 || codedHeight % 2 !== 0) {
    throw new TypeError("$throughput.selectedRendition coded dimensions must be even");
  }
  const selectedRendition = Object.freeze({
    id: identifier(renditionInput.id, "$throughput.selectedRendition.id"),
    codecFamily,
    codec,
    bitDepth,
    codedWidth,
    codedHeight,
    alphaLayout: supportedAlphaLayout(
      renditionInput.alphaLayout,
      codedWidth,
      codedHeight,
      "$throughput.selectedRendition.alphaLayout"
    ),
    frameRateNumerator: positiveInteger(renditionInput.frameRateNumerator, "$throughput.selectedRendition.frameRateNumerator"),
    frameRateDenominator: positiveInteger(renditionInput.frameRateDenominator, "$throughput.selectedRendition.frameRateDenominator")
  });
  if (!Array.isArray(root.outputs) || root.outputs.length > 100_000) {
    throw new TypeError("$throughput.outputs must be an array of at most 100000 entries");
  }
  const outputs = root.outputs.map((value, index): DecoderThroughputOutput => {
    const path = `$throughput.outputs[${String(index)}]`;
    const output = exactRecord(value, EXACT_KEYS.output, path);
    return Object.freeze({
      outputOrdinal: nonnegativeInteger(output.outputOrdinal, `${path}.outputOrdinal`),
      phase: enumeration(output.phase, ["warmup", "measured"] as const, `${path}.phase`),
      mediaTimestampMicroseconds: nonnegativeInteger(output.mediaTimestampMicroseconds, `${path}.mediaTimestampMicroseconds`),
      mediaDurationMicroseconds: positiveInteger(output.mediaDurationMicroseconds, `${path}.mediaDurationMicroseconds`),
      callbackMicroseconds: nonnegativeInteger(output.callbackMicroseconds, `${path}.callbackMicroseconds`),
      renditionId: identifier(output.renditionId, `${path}.renditionId`),
      unitId: identifier(output.unitId, `${path}.unitId`),
      unitInstance: nonnegativeInteger(output.unitInstance, `${path}.unitInstance`),
      localFrame: nonnegativeInteger(output.localFrame, `${path}.localFrame`)
    });
  });
  if (!Array.isArray(root.events) || root.events.length > 300_000) throw new TypeError("$throughput.events must be an array of at most 300000 entries");
  const eventKinds = ["configure", "output-callback", "frame-close", "reset", "flush", "reconfigure", "underflow", "error", "terminal"] as const;
  const events = root.events.map((value, index): DecoderThroughputEvent => {
    const path = `$throughput.events[${String(index)}]`;
    const event = exactRecord(value, EXACT_KEYS.event, path);
    return Object.freeze({
      eventOrdinal: nonnegativeInteger(event.eventOrdinal, `${path}.eventOrdinal`),
      kind: enumeration(event.kind, eventKinds, `${path}.kind`),
      atMicroseconds: nonnegativeInteger(event.atMicroseconds, `${path}.atMicroseconds`),
      outputOrdinal: event.outputOrdinal === null ? null : nonnegativeInteger(event.outputOrdinal, `${path}.outputOrdinal`)
    });
  });
  const terminalInput = exactRecord(root.terminal, EXACT_KEYS.terminal, "$throughput.terminal");
  if (typeof terminalInput.decoderClosed !== "boolean") throw new TypeError("$throughput.terminal.decoderClosed must be boolean");
  const terminal = Object.freeze({
    decoderClosed: terminalInput.decoderClosed,
    configureCalls: nonnegativeInteger(terminalInput.configureCalls, "$throughput.terminal.configureCalls"),
    resetCalls: nonnegativeInteger(terminalInput.resetCalls, "$throughput.terminal.resetCalls"),
    flushCalls: nonnegativeInteger(terminalInput.flushCalls, "$throughput.terminal.flushCalls"),
    boundaryFlushCalls: nonnegativeInteger(terminalInput.boundaryFlushCalls, "$throughput.terminal.boundaryFlushCalls"),
    acceptedSamples: nonnegativeInteger(terminalInput.acceptedSamples, "$throughput.terminal.acceptedSamples"),
    submittedChunks: nonnegativeInteger(terminalInput.submittedChunks, "$throughput.terminal.submittedChunks"),
    outputFrames: nonnegativeInteger(terminalInput.outputFrames, "$throughput.terminal.outputFrames"),
    deliveredFrames: nonnegativeInteger(terminalInput.deliveredFrames, "$throughput.terminal.deliveredFrames"),
    releasedFrames: nonnegativeInteger(terminalInput.releasedFrames, "$throughput.terminal.releasedFrames"),
    staleFrames: nonnegativeInteger(terminalInput.staleFrames, "$throughput.terminal.staleFrames"),
    workerClosedFrames: nonnegativeInteger(terminalInput.workerClosedFrames, "$throughput.terminal.workerClosedFrames"),
    errors: nonnegativeInteger(terminalInput.errors, "$throughput.terminal.errors"),
    openFrames: nonnegativeInteger(terminalInput.openFrames, "$throughput.terminal.openFrames"),
    pendingFrames: nonnegativeInteger(terminalInput.pendingFrames, "$throughput.terminal.pendingFrames"),
    decodeQueueSize: nonnegativeInteger(terminalInput.decodeQueueSize, "$throughput.terminal.decodeQueueSize")
  });
  const ledger: DecoderThroughputLedger = Object.freeze({
    schemaVersion: "1.0",
    ledgerKind: "decoder-output-throughput",
    candidateManifestDigest,
    fixtureDigest,
    selectedRendition,
    outputs: Object.freeze(outputs),
    events: Object.freeze(events),
    terminal
  });
  const evaluation = evaluateParsedLedger(ledger);
  const externalFailures = [...evaluation.failures];
  if (expected?.candidateManifestDigest !== undefined && ledger.candidateManifestDigest !== expected.candidateManifestDigest) externalFailures.push("candidate-manifest-digest-mismatch");
  if (expected?.fixtureDigest !== undefined && ledger.fixtureDigest !== expected.fixtureDigest) externalFailures.push("fixture-digest-mismatch");
  if (expected?.selectedRendition !== undefined && JSON.stringify(ledger.selectedRendition) !== JSON.stringify(expected.selectedRendition)) externalFailures.push("selected-rendition-mismatch");
  return Object.freeze({
    ledger,
    evaluation: externalFailures.length === evaluation.failures.length ? evaluation : Object.freeze({ ...evaluation, passed: false, failures: Object.freeze(externalFailures) })
  });
}

function evaluateParsedLedger(ledger: DecoderThroughputLedger): DecoderThroughputEvaluation {
  const failures: string[] = [];
  let measuredStarted = false;
  let warmupOutputs = 0;
  const measured: DecoderThroughputOutput[] = [];
  let prior: DecoderThroughputOutput | undefined;
  for (const output of ledger.outputs) {
    if (prior !== undefined) {
      if (output.outputOrdinal !== prior.outputOrdinal + 1) failures.push(`output-ordinal:${String(output.outputOrdinal)}`);
      if (output.mediaTimestampMicroseconds <= prior.mediaTimestampMicroseconds) failures.push(`media-clock:${String(output.outputOrdinal)}`);
      if (output.callbackMicroseconds < prior.callbackMicroseconds) failures.push(`callback-clock:${String(output.outputOrdinal)}`);
    }
    if (output.renditionId !== ledger.selectedRendition.id) failures.push(`rendition-identity:${String(output.outputOrdinal)}`);
    if (output.phase === "warmup") {
      if (measuredStarted) failures.push(`warmup-after-measurement:${String(output.outputOrdinal)}`);
      warmupOutputs += 1;
    } else {
      measuredStarted = true;
      measured.push(output);
    }
    prior = output;
  }
  if (ledger.outputs[0]?.outputOrdinal !== 0) failures.push("output-ordinal-origin");
  if (warmupOutputs < 24) failures.push("warmup-output-count-below-24");
  if (measured.length < 300) failures.push("throughput-sample-count-below-300");
  const counters = deriveEventCounters(ledger, failures);
  if (counters.configure !== 1) failures.push("configure-count-not-one");
  for (const name of ["reset", "flush", "reconfigure", "underflow", "errors"] as const) {
    if (counters[name] !== 0) failures.push(`forbidden-counter:${name}:${String(counters[name])}`);
  }
  if (counters.outputCallbacks !== ledger.outputs.length) failures.push("output-callback-count-mismatch");
  if (counters.closedFrames !== ledger.outputs.length) failures.push("closed-frame-count-mismatch");
  if (!ledger.terminal.decoderClosed) failures.push("decoder-not-closed");
  if (ledger.terminal.configureCalls !== counters.configure) failures.push("terminal-configure-count-mismatch");
  if (ledger.terminal.resetCalls !== counters.reset) failures.push("terminal-reset-count-mismatch");
  if (ledger.terminal.flushCalls !== counters.flush) failures.push("terminal-flush-count-mismatch");
  if (ledger.terminal.boundaryFlushCalls !== 0) failures.push("terminal-boundary-flush");
  if (ledger.terminal.acceptedSamples !== ledger.terminal.submittedChunks) failures.push("terminal-accepted-sample-count-mismatch");
  for (const name of ["outputFrames", "deliveredFrames", "releasedFrames"] as const) {
    if (ledger.terminal[name] !== ledger.outputs.length) failures.push(`terminal-output-count:${name}`);
  }
  if (ledger.terminal.staleFrames !== 0) failures.push("terminal-stale-frames");
  if (ledger.terminal.workerClosedFrames !== 0) failures.push("terminal-worker-closed-frames");
  if (ledger.terminal.errors !== counters.errors) failures.push("terminal-error-count-mismatch");
  if (ledger.terminal.openFrames !== 0) failures.push("terminal-open-frames");
  if (ledger.terminal.pendingFrames !== 0) failures.push(`terminal-pending-frames:${String(ledger.terminal.pendingFrames)}`);
  if (ledger.terminal.decodeQueueSize !== 0) failures.push(`terminal-decode-queue:${String(ledger.terminal.decodeQueueSize)}`);
  const first = measured[0];
  const last = measured.at(-1);
  const elapsedMicroseconds = first === undefined || last === undefined ? 0 : last.callbackMicroseconds - first.callbackMicroseconds;
  // Compare N-1 media intervals with the same first-to-last callback window.
  // Including the last frame duration would bias short ledgers upward.
  const mediaDurationMicroseconds = first === undefined || last === undefined ? 0 : last.mediaTimestampMicroseconds - first.mediaTimestampMicroseconds;
  if (measured.length >= 2 && elapsedMicroseconds <= 0) failures.push("measured-elapsed-time-not-positive");
  const ratioMillionths = elapsedMicroseconds <= 0 ? 0 : Math.floor(mediaDurationMicroseconds * 1_000_000 / elapsedMicroseconds);
  if (ratioMillionths < 1_500_000) failures.push("throughput-below-1.5x");
  return Object.freeze({
    passed: failures.length === 0,
    warmupOutputs,
    measuredOutputs: measured.length,
    elapsedMicroseconds,
    mediaDurationMicroseconds,
    ratioMillionths,
    counters,
    failures: Object.freeze(failures)
  });
}

function deriveEventCounters(
  ledger: DecoderThroughputLedger,
  failures: string[]
): DecoderThroughputEvaluation["counters"] {
  const counts = { configure: 0, reset: 0, flush: 0, reconfigure: 0, underflow: 0, errors: 0, outputCallbacks: 0, closedFrames: 0 };
  const callbackEvents = new Map<number, DecoderThroughputEvent>();
  const closeEvents = new Map<number, DecoderThroughputEvent>();
  let prior: DecoderThroughputEvent | undefined;
  for (const event of ledger.events) {
    if (prior !== undefined) {
      if (event.eventOrdinal !== prior.eventOrdinal + 1) failures.push(`event-ordinal:${String(event.eventOrdinal)}`);
      if (event.atMicroseconds < prior.atMicroseconds) failures.push(`event-clock:${String(event.eventOrdinal)}`);
    }
    if (event.kind === "configure") counts.configure += 1;
    else if (event.kind === "reset") counts.reset += 1;
    else if (event.kind === "flush") counts.flush += 1;
    else if (event.kind === "reconfigure") counts.reconfigure += 1;
    else if (event.kind === "underflow") counts.underflow += 1;
    else if (event.kind === "error") counts.errors += 1;
    else if (event.kind === "output-callback" || event.kind === "frame-close") {
      if (event.outputOrdinal === null) failures.push(`${event.kind}-missing-output-ordinal`);
      else {
        const target = event.kind === "output-callback" ? callbackEvents : closeEvents;
        if (target.has(event.outputOrdinal)) failures.push(`${event.kind}-duplicate:${String(event.outputOrdinal)}`);
        target.set(event.outputOrdinal, event);
      }
      if (event.kind === "output-callback") counts.outputCallbacks += 1;
      else counts.closedFrames += 1;
    } else if (event.outputOrdinal !== null) failures.push(`${event.kind}-unexpected-output-ordinal`);
    prior = event;
  }
  if (ledger.events[0]?.eventOrdinal !== 0) failures.push("event-ordinal-origin");
  if (ledger.events.at(-1)?.kind !== "terminal") failures.push("terminal-event-missing");
  for (const output of ledger.outputs) {
    const callback = callbackEvents.get(output.outputOrdinal);
    const close = closeEvents.get(output.outputOrdinal);
    if (callback === undefined || callback.atMicroseconds !== output.callbackMicroseconds) failures.push(`output-callback-binding:${String(output.outputOrdinal)}`);
    if (close === undefined || (callback !== undefined && close.eventOrdinal <= callback.eventOrdinal)) failures.push(`frame-close-binding:${String(output.outputOrdinal)}`);
  }
  return Object.freeze(counts);
}

function exactRecord(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${path} must be an object`);
  const record = value as Record<string, unknown>;
  const expected = new Set(keys);
  for (const key of Object.keys(record)) if (!expected.has(key)) throw new TypeError(`${path}.${key} is an unknown field`);
  for (const key of keys) if (!(key in record)) throw new TypeError(`${path}.${key} is required`);
  return record;
}

function literal<const T extends string | number | boolean>(value: unknown, expected: T, path: string): asserts value is T {
  if (value !== expected) throw new TypeError(`${path} must be ${String(expected)}`);
}

function enumeration<const T extends readonly string[]>(value: unknown, values: T, path: string): T[number] {
  if (typeof value !== "string" || !values.includes(value)) throw new TypeError(`${path} is invalid`);
  return value as T[number];
}

function supportedBitDepth(
  value: unknown,
  family: VideoCodec,
  path: string
): VideoBitDepth {
  if (value !== 8 && value !== 10) {
    throw new TypeError(`${path} must be 8 or 10`);
  }
  if (family !== "av1" && value !== 8) {
    throw new TypeError(`${path} must be 8 for ${family}`);
  }
  return value;
}

function supportedVideoCodec(
  value: unknown,
  family: VideoCodec,
  bitDepth: VideoBitDepth,
  path: string
): string {
  if (!isVideoCodecString(value, family, bitDepth)) {
    throw new TypeError(`${path} must be a canonical ${family} codec string matching bit depth`);
  }
  return value;
}

function supportedAlphaLayout(
  value: unknown,
  codedWidth: number,
  codedHeight: number,
  path: string
): AlphaLayout {
  const input = exactRecord(
    value,
    value !== null && typeof value === "object" && !Array.isArray(value) &&
      (value as Record<string, unknown>).type === "stacked"
      ? ["type", "colorRect", "alphaRect"]
      : ["type", "colorRect"],
    path
  );
  const type = enumeration(input.type, ["opaque", "stacked"] as const, `${path}.type`);
  const colorRect = supportedRect(input.colorRect, codedWidth, codedHeight, `${path}.colorRect`);
  if (colorRect[0] !== 0 || colorRect[1] !== 0) {
    throw new TypeError(`${path}.colorRect must begin at the decoded surface origin`);
  }
  if (type === "opaque") return Object.freeze({ type, colorRect });
  const alphaRect = supportedRect(input.alphaRect, codedWidth, codedHeight, `${path}.alphaRect`);
  const paneHeight = colorRect[3] % 2 === 0 ? colorRect[3] : colorRect[3] + 1;
  if (
    alphaRect[0] !== 0 ||
    alphaRect[1] !== paneHeight + PACKED_ALPHA_GUTTER ||
    alphaRect[2] !== colorRect[2] ||
    alphaRect[3] !== colorRect[3]
  ) {
    throw new TypeError(`${path}.alphaRect must be the matching pane after the fixed gutter`);
  }
  return Object.freeze({ type, colorRect, alphaRect });
}

function supportedRect(
  value: unknown,
  codedWidth: number,
  codedHeight: number,
  path: string
): Rect {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new TypeError(`${path} must be a four-number rectangle`);
  }
  const x = nonnegativeInteger(value[0], `${path}[0]`);
  const y = nonnegativeInteger(value[1], `${path}[1]`);
  const width = positiveInteger(value[2], `${path}[2]`);
  const height = positiveInteger(value[3], `${path}[3]`);
  if (x > codedWidth - width || y > codedHeight - height) {
    throw new TypeError(`${path} must fit inside the coded surface`);
  }
  return Object.freeze([x, y, width, height]);
}

function identifier(value: unknown, path: string): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) throw new TypeError(`${path} is invalid`);
  return value;
}

function digest(value: unknown, path: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) throw new TypeError(`${path} is invalid`);
  return value;
}

function nonnegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new RangeError(`${path} must be a nonnegative safe integer`);
  return value as number;
}

function positiveInteger(value: unknown, path: string): number {
  const checked = nonnegativeInteger(value, path);
  if (checked === 0) throw new RangeError(`${path} must be positive`);
  return checked;
}
