import type {
  CertifiedVideoRendition,
  RuntimeAssetCatalog
} from "./asset-catalog.js";

/**
 * Build the exact codec-neutral selection token that production source
 * selection hands to IntegratedPlayer for an installed catalog.
 */
export function selectIntegratedTestVideoRendition(
  source: RuntimeAssetCatalog,
  authoredIndex = 0
): Readonly<CertifiedVideoRendition> {
  const selected = source.videoRenditions[authoredIndex];
  if (selected === undefined) {
    throw new RangeError("integrated test rendition index is unavailable");
  }
  return selected;
}

/** Pair owned test bytes with an explicit authored-rendition selection. */
export function createIntegratedTestVideoSource(
  bytes: Uint8Array,
  authoredIndex = 0
): Readonly<{
  readonly bytes: Uint8Array;
  readonly selectedRenditionIndex: number;
}> {
  return Object.freeze({
    bytes,
    selectedRenditionIndex: authoredIndex
  });
}
