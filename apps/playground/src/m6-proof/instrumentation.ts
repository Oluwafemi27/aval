import type { GraphPresentation } from "@rendered-motion/graph";
import type {
  BrowserDecodedStaticSurface,
  BrowserStaticSurfaceDecoder,
  BrowserStaticSurfaceDecoderSnapshot,
  IntegratedCandidateAttempt,
  IntegratedCandidateFactory,
  IntegratedPlaybackSession,
  OwnedDecoderWorkerPort,
  RuntimeMediaPresentation,
  StaticSurfaceDecodeOptions,
  StaticSurfaceDecoder
} from "@rendered-motion/player-web";

import { deepFreeze, requireProof } from "./shared";

export interface DrawIdentityRecord {
  readonly sequence: number;
  readonly candidateId: string;
  readonly presentation: Readonly<GraphPresentation>;
  readonly media: Readonly<RuntimeMediaPresentation> | null;
}

export interface CandidateIdentityTracker {
  readonly factory: IntegratedCandidateFactory;
  readonly candidateIds: readonly string[];
  readonly drawRecords: readonly Readonly<DrawIdentityRecord>[];
  readonly activationStarts: readonly Readonly<{
    readonly candidateId: string;
    readonly expectedPresentation: string;
  }>[];
  readonly disposedCandidateIds: readonly string[];
  readonly activationGate: OperationGate;
}

export interface CandidateLifecycleEvent {
  readonly kind: "candidate-dispose-start" | "candidate-dispose-end";
  readonly candidateId: string;
}

export interface CandidateInstrumentationOptions {
  readonly onLifecycle?: (event: Readonly<CandidateLifecycleEvent>) => void;
}

/** One-use controllable boundary that records entry before allowing progress. */
export class OperationGate {
  #armedLabel: string | null = null;
  #enteredLabel: string | null = null;
  #resolveEntered: (() => void) | null = null;
  #resolveRelease: (() => void) | null = null;
  #enteredPromise: Promise<void> = Promise.resolve();
  #releasePromise: Promise<void> = Promise.resolve();

  public arm(label: string): void {
    requireProof(this.#armedLabel === null, "proof operation gate is already armed");
    this.#armedLabel = label;
    this.#enteredLabel = null;
    this.#enteredPromise = new Promise<void>((resolve) => {
      this.#resolveEntered = resolve;
    });
    this.#releasePromise = new Promise<void>((resolve) => {
      this.#resolveRelease = resolve;
    });
  }

  public async enterIfArmed(signal: AbortSignal): Promise<boolean> {
    const label = this.#armedLabel;
    if (label === null) return false;
    this.#armedLabel = null;
    this.#enteredLabel = label;
    this.#resolveEntered?.();
    this.#resolveEntered = null;
    await new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        signal.removeEventListener("abort", onAbort);
        reject(signal.reason);
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
      void this.#releasePromise.then(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      });
    });
    return true;
  }

  public async waitUntilEntered(label: string): Promise<void> {
    await this.#enteredPromise;
    requireProof(this.#enteredLabel === label,
      `proof operation gate entered ${this.#enteredLabel ?? "nothing"}, expected ${label}`);
  }

  public release(): void {
    this.#resolveRelease?.();
    this.#resolveRelease = null;
  }
}

