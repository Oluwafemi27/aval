import { describe, expect, it } from "vitest";
import { evaluateDecoderThroughputLedger } from "../src/decoder-throughput-ledger.js";

function validLedger(
  codec = "avc1.42E020",
  profile = "avc-annexb-packed-alpha-v0"
): unknown {
  const warmup = 24;
  const measured = 300;
  return {
    schemaVersion: "1.0",
    ledgerKind: "decoder-output-throughput",
    candidateManifestDigest: "a".repeat(64),
    fixtureDigest: "b".repeat(64),
    selectedRendition: {
      id: "alpha.1x",
      profile,
      codec,
      codedWidth: 64,
      codedHeight: 32,
      frameRateNumerator: 30,
      frameRateDenominator: 1
    },
    outputs: Array.from({ length: warmup + measured }, (_, outputOrdinal) => ({
      outputOrdinal,
      phase: outputOrdinal < warmup ? "warmup" : "measured",
      mediaTimestampMicroseconds: outputOrdinal * 33_333,
      mediaDurationMicroseconds: 33_333,
      callbackMicroseconds: outputOrdinal * 10_000,
      renditionId: "alpha.1x",
      unitId: "idle-body",
      unitInstance: Math.floor(outputOrdinal / 2),
      localFrame: outputOrdinal % 2
    })),
    events: [
      { eventOrdinal: 0, kind: "configure", atMicroseconds: 0, outputOrdinal: null },
      ...Array.from({ length: warmup + measured }, (_, outputOrdinal) => [
        { eventOrdinal: outputOrdinal * 2 + 1, kind: "output-callback", atMicroseconds: outputOrdinal * 10_000, outputOrdinal },
        { eventOrdinal: outputOrdinal * 2 + 2, kind: "frame-close", atMicroseconds: outputOrdinal * 10_000, outputOrdinal }
      ]).flat(),
      { eventOrdinal: (warmup + measured) * 2 + 1, kind: "terminal", atMicroseconds: (warmup + measured) * 10_000, outputOrdinal: null }
    ],
    terminal: {
      decoderClosed: true,
      configureCalls: 1,
      resetCalls: 0,
      flushCalls: 0,
      boundaryFlushCalls: 0,
      acceptedSamples: warmup + measured,
      submittedChunks: warmup + measured,
      outputFrames: warmup + measured,
      deliveredFrames: warmup + measured,
      releasedFrames: warmup + measured,
      staleFrames: 0,
      workerClosedFrames: 0,
      errors: 0,
      openFrames: 0,
      pendingFrames: 0,
      decodeQueueSize: 0
    }
  };
}

describe("decoder throughput raw ledger", () => {
  it.each([
    "avc-annexb-packed-alpha-v0",
    "avc-annexb-opaque-v0",
    "avc-annexb-packed-alpha-v1",
    "avc-annexb-opaque-v1"
  ])("accepts production AVC profile %s", (profile) => {
    const result = evaluateDecoderThroughputLedger(
      validLedger("avc1.42E020", profile)
    );
    expect(result.ledger.selectedRendition.profile).toBe(profile);
    expect(result.evaluation.passed).toBe(true);
  });

  it("rejects an unversioned AVC profile", () => {
    expect(() => evaluateDecoderThroughputLedger(
      validLedger("avc1.42E020", "avc-annexb-packed-alpha")
    )).toThrow(/profile is invalid/u);
  });

  it.each([
    "avc1.42E015",
    "avc1.42E028",
    "avc1.42E03E"
  ])("accepts and preserves supported Constrained Baseline codec %s", (codec) => {
    const result = evaluateDecoderThroughputLedger(validLedger(codec));
    expect(result.ledger.selectedRendition.codec).toBe(codec);
    expect(result.evaluation.passed).toBe(true);
  });

  it.each([
    "avc1.640028",
    "avc1.42E023",
    "avc1.42e028"
  ])("rejects unsupported or noncanonical codec %s", (codec) => {
    expect(() => evaluateDecoderThroughputLedger(validLedger(codec))).toThrow(
      /supported Constrained Baseline codec/u
    );
  });

  it("excludes warm-up and recomputes sample count, elapsed media time, and ratio", () => {
    const result = evaluateDecoderThroughputLedger(validLedger());
    expect(result.evaluation).toMatchObject({
      passed: true,
      warmupOutputs: 24,
      measuredOutputs: 300
    });
    expect(result.evaluation.elapsedMicroseconds).toBe(2_990_000);
    expect(result.evaluation.mediaDurationMicroseconds).toBe(9_966_567);
    expect(result.evaluation.ratioMillionths).toBeGreaterThan(3_000_000);
  });

  it.each([
    ["insufficient samples", (ledger: any) => {
      ledger.outputs.splice(-1, 1);
      ledger.events = ledger.events.filter((event: any) => event.outputOrdinal !== 323);
      ledger.events.at(-1).eventOrdinal -= 2;
      for (const name of ["acceptedSamples", "submittedChunks", "outputFrames", "deliveredFrames", "releasedFrames"]) ledger.terminal[name] -= 1;
    }, "throughput-sample-count-below-300"],
    ["slow callbacks", (ledger: any) => { ledger.outputs.forEach((output: any) => { output.callbackMicroseconds = output.outputOrdinal * 30_000; }); }, "throughput-below-1.5x"],
    ["ordinal gap", (ledger: any) => { ledger.outputs[100].outputOrdinal += 1; }, "output-ordinal"],
    ["wrong rendition", (ledger: any) => { ledger.outputs[100].renditionId = "other"; }, "rendition-identity"],
    ["flush", (ledger: any) => { ledger.events.splice(-1, 0, { ...ledger.events.at(-1), kind: "flush" }); ledger.events.forEach((event: any, index: number) => { event.eventOrdinal = index; }); }, "forbidden-counter:flush"],
    ["missing close", (ledger: any) => { ledger.events = ledger.events.filter((event: any) => !(event.kind === "frame-close" && event.outputOrdinal === 100)); ledger.events.forEach((event: any, index: number) => { event.eventOrdinal = index; }); }, "frame-close"],
    ["callback mismatch", (ledger: any) => { ledger.events.find((event: any) => event.kind === "output-callback" && event.outputOrdinal === 100).atMicroseconds += 1; }, "output-callback-binding"]
  ])("rejects or fails %s", (_name, mutate, expected) => {
    const ledger = validLedger() as any;
    mutate(ledger);
    try {
      const result = evaluateDecoderThroughputLedger(ledger);
      expect(result.evaluation.passed).toBe(false);
      expect(result.evaluation.failures.join("\n")).toMatch(new RegExp(expected));
    } catch (error) {
      expect(String(error)).toMatch(new RegExp(expected));
    }
  });

  it("rejects fields that could smuggle a self-declared ratio", () => {
    const ledger = validLedger() as any;
    ledger.ratioMillionths = 9_999_999;
    expect(() => evaluateDecoderThroughputLedger(ledger)).toThrow(/unknown field/u);
  });
});
