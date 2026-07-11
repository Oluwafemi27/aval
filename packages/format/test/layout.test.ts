import { describe, expect, it } from "vitest";

import { writeUint64LE } from "../src/checked-integer.js";
import { FormatError } from "../src/errors.js";
import { deriveCanonicalAssetLayout } from "../src/layout.js";
import { parseFrontIndex, validateCompleteAsset } from "../src/parser.js";
import type { ParsedFrontIndex } from "../src/model.js";
import { canonicalAssetFixture } from "./asset-fixture.js";

function expectFormatError(
  action: () => unknown,
  code: FormatError["code"]
): FormatError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(FormatError);
    expect((error as FormatError).code).toBe(code);
    return error as FormatError;
  }
  throw new Error("expected a FormatError");
}

function replaceAscii(
  bytes: Uint8Array,
  offset: number,
  from: string,
  to: string
): void {
  expect(to.length).toBe(from.length);
  for (let index = 0; index < from.length; index += 1) {
    expect(bytes[offset + index]).toBe(from.charCodeAt(index));
    bytes[offset + index] = to.charCodeAt(index);
  }
}

describe("canonical asset layout", () => {
  it("validates an exact complete file and returns frozen range-only geometry", () => {
    const fixture = canonicalAssetFixture();
    const result = validateCompleteAsset({ bytes: fixture.bytes });

    expect(result.fileRange).toEqual({
      offset: 0,
      length: fixture.bytes.byteLength
    });
    expect(result.frontIndex.unitBlobs.map(({ rendition, unit }) => ({ rendition, unit })))
      .toEqual(
        fixture.manifest.units.map((unit) => ({
          rendition: "reference",
          unit: unit.id
        }))
      );
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.fileRange)).toBe(true);
    expect(Object.isFrozen(result.frontIndex)).toBe(true);
  });

  it("accepts every possible unit-end alignment residue and inserts only the exact next padding", () => {
    for (let residue = 0; residue < 8; residue += 1) {
      const fixture = canonicalAssetFixture({
        profile: "avc",
        sampleLength: (ordinal) => (ordinal === 0 ? 40 + residue : 40)
      });
      const result = validateCompleteAsset({ bytes: fixture.bytes });
      const first = result.frontIndex.unitBlobs[0]!;
      const second = result.frontIndex.unitBlobs[1]!;
      const firstEnd = first.offset + first.length;

      expect(firstEnd % 8).toBe(residue);
      expect(second.offset - firstEnd).toBe(residue === 0 ? 0 : 8 - residue);
    }
  });

  it("rejects a nonzero byte in every canonical alignment region", () => {
    const fixture = canonicalAssetFixture({
      profile: "avc",
      sampleLength: (ordinal) => (ordinal % 7) + 33,
      staticLength: 67,
      generatorSuffix: "pad"
    });
    const front = parseFrontIndex(fixture.bytes);
    const layout = deriveCanonicalAssetLayout(
      front.header,
      front.manifest,
      front.records
    );
    expect(layout.paddingRanges.length).toBeGreaterThan(3);

    for (const range of layout.paddingRanges) {
      const bytes = fixture.bytes.slice();
      bytes[range.offset] = 1;
      const error = expectFormatError(
        () => validateCompleteAsset({ bytes }),
        "LAYOUT_INVALID"
      );
      expect(error.offset).toBe(range.offset);
    }
  });

  it("rejects record gaps, overlaps, and aliases before inspecting payloads", () => {
    const fixture = canonicalAssetFixture({ profile: "avc" });
    const indexOffset = parseFrontIndex(fixture.bytes).header.indexOffset;
    const first = fixture.records[0]!;
    const second = fixture.records[1]!;
    const secondRecordOffset = indexOffset + 16 + 32;

    const mutations = [
      first.payloadOffset,
      second.payloadOffset - 1,
      second.payloadOffset + 1
    ];
    for (const payloadOffset of mutations) {
      const bytes = fixture.bytes.slice();
      writeUint64LE(
        bytes,
        secondRecordOffset,
        payloadOffset,
        "INDEX_INVALID"
      );
      expectFormatError(() => parseFrontIndex(bytes), "LAYOUT_INVALID");
    }
  });

  it("rejects aliased static descriptors from canonical manifest bytes", () => {
    const fixture = canonicalAssetFixture({ profile: "avc" });
    const bytes = fixture.bytes.slice();
    const header = parseFrontIndex(bytes).header;
    const firstOffset = String(fixture.manifest.staticFrames[0]!.offset);
    const secondOffset = String(fixture.manifest.staticFrames[1]!.offset);
    expect(secondOffset.length).toBe(firstOffset.length);
    const manifestText = new TextDecoder().decode(
      bytes.subarray(
        header.manifestOffset,
        header.manifestOffset + header.manifestLength
      )
    );
    const token = `\"offset\":${secondOffset}`;
    const tokenOffset = manifestText.indexOf(token);
    expect(tokenOffset).toBeGreaterThanOrEqual(0);
    replaceAscii(
      bytes,
      header.manifestOffset + tokenOffset + `\"offset\":`.length,
      secondOffset,
      firstOffset
    );

    expectFormatError(() => parseFrontIndex(bytes), "LAYOUT_INVALID");
  });

  it("requires the caller bytes to end exactly at the declared file boundary", () => {
    const fixture = canonicalAssetFixture();
    const trailing = new Uint8Array(fixture.bytes.byteLength + 1);
    trailing.set(fixture.bytes);

    const trailingError = expectFormatError(
      () => validateCompleteAsset({ bytes: trailing }),
      "LAYOUT_INVALID"
    );
    expect(trailingError.offset).toBe(fixture.bytes.byteLength);

    const truncated = fixture.bytes.subarray(0, fixture.bytes.byteLength - 1);
    const truncatedError = expectFormatError(
      () => validateCompleteAsset({ bytes: truncated }),
      "LAYOUT_INVALID"
    );
    expect(truncatedError.offset).toBe(truncated.byteLength);
  });

  it("reparses and compares supplied header, canonical manifest, and every record", () => {
    const fixture = canonicalAssetFixture({ generatorSuffix: "a" });
    const supplied = parseFrontIndex(fixture.bytes);

    const wrongHeader = {
      ...supplied,
      header: Object.freeze({
        ...supplied.header,
        declaredFileLength: supplied.header.declaredFileLength + 1
      })
    } as ParsedFrontIndex;
    expectFormatError(
      () => validateCompleteAsset({ bytes: fixture.bytes, frontIndex: wrongHeader }),
      "LAYOUT_INVALID"
    );

    const otherManifest = canonicalAssetFixture({ generatorSuffix: "b" });
    expect(otherManifest.bytes.byteLength).toBe(fixture.bytes.byteLength);
    expectFormatError(
      () =>
        validateCompleteAsset({
          bytes: otherManifest.bytes,
          frontIndex: supplied
        }),
      "LAYOUT_INVALID"
    );

    const wrongRecords = {
      ...supplied,
      records: Object.freeze([
        Object.freeze({
          ...supplied.records[0]!,
          payloadLength: supplied.records[0]!.payloadLength + 1
        }),
        ...supplied.records.slice(1)
      ])
    } as ParsedFrontIndex;
    expectFormatError(
      () =>
        validateCompleteAsset({
          bytes: fixture.bytes,
          frontIndex: wrongRecords
        }),
      "LAYOUT_INVALID"
    );
  });

  it("accepts a matching supplied front index but returns a fresh reparse", () => {
    const fixture = canonicalAssetFixture();
    const supplied = parseFrontIndex(fixture.bytes);

    const result = validateCompleteAsset({
      bytes: fixture.bytes,
      frontIndex: supplied
    });

    expect(result.frontIndex).toEqual(supplied);
    expect(result.frontIndex).not.toBe(supplied);
  });

  it("schema-bounds a supplied front-index manifest before serializing it", () => {
    const fixture = canonicalAssetFixture();
    const frontIndex = parseFrontIndex(fixture.bytes);
    let hostileValueVisited = false;
    const hostileValue = new Proxy(
      {},
      {
        ownKeys() {
          hostileValueVisited = true;
          throw new RangeError("hostile manifest value was traversed");
        }
      }
    );
    const supplied = {
      ...frontIndex,
      manifest: {
        ...frontIndex.manifest,
        zzz: hostileValue
      }
    } as unknown as ParsedFrontIndex;

    expectFormatError(
      () =>
        validateCompleteAsset({
          bytes: fixture.bytes,
          frontIndex: supplied
        }),
      "LAYOUT_INVALID"
    );
    expect(hostileValueVisited).toBe(false);
  });

  it("bounds supplied-front readiness arrays before probing their elements", () => {
    const fixture = canonicalAssetFixture();
    const frontIndex = parseFrontIndex(fixture.bytes);
    let elementProbes = 0;
    const hostileIds = new Proxy(Array(1_000_000), {
      getOwnPropertyDescriptor(target, property) {
        if (property !== "length") elementProbes += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      }
    });
    const supplied = {
      ...frontIndex,
      manifest: {
        ...frontIndex.manifest,
        readiness: {
          ...frontIndex.manifest.readiness,
          bootstrapUnits: hostileIds
        }
      }
    } as unknown as ParsedFrontIndex;

    expectFormatError(
      () => validateCompleteAsset({
        bytes: fixture.bytes,
        frontIndex: supplied
      }),
      "LAYOUT_INVALID"
    );
    expect(elementProbes).toBe(0);
  });

  it("runs complete reference-frame and shallow PNG validation with absolute offsets", () => {
    const fixture = canonicalAssetFixture();
    const badReference = fixture.bytes.slice();
    const firstSampleOffset = fixture.records[0]!.payloadOffset;
    badReference[firstSampleOffset] =
      (badReference[firstSampleOffset] ?? 0) ^ 0xff;
    const referenceError = expectFormatError(
      () => validateCompleteAsset({ bytes: badReference }),
      "REFERENCE_FRAME_INVALID"
    );
    expect(referenceError.offset).toBe(firstSampleOffset);

    const badPng = fixture.bytes.slice();
    const pngOffset = fixture.manifest.staticFrames[0]!.offset;
    badPng[pngOffset] = (badPng[pngOffset] ?? 0) ^ 0xff;
    const pngError = expectFormatError(
      () => validateCompleteAsset({ bytes: badPng }),
      "PNG_ENVELOPE_INVALID"
    );
    expect(pngError.offset).toBe(pngOffset);
  });

  it("does not inspect arbitrary AVC payload bytes during M4 validation", () => {
    const fixture = canonicalAssetFixture({ profile: "avc" });
    const bytes = fixture.bytes.slice();
    for (const record of fixture.records) {
      bytes.fill(0xff, record.payloadOffset, record.payloadOffset + record.payloadLength);
    }

    expect(validateCompleteAsset({ bytes }).fileRange.length).toBe(bytes.byteLength);
  });
});
