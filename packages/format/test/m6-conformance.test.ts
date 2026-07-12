import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync, inflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  crc32,
  decodePngRgba,
  deriveAvcRenditionGeometry,
  inspectAvcAnnexBRendition,
  parseFrontIndex,
  validateCompleteAsset,
  validatePngProfile
} from "../src/index.js";
import { FormatError } from "../src/errors.js";
import {
  inflateDeflate,
  inflateDeflateWithLimit
} from "../src/png/deflate.js";
import { parseRestrictedPngChunks } from "../src/png/chunks.js";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const FIXTURE_ROOT = join(REPOSITORY_ROOT, "fixtures/conformance/m6");
const PROVENANCE_PATH = join(FIXTURE_ROOT, "provenance.json");
const MALFORMED_CONTRACTS_PATH = join(
  FIXTURE_ROOT,
  "malformed/contracts.json"
);
const MALFORMED_CORPUS_PATH = join(FIXTURE_ROOT, "malformed/corpus.json");

describe("M6 checked-in format conformance", () => {
  it("validates every blob, strict AVC unit, cropped surface, and static PNG", async () => {
    const provenance = JSON.parse(await readFile(PROVENANCE_PATH, "utf8"));
    for (const entry of provenance.assets) {
      const bytes = new Uint8Array(await readFile(join(FIXTURE_ROOT, entry.name)));
      const front = validateCompleteAsset({ bytes }).frontIndex;
      expect(parseFrontIndex(bytes)).toEqual(front);
      expect(bytes.byteLength).toBe(entry.asset.bytes);
      expect(sha256(bytes)).toBe(entry.asset.sha256);

      for (const blob of [...front.unitBlobs, ...front.staticBlobs]) {
        expect(sha256(bytes.subarray(blob.offset, blob.offset + blob.length)))
          .toBe(blob.sha256);
      }

      const inspections = front.manifest.renditions.map((rendition, renditionIndex) => {
        if (rendition.profile === "reference-rgba-v0") {
          throw new Error("M6 fixture unexpectedly contains a reference rendition");
        }
        const geometry = deriveGeometry(front.manifest, rendition);
        const inspection = inspectAvcAnnexBRendition({
          profile: {
            codedWidth: rendition.codedWidth,
            codedHeight: rendition.codedHeight,
            expectedDecodedStorageRect: geometry.decodedStorageRect,
            frameRate: front.manifest.frameRate,
            averageBitrate: rendition.bitrate.average,
            peakBitrate: rendition.bitrate.peak,
            cpbBufferBits: rendition.bitrate.peak,
            requireBt709LimitedRange: true
          },
          units: front.manifest.units.map((unit, unitIndex) => ({
            id: unit.id,
            accessUnits: front.records
              .filter((record) =>
                record.renditionIndex === renditionIndex &&
                record.unitIndex === unitIndex
              )
              .map((record) => ({
                key: record.key,
                bytes: bytes.slice(
                  record.payloadOffset,
                  record.payloadOffset + record.payloadLength
                )
              }))
          }))
        });
        expect(inspection.parameterSet.crop).toEqual({
          left: 0,
          top: 0,
          right: rendition.codedWidth - geometry.decodedStorageRect[2],
          bottom: rendition.codedHeight - geometry.decodedStorageRect[3],
          visibleWidth: geometry.decodedStorageRect[2],
          visibleHeight: geometry.decodedStorageRect[3]
        });
        return {
          rendition: rendition.id,
          parameterSet: inspection.parameterSet,
          macroblocksPerFrame: inspection.macroblocksPerFrame,
          units: inspection.units.map((unit) => ({
            id: unit.id,
            frames: unit.frames.length
          }))
        };
      });
      expect(inspections).toEqual(entry.strictInspections);

      for (const [index, blob] of front.staticBlobs.entries()) {
        const descriptor = front.manifest.staticFrames[index]!;
        const png = bytes.slice(blob.offset, blob.offset + blob.length);
        const decoded = decodePngRgba(validatePngProfile({
          png,
          expectedWidth: descriptor.width,
          expectedHeight: descriptor.height
        }));
        expect(decoded).toMatchObject({ width: 45, height: 27 });
        expect(decoded.rgba.byteLength).toBe(4860);
        expect(blob.length).toBe(4968);
      }
    }
  });

  it("covers stored, fixed, dynamic DEFLATE and PNG filters zero through four", async () => {
    const provenance = JSON.parse(await readFile(PROVENANCE_PATH, "utf8"));
    const decodedPixels: Uint8Array[] = [];
    for (const entry of provenance.pngCorpus) {
      const png = new Uint8Array(await readFile(join(REPOSITORY_ROOT, entry.path)));
      expect(png.byteLength).toBe(entry.bytes);
      expect(sha256(png)).toBe(entry.sha256);
      const plan = validatePngProfile({
        png,
        expectedWidth: 32,
        expectedHeight: 16
      });
      const decoded = decodePngRgba(plan);
      const zlib = plan.copyZlibBytes();
      const filtered = new Uint8Array(inflateSync(zlib));
      expect(decoded).toMatchObject({ width: 32, height: 16 });
      expect(decoded.rgba.byteLength).toBe(2048);
      expect(zlib.byteLength).toBe(entry.zlibBytes);
      expect(filtered.byteLength).toBe(2064);
      expect((zlib[2]! >> 1) & 0b11).toBe(entry.firstDeflateBlockType);
      for (let row = 0; row < 16; row += 1) {
        expect(filtered[row * 129]).toBe(entry.rowFilter);
      }
      decodedPixels.push(decoded.rgba);
    }
    expect(provenance.pngCorpus.map((entry: any) => entry.rowFilter))
      .toEqual([0, 1, 2, 3, 4, 0]);
    expect(provenance.pngCorpus.map((entry: any) => entry.firstDeflateBlockType))
      .toEqual([0, 1, 2, 2, 2, 2]);
    expect(provenance.pngCorpus.map((entry: any) => entry.pixelFixture))
      .toEqual([
        "conformance-pattern",
        "conformance-pattern",
        "conformance-pattern",
        "conformance-pattern",
        "conformance-pattern",
        "transparent-black"
      ]);
    for (const rgba of decodedPixels.slice(1, 5)) {
      expect(rgba).toEqual(decodedPixels[0]);
    }
    expect(decodedPixels[5]?.every((sample) => sample === 0)).toBe(true);
  });

  it("rejects every malformed PNG at the frozen public failure boundary", async () => {
    const provenance = JSON.parse(await readFile(PROVENANCE_PATH, "utf8"));
    const corpusManifestBytes = new Uint8Array(
      await readFile(MALFORMED_CORPUS_PATH)
    );
    expect(corpusManifestBytes.byteLength)
      .toBe(provenance.malformedCorpusManifest.bytes);
    expect(sha256(corpusManifestBytes))
      .toBe(provenance.malformedCorpusManifest.sha256);
    const manifest = JSON.parse(new TextDecoder().decode(corpusManifestBytes));
    expect(manifest.cases).toHaveLength(59);
    expect(new Set(manifest.cases.map((entry: any) => entry.name)).size).toBe(59);
    expect(new Set(
      manifest.cases.map((entry: any) => entry.rejectionClass)
    ).size).toBe(59);
    expect(provenance.malformedCorpus.map((entry: any) => ({
      name: entry.path.split("/").at(-1),
      rejectionClass: entry.rejectionClass,
      expected: entry.rejection
    }))).toEqual(manifest.cases);
    const codes = new Map<string, string>();
    for (const entry of provenance.malformedCorpus) {
      const png = new Uint8Array(await readFile(join(REPOSITORY_ROOT, entry.path)));
      expect(sha256(png)).toBe(entry.sha256);
      try {
        const plan = validatePngProfile({
          png,
          expectedWidth: 32,
          expectedHeight: 16
        });
        decodePngRgba(plan);
        throw new Error(`${entry.path} unexpectedly decoded`);
      } catch (error) {
        expect(error).toBeInstanceOf(FormatError);
        expect((error as FormatError).code).toBe(entry.rejection.code);
        codes.set(entry.path.split("/").at(-1)!, (error as FormatError).code);
      }
    }
    expect([...codes.values()].filter((code) => code === "PNG_ENVELOPE_INVALID"))
      .toHaveLength(29);
    expect([...codes.values()].filter((code) => code === "PNG_DEFLATE_INVALID"))
      .toHaveLength(29);
    expect([...codes.values()].filter((code) => code === "PNG_SCANLINE_INVALID"))
      .toHaveLength(1);
  });

  it("executes the checked malformed geometry, crop, and limit-only contracts", async () => {
    const provenance = JSON.parse(await readFile(PROVENANCE_PATH, "utf8"));
    const contractBytes = await readFile(MALFORMED_CONTRACTS_PATH);
    expect(contractBytes.byteLength).toBe(provenance.malformedContracts.bytes);
    expect(sha256(new Uint8Array(contractBytes)))
      .toBe(provenance.malformedContracts.sha256);
    const contracts = JSON.parse(
      new TextDecoder().decode(contractBytes)
    );
    const geometryCase = contracts.cases.find(
      (entry: any) => entry.id === "packed-geometry-overlapping-alpha-pane"
    );
    expect(() => deriveAvcRenditionGeometry(geometryCase.input)).toThrow(
      expect.objectContaining(geometryCase.expected)
    );

    const cropCase = contracts.cases.find(
      (entry: any) => entry.id === "packed-sps-crop-mismatch"
    );
    const bytes = new Uint8Array(
      await readFile(join(FIXTURE_ROOT, cropCase.asset))
    );
    const front = validateCompleteAsset({ bytes }).frontIndex;
    const renditionIndex = front.manifest.renditions.findIndex(
      ({ id }) => id === cropCase.rendition
    );
    const rendition = front.manifest.renditions[renditionIndex]!;
    if (rendition.profile === "reference-rgba-v0") {
      throw new Error("malformed crop contract requires an AVC rendition");
    }
    expect(() => inspectAvcAnnexBRendition({
      profile: {
        codedWidth: rendition.codedWidth,
        codedHeight: rendition.codedHeight,
        expectedDecodedStorageRect: cropCase.expectedDecodedStorageRect,
        frameRate: front.manifest.frameRate,
        averageBitrate: rendition.bitrate.average,
        peakBitrate: rendition.bitrate.peak,
        cpbBufferBits: rendition.bitrate.peak,
        requireBt709LimitedRange: true
      },
      units: front.manifest.units.map((unit, unitIndex) => ({
        id: unit.id,
        accessUnits: front.records
          .filter((record) =>
            record.renditionIndex === renditionIndex &&
            record.unitIndex === unitIndex
          )
          .map((record) => ({
            key: record.key,
            bytes: bytes.slice(
              record.payloadOffset,
              record.payloadOffset + record.payloadLength
            )
          }))
      }))
    })).toThrow(expect.objectContaining(cropCase.expected));

    const limitCases = contracts.cases.filter(
      (entry: any) => entry.owner === "format" &&
        entry.id.startsWith("strict-")
    );
    expect(limitCases.map((entry: any) => entry.id)).toEqual([
      "strict-png-active-byte-budget",
      "strict-png-combined-idat-limit",
      "strict-deflate-compressed-byte-limit",
      "strict-deflate-output-byte-limit",
      "strict-deflate-work-limit"
    ]);
    for (const entry of limitCases) {
      const action = limitContractAction(entry);
      expect(action).toThrow(expect.objectContaining(entry.expected));
    }
  });
});

