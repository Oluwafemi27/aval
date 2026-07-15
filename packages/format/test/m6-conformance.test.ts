import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  deriveAvcRenditionGeometry,
  inspectAvcAnnexBRendition,
  parseFrontIndex,
  validateCompleteAsset
} from "../src/index.js";

const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../.."
);
const FIXTURE_ROOT = join(REPOSITORY_ROOT, "fixtures/conformance/m6");
const PROVENANCE_PATH = join(FIXTURE_ROOT, "provenance.json");

describe("M6 checked-in format conformance", () => {
  it("validates every motion blob, strict AVC unit, and cropped surface", async () => {
    const provenance = JSON.parse(await readFile(PROVENANCE_PATH, "utf8"));
    for (const entry of provenance.assets) {
      const bytes = new Uint8Array(
        await readFile(join(FIXTURE_ROOT, entry.name))
      );
      const front = validateCompleteAsset({ bytes }).frontIndex;
      expect(parseFrontIndex(bytes)).toEqual(front);
      expect(bytes.byteLength).toBe(entry.asset.bytes);
      expect(sha256(bytes)).toBe(entry.asset.sha256);

      for (const blob of front.unitBlobs) {
        expect(sha256(bytes.subarray(blob.offset, blob.offset + blob.length)))
          .toBe(blob.sha256);
      }

      const inspections = front.manifest.renditions.map(
        (rendition, renditionIndex) => {
          if (rendition.profile === "reference-rgba-v0") {
            throw new Error(
              "M6 fixture unexpectedly contains a reference rendition"
            );
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
              requireBt709LimitedRange: true,
              quantizationPolicy: "fixed-qp26-v0"
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
        }
      );
      expect(inspections).toEqual(entry.strictInspections);
    }
  });
});

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
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
