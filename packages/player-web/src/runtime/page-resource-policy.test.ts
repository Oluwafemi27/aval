import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAXIMUM_DECODER_LEASES,
  DEFAULT_MAXIMUM_PAGE_PHYSICAL_BYTES,
  DEFAULT_MAXIMUM_PLAYER_LOGICAL_BYTES,
  createRuntimePageResourcePolicy
} from "./page-resource-policy.js";

describe("page resource policy", () => {
  it("creates the frozen reference defaults", () => {
    const policy = createRuntimePageResourcePolicy();
    expect(policy).toEqual({
      maximumDecoderLeases: 2,
      maximumPagePhysicalBytes: Number.MAX_SAFE_INTEGER,
      maximumPlayerLogicalBytes: Number.MAX_SAFE_INTEGER,
      referenceProfile: true
    });
    expect(Object.isFrozen(policy)).toBe(true);
    expect(DEFAULT_MAXIMUM_DECODER_LEASES).toBe(2);
    expect(DEFAULT_MAXIMUM_PAGE_PHYSICAL_BYTES).toBe(Number.MAX_SAFE_INTEGER);
    expect(DEFAULT_MAXIMUM_PLAYER_LOGICAL_BYTES).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("accepts lower limits without changing reference-profile status", () => {
    expect(createRuntimePageResourcePolicy({
      maximumDecoderLeases: 0,
      maximumPagePhysicalBytes: 96 * 1024 * 1024,
      maximumPlayerLogicalBytes: 32 * 1024 * 1024
    })).toEqual({
      maximumDecoderLeases: 0,
      maximumPagePhysicalBytes: 96 * 1024 * 1024,
      maximumPlayerLogicalBytes: 32 * 1024 * 1024,
      referenceProfile: true
    });
  });

  it("accepts byte policies above the former defaults without an opt-in", () => {
    expect(createRuntimePageResourcePolicy({
      maximumPagePhysicalBytes: 193 * 1024 * 1024,
      maximumPlayerLogicalBytes: 65 * 1024 * 1024
    })).toMatchObject({
      maximumPagePhysicalBytes: 193 * 1024 * 1024,
      maximumPlayerLogicalBytes: 65 * 1024 * 1024,
      referenceProfile: true
    });
  });

  it("keeps the decoder-concurrency reference opt-in", () => {
    const input = { maximumDecoderLeases: 3 };
    expect(() => createRuntimePageResourcePolicy(input)).toThrow();
    expect(createRuntimePageResourcePolicy({
      ...input,
      allowUncertifiedHigherLimits: true
    }).referenceProfile).toBe(false);
  });

  it("does not mark a lower policy uncertified merely because opt-in is present", () => {
    expect(createRuntimePageResourcePolicy({
      maximumPagePhysicalBytes: 1024,
      maximumPlayerLogicalBytes: 512,
      allowUncertifiedHigherLimits: true
    }).referenceProfile).toBe(true);
  });

  it.each([
    { maximumDecoderLeases: -1 },
    { maximumDecoderLeases: 1.5 },
    { maximumPagePhysicalBytes: 0 },
    { maximumPagePhysicalBytes: Number.MAX_SAFE_INTEGER + 1 },
    { maximumPlayerLogicalBytes: -1 },
    { maximumPlayerLogicalBytes: Number.NaN }
  ])("rejects hostile numeric policy %#", (input) => {
    expect(() => createRuntimePageResourcePolicy(input)).toThrow();
  });

  it("rejects unknown fields and non-boolean opt-in values", () => {
    expect(() => createRuntimePageResourcePolicy({
      maximumDecoderLeases: 1,
      surprise: true
    } as never)).toThrow();
    expect(() => createRuntimePageResourcePolicy({
      allowUncertifiedHigherLimits: 1
    } as never)).toThrow();
  });
});
