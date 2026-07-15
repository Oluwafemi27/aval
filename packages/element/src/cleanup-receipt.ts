import type {
  BrowserAvcCandidateComposition,
  BrowserPresentationPlanes,
  IntegratedPlayer,
  PlayerWebPageRuntime,
  RuntimeAssetSession,
  RuntimeParticipantId
} from "@aval/player-web";

import type { AvalCleanupReceipt } from "./public-types.js";

export async function settleCleanupOperation(
  operation: () => void | PromiseLike<unknown> | null | undefined,
  failures: unknown[]
): Promise<void> {
  try { await operation(); } catch (error) { failures.push(error); }
}

/** Capture a conservative, nonthrowing terminal proof from real owners. */
export function captureCleanupReceipt(input: Readonly<{
  elementGeneration: number;
  sourceGeneration: number;
  participantId: RuntimeParticipantId;
  pageRuntime: PlayerWebPageRuntime;
  participant: ReturnType<PlayerWebPageRuntime["createParticipant"]>;
  session: RuntimeAssetSession | null;
  planes: BrowserPresentationPlanes | null;
  composition: Readonly<BrowserAvcCandidateComposition> | null;
  player: IntegratedPlayer | null;
  operationFailureCount: number;
}>): Readonly<AvalCleanupReceipt> {
  let snapshotFailureCount = 0;
  const read = <Value>(operation: () => Value): Value | null => {
    try { return operation(); } catch {
      snapshotFailureCount += 1;
      return null;
    }
  };
  const participant = read(() => input.participant.snapshot());
  const account = participant?.account ?? null;
  const session = input.session === null
    ? null
    : read(() => input.session!.snapshot());
  const page = read(() => input.pageRuntime.snapshot());
  const candidate = input.composition === null
    ? null
    : read(() => input.composition!.controls.snapshot());
  const presentation = input.planes === null
    ? null
    : read(() => input.planes!.snapshot());
  const playerSnapshot = input.player === null
    ? null
    : read(() => input.player!.snapshot());
  const playerDisposed = input.player === null || playerSnapshot?.disposed === true;
  const participantTickets = page?.decoders.tickets.filter(
    ({ participantId }) => participantId === input.participantId
  ) ?? [];
  const participantLogicalBytes = account?.participant?.logicalBytes ?? 0;
  const participantRegistered = page === null || page.resources.participants.some(
    ({ id }) => id === input.participantId
  );
  const workerCount = candidate?.cleanup.workersAlive ?? 0;
  const openFrames = candidate?.cleanup.openFrames ?? 0;
  const rendererResourceCount =
    (candidate?.cleanup.renderersAlive ?? 0) +
    (candidate?.cleanup.glResourceCount ?? 0) +
    (presentation?.backendAttached === true ? 1 : 0) +
    (presentation?.resourceReservations ?? 0) +
    (presentation?.liveResourceTotals.filter((bytes) => bytes !== 0).length ?? 0);
  const contextListenerCount = presentation?.contextListeners ?? 0;
  const registeredCleanupCount = participant?.lifecycle.registeredCleanupCount ?? 1;
  const trackedWorkCount = participant?.lifecycle.trackedWorkCount ?? 1;
  const pendingWaitCount = participant?.lifecycle.pendingWaitCount ?? 1;
  const invariantFailureCount = [
    !playerDisposed,
    participant?.disposed !== true,
    participantRegistered,
    participantLogicalBytes !== 0,
    (account?.activeLeaseCount ?? 1) !== 0,
    registeredCleanupCount !== 0,
    trackedWorkCount !== 0,
    pendingWaitCount !== 0,
    participantTickets.length !== 0,
    workerCount !== 0,
    openFrames !== 0,
    (candidate?.cleanup.pendingOperations ?? 0) !== 0,
    (candidate?.cleanup.sourceCopiesInFlight ?? 0) !== 0,
    (candidate?.cleanup.rendererStagingBytes ?? 0) !== 0,
    (session?.pendingLoads ?? 0) !== 0,
    (session?.activeTransportBodies ?? 0) !== 0,
    (session?.interestedWaiters ?? 0) !== 0,
    rendererResourceCount !== 0,
    contextListenerCount !== 0,
    candidate?.cleanup.complete === false
  ].filter(Boolean).length;
  const failureCount = input.operationFailureCount +
    (participant?.lifecycle.cleanupFailureCount ?? 0) +
    snapshotFailureCount +
    invariantFailureCount;
  return Object.freeze({
    elementGeneration: input.elementGeneration,
    sourceGeneration: input.sourceGeneration,
    completed: failureCount === 0,
    failureCount,
    playerDisposed,
    participantDisposed: participant?.disposed === true,
    participantRegistered,
    participantLogicalBytes,
    participantActiveLeaseCount: account?.activeLeaseCount ?? 0,
    participantRegisteredCleanupCount: registeredCleanupCount,
    participantTrackedWorkCount: trackedWorkCount,
    participantPendingWaitCount: pendingWaitCount,
    participantDecoderTicketCount: participantTickets.length,
    participantDecoderState: participantTickets[0]?.state ?? null,
    workerCount,
    openFrames,
    pendingRuntimeOperations: candidate?.cleanup.pendingOperations ?? 0,
    sourceCopiesInFlight: candidate?.cleanup.sourceCopiesInFlight ?? 0,
    rendererStagingBytes: candidate?.cleanup.rendererStagingBytes ?? 0,
    pendingLoads: session?.pendingLoads ?? 0,
    activeTransportBodies: session?.activeTransportBodies ?? 0,
    interestedWaiters: session?.interestedWaiters ?? 0,
    rendererResourceCount,
    contextListenerCount,
    stalePublicationCount: candidate?.worker.metrics?.staleFrames ?? 0,
    pagePhysicalBytes: page?.resources.physicalBytes ?? 0,
    pageParticipantCount: page?.activeParticipants ?? 0,
    pageActiveDecoderLeaseCount: page?.decoders.activeLeaseCount ?? 0,
    pageQueuedDecoderTicketCount: page?.decoders.queuedTicketCount ?? 0,
    pageParkedDecoderTicketCount: page?.decoders.parkedTicketCount ?? 0
  });
}
