import {
  FORMAT_DEFAULT_BUDGETS,
  FormatError,
  deriveAvcRenditionGeometry,
  inspectAvcAnnexBRendition,
  validateCompleteAsset,
  type AvcRenditionInspection,
  type ParsedFrontIndex,
  type ValidatedAssetLayout
} from "@aval/format";

import { readBoundedRegularFile } from "../bounded-file.js";
import { throwIfAborted } from "../cancellation.js";
import { createSha256Accumulator } from "../compile/hash.js";
import { CompilerError } from "../diagnostics.js";

export interface ValidatedAsset {
  readonly bytes: Uint8Array;
  readonly layout: Readonly<ValidatedAssetLayout>;
  readonly avc: readonly {
    readonly rendition: string;
    readonly inspection: AvcRenditionInspection;
  }[];
}

export interface InspectedAccessUnitRange {
  readonly rendition: string;
  readonly unit: string;
  readonly frameIndex: number;
  readonly key: boolean;
  readonly offset: number;
  readonly length: number;
  readonly sha256: string;
}

/** Read once, validate M4 layout, verify digests, then inspect every AVC unit. */
export async function readValidatedAsset(
  file: string,
  signal?: AbortSignal
): Promise<ValidatedAsset> {
  const bytes = await readBoundedRegularFile({
    path: file,
    maxBytes: FORMAT_DEFAULT_BUDGETS.maxFileBytes,
    label: "compiled asset",
    limitCode: "ASSET_INVALID",
    ...(signal === undefined ? {} : { signal })
  });
  try {
    throwIfAborted(signal);
    const layout = validateCompleteAsset({ bytes });
    throwIfAborted(signal);
    verifyBlobDigests(bytes, layout, signal);
    const avc = inspectAvcRenditions(bytes, layout.frontIndex, signal);
    throwIfAborted(signal);
    return Object.freeze({ bytes, layout, avc });
  } catch (error) {
    throwIfAborted(signal);
    if (error instanceof CompilerError) throw error;
    if (error instanceof FormatError) {
      throw new CompilerError(
        error.code === "PROFILE_INVALID"
          ? "AVC_PROFILE_INVALID"
          : "ASSET_INVALID",
        error.message,
        {
          path: file,
          cause: error
        }
      );
    }
    throw new CompilerError("ASSET_INVALID", "Compiled asset is invalid", {
      path: file,
      cause: error
    });
  }
}

export function describeAccessUnits(
  bytes: Uint8Array,
  front: ParsedFrontIndex,
  signal?: AbortSignal
): readonly InspectedAccessUnitRange[] {
  const ranges: InspectedAccessUnitRange[] = [];
  for (const record of front.records) {
    throwIfAborted(signal);
    const rendition = front.manifest.renditions[record.renditionIndex];
    const unit = front.manifest.units[record.unitIndex];
    if (rendition === undefined || unit === undefined) {
      throw new CompilerError("ASSET_INVALID", "Access-unit identity is missing");
    }
    ranges.push(Object.freeze({
      rendition: rendition.id,
      unit: unit.id,
      frameIndex: record.frameIndex,
      key: record.key,
      offset: record.payloadOffset,
      length: record.payloadLength,
      sha256: sha256AssetBytes(bytes.subarray(
        record.payloadOffset,
        record.payloadOffset + record.payloadLength
      ), signal)
    }));
  }
  throwIfAborted(signal);
  return Object.freeze(ranges);
}

/** Incremental whole/range digest with cancellation checkpoints. */
export function sha256AssetBytes(
  bytes: Uint8Array,
  signal?: AbortSignal
): string {
  const digest = createSha256Accumulator();
  const chunkBytes = 1024 * 1024;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkBytes) {
    throwIfAborted(signal);
    digest.update(bytes.subarray(
      offset,
      Math.min(bytes.byteLength, offset + chunkBytes)
    ));
  }
  throwIfAborted(signal);
  return digest.digestHex();
}

function inspectAvcRenditions(
  bytes: Uint8Array,
  front: ParsedFrontIndex,
  signal?: AbortSignal
): ValidatedAsset["avc"] {
  const results: Array<ValidatedAsset["avc"][number]> = [];
  for (
    let renditionIndex = 0;
    renditionIndex < front.manifest.renditions.length;
    renditionIndex += 1
  ) {
    throwIfAborted(signal);
    const rendition = front.manifest.renditions[renditionIndex];
    if (
      rendition?.profile !== "avc-annexb-opaque-v0" &&
      rendition?.profile !== "avc-annexb-packed-alpha-v0" &&
      rendition?.profile !== "avc-annexb-opaque-v1" &&
      rendition?.profile !== "avc-annexb-packed-alpha-v1"
    ) continue;
    const geometry = deriveAvcRenditionGeometry(
      rendition.profile === "avc-annexb-opaque-v0" ||
        rendition.profile === "avc-annexb-opaque-v1"
        ? {
            canvasWidth: front.manifest.canvas.width,
            canvasHeight: front.manifest.canvas.height,
            profile: rendition.profile,
            codedWidth: rendition.codedWidth,
            codedHeight: rendition.codedHeight,
            colorRect: rendition.alphaLayout.colorRect
          }
        : {
            canvasWidth: front.manifest.canvas.width,
            canvasHeight: front.manifest.canvas.height,
            profile: rendition.profile,
            codedWidth: rendition.codedWidth,
            codedHeight: rendition.codedHeight,
            colorRect: rendition.alphaLayout.colorRect,
            alphaRect: rendition.alphaLayout.alphaRect
          }
    );
    const units = front.manifest.units.map((unit, unitIndex) => {
      const accessUnits: Array<{ readonly key: boolean; readonly bytes: Uint8Array }> = [];
      for (const record of front.records) {
        throwIfAborted(signal);
        if (
          record.renditionIndex === renditionIndex &&
          record.unitIndex === unitIndex
        ) {
          accessUnits.push({
            key: record.key,
            bytes: bytes.subarray(
              record.payloadOffset,
              record.payloadOffset + record.payloadLength
            )
          });
        }
      }
      return { id: unit.id, accessUnits };
    });
    throwIfAborted(signal);
    const inspection = inspectAvcAnnexBRendition({
      profile: {
        codedWidth: rendition.codedWidth,
        codedHeight: rendition.codedHeight,
        expectedDecodedStorageRect: geometry.decodedStorageRect,
        frameRate: front.manifest.frameRate,
        averageBitrate: rendition.bitrate.average,
        peakBitrate: rendition.bitrate.peak,
        cpbBufferBits: rendition.bitrate.peak,
        quantizationPolicy: rendition.profile.endsWith("-v1")
          ? "bounded-qp-v1"
          : "fixed-qp26-v0",
        requireBt709LimitedRange: true
      },
      units
    });
    throwIfAborted(signal);
    results.push(Object.freeze({ rendition: rendition.id, inspection }));
  }
  return Object.freeze(results);
}

function verifyBlobDigests(
  bytes: Uint8Array,
  layout: ValidatedAssetLayout,
  signal?: AbortSignal
): void {
  for (const blob of layout.frontIndex.unitBlobs) {
    throwIfAborted(signal);
    const actual = sha256AssetBytes(
      bytes.subarray(blob.offset, blob.offset + blob.length),
      signal
    );
    if (actual !== blob.sha256) {
      throw new CompilerError(
        "ASSET_INVALID",
        `Digest mismatch for ${blob.unit}`
      );
    }
  }
}
