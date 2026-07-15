import { describe, expect, it, vi } from "vitest";

import * as certification from "../../packages/certification/src/publication-ledger.js";
import { reconcileRegistryMutation } from "../../scripts/release/registry-reconciler.mjs";

const integrity = `sha512-${Buffer.alloc(64, 2).toString("base64")}`;
const identity = {
  packageName: "@pixel-point/aval-graph",
  version: "1.0.0" as const,
  tarballSha256: "a".repeat(64),
  registryIntegrity: integrity,
  desiredTag: "next" as const,
  sequence: 1,
  timestamp: "2026-07-12T13:00:00.000Z",
  approvalId: "approval-1"
};
const absent = { name: identity.packageName, version: identity.version, integrity: null, tags: {} };
const exact = { name: identity.packageName, version: identity.version, integrity, tags: { next: "1.0.0" } };

describe("registry mutation reconciliation", () => {
  it("recognizes a successful write even when the transport reports failure", () => {
    const planned = certification.planExactPublication({ ...identity, registry: absent });
    const result = reconcileRegistryMutation({ planned, mutate: () => { throw new Error("connection reset after write"); }, readState: () => exact, certification });
    expect(result).toMatchObject({ operation: { result: "applied" }, error: null, reconciledAfterMutationError: true });
  });

  it("records an ambiguous operation when both mutation and post-read are unavailable", () => {
    const planned = certification.planExactPublication({ ...identity, registry: absent });
    const result = reconcileRegistryMutation({ planned, mutate: () => { throw new Error("timeout"); }, readState: () => { throw new Error("registry unavailable"); }, certification });
    expect(result.operation).toMatchObject({ result: "ambiguous", afterStateDigest: null });
    expect(result.error).toBeInstanceOf(AggregateError);
  });

  it("records the observed non-target state as a failed operation", () => {
    const planned = certification.planExactPublication({ ...identity, registry: absent });
    const result = reconcileRegistryMutation({ planned, mutate: () => undefined, readState: () => absent, certification });
    expect(result.operation).toMatchObject({ result: "failed", afterStateDigest: expect.stringMatching(/^[0-9a-f]{64}$/u) });
    expect(result.error).toBeInstanceOf(Error);
  });

  it("does not mutate when compensation sees a concurrently changed tag", () => {
    const conflict = certification.planTagCompensation({
      ...identity,
      desiredTag: "next",
      targetVersion: null,
      requiredCurrentTag: "1.0.0",
      registry: { ...exact, tags: { next: "1.0.1" } }
    });
    const mutate = vi.fn();
    const result = reconcileRegistryMutation({ planned: conflict, mutate, readState: () => exact, certification });
    expect(result.operation.result).toBe("conflict");
    expect(mutate).not.toHaveBeenCalled();
  });

  it("treats an already-absent initial-release tag as exact removal", () => {
    const removal = certification.planTagCompensation({
      ...identity,
      desiredTag: "next",
      targetVersion: null,
      requiredCurrentTag: "1.0.0",
      registry: { ...exact, tags: {} }
    });
    const mutate = vi.fn();
    const result = reconcileRegistryMutation({ planned: removal, mutate, readState: () => exact, certification });
    expect(result.operation).toMatchObject({ action: "rollback-tag", before: null, after: null, result: "already-exact" });
    expect(mutate).not.toHaveBeenCalled();
  });
});
