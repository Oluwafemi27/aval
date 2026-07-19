import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AvalPlaybackError } from "../src/errors.js";

type CodecFamily = "av1" | "vp9" | "h265" | "h264";
type StartupOutcome =
  | "success"
  | "invalid-output"
  | "encoding-error"
  | "unsupported-config"
  | "transport-error"
  | "pending";

const startup = vi.hoisted(() => ({
  outcomes: new Map<string, StartupOutcome>(),
  opens: [] as string[],
  disposals: [] as string[],
  operations: [] as string[],
  cleanupFailures: new Set<string>(),
  rendererFailures: new Set<string>(),
  resizeFailures: new Set<string>(),
  snapshotFailures: new Set<string>(),
  decoders: [] as Array<{
    codec: string;
    disposed: boolean;
    fail: (reason?: Error) => void;
  }>
}));

vi.mock("../src/asset.js", () => ({
  Asset: class {
    public static async open(source: Readonly<{ src: string; codec: string }>) {
      const family = codecFamily(source.codec);
      startup.opens.push(family);
      startup.operations.push(`asset-open:${family}`);
      return new SyntheticAsset(family, source.codec);
    }
  }
}));

vi.mock("../src/codec-validator.js", () => ({
  createCodecValidator: () => ({
    validate: () => undefined,
    complete: () => undefined
  })
}));

