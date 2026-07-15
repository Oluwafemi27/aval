import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  parseFrontIndex,
  validateCompleteAsset
} from "../src/index.js";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const FIXTURE_ROOT = join(REPOSITORY_ROOT, "fixtures/conformance/m7");

describe("M7 checked loader fixture format conformance", () => {
  it("retains canonical 0.1 geometry and every internal digest", async () => {
    const [raw, provenanceText] = await Promise.all([
      readFile(join(FIXTURE_ROOT, "reference-packed.avl")),
      readFile(join(FIXTURE_ROOT, "reference-packed.provenance.json"), "utf8")
    ]);
    const bytes = new Uint8Array(raw);
    const provenance = JSON.parse(provenanceText);
    const validated = validateCompleteAsset({ bytes });

    expect(parseFrontIndex(bytes)).toEqual(validated.frontIndex);
    expect(validated.frontIndex.header).toMatchObject({
      major: 0,
      minor: 1,
      headerLength: 64,
      requiredFeatureFlags: 0,
      declaredFileLength: provenance.asset.bytes
    });
    expect(sha256(bytes)).toBe(provenance.asset.sha256);
    expect(validated.frontIndex.frontIndexRange)
      .toEqual(provenance.metadata.frontIndex);

    for (const blob of validated.frontIndex.unitBlobs) {
      expect(sha256(bytes.subarray(blob.offset, blob.offset + blob.length)))
        .toBe(blob.sha256);
    }
  });
});

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
