import { describe, expect, it } from "vitest";

// @ts-expect-error Vite exposes the checked-in binary as a data URL in tests.
import packedFixtureDataUrl from "../../../../fixtures/conformance/m6/packed-alpha-all-routes.rma?url&inline";

import { runIntegratedFuzzSeed } from "./integrated-player-fuzz-support.js";

const FUZZ_SEEDS = Object.freeze([
  { seed: 1, profile: "opaque" as const },
  { seed: 0x5eed_c0de, profile: "packed" as const },
  { seed: 0x00c0_ffee, profile: "opaque" as const },
  { seed: 0xffff_ffff, profile: "packed" as const }
] as const);
const PACKED_FIXTURE = decodeFixture(packedFixtureDataUrl);

describe("IntegratedPlayer fixed-seed model properties", () => {
  for (const { seed, profile } of FUZZ_SEEDS) {
    it(`replays bounded ${profile} seed 0x${seed.toString(16)} deterministically`, async () => {
      const options = profile === "packed"
        ? { bytes: PACKED_FIXTURE }
        : {};
      const first = await runIntegratedFuzzSeed(seed, options);
      const second = await runIntegratedFuzzSeed(seed, options);

      expect(second).toEqual(first);
      expect(first.profile).toBe(profile === "packed"
        ? "avc-annexb-packed-alpha-v0"
        : "avc-annexb-opaque-v0");
      expect(first.abortAction).toBe(true);
      expect(first.resizeActions).toBeGreaterThan(0);
    });
  }
});

function decodeFixture(dataUrl: string): Uint8Array {
  const separator = dataUrl.indexOf(",");
  if (
    !dataUrl.startsWith("data:") ||
    separator < 0 ||
    !dataUrl.slice(0, separator).endsWith(";base64")
  ) {
    throw new Error("Vite did not inline the M6 fixture as base64");
  }
  const binary = atob(dataUrl.slice(separator + 1));
  return Uint8Array.from(binary, (value) => value.charCodeAt(0));
}