export function instrumentCandidateFactory(
  factory: IntegratedCandidateFactory,
  options: Readonly<CandidateInstrumentationOptions> = {}
): Readonly<CandidateIdentityTracker> {
  const candidateIds: string[] = [];
  const drawRecords: DrawIdentityRecord[] = [];
  const activationStarts: Array<{
    readonly candidateId: string;
    readonly expectedPresentation: string;
  }> = [];
  const disposedCandidateIds: string[] = [];
  const activationGate = new OperationGate();
  let drawSequence = 0;
  const instrumented: IntegratedCandidateFactory = {
    availability: factory.availability,
    ...(factory.resourceHost === undefined ? {} : { resourceHost: factory.resourceHost }),
    create(context) {
      const candidateId = `candidate-${String(candidateIds.length + 1)}`;
      candidateIds.push(candidateId);
      const attempt = factory.create(context);
      let disposalStarted = false;
      const playback = attempt.playback;
      const record = (
        presentation: Readonly<GraphPresentation>,
        media: Readonly<RuntimeMediaPresentation> | null
      ): void => {
        drawRecords.push(Object.freeze({
          sequence: ++drawSequence,
          candidateId,
          presentation,
          media
        }));
      };
      const instrumentedPlayback: IntegratedPlaybackSession = {
        prepareContentTick: (tickContext) => playback.prepareContentTick(tickContext),
        drawContentTick: (prepared, presentation) => {
          const tag = playback.drawContentTick(prepared, presentation);
          record(presentation, prepared.media);
          return tag;
        },
        synchronizeGraph: (result) => playback.synchronizeGraph(result),
        traceState: () => playback.traceState()
      };
      const instrumentedAttempt: IntegratedCandidateAttempt = {
        playback: Object.freeze(instrumentedPlayback),
        prepare: (options) => attempt.prepare(options),
        prepareActivation: async (options) => {
          activationStarts.push(Object.freeze({
            candidateId,
            expectedPresentation: presentationLabel(options.expectedPresentation)
          }));
          await activationGate.enterIfArmed(options.signal);
          return attempt.prepareActivation(options);
        },
        drawInitial: (activation, presentation) => {
          attempt.drawInitial(activation, presentation);
          record(presentation, null);
        },
        dispose: async () => {
          if (!disposalStarted) {
            disposalStarted = true;
            options.onLifecycle?.(Object.freeze({
              kind: "candidate-dispose-start",
              candidateId
            }));
          }
          try {
            await attempt.dispose();
          } finally {
            if (!disposedCandidateIds.includes(candidateId)) {
              disposedCandidateIds.push(candidateId);
              options.onLifecycle?.(Object.freeze({
                kind: "candidate-dispose-end",
                candidateId
              }));
            }
          }
        }
      };
      return Object.freeze(instrumentedAttempt);
    }
  };
  return Object.freeze({
    factory: Object.freeze(instrumented),
    candidateIds,
    drawRecords,
    activationStarts,
    disposedCandidateIds,
    activationGate
  });
}

export class GatedStaticSurfaceDecoder
implements StaticSurfaceDecoder<BrowserDecodedStaticSurface> {
  public readonly gate = new OperationGate();
  readonly #inner: BrowserStaticSurfaceDecoder;

  public constructor(inner: BrowserStaticSurfaceDecoder) {
    this.#inner = inner;
  }

  public snapshot(): Readonly<BrowserStaticSurfaceDecoderSnapshot> {
    return this.#inner.snapshot();
  }

  public async decode(
    png: Uint8Array,
    options: StaticSurfaceDecodeOptions
  ): Promise<BrowserDecodedStaticSurface> {
    await this.gate.enterIfArmed(options.signal);
    return this.#inner.decode(png, options);
  }
}

export interface WorkerIdentityTracker {
  readonly identities: readonly string[];
  create(url: URL, options: WorkerOptions): OwnedDecoderWorkerPort;
}

export function createWorkerIdentityTracker(): Readonly<WorkerIdentityTracker> {
  const identities: string[] = [];
  return Object.freeze({
    identities,
    create(url: URL, options: WorkerOptions): OwnedDecoderWorkerPort {
      identities.push(`worker-${String(identities.length + 1)}`);
      return new Worker(url, options);
    }
  });
}

export function identitySnapshot(
  candidates: Readonly<CandidateIdentityTracker>,
  workers: Readonly<WorkerIdentityTracker>
): Readonly<{
  readonly candidateIds: readonly string[];
  readonly workerIds: readonly string[];
  readonly lastDrawCandidateId: string | null;
}> {
  return deepFreeze({
    candidateIds: [...candidates.candidateIds],
    workerIds: [...workers.identities],
    lastDrawCandidateId: candidates.drawRecords.at(-1)?.candidateId ?? null
  });
}

function presentationLabel(presentation: Readonly<GraphPresentation>): string {
  return presentation.kind === "static"
    ? `static:${presentation.state}`
    : `${presentation.unitId}:${String(presentation.frameIndex)}`;
}
