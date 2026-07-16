import type {
  CertifiedVideoRendition,
  RuntimeAssetCatalog,
  RuntimeCatalogChunkIndex
} from "./asset-catalog.js";
import {
  inspectBorrowedVideoRendition,
  type BorrowedVideoRenditionPlan,
  type VideoCodecAdapterInspection
} from "./video-codec-adapters.js";

export interface InspectedVideoRendition {
  readonly candidate: Readonly<CertifiedVideoRendition>;
  readonly inspection: Readonly<VideoCodecAdapterInspection>;
}

interface VideoInspectionCatalog {
  readonly manifest: RuntimeAssetCatalog["manifest"];
  readonly chunks: Pick<RuntimeCatalogChunkIndex, "require">;
  ownsVideoRendition(value: unknown): value is Readonly<CertifiedVideoRendition>;
  copyChunk(rendition: string, unit: string, decodeIndex: number): ArrayBuffer;
}

interface PlannedChunkCopy {
  readonly unit: string;
  readonly decodeIndex: number;
}

/** Inspect encoded syntax for the exact catalog-certified selected rendition. */
export function inspectSelectedVideoRendition(
  catalog: RuntimeAssetCatalog,
  candidate: Readonly<CertifiedVideoRendition>
): Readonly<InspectedVideoRendition> {
  const source = catalog as VideoInspectionCatalog;
  if (!source.ownsVideoRendition(candidate)) {
    invalid("selected rendition does not belong to this asset catalog");
  }
  const copies = new Map<string, PlannedChunkCopy>();
  const units = source.manifest.units.map((unit) => {
    const span = unit.chunks.find(
      ({ rendition }) => rendition === candidate.rendition.id
    );
    if (span === undefined) {
      invalid("selected rendition is missing a unit chunk span");
    }
    const chunks = Array.from({ length: span.chunkCount }, (_, decodeIndex) => {
      const entry = source.chunks.require(
        candidate.rendition.id,
        unit.id,
        decodeIndex
      );
      const blobKey = entry.blobKey;
      const relativeRange = entry.relativeRange;
      if (blobKey === undefined || relativeRange === undefined) {
        invalid("selected rendition chunk range is unavailable");
      }
      const identity = rangeIdentity(
        blobKey,
        relativeRange.offset,
        relativeRange.length
      );
      if (copies.has(identity)) {
        invalid("selected rendition contains a duplicate chunk range");
      }
      copies.set(identity, Object.freeze({ unit: unit.id, decodeIndex }));
      return Object.freeze({
        blobKey,
        relativeOffset: relativeRange.offset,
        byteLength: relativeRange.length,
        record: entry.record
      });
    });
    return Object.freeze({
      id: unit.id,
      expectedDisplayedFrames: unit.frameCount,
      chunks: Object.freeze(chunks)
    });
  });

  const plan: Readonly<BorrowedVideoRenditionPlan> = Object.freeze({
    candidate,
    frameRate: source.manifest.frameRate,
    units: Object.freeze(units)
  });
  const inspection = inspectBorrowedVideoRendition(
    plan,
    (blobKey, relativeOffset, byteLength) => {
      const copy = copies.get(rangeIdentity(blobKey, relativeOffset, byteLength));
      if (copy === undefined) {
        invalid("codec inspector requested an unplanned chunk range");
      }
      const data = source.copyChunk(
        candidate.rendition.id,
        copy.unit,
        copy.decodeIndex
      );
      if (!(data instanceof ArrayBuffer) || data.byteLength !== byteLength) {
        invalid("catalog returned a malformed selected-rendition chunk copy");
      }
      return new Uint8Array(data);
    }
  );
  return Object.freeze({ candidate, inspection });
}

export function assertSelectedVideoRenditionCatalogIdentity(
  catalog: RuntimeAssetCatalog,
  candidate: Readonly<CertifiedVideoRendition>
): void {
  if (!catalog.ownsVideoRendition(candidate)) {
    invalid("selected rendition does not belong to this asset catalog");
  }
}

function rangeIdentity(
  blobKey: string,
  relativeOffset: number,
  byteLength: number
): string {
  return `${blobKey}\u0000${String(relativeOffset)}\u0000${String(byteLength)}`;
}

function invalid(message: string): never {
  throw new TypeError(`selected video rendition: ${message}`);
}
