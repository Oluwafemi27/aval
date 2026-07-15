import { describe, expect, it, vi } from "vitest";

import type {
  RuntimeByteCategory,
  RuntimeByteLease,
  RuntimeParticipantId,
  RuntimeParticipantPhase,
  RuntimeParticipantVisibility,
  RuntimeReclamationRequest,
  RuntimeReclamationResult
} from "./model.js";
import { PageReclamationCoordinator } from "./page-reclamation.js";
import { PageResourceManager } from "./page-resource-manager.js";
import { createRuntimePageResourcePolicy } from "./page-resource-policy.js";

describe("page reclamation", () => {
  it("reclaims abandoned then hidden animation while protecting visible animation", async () => {
    const { manager, coordinator, participants } = setup(12, 12, 4);
    const log: string[] = [];
    const abandoned = ownedReclaimable(
      manager, participants[0]!, "quarantine", 4, "visible", "preparing"
    );
    const hidden = ownedReclaimable(
      manager, participants[1]!, "streaming-texture", 4, "hidden", "animated"
    );
    const protectedAnimation = ownedReclaimable(
      manager, participants[2]!, "streaming-texture", 4, "visible", "animated"
    );
    registerRelease(coordinator, abandoned, log);
    registerRelease(coordinator, hidden, log);
    const protectedCallback = registerRelease(
      coordinator, protectedAnimation, log
    );

    const lease = await coordinator.reserveWithReclamation({
      participantId: participants[3]!,
      generation: 1,
      category: "asset-full",
      bytes: 8
    });

    expect(log).toEqual(["abandoned-animation", "hidden-animation"]);
    expect(protectedCallback).not.toHaveBeenCalled();
    expect(lease.snapshot().bytes).toBe(8);
    lease.release();
    protectedAnimation.lease.release();
    await coordinator.dispose();
    manager.dispose();
  });

  it("uses requester fallback to satisfy per-player pressure", async () => {
    const { manager, coordinator, participants } = setup(12, 8, 2);
    const ownAnimation = ownedReclaimable(
      manager, participants[0]!, "persistent-animation", 8, "visible", "animated"
    );
    const pinned = manager.reserve(participants[1]!, "asset-metadata", 4);
    const calls: RuntimeReclamationRequest[] = [];
    coordinator.registerParticipant(participants[0]!, {
      async reclaim(request) {
        calls.push(request);
        ownAnimation.lease.release();
        return resultFor(request, 8);
      }
    });

    const lease = await coordinator.reserveWithReclamation({
      participantId: participants[0]!,
      generation: 1,
      category: "decoder-output",
      bytes: 4
    });

    expect(calls.map(({ reason }) => reason)).toEqual(["requester-fallback"]);
    expect(lease.snapshot().bytes).toBe(4);
    lease.release();
    pinned.release();
    await coordinator.dispose();
    manager.dispose();
  });

  it("rejects pressure that cannot be reclaimed without partial callbacks", async () => {
    const { manager, coordinator, participants } = setup(8, 8, 2);
    const protectedAnimation = ownedReclaimable(
      manager, participants[0]!, "streaming-texture", 8, "visible", "animated"
    );
    const callback = registerRelease(coordinator, protectedAnimation, []);

    await expect(coordinator.reserveWithReclamation({
      participantId: participants[1]!,
      generation: 1,
      category: "asset-full",
      bytes: 1
    })).rejects.toMatchObject({ code: "resource-rejection" });
    expect(callback).not.toHaveBeenCalled();
    expect(manager.snapshot().physicalBytes).toBe(8);
    protectedAnimation.lease.release();
    await coordinator.dispose();
    manager.dispose();
  });
});

interface OwnedReclaimable {
  readonly participantId: RuntimeParticipantId;
  readonly lease: RuntimeByteLease;
  readonly bytes: number;
}

function setup(pageBytes: number, playerBytes: number, count: number) {
  const manager = new PageResourceManager(createRuntimePageResourcePolicy({
    maximumPagePhysicalBytes: pageBytes,
    maximumPlayerLogicalBytes: playerBytes
  }));
  const participants = Array.from({ length: count }, () =>
    manager.registerParticipant()
  );
  return {
    manager,
    coordinator: new PageReclamationCoordinator(manager),
    participants
  };
}

function ownedReclaimable(
  manager: PageResourceManager,
  participantId: RuntimeParticipantId,
  category: RuntimeByteCategory,
  bytes: number,
  visibility: RuntimeParticipantVisibility,
  phase: RuntimeParticipantPhase
): OwnedReclaimable {
  const lease = manager.reserve(participantId, category, bytes);
  manager.updateParticipant(participantId, {
    visibility,
    phase,
    reclaimable: [{ category, bytes }]
  });
  return { participantId, lease, bytes };
}

function registerRelease(
  coordinator: PageReclamationCoordinator,
  owned: OwnedReclaimable,
  log: string[]
) {
  const reclaim = vi.fn(async (request: RuntimeReclamationRequest) => {
    log.push(request.reason);
    owned.lease.release();
    return resultFor(request, owned.bytes);
  });
  coordinator.registerParticipant(owned.participantId, { reclaim });
  return reclaim;
}

function resultFor(
  request: RuntimeReclamationRequest,
  releasedBytes: number
): RuntimeReclamationResult {
  return Object.freeze({ token: request.token, releasedBytes, covered: true });
}