vi.mock("../src/decoder.js", () => ({
  Decoder: class {
    public encodedBytes = 0;
    readonly #codec: string;
    readonly #failure: Promise<never>;
    readonly #control: {
      codec: string;
      disposed: boolean;
      fail: (reason?: Error) => void;
    };
    #rejectFailure!: (reason: unknown) => void;
    #failureSettled = false;
    #disposed = false;
    #generation = 0;
    #diagnostic: Readonly<Record<string, unknown>> | null = null;
    #rejectRunReady: ((reason: unknown) => void) | null = null;
    #runReadySettled = false;

    public constructor(config: Readonly<VideoDecoderConfig>) {
      this.#codec = codecFamily(config.codec);
      this.#failure = new Promise<never>((_resolve, reject) => {
        this.#rejectFailure = reject;
      });
      void this.#failure.catch(() => undefined);
      this.#control = {
        codec: this.#codec,
        disposed: false,
        fail: (reason = invalidOutputError(this.#codec)) => this.#fail(reason)
      };
      startup.decoders.push(this.#control);
    }

    public get available(): boolean { return !this.#disposed; }

    public async supported(): Promise<boolean> {
      startup.operations.push(`probe:${this.#codec}`);
      return true;
    }

    public failure(): Promise<never> { return this.#failure; }

    public createRun(samples: readonly Readonly<{
      displayedFrames: number;
    }>[]) {
      const generation = ++this.#generation;
      const outcome = startup.outcomes.get(this.#codec) ?? "success";
      startup.operations.push(`run:${this.#codec}`);
      let resolveRunReady!: () => void;
      const readiness = new Promise<void>((resolve, reject) => {
        resolveRunReady = resolve;
        this.#rejectRunReady = reject;
      });
      if (outcome === "success") {
        queueMicrotask(() => {
          if (this.#runReadySettled) return;
          this.#runReadySettled = true;
          resolveRunReady();
        });
      } else if (outcome === "invalid-output") {
        queueMicrotask(() => this.#fail(invalidOutputError(this.#codec)));
      } else if (outcome === "encoding-error") {
        const error = new Error(`synthetic decode failure for ${this.#codec}`);
        error.name = "EncodingError";
        queueMicrotask(() => this.#fail(error, "decode", "decoder-operation"));
      } else if (outcome === "unsupported-config") {
        const error = new Error(`synthetic unsupported config for ${this.#codec}`);
        error.name = "NotSupportedError";
        queueMicrotask(() => this.#fail(error, "configure", "unsupported-config"));
      } else if (outcome === "transport-error") {
        queueMicrotask(() => this.#fail(
          new Error(`synthetic worker transport failure for ${this.#codec}`),
          "frame-transfer",
          "transport"
        ));
      }
      let closed = false;
      return {
        generation,
        frameCount: samples[0]?.displayedFrames ?? 1,
        openFrames: 0,
        outstanding: 0,
        get closed() { return closed; },
        ready: () => readiness,
        take: async (index: number) => ({ codec: this.#codec, index }),
        release: () => undefined,
        complete: async () => undefined,
        close: () => {
          if (closed) return;
          closed = true;
          if (!this.#runReadySettled) {
            this.#runReadySettled = true;
            this.#rejectRunReady?.(
              new DOMException("synthetic decoder run closed", "AbortError")
            );
          }
        }
      };
    }

    public snapshot() {
      if (startup.snapshotFailures.has(this.#codec)) {
        throw new Error(`synthetic renderer snapshot failure for ${this.#codec}`);
      }
      return {
        workerCount: this.#disposed ? 0 : 1,
        openFrames: 0,
        openFrameBytes: 0,
        diagnostic: this.#diagnostic
      };
    }

    public dispose(): void {
      if (this.#disposed) return;
      this.#disposed = true;
      this.#control.disposed = true;
      startup.operations.push(`decoder-dispose:${this.#codec}`);
      if (!this.#runReadySettled) {
        this.#runReadySettled = true;
        this.#rejectRunReady?.(
          new DOMException("synthetic decoder disposed", "AbortError")
        );
      }
    }

    #fail(
      reason: Error,
      phase = "output-validation",
      code = "invalid-output"
    ): void {
      if (this.#failureSettled || this.#disposed) return;
      this.#failureSettled = true;
      this.#diagnostic = Object.freeze({
        phase,
        code,
        run: this.#generation === 0 ? null : this.#generation,
        decodeOrdinal: this.#generation === 0 ? null : 0,
        exception: Object.freeze({ name: reason.name, message: reason.message }),
        firstFrame: null
      });
      if (!this.#runReadySettled) {
        this.#runReadySettled = true;
        this.#rejectRunReady?.(reason);
      }
      this.#rejectFailure(reason);
    }
  }
}));

vi.mock("../src/renderer.js", () => ({
  Renderer: class {
    readonly #codec: string;
    #disposed = false;

    public constructor(
      _canvas: HTMLCanvasElement,
      layout: Readonly<{ codedWidth: number }>
    ) {
      this.#codec = familyForWidth(layout.codedWidth);
      startup.operations.push(`renderer:${this.#codec}`);
    }

    public admit() { return { textureBytes: 1, runtimeBytes: 3 }; }

    public snapshot() {
      return {
        cssWidth: 16,
        cssHeight: 16,
        backingWidth: 16,
        backingHeight: 16,
        effectiveDprX: 1,
        effectiveDprY: 1,
        contextLossCount: 0,
        contextRecoveryCount: 0,
        stagingBytes: 1,
        residentBytes: 0,
        textureBytes: 1,
        runtimeBytes: 3,
        pendingOperations: 0,
        sourceCopiesInFlight: 0,
        resourceCount: 4,
        contextListenerCount: 2
      };
    }

    public async draw(): Promise<void> {
      startup.operations.push(`draw:${this.#codec}`);
      if (startup.rendererFailures.has(this.#codec)) {
        throw new Error(`synthetic WebGL draw failure for ${this.#codec}`);
      }
    }

    public async store(): Promise<void> {}
    public async drawStored(): Promise<void> {}
    public resize(): void {
      if (startup.resizeFailures.has(this.#codec)) {
        throw new Error(`synthetic WebGL resize failure for ${this.#codec}`);
      }
    }
    public settled(): Promise<void> { return Promise.resolve(); }

    public dispose(): void {
      if (this.#disposed) return;
      this.#disposed = true;
      startup.operations.push(`renderer-dispose:${this.#codec}`);
    }
  }
}));

import { createPlayer } from "../src/player.js";

beforeEach(() => {
  startup.outcomes.clear();
  startup.opens.length = 0;
  startup.disposals.length = 0;
  startup.operations.length = 0;
  startup.cleanupFailures.clear();
  startup.rendererFailures.clear();
  startup.resizeFailures.clear();
  startup.snapshotFailures.clear();
  startup.decoders.length = 0;
  vi.stubGlobal("Worker", class {});
  vi.stubGlobal("VideoDecoder", class {});
  vi.stubGlobal("VideoFrame", class {});
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("player startup source fallback", () => {
  it("falls through a positive AV1 probe with invalid output to VP9", async () => {
    startup.outcomes.set("av1", "invalid-output");
    const harness = createHarness(["av1", "vp9", "h265", "h264"]);

    const outcome = await prepareAttempt(harness.input);

    const player = requirePrepared(outcome);
    if (outcome.status !== "fulfilled") throw outcome.error;
    expect(startup.opens).toEqual(["av1", "vp9"]);
    expect(startup.disposals).toEqual(["av1"]);
    expect(player.snapshot(false).selectedCodec).toBe(CODECS.vp9);
    expect(player.snapshot(false).decoderDiagnostics).toEqual([
      expect.objectContaining({
        sourceIndex: 0,
        codec: CODECS.av1,
        phase: "output-validation",
        code: "invalid-output"
      })
    ]);
    expect(harness.publications.metadata).toEqual(["vp9"]);
    expect(harness.publications.readiness).toEqual([
      "metadataReady",
      "visualReady",
      "interactiveReady"
    ]);
    expect(harness.publications.draws).toBe(1);
    expect(harness.publications.playbackFailures).toEqual([]);
    expect(outcome.result.report.candidates.map((candidate) => ({
      rank: candidate.rank,
      outcome: candidate.outcome,
      code: candidate.failure?.code ?? null
    }))).toEqual([
      { rank: 0, outcome: "rejected", code: "worker-decode-failure" },
      { rank: 1, outcome: "selected", code: null }
    ]);
    const vp9Open = startup.operations.indexOf("asset-open:vp9");
    expect(startup.operations.indexOf("decoder-dispose:av1")).toBeLessThan(vp9Open);
    expect(startup.operations.indexOf("renderer-dispose:av1")).toBeLessThan(vp9Open);
    expect(startup.operations.indexOf("asset-dispose:av1")).toBeLessThan(vp9Open);
    await player.dispose();
  });

  it("falls through AV1 invalid output and a VP9 EncodingError to HEVC", async () => {
    startup.outcomes.set("av1", "invalid-output");
    startup.outcomes.set("vp9", "encoding-error");
    const harness = createHarness(FAMILIES);

    const outcome = await prepareAttempt(harness.input);

    const player = requirePrepared(outcome);
    if (outcome.status !== "fulfilled") throw outcome.error;
    expect(startup.opens).toEqual(["av1", "vp9", "h265"]);
    expect(player.snapshot(false).selectedCodec).toBe(CODECS.h265);
    expect(harness.publications.playbackFailures).toEqual([]);
    await player.dispose();
  });

  it("advances on retained unsupported-config evidence", async () => {
    startup.outcomes.set("av1", "unsupported-config");
    const harness = createHarness(FAMILIES);

    const outcome = await prepareAttempt(harness.input);

    const player = requirePrepared(outcome);
    expect(startup.opens).toEqual(["av1", "vp9"]);
    expect(player.snapshot(false).selectedCodec).toBe(CODECS.vp9);
    expect(harness.publications.playbackFailures).toEqual([]);
    await player.dispose();
  });

  it("qualifies without publishing or scheduling until publication", async () => {
    let published = false;
    vi.stubGlobal("requestAnimationFrame", () => {
      if (!published) throw new Error("playback scheduled before publication");
      return 1;
    });
    const harness = createHarness(["av1"]);

    const player = await createPlayer(harness.input);

    expect(harness.publications.readiness).toEqual([]);
    player.activate({ publish: false });
    expect(harness.publications.readiness).toEqual([]);
    published = true;
    player.publish();
    expect(harness.publications.readiness).toEqual([
      "metadataReady",
      "visualReady",
      "interactiveReady"
    ]);
    await player.dispose();
  });

  it("suppresses provisional animated publications after pre-publication reduction", async () => {
    const harness = createHarness(["av1"]);
    const player = await createPlayer(harness.input);

    player.activate({ publish: false });
    await player.setMotion("reduce", true);
    player.publish();

    expect(harness.publications.metadata).toEqual(["av1"]);
    expect(harness.publications.readiness).toEqual([
      "metadataReady",
      "staticReady"
    ]);
    expect(harness.publications.draws).toBe(0);
    expect(await player.prepare()).toMatchObject({
      mode: "static",
      reason: "reduced-motion"
    });
    await player.dispose();
  });

  it("suppresses provisional animated publications after pre-publication suspension", async () => {
    const harness = createHarness(["av1"]);
    const player = await createPlayer(harness.input);

    player.activate({ publish: false });
    await player.suspend("visibility-suspended");
    player.publish();

    expect(harness.publications.metadata).toEqual(["av1"]);
    expect(harness.publications.readiness).toEqual([
      "metadataReady",
      "staticReady"
    ]);
    expect(harness.publications.draws).toBe(0);
    await player.dispose();
  });

  it("releases the total deadline listener when a qualified player is disposed", async () => {
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    const harness = createHarness(["av1"], controller);
    const player = await createPlayer(harness.input);

    await player.dispose();

    expect(removeListener).toHaveBeenCalledWith(
      "abort",
      expect.any(Function)
    );
  });

  it("does not publish stale readiness when an unpublished winner fails", async () => {
    const harness = createHarness(["av1"]);
    const player = await createPlayer(harness.input);

    player.activate({ publish: false });
    failLiveDecoder("av1");
    await eventually(() => harness.publications.playbackFailures.length === 1);
    player.publish();

    expect(harness.publications.metadata).toEqual([]);
    expect(harness.publications.readiness).toEqual([]);
    expect(harness.publications.draws).toBe(0);
    expect(harness.publications.playbackFailures).toEqual([
      "worker-decode-failure:playback"
    ]);
    await player.dispose();
  });

  it("does not reuse AV1 qualification evidence for a VP9 transport failure", async () => {
    startup.outcomes.set("av1", "invalid-output");
    startup.outcomes.set("vp9", "transport-error");
    const harness = createHarness(FAMILIES);

    const outcome = await prepareAttempt(harness.input);

    expect(outcome.status).toBe("rejected");
    expect(startup.opens).toEqual(["av1", "vp9"]);
    expect(startup.disposals).toEqual(["av1", "vp9"]);
    expect(harness.publications.playbackFailures).toEqual([
      "worker-decode-failure:prepare"
    ]);
  });

  it("uses H264 only after AV1, VP9, and HEVC fail startup qualification", async () => {
    startup.outcomes.set("av1", "invalid-output");
    startup.outcomes.set("vp9", "invalid-output");
    startup.outcomes.set("h265", "invalid-output");
    const harness = createHarness(["av1", "vp9", "h265", "h264"]);

    const outcome = await prepareAttempt(harness.input);

    const player = requirePrepared(outcome);
    if (outcome.status !== "fulfilled") throw outcome.error;
    expect(startup.opens).toEqual(["av1", "vp9", "h265", "h264"]);
    expect(startup.disposals).toEqual(["av1", "vp9", "h265"]);
    expect(player.snapshot(false).selectedCodec).toBe(CODECS.h264);
    expect(harness.publications.metadata).toEqual(["h264"]);
    expect(harness.publications.readiness).toEqual([
      "metadataReady",
      "visualReady",
      "interactiveReady"
    ]);
    expect(harness.publications.draws).toBe(1);
    expect(harness.publications.playbackFailures).toEqual([]);
    expect(outcome.result.report.candidates.map((candidate) => ({
      rank: candidate.rank,
      outcome: candidate.outcome,
      code: candidate.failure?.code ?? null
    }))).toEqual([
      { rank: 0, outcome: "rejected", code: "worker-decode-failure" },
      { rank: 1, outcome: "rejected", code: "worker-decode-failure" },
      { rank: 2, outcome: "rejected", code: "worker-decode-failure" },
      { rank: 3, outcome: "selected", code: null }
    ]);
    await player.dispose();
  });

  it("publishes one canonical terminal error after every candidate fails", async () => {
    for (const family of FAMILIES) {
      startup.outcomes.set(family, "invalid-output");
    }
    const harness = createHarness(FAMILIES);

    const outcome = await prepareAttempt(harness.input);

    expect(outcome.status).toBe("rejected");
    if (outcome.status !== "rejected") throw new Error("expected startup rejection");
    expect(outcome.error).toBe(harness.terminal);
    expect(startup.opens).toEqual(FAMILIES);
    expect(startup.disposals).toEqual(FAMILIES);
    expect(harness.publications.metadata).toEqual([]);
    expect(harness.publications.readiness).toEqual([]);
    expect(harness.publications.draws).toBe(0);
    expect(harness.publications.playbackFailures).toEqual([
      "worker-decode-failure:prepare"
    ]);
  });

  it("does not traverse sources after a non-codec renderer failure", async () => {
    startup.rendererFailures.add("av1");
    const harness = createHarness(FAMILIES);

    const outcome = await prepareAttempt(harness.input);

    expect(outcome.status).toBe("rejected");
    expect(startup.opens).toEqual(["av1"]);
    expect(harness.publications.playbackFailures).toEqual([
      "renderer-failure:prepare"
    ]);
  });

  it("surfaces candidate resize failure before qualification can succeed", async () => {
    startup.resizeFailures.add("av1");
    const harness = createHarness(FAMILIES);
    const input = {
      ...harness.input,
      onCandidate: async (player: Awaited<ReturnType<typeof createPlayer>>) => {
        player.activate({ publish: false });
        player.resize(32, 32, 1, "contain");
      }
    };

    const outcome = await prepareAttempt(input);

    expect(outcome.status).toBe("rejected");
    expect(startup.opens).toEqual(["av1"]);
    expect(harness.publications.metadata).toEqual([]);
    expect(harness.publications.readiness).toEqual([]);
    expect(harness.publications.draws).toBe(0);
    expect(harness.publications.playbackFailures).toEqual([
      "renderer-failure:prepare"
    ]);
  });

  it("does not traverse sources when failed-candidate cleanup is incomplete", async () => {
    startup.outcomes.set("av1", "invalid-output");
    startup.cleanupFailures.add("av1");
    const harness = createHarness(FAMILIES);

    const outcome = await prepareAttempt(harness.input);

    expect(outcome.status).toBe("rejected");
    expect(startup.opens).toEqual(["av1"]);
    expect(startup.disposals.every((codec) => codec === "av1")).toBe(true);
    expect(startup.disposals.length).toBeGreaterThan(0);
    expect(harness.publications.playbackFailures).toHaveLength(1);
  });

  it("disposes a rejected candidate even when its diagnostic snapshot throws", async () => {
    startup.outcomes.set("av1", "invalid-output");
    startup.snapshotFailures.add("av1");
    const harness = createHarness(FAMILIES);
    const removeListener = vi.spyOn(harness.input.canvas, "removeEventListener");

    const outcome = await prepareAttempt(harness.input);

    expect(outcome.status).toBe("rejected");
    expect(startup.opens).toEqual(["av1"]);
    expect(removeListener.mock.calls.filter(([type]) =>
      type === "webglcontextrestored"
    )).toHaveLength(0);
    expect(harness.publications.playbackFailures).toEqual([
      "renderer-failure:prepare"
    ]);
  });

  it("does not traverse sources after an abort during provisional readiness", async () => {
    startup.outcomes.set("av1", "pending");
    const controller = new AbortController();
    const harness = createHarness(FAMILIES, controller);
    const attempt = prepareAttempt(harness.input);
    await eventually(() => startup.operations.includes("run:av1"));
    const reason = new DOMException("source generation replaced", "AbortError");

    controller.abort(reason);
    // Unblock the synthetic decoder after cancellation, as a real worker would
    // settle its in-flight run while the owning generation retires.
    failLiveDecoder("av1");
    const outcome = await attempt;

    expect(outcome.status).toBe("rejected");
    if (outcome.status !== "rejected") throw new Error("expected startup rejection");
    expect(outcome.error).toBe(reason);
    expect(startup.opens).toEqual(["av1"]);
    expect(harness.publications.playbackFailures).toEqual([]);
  });

  it("does not hot-switch sources after a qualified player later fails", async () => {
    startup.outcomes.set("av1", "invalid-output");
    const harness = createHarness(FAMILIES);
    const outcome = await prepareAttempt(harness.input);
    const player = requirePrepared(outcome);
    expect(startup.opens).toEqual(["av1", "vp9"]);

    failLiveDecoder("vp9");
    await eventually(() => harness.publications.playbackFailures.length === 1);

    await expect(player.prepare()).rejects.toBe(harness.terminal);
    expect(startup.opens).toEqual(["av1", "vp9"]);
    expect(harness.publications.playbackFailures).toEqual([
      "worker-decode-failure:playback"
    ]);
    await player.dispose();
  });
});

const FAMILIES = Object.freeze([
  "av1",
  "vp9",
  "h265",
  "h264"
] as const);

const CODECS = Object.freeze({
  av1: "av01.0.05M.08",
  vp9: "vp09.00.10.08",
  h265: "hvc1.1.6.L93.B0",
  h264: "avc1.640020"
} satisfies Readonly<Record<CodecFamily, string>>);

const WIDTHS = Object.freeze({
  av1: 16,
  vp9: 18,
  h265: 20,
  h264: 22
} satisfies Readonly<Record<CodecFamily, number>>);

class SyntheticAsset {
  public readonly manifest;
  public readonly blobs;
  public readonly records;
  readonly #family: CodecFamily;
  #disposed = false;

  public constructor(family: CodecFamily, codec: string) {
    this.#family = family;
    const unit = `${family}-body`;
    this.manifest = {
      codec: family,
      canvas: { width: 16, height: 16, fit: "contain", pixelAspect: [1, 1] },
      frameRate: { numerator: 30, denominator: 1 },
      renditions: [{
        id: "main",
        codec,
        bitDepth: 8,
        codedWidth: WIDTHS[family],
        codedHeight: 16,
        bitrate: { average: 1_000, peak: 1_000 },
        alphaLayout: { type: "opaque", colorRect: [0, 0, 16, 16] }
      }],
      units: [{
        id: unit,
        kind: "body",
        playback: "loop",
        frameCount: 1,
        ports: [{ id: "entry", entryFrame: 0, portalFrames: [0] }],
        chunks: [{ rendition: "main", chunkStart: 0, chunkCount: 1 }]
      }],
      initialState: family,
      states: [{ id: family, bodyUnit: unit }],
      edges: [],
      bindings: [],
      readiness: { policy: "all-routes", bootstrapUnits: [], immediateEdges: [] },
      limits: {
        maxRuntimeBytes: 16_000_000,
        decodedPixelBytes: 2_048,
        persistentCacheBytes: 0,
        runtimeWorkingSetBytes: 1_000_000
      }
    };
    this.blobs = [{
      rendition: "main",
      unit,
      offset: 1_000,
      length: 1,
      chunkStart: 0,
      chunkCount: 1
    }];
    this.records = [{
      offset: 1_000,
      length: 1,
      presentationTimestamp: 0,
      duration: 1,
      randomAccess: true,
      displayedFrameCount: 1
    }];
  }

  public async unitBytes(): Promise<Uint8Array<ArrayBuffer>> {
    return new Uint8Array(1);
  }

  public chunkBytes(): ArrayBuffer {
    return new Uint8Array([0]).buffer;
  }

  public async dispose(): Promise<void> {
    if (this.#disposed) return;
    startup.disposals.push(this.#family);
    startup.operations.push(`asset-dispose:${this.#family}`);
    if (startup.cleanupFailures.has(this.#family)) {
      throw new Error(`synthetic asset cleanup failure for ${this.#family}`);
    }
    this.#disposed = true;
  }

  public snapshot() {
    return {
      mode: "range",
      disposed: this.#disposed,
      declaredFileBytes: 2_000,
      metadataBytes: 1_000,
      verifiedBytes: 1,
      residentBlobBytes: 1,
      activeTransportBodies: 0,
      pendingLoads: 0,
      interestedWaiters: 0
    };
  }
}

function createHarness(
  families: readonly CodecFamily[],
  controller = new AbortController()
) {
  const publications = {
    metadata: [] as string[],
    readiness: [] as string[],
    draws: 0,
    retirements: 0,
    playbackFailures: [] as string[]
  };
  const terminal = new AvalPlaybackError(Object.freeze({
    code: "worker-decode-failure",
    message: "Playback could not continue.",
    operation: "prepare"
  }), 1);
  const input = {
    canvas: new EventTarget() as HTMLCanvasElement,
    platform: testPlatform(),
    initialPresentation: { width: 16, height: 16, dpr: 1, fit: null },
    baseUrl: "https://example.test/",
    sources: families.map((family, sourceIndex) => ({
      src: `${family}.avl`,
      codec: CODECS[family],
      integrity: "",
      sourceIndex
    })),
    credentials: "same-origin" as const,
    signal: controller.signal,
    preparationTimeoutMs: 5_000,
    motion: "full" as const,
    reduced: false,
    initialState: null,
    initialBody: false,
    visible: true,
    decoderReady: () => true,
    onResourceBytes: () => undefined,
    onMetadata: (metadata: Readonly<{ initialState: string }>) => {
      publications.metadata.push(metadata.initialState);
    },
    onReadiness: (value: string) => publications.readiness.push(value),
    onAnimationResourcesRetired: () => { publications.retirements += 1; },
    onDraw: () => { publications.draws += 1; },
    onRestart: () => undefined,
    onEvent: () => undefined,
    onFailure: () => undefined,
    onPlaybackFailure: (
      code: ConstructorParameters<typeof AvalPlaybackError>[0]["code"],
      operation: string
    ) => {
      publications.playbackFailures.push(`${code}:${operation}`);
      return terminal;
    }
  };
  return { controller, input, publications, terminal };
}

async function prepareAttempt(input: Parameters<typeof createPlayer>[0]) {
  let player: Awaited<ReturnType<typeof createPlayer>> | null = null;
  try {
    player = await createPlayer(input);
    player.activate();
    const result = await player.prepare();
    return { status: "fulfilled" as const, player, result };
  } catch (error) {
    if (player !== null) {
      try { await player.dispose(); } catch { /* retain the startup outcome */ }
    }
    return { status: "rejected" as const, error };
  }
}

function requirePrepared(
  outcome: Awaited<ReturnType<typeof prepareAttempt>>
): Awaited<ReturnType<typeof createPlayer>> {
  if (outcome.status === "rejected") throw outcome.error;
  return outcome.player;
}

function failLiveDecoder(family: CodecFamily): void {
  const control = startup.decoders.find((candidate) =>
    candidate.codec === family && !candidate.disposed
  );
  if (control === undefined) throw new Error(`no live ${family} decoder`);
  control.fail();
}

async function eventually(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("condition did not become true");
}

function invalidOutputError(codec: string): Error {
  const error = new Error(`synthetic invalid decoded frame for ${codec}`);
  error.name = "EncodingError";
  return error;
}

function codecFamily(codec: string): CodecFamily {
  return codec.startsWith("av01.") ? "av1"
    : codec.startsWith("vp09.") ? "vp9"
      : codec.startsWith("hvc1.") ? "h265" : "h264";
}

function familyForWidth(width: number): CodecFamily {
  const match = FAMILIES.find((family) => WIDTHS[family] === width);
  if (match === undefined) throw new Error(`unknown synthetic width ${String(width)}`);
  return match;
}

function testPlatform() {
  return {
    fetch: globalThis.fetch.bind(globalThis),
    Worker: globalThis.Worker ?? null,
    VideoDecoder: globalThis.VideoDecoder ?? null,
    VideoFrame: globalThis.VideoFrame ?? null,
    requestAnimationFrame: globalThis.requestAnimationFrame.bind(globalThis),
    cancelAnimationFrame: globalThis.cancelAnimationFrame.bind(globalThis),
    now: () => performance.now(),
    setTimeout: (callback: () => void, delay: number) =>
      globalThis.setTimeout(callback, delay) as unknown as number,
    clearTimeout: (handle: number) => globalThis.clearTimeout(handle),
    crypto: globalThis.crypto
  };
}
