import { readFile } from "node:fs/promises";
import { parseFrontIndex } from "@aval/format";
import { describe, expect, it } from "vitest";
import { evaluateRuntimeScenarioLedger, runtimeFixtureModelFromManifest } from "../src/runtime-scenario-ledger.js";
import { createRawScenarioLedger, TEST_FIXTURE_DIGEST, TEST_RUNTIME_FIXTURE } from "./runtime-scenario-support.js";

const candidate = "a".repeat(64);
const ids = ["loop-1000", "all-routes-1000", "active-inverse-1000", "portal-1000", "rapid-input-10000", "terminal-settlement"] as const;

function ledger(id: string): any { return createRawScenarioLedger({ id, repetition: 1, seed: 7 }); }
function expected(id: string) { return { candidateManifestDigest: candidate, fixtureDigest: TEST_FIXTURE_DIGEST, fixture: TEST_RUNTIME_FIXTURE, scenarioId: id as any, repetition: 1, seed: 7 }; }

describe("raw runtime scenario ledgers", () => {
  it.each(ids)("recomputes %s from raw public-trace-shaped evidence and fixture", (id) => {
    const result = evaluateRuntimeScenarioLedger(ledger(id), expected(id));
    expect(result.evaluation.failures).toEqual([]);
    expect(result.evaluation.passed).toBe(true);
  });

  it("accepts zero maxWaitFrames from an actual compiled candidate fixture", async () => {
    const bytes = new Uint8Array(await readFile("fixtures/conformance/m5/opaque-reversible.avl"));
    const model = runtimeFixtureModelFromManifest(parseFrontIndex(bytes).manifest);
    expect(model.edges.some(({ start }) => start.maxWaitFrames === 0)).toBe(true);
  });

  it("derives paired-edge active reversal through reverseOf and exact adjacent frames", () => {
    const value = ledger("active-inverse-1000");
    const firstStart = value.graphEvents.find(({ effect }: any) => effect.type === "transitionstart");
    const current = value.frames.find(({ traceIndex }: any) => traceIndex > firstStart.traceIndex);
    const previous = value.frames[value.frames.indexOf(current) - 1];
    expect([previous.mediaEdge, current.mediaEdge]).toEqual(["idle-hover", "hover-idle"]);
    expect(evaluateRuntimeScenarioLedger(value, expected("active-inverse-1000")).evaluation.boundaryCount).toBe(1_000);
    current.graphPresentationFrame = previous.graphPresentationFrame;
    current.mediaLocalFrame = previous.mediaLocalFrame;
    current.submittedCursors[0].localFrame = previous.mediaLocalFrame;
    expect(evaluateRuntimeScenarioLedger(value, expected("active-inverse-1000")).evaluation.failures.join("\n")).toMatch(/inverse-semantics/u);
  });

  it("rejects underflow, wrong identity, inter-frame seam gaps, forbidden counters, and terminal leaks", () => {
    const value = ledger("loop-1000");
    for (let index = 500; index < value.frames.length; index += 1) value.frames[index].cumulativeUnderflows = 1;
    value.frames[600].graphContentOrdinal += 1;
    const boundary = value.frames.find((frame: any, index: number) => index > 700 && frame.mediaLocalFrame === 0)!;
    boundary.canvasSubmissionCompleteMicroseconds += 100_000;
    value.counterTerminal.seek = 1;
    value.cleanupReceipt.openFrames = 1;
    const failures = evaluateRuntimeScenarioLedger(value, expected("loop-1000")).evaluation.failures.join("\n");
    expect(failures).toMatch(/format-underflow/u);
    expect(failures).toMatch(/content-identity/u);
    expect(failures).toMatch(/boundary-submission-gap/u);
    expect(failures).toMatch(/forbidden-counter-delta:seek/u);
    expect(failures).toMatch(/terminal-resource:openFrames/u);
  });

  it("requires repeated finite-terminal evidence before classifying a held portal origin", () => {
    const value = ledger("portal-1000");
    const heldStarts = value.graphEvents.filter(({ effect }: any) => effect.type === "transitionstart" && effect.edgeId === "held-idle");
    for (const start of heldStarts) {
      const currentIndex = value.frames.findIndex(({ traceIndex }: any) => traceIndex > start.traceIndex);
      const previous = value.frames[currentIndex - 1];
      const before = value.frames[currentIndex - 2];
      if (previous.mediaLocalFrame === 7 && before.mediaLocalFrame === 7) {
        before.mediaLocalFrame = 6; before.graphPresentationFrame = 6; before.submittedCursors[0].localFrame = 6;
      }
    }
    expect(evaluateRuntimeScenarioLedger(value, expected("portal-1000")).evaluation.failures).toContain("portal-origin-missing:held");
  });

  it("rejects skipped transition frames, wrong immediate target entry, and portal coverage mutations", () => {
    const routes = ledger("all-routes-1000");
    const start = routes.graphEvents.find(({ effect }: any) => effect.type === "transitionstart" && effect.edgeId === "idle-hover");
    const index = routes.frames.findIndex(({ traceIndex }: any) => traceIndex > start.traceIndex);
    routes.frames[index + 1].graphPresentationFrame += 1;
    routes.frames[index + 1].mediaLocalFrame += 1;
    routes.frames[index + 1].submittedCursors[0].localFrame += 1;
    expect(evaluateRuntimeScenarioLedger(routes, expected("all-routes-1000")).evaluation.failures.join("\n")).toMatch(/route-transition-progression|media-progression/u);

    const portal = ledger("portal-1000");
    for (const startEvent of portal.graphEvents.filter(({ effect }: any) => effect.type === "transitionstart" && effect.edgeId === "finite-held")) {
      const routeIndex = portal.frames.findIndex(({ traceIndex }: any) => traceIndex > startEvent.traceIndex);
      const source = portal.frames[routeIndex - 1];
      if (source.mediaLocalFrame === 7) { source.mediaLocalFrame = 6; source.graphPresentationFrame = 6; source.submittedCursors[0].localFrame = 6; }
    }
    expect(evaluateRuntimeScenarioLedger(portal, expected("portal-1000")).evaluation.failures.join("\n")).toMatch(/portal-position-missing/u);
  });

  it("indexes rapid settlements linearly and rejects duplicate/missing ordinals plus failed convergence", () => {
    const value = ledger("rapid-input-10000");
    value.operations.find(({ kind, operationOrdinal }: any) => kind === "promise" && operationOrdinal === 42).operationOrdinal = 41;
    const final = value.frames.at(-1); final.mediaState = "idle"; final.graphPresentationState = "idle"; final.graphVisualState = "idle";
    const failures = evaluateRuntimeScenarioLedger(value, expected("rapid-input-10000")).evaluation.failures.join("\n");
    expect(failures).toMatch(/operation-duplicate-promise|operation-settlement-order/u);
    expect(failures).toMatch(/rapid-final-convergence/u);
  });

  it("requires trigger-linked route requests, complete DOM agreement, and raw headed dispatch evidence", () => {
    const routes = ledger("all-routes-1000");
    const requestedIndex = routes.graphEvents.findIndex(({ effect }: any) => effect.type === "requestedstatechange" && effect.sequence === 0);
    routes.graphEvents.splice(requestedIndex, 1);
    routes.graphEvents.forEach((event: any, index: number) => { event.eventOrdinal = index; });
    expect(evaluateRuntimeScenarioLedger(routes, expected("all-routes-1000")).evaluation.failures.join("\n")).toMatch(/route-request-missing/u);

    const rapid = ledger("rapid-input-10000");
    rapid.operations = rapid.operations.filter(({ kind }: any) => kind !== "dom-event" && kind !== "headed-dispatch");
    rapid.operations.forEach((event: any, index: number) => { event.eventOrdinal = index; event.atMicroseconds = index; });
    const failures = evaluateRuntimeScenarioLedger(rapid, expected("rapid-input-10000")).evaluation.failures.join("\n");
    expect(failures).toMatch(/dom-event-cardinality/u);
    expect(failures).toMatch(/headed-operations-below-1000/u);
  });

  it("binds terminal underflows and same-trace effect order to terminal evidence", () => {
    const terminal = ledger("terminal-settlement");
    terminal.terminalTrace.cumulativeUnderflows = 1;
    terminal.terminalTrace.contentTickRecords = 1;
    expect(evaluateRuntimeScenarioLedger(terminal, expected("terminal-settlement")).evaluation.failures).toEqual(expect.arrayContaining(["terminal-trace-content-cardinality", "terminal-trace-underflow-mismatch"]));

    const routes = ledger("all-routes-1000");
    const startIndex = routes.graphEvents.findIndex(({ effect }: any) => effect.type === "transitionstart" && effect.edgeId === "idle-hover");
    const start = routes.graphEvents[startIndex];
    const currentFrame = routes.frames.find(({ traceIndex }: any) => traceIndex > start.traceIndex);
    const correctEnd = routes.graphEvents.findIndex((event: any, index: number) => index > startIndex && event.effect.type === "transitionend" && event.effect.edgeId === "idle-hover" && event.traceIndex <= currentFrame.traceIndex + 4);
    routes.graphEvents.splice(correctEnd, 1);
    routes.graphEvents.splice(startIndex, 0, { eventOrdinal: 0, traceIndex: start.traceIndex, effect: { type: "transitionend", edgeId: "idle-hover", from: "idle", to: "hover" } });
    routes.graphEvents.forEach((event: any, index: number) => { event.eventOrdinal = index; });
    expect(evaluateRuntimeScenarioLedger(routes, expected("all-routes-1000")).evaluation.failures.join("\n")).toMatch(/route-transition-end-missing/u);
  });

  it("requires byte-coherent acquired-to-retired evidence and exact terminal raw zero", () => {
    const value = ledger("terminal-settlement");
    value.resourceEvents[1].resourceBytes = 512;
    value.resourceEvents[1].ownedBytes = 512;
    const failures = evaluateRuntimeScenarioLedger(value, expected("terminal-settlement")).evaluation.failures.join("\n");
    expect(failures).toMatch(/resource-byte-identity|resource-owned-bytes|terminal-raw-resource-event-nonzero/u);
    value.resourceEvents = [];
    value.cleanupReceipt.retiredResourceIds = [];
    expect(evaluateRuntimeScenarioLedger(value, expected("terminal-settlement")).evaluation.failures).toContain("terminal-no-acquired-resource-evidence");

    const overflow = ledger("terminal-settlement");
    overflow.resourceEvents = [
      { eventOrdinal: 0, atMicroseconds: 0, kind: "acquired", resourceId: "a", resourceBytes: Number.MAX_SAFE_INTEGER, ownedResources: 1, ownedBytes: Number.MAX_SAFE_INTEGER },
      { eventOrdinal: 1, atMicroseconds: 1, kind: "acquired", resourceId: "b", resourceBytes: 1, ownedResources: 2, ownedBytes: Number.MAX_SAFE_INTEGER }
    ];
    expect(() => evaluateRuntimeScenarioLedger(overflow, expected("terminal-settlement"))).toThrow(/overflow/u);
  });

  it("requires candidate-bound fixture authority and rejects under-count/substitution", () => {
    const value = ledger("loop-1000");
    expect(evaluateRuntimeScenarioLedger(value).evaluation.failures).toContain("fixture-authority-missing");
    value.frames.splice(-8);
    const result = evaluateRuntimeScenarioLedger(value, { ...expected("loop-1000"), candidateManifestDigest: "c".repeat(64), scenarioId: "all-routes-1000" as any });
    expect(result.evaluation.failures).toEqual(expect.arrayContaining(["loop-boundaries-below-1000", "candidate-manifest-digest-mismatch", "scenario-id-mismatch"]));
  });
});