function limitContractAction(entry: any): () => unknown {
  if (entry.operation === "validatePngProfile") {
    return () => validatePngProfile({
      png: new Uint8Array(
        readFileSync(join(FIXTURE_ROOT, "malformed", entry.asset))
      ),
      expectedWidth: entry.expectedWidth,
      expectedHeight: entry.expectedHeight,
      options: { budgets: { maxStaticPngBytes: entry.maximumPngBytes } }
    });
  }
  if (entry.operation === "parseRestrictedPngChunksGenerated") {
    return () => parseRestrictedPngChunks({
      png: generatedCombinedIdatPng(entry.idatLengths),
      expectedWidth: entry.expectedWidth,
      expectedHeight: entry.expectedHeight,
      maximumPngBytes: entry.maximumPngBytes
    });
  }
  if (entry.operation === "inflateDeflateWithLimit") {
    const source = new TextEncoder().encode(entry.sourceUtf8);
    const deflate = new Uint8Array(deflateRawSync(source));
    return () => inflateDeflateWithLimit({
      deflate,
      expectedOutputLength: source.byteLength
    }, entry.workLimit);
  }
  if (entry.operation === "inflateDeflate") {
    const deflate = entry.deflateBytes === undefined
      ? Uint8Array.from(entry.deflate)
      : new Uint8Array(entry.deflateBytes);
    return () => inflateDeflate({
      deflate,
      expectedOutputLength: entry.expectedOutputLength
    });
  }
  throw new Error(`unknown limit contract operation ${String(entry.operation)}`);
}

