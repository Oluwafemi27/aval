import { validateCompleteAsset } from "@pixel-point/aval-format";
import { describe, expect, it } from "vitest";

// @ts-expect-error Vite exposes the checked binary as a data URL in tests.
import fixtureDataUrl from "../../../../fixtures/conformance/m7/reference-packed.avl?url&inline";
// @ts-expect-error Vite exposes the checked provenance as source text.
import provenanceText from "../../../../fixtures/conformance/m7/reference-packed.provenance.json?raw";
// @ts-expect-error Vite exposes the checked scenario catalog as source text.
import scenariosText from "../../../../fixtures/conformance/m7/network-scenarios.json?raw";

import {
  planBlobStorageRanges,
  type RuntimeBlobSelection
} from "./blob-range-plan.js";

describe("M7 checked sparse-loader fixture", () => {
  it("is canonical 0.1 output with frozen whole-file and blob digests", async () => {
    const bytes = decodeDataUrl(fixtureDataUrl);
    const provenance = JSON.parse(provenanceText);
    const validated = validateCompleteAsset({ bytes });

    expect(bytes.byteLength).toBe(provenance.asset.bytes);
    expect(await sha256(bytes)).toBe(provenance.asset.sha256);
    expect([
      validated.frontIndex.header.major,
      validated.frontIndex.header.minor
    ]).toEqual([0, 1]);
    expect(validated.frontIndex.frontIndexRange).toEqual(
      provenance.metadata.frontIndex
    );
    expect(validated.frontIndex.header.declaredFileLength)
      .toBe(provenance.asset.bytes);

    for (const blob of provenance.blobs) {
      expect(await sha256(
        bytes.subarray(blob.offset, blob.offset + blob.length)
      ))
        .toBe(blob.sha256);
      expect(
        bytes.subarray(
          blob.paddingOffset,
          blob.paddingOffset + blob.paddingLength
        ).every((value) => value === 0)
      ).toBe(true);
    }
    expect(findAbsolutePaths(provenance)).toEqual([]);
  });

  it("reproduces the exact bootstrap, rendition, and all-payload plans", () => {
    const bytes = decodeDataUrl(fixtureDataUrl);
    const provenance = JSON.parse(provenanceText);
    const frontIndex = validateCompleteAsset({ bytes }).frontIndex;
    const rendition = provenance.selectedRendition.id as string;
    const bootstrapUnits = provenance.bootstrapUnits.map(
      (unit: string): RuntimeBlobSelection => ({
        kind: "unit",
        rendition,
        unit
      })
    );
    expect(requestRanges(planBlobStorageRanges({
      frontIndex,
      requested: bootstrapUnits
    }))).toEqual(provenance.expectedRangePlans.bootstrapUnits);

    const selectedUnits = frontIndex.unitBlobs
      .filter((blob) => blob.rendition === rendition)
      .map<RuntimeBlobSelection>(({ rendition, unit }) => ({
        kind: "unit",
        rendition,
        unit
      }));
    const selectedPlan = planBlobStorageRanges({
      frontIndex,
      requested: selectedUnits
    });
    expect(requestRanges(selectedPlan))
      .toEqual(provenance.expectedRangePlans.selectedRendition);
    expect(selectedPlan.totalStorageBytes)
      .toBe(provenance.selectedRendition.storageBytes);

    const allPayload = frontIndex.unitBlobs.map<RuntimeBlobSelection>(
      ({ rendition, unit }) => ({ kind: "unit", rendition, unit })
    );
    expect(requestRanges(planBlobStorageRanges({
      frontIndex,
      requested: allPayload
    }))).toEqual(provenance.expectedRangePlans.allPayload);
    expect(Object.isFrozen(selectedPlan)).toBe(true);
    expect(Object.isFrozen(selectedPlan.requests)).toBe(true);
  });

  it("freezes one bounded behavior catalog with no duplicated mutation assets", () => {
    const scenarios = JSON.parse(scenariosText);
    expect(scenarios).toMatchObject({
      schemaVersion: "0.1",
      fixture: "reference-packed.avl"
    });
    expect(scenarios.scenarios).toHaveLength(15);
    expect(new Set(scenarios.scenarios.map(({ id }: { id: string }) => id)).size)
      .toBe(15);
    expect(scenarios.scenarios.map(({ id }: { id: string }) => id)).toEqual([
      "exact-range",
      "ignored-initial-range",
      "no-validator",
      "weak-etag",
      "changed-etag",
      "wrong-total",
      "truncated-body",
      "oversized-body",
      "compressed-body",
      "stalled-body",
      "corrupt-unit",
      "corrupt-bootstrap-unit",
      "nonzero-padding",
      "valid-external-integrity",
      "invalid-external-integrity"
    ]);
  });
});

function requestRanges(plan: Readonly<{
  readonly requests: readonly Readonly<{ offset: number; length: number }>[];
}>): readonly Readonly<{ offset: number; length: number }>[] {
  return plan.requests.map(({ offset, length }) => ({ offset, length }));
}

function decodeDataUrl(value: string): Uint8Array {
  const separator = value.indexOf(",");
  if (separator < 0 || !value.slice(0, separator).endsWith(";base64")) {
    throw new Error("M7 fixture data URL is malformed");
  }
  const binary = atob(value.slice(separator + 1));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    bytes.slice().buffer
  ));
  return [...digest]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function findAbsolutePaths(value: unknown, path = "provenance"): string[] {
  if (typeof value === "string") {
    return value.startsWith("/") ? [path] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      findAbsolutePaths(entry, `${path}[${String(index)}]`)
    );
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, entry]) =>
      findAbsolutePaths(entry, `${path}.${key}`)
    );
  }
  return [];
}
