import { describe, expect, it } from "vitest";

import { PageDecoderLeases } from "./page-decoder-leases.js";
import { PageResourceManager } from "./page-resource-manager.js";
import {
  PlayerResourceAccount,
  retainPlayerReclaimableCategories
} from "./player-resource-account.js";
import {
  createPlayerBlobAssemblyResourceHost,
  createPlayerBodyResourceHost,
  createPlayerCanvasBackingResourceHost,
  createPlayerCandidateResourceAuthority,
  createPlayerFullBodyResourceHost,
  createPlayerVerifiedBlobResourceHost,
  reserveRuntimeResourcePlan
} from "./player-resource-hosts.js";
import type { RuntimeResourceAllocationSnapshot } from "./resource-plan.js";
import { MARK_VERIFIED_BLOB_RECLAIMABLE } from "./verified-blob-resources.js";

describe("player resource host adapters", () => {
  it("routes loader and verified-unit owners into closed categories", async () => {
    const manager = new PageResourceManager();
    const account = new PlayerResourceAccount(manager);
    const response = await createPlayerBodyResourceHost(
      account, "response-body"
    ).reserve(3);
    const quarantine = await createPlayerBodyResourceHost(
      account, "quarantine"
    ).reserve(5);
    const assembly = await createPlayerBlobAssemblyResourceHost(account)
      .reserve(7);
    const unit = await createPlayerVerifiedBlobResourceHost(account)
      .reserve("verified-unit", 11);

    expect(activeCategories(manager)).toEqual([
      { category: "response-body", bytes: 3 },
      { category: "quarantine", bytes: 5 },
      { category: "blob-assembly", bytes: 7 },
      { category: "verified-unit", bytes: 11 }
    ]);
    response.release();
    response.release();
    quarantine.release();
    assembly.release();
    unit.release();
    expect(manager.snapshot()).toMatchObject({
      physicalBytes: 0,
      byteLeaseCount: 0
    });
    account.dispose();
    manager.dispose();
  });

  it("promotes a validated full body atomically and releases mismatches", async () => {
    const manager = new PageResourceManager({
      maximumDecoderLeases: 1,
      maximumPagePhysicalBytes: 8,
      maximumPlayerLogicalBytes: 8,
      referenceProfile: true
    });
    const account = new PlayerResourceAccount(manager);
    const host = createPlayerFullBodyResourceHost(account);
    const mismatch = await host.reserve(8);
    expect(activeCategories(manager)).toEqual([
      { category: "quarantine", bytes: 8 }
    ]);
    mismatch.release();
    expect(manager.snapshot().physicalBytes).toBe(0);

    const body = await host.reserve(8);
    const before = manager.snapshot();
    body.promoteToAssetFull?.();
    body.promoteToAssetFull?.();
    expect(activeCategories(manager)).toEqual([
      { category: "asset-full", bytes: 8 }
    ]);
    expect(manager.snapshot()).toMatchObject({
      physicalBytes: before.physicalBytes,
      byteLeaseCount: before.byteLeaseCount
    });
    body.release();
    body.release();
    expect(manager.snapshot()).toMatchObject({
      physicalBytes: 0,
      byteLeaseCount: 0
    });
    account.dispose();
    manager.dispose();
  });

  it("publishes verified units only after residency commits", async () => {
    const manager = new PageResourceManager();
    const account = new PlayerResourceAccount(manager);
    const releaseCategory = retainPlayerReclaimableCategories(
      account, ["verified-unit"]
    );
    const lease = await createPlayerVerifiedBlobResourceHost(account)
      .reserve("verified-unit", 9);
    expect(account.snapshot().participant?.reclaimable).toEqual([]);
    const mark = Reflect.get(lease, MARK_VERIFIED_BLOB_RECLAIMABLE) as
      (() => void) | undefined;
    expect(mark).toBeTypeOf("function");
    Reflect.apply(mark!, lease, []);
    expect(account.snapshot().participant?.reclaimable).toEqual([
      { category: "verified-unit", bytes: 9 }
    ]);
    lease.release();
    releaseCategory();
    expect(account.snapshot().participant?.reclaimable).toEqual([]);
    account.dispose();
    manager.dispose();
  });

  it("reserves one reconciled poster-free runtime plan", () => {
    const manager = new PageResourceManager();
    const account = new PlayerResourceAccount(manager);
    const allocation = allocationSnapshot();
    const plan = reserveRuntimeResourcePlan(account, allocation);

    expect(plan.snapshot()).toEqual({
      released: false,
      totalBytes: 36,
      categories: [
        { category: "asset-full", bytes: 1 },
        { category: "worker-transfer", bytes: 5 },
        { category: "decoder-output", bytes: 4 },
        { category: "persistent-animation", bytes: 5 },
        { category: "streaming-texture", bytes: 6 },
        { category: "frame-staging", bytes: 7 },
        { category: "animated-canvas-backing", bytes: 8 }
      ]
    });
    expect(account.snapshot().participant?.logicalBytes).toBe(36);
    expect(() => plan.assertAllocation(allocation)).not.toThrow();
    expect(() => plan.assertAllocation(allocationSnapshot({
      ownedAssetBytes: 2,
      totalBytes: 37
    }))).toThrowError(expect.objectContaining({ code: "resource-rejection" }));
    plan.release();
    plan.release();
    expect(() => plan.assertAllocation(allocation))
      .toThrowError(expect.objectContaining({ code: "resource-rejection" }));
    expect(account.snapshot()).toMatchObject({ activeLeaseCount: 0 });
    expect(manager.snapshot().physicalBytes).toBe(0);
    account.dispose();
    manager.dispose();
  });

  it("accounts for only one animated canvas backing", async () => {
    const manager = new PageResourceManager();
    const account = new PlayerResourceAccount(manager);
    const host = createPlayerCanvasBackingResourceHost(account);
    const initial = await host.beginTransition({ animatedAllocationBytes: 10 });
    initial.commit();
    expect(activeCategories(manager)).toEqual([
      { category: "animated-canvas-backing", bytes: 10 }
    ]);

    const growth = await host.beginTransition({ animatedAllocationBytes: 15 });
    expect(manager.snapshot().physicalBytes).toBe(15);
    growth.commit();
    const rollback = await host.beginTransition({ animatedAllocationBytes: 20 });
    expect(manager.snapshot().physicalBytes).toBe(20);
    rollback.rollback();
    rollback.rollback();
    expect(manager.snapshot().physicalBytes).toBe(15);
    expect(() => rollback.commit()).toThrowError(
      expect.objectContaining({ code: "abort" })
    );

    host.release();
    host.release();
    expect(manager.snapshot().physicalBytes).toBe(0);
    account.dispose();
    manager.dispose();
  });

  it("binds candidate accounting and a decoder ticket to one generation", async () => {
    const manager = new PageResourceManager();
    const decoders = new PageDecoderLeases(manager);
    const account = new PlayerResourceAccount(manager, { generation: 7 });
    const authority = createPlayerCandidateResourceAuthority(account, decoders);
    const plan = await authority.reservePlan(allocationSnapshot());
    const ticket = authority.requestDecoder();
    const decoder = await ticket.wait();

    expect(ticket.snapshot()).toMatchObject({
      participantId: account.participantId,
      generation: 7,
      state: "granted"
    });
    expect(manager.snapshot()).toMatchObject({
      physicalBytes: 27,
      decoderLeaseCount: 1,
      decoderQueueLength: 0
    });
    plan.assertAllocation(allocationSnapshot());
    const transfer = plan.claimWorkerTransfer(2);
    expect(() => plan.claimWorkerTransfer(1))
      .toThrowError(expect.objectContaining({ code: "resource-rejection" }));
    transfer.release();
    plan.claimWorkerTransfer(1).release();
    decoder.release();
    plan.release();
    expect(manager.snapshot()).toMatchObject({
      physicalBytes: 0,
      decoderLeaseCount: 0,
      byteLeaseCount: 0
    });
    account.dispose();
    decoders.dispose();
    manager.dispose();
  });

  it("admits animation owners over independent loader and canvas leases", async () => {
    const manager = new PageResourceManager();
    const decoders = new PageDecoderLeases(manager);
    const account = new PlayerResourceAccount(manager);
    const base = [
      account.reserve("asset-metadata", 5),
      account.reserve("verified-unit", 11),
      account.reserve("animated-canvas-backing", 8)
    ];
    const allocation = allocationSnapshot({
      ownedAssetBytes: 16,
      totalBytes: 51
    });
    const plan = await createPlayerCandidateResourceAuthority(
      account,
      decoders
    ).reservePlan(allocation);

    expect(plan.snapshot()).toMatchObject({
      released: false,
      totalBytes: 51
    });
    expect(account.snapshot().participant?.logicalBytes).toBe(51);
    plan.assertAllocation(allocation);
    expect(activeCategories(manager)).toEqual(expect.arrayContaining([
      { category: "asset-metadata", bytes: 5 },
      { category: "verified-unit", bytes: 11 },
      { category: "worker-transfer", bytes: 5 },
      { category: "decoder-output", bytes: 4 },
      { category: "persistent-animation", bytes: 5 },
      { category: "streaming-texture", bytes: 6 },
      { category: "frame-staging", bytes: 7 },
      { category: "animated-canvas-backing", bytes: 8 }
    ]));

    plan.release();
    expect(account.snapshot().participant?.logicalBytes).toBe(24);
    for (const lease of base) lease.release();
    expect(manager.snapshot().physicalBytes).toBe(0);
    account.dispose();
    decoders.dispose();
    manager.dispose();
  });

  it("rolls earlier categories back when a later reservation exceeds policy", () => {
    const manager = new PageResourceManager({
      maximumDecoderLeases: 2,
      maximumPagePhysicalBytes: 20,
      maximumPlayerLogicalBytes: 20,
      referenceProfile: true
    });
    const account = new PlayerResourceAccount(manager);
    const allocation = allocationSnapshot({
      ownedAssetBytes: 10,
      maximumEncodedWindowBytes: 9,
      decoderEncodedWindowBytes: 9,
      totalBytes: 58
    });

    expect(() => reserveRuntimeResourcePlan(account, allocation))
      .toThrowError(expect.objectContaining({ code: "resource-rejection" }));
    expect(account.snapshot()).toMatchObject({ activeLeaseCount: 0 });
    expect(manager.snapshot()).toMatchObject({
      physicalBytes: 0,
      byteLeaseCount: 0
    });
    account.dispose();
    manager.dispose();
  });

  it("rejects generic categories and malformed account capabilities", () => {
    const manager = new PageResourceManager();
    const account = new PlayerResourceAccount(manager);
    expect(() => createPlayerBodyResourceHost(
      account,
      "asset-full" as unknown as "response-body"
    )).toThrow("category");
    expect(() => createPlayerBlobAssemblyResourceHost(
      {} as PlayerResourceAccount
    )).toThrow("account");
    account.dispose();
    manager.dispose();
  });
});

function activeCategories(manager: PageResourceManager) {
  return manager.snapshot().categories.filter(({ bytes }) => bytes > 0);
}

function allocationSnapshot(
  override: Partial<RuntimeResourceAllocationSnapshot> = {}
): RuntimeResourceAllocationSnapshot {
  const base: RuntimeResourceAllocationSnapshot = {
    ownedAssetBytes: 1,
    maximumEncodedWindowBytes: 2,
    decoderEncodedWindowBytes: 3,
    decodedSurfaceBytes: 4,
    persistentAllocationBytes: 5,
    streamingAllocationBytes: 6,
    frameStagingBytes: 7,
    animatedCanvasBackingAllocationBytes: 8,
    totalBytes: 36
  };
  return Object.freeze({ ...base, ...override });
}
