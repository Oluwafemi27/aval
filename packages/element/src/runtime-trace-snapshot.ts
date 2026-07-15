import type { RuntimeTraceRecord } from "@pixel-point/aval-player-web";

import type { AvalRuntimeTraceRecord } from "./public-types.js";

type Graph = NonNullable<RuntimeTraceRecord["graph"]>;
type Presentation = NonNullable<Graph["presentation"]>;
type Cursor = NonNullable<RuntimeTraceRecord["scheduler"]["sourceCursor"]>;

/** Copy the complete public, handle-free runtime trace into JSON-safe frozen data. */
export function snapshotRuntimeTrace(
  records: readonly Readonly<RuntimeTraceRecord>[]
): readonly Readonly<AvalRuntimeTraceRecord>[] {
  return Object.freeze(records.slice(-512).map((record) => Object.freeze({
    index: record.index,
    kind: record.kind,
    presentationOrdinal: record.presentationOrdinal?.toString() ?? null,
    rationalDeadlineUs: record.rationalDeadlineUs,
    callbackStartMicroseconds: record.callbackStartMicroseconds,
    canvasSubmissionCompleteMicroseconds:
      record.canvasSubmissionCompleteMicroseconds,
    eligibleAnimationFrameOrdinal: record.eligibleAnimationFrameOrdinal,
    graph: record.graph === null ? null : copyGraph(record.graph),
    routeReady: record.routeReady,
    selectedBoundary: record.selectedBoundary,
    scheduler: copyScheduler(record.scheduler),
    submitted: Object.freeze(record.submitted.map(copyCursor)),
    media: copyMedia(record.media),
    readbackTag: record.readbackTag,
    readiness: record.readiness,
    decodeLeadFrames: record.decodeLeadFrames,
    settledRequestIds: Object.freeze([...record.settledRequestIds]),
    counters: Object.freeze({
      underflows: record.counters.underflows,
      fallbacks: record.counters.fallbacks,
      settledRequests: record.counters.settledRequests,
      cleanedFrames: record.counters.cleanedFrames
    })
  }))) as readonly Readonly<AvalRuntimeTraceRecord>[];
}

function copyGraph(graph: Readonly<Graph>): Readonly<Record<string, unknown>> {
  return Object.freeze({
    operation: graph.operation,
    snapshot: Object.freeze({
      readiness: graph.snapshot.readiness,
      phase: graph.snapshot.phase,
      initialUnitPending: graph.snapshot.initialUnitPending,
      requestedState: graph.snapshot.requestedState,
      visualState: graph.snapshot.visualState,
      prospectiveState: graph.snapshot.prospectiveState,
      isTransitioning: graph.snapshot.isTransitioning,
      presentation: copyPresentation(graph.snapshot.presentation),
      pendingEdgeId: graph.snapshot.pendingEdgeId,
      activeEdgeId: graph.snapshot.activeEdgeId,
      followOnEdgeId: graph.snapshot.followOnEdgeId,
      direction: graph.snapshot.direction,
      contentOrdinal: graph.snapshot.contentOrdinal?.toString() ?? null,
      inputSequence: graph.snapshot.inputSequence,
      pendingRequestCount: graph.snapshot.pendingRequestCount,
      inputsSinceTick: graph.snapshot.inputsSinceTick,
      routeOperationsLastTick: graph.snapshot.routeOperationsLastTick
    }),
    presentation: copyPresentation(graph.presentation),
    effects: Object.freeze(graph.effects.map((effect) => {
      if (effect.type !== "settle") return Object.freeze({ ...effect });
      return Object.freeze({
        type: effect.type,
        requestIds: Object.freeze([...effect.requestIds]),
        outcome: Object.freeze({ ...effect.outcome })
      });
    }))
  });
}

function copyPresentation(
  presentation: Readonly<Presentation> | null
): Readonly<Record<string, unknown>> | null {
  return presentation === null ? null : Object.freeze({ ...presentation });
}

function copyScheduler(
  scheduler: Readonly<RuntimeTraceRecord["scheduler"]>
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    generation: scheduler.generation,
    activePath: scheduler.activePath,
    sourceCursor: copyCursorOrNull(scheduler.sourceCursor),
    submittedCursor: copyCursorOrNull(scheduler.submittedCursor),
    decodedCursor: copyCursorOrNull(scheduler.decodedCursor),
    displayedCursor: copyCursorOrNull(scheduler.displayedCursor),
    ringSize: scheduler.ringSize,
    ringCapacity: scheduler.ringCapacity,
    smoothSession: scheduler.smoothSession
  });
}

function copyCursor(cursor: Readonly<Cursor>): Readonly<Record<string, unknown>> {
  return Object.freeze({
    path: cursor.path,
    unit: cursor.unit,
    unitInstance: cursor.unitInstance,
    localFrame: cursor.localFrame
  });
}

function copyCursorOrNull(
  cursor: Readonly<Cursor> | null
): Readonly<Record<string, unknown>> | null {
  return cursor === null ? null : copyCursor(cursor);
}

function copyMedia(
  media: Readonly<RuntimeTraceRecord["media"]>
): Readonly<Record<string, unknown>> | null {
  if (media === null) return null;
  if (media.kind === "static") {
    return Object.freeze({
      kind: media.kind,
      state: media.state,
      drawSource: media.drawSource
    });
  }
  return Object.freeze({
    kind: media.kind,
    graphKind: media.graphKind,
    state: media.state,
    edge: media.edge,
    path: media.path,
    frame: Object.freeze({
      rendition: media.frame.rendition,
      unit: media.frame.unit,
      localFrame: media.frame.localFrame
    }),
    drawSource: media.drawSource,
    generation: media.generation,
    unitInstance: media.unitInstance,
    decodeOrdinal: media.decodeOrdinal,
    timestamp: media.timestamp,
    intendedPresentationOrdinal: media.intendedPresentationOrdinal.toString()
  });
}
