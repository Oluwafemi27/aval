import { describe, expect, it, vi } from "vitest";

import { createIntegratedOpaqueTestAsset } from "./asset-test-fixture.js";
import {
  PlayerWebPageRuntime,
  type PlayerWebRuntimeParticipant
} from "./player-web-page-runtime.js";

describe("player web page runtime", () => {
  it("keeps participant generation lifecycle-owned", async () => {
    const page = new PlayerWebPageRuntime();
    expect(() => page.createParticipant({ generation: 5 } as never))
      .toThrow("lifecycle-owned");
    expect(page.snapshot()).toMatchObject({
      activeParticipants: 0,
      resources: { participants: [] }
    });
    await page.dispose();
  });

  it("publishes one poster-free resource bundle", async () => {
    const page = new PlayerWebPageRuntime();
    const participant = page.createParticipant();

    expect(Object.keys(participant.resources).sort()).toEqual([
      "assetSession",
      "candidate",
      "canvasBacking",
      "participant"
    ]);
    expect(participant.resources.participant.candidateResourceAuthority)
      .toBe(participant.resources.candidate);

    await page.dispose();
  });

  it("retires an open asset and owned player before publishing replacement", async () => {
    const page = new PlayerWebPageRuntime();
    const participant = page.createParticipant();
    const session = await participant.openAssetBytes(
      createIntegratedOpaqueTestAsset()
    );
    const disposePlayer = vi.fn();
    participant.ownPlayer({ dispose: disposePlayer });

    await expect(participant.replace()).resolves.toBe(2);
    expect(session.disposed).toBe(true);
    expect(disposePlayer).toHaveBeenCalledOnce();
    expect(participant.snapshot()).toMatchObject({
      generation: 2,
      account: { participant: { generation: 2 } }
    });

    await page.dispose();
  });

  it("releases the sole animated canvas backing on replacement", async () => {
    const page = new PlayerWebPageRuntime();
    const participant = page.createParticipant();
    const oldResources = participant.resources;
    const transition = await oldResources.canvasBacking.beginTransition({
      animatedAllocationBytes: 16
    });
    transition.commit();
    expect(page.snapshot().resources.categories).toEqual(expect.arrayContaining([
      { category: "animated-canvas-backing", bytes: 16 }
    ]));

    await participant.replace();
    expect(participant.resources).not.toBe(oldResources);
    expect(page.snapshot().resources.physicalBytes).toBe(0);

    await page.dispose();
  });

  it("serializes concurrent replacements", async () => {
    const page = new PlayerWebPageRuntime();
    const participant = page.createParticipant();

    await expect(Promise.all([
      participant.replace(),
      participant.replace()
    ])).resolves.toEqual([2, 3]);
    expect(participant.generation).toBe(3);

    await page.dispose();
  });

  it("disposes all participants and resources idempotently", async () => {
    const page = new PlayerWebPageRuntime();
    const first = page.createParticipant();
    const second = page.createParticipant();
    await first.reserveWithReclamation("response-body", 5);
    await second.reserveWithReclamation("blob-assembly", 7);

    const disposal = page.dispose();
    expect(page.dispose()).toBe(disposal);
    await disposal;
    expect(page.snapshot()).toMatchObject({
      disposed: true,
      activeParticipants: 0,
      resources: {
        physicalBytes: 0,
        byteLeaseCount: 0,
        decoderLeaseCount: 0,
        participants: []
      }
    });
    expect(() => page.createParticipant()).toThrow();
  });

  it("rejects use after participant disposal", async () => {
    const page = new PlayerWebPageRuntime();
    const participant: PlayerWebRuntimeParticipant = page.createParticipant();
    await participant.dispose();
    expect(() => participant.resources).toThrow();
    await expect(participant.replace()).rejects.toMatchObject({
      name: "AbortError",
      message: "page runtime is disposed"
    });
    await page.dispose();
  });
});