function deriveGeometry(manifest: any, rendition: any) {
  return deriveAvcRenditionGeometry({
    canvasWidth: manifest.canvas.width,
    canvasHeight: manifest.canvas.height,
    profile: rendition.profile,
    codedWidth: rendition.codedWidth,
    codedHeight: rendition.codedHeight,
    colorRect: rendition.alphaLayout.colorRect,
    ...(rendition.profile === "avc-annexb-packed-alpha-v0"
      ? { alphaRect: rendition.alphaLayout.alphaRect }
      : {})
  });
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function generatedCombinedIdatPng(lengths: readonly number[]): Uint8Array {
  const ihdr = new Uint8Array(13);
  writeUint32Be(ihdr, 0, 32);
  writeUint32Be(ihdr, 4, 16);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return concatenateBytes([
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    pngChunk("IHDR", ihdr),
    ...lengths.map((length) => pngChunk("IDAT", new Uint8Array(length)))
  ]);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const result = new Uint8Array(12 + data.byteLength);
  writeUint32Be(result, 0, data.byteLength);
  result.set(typeBytes, 4);
  result.set(data, 8);
  writeUint32Be(
    result,
    8 + data.byteLength,
    crc32(result.subarray(4, 8 + data.byteLength))
  );
  return result;
}

function concatenateBytes(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    parts.reduce((total, part) => total + part.byteLength, 0)
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function writeUint32Be(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}
