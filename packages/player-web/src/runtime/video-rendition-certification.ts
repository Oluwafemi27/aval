import type {
  CompiledManifest,
  ProductionRendition,
  Rect,
  VideoRenditionGeometry
} from "@pixel-point/aval-format";
import { PACKED_ALPHA_GUTTER } from "@pixel-point/aval-format";

import type { DecoderWorkerProbeConfig } from "../decoder-worker/protocol.js";

export interface CertifiedVideoRendition {
  readonly authoredIndex: number;
  readonly rendition: Readonly<ProductionRendition>;
  readonly geometry: Readonly<VideoRenditionGeometry>;
  readonly decoderConfig: Readonly<DecoderWorkerProbeConfig>;
}

const BT709_LIMITED_COLOR_SPACE = Object.freeze({
  primaries: "bt709" as const,
  transfer: "bt709" as const,
  matrix: "bt709" as const,
  fullRange: false as const
});

/** Derive byte-free runtime metadata from an already format-certified manifest. */
export function certifyVideoRenditions(
  manifest: Readonly<CompiledManifest>
): readonly Readonly<CertifiedVideoRendition>[] {
  return Object.freeze(manifest.renditions.map((rendition, authoredIndex) => {
    const geometry = runtimeGeometry(manifest, rendition);
    return Object.freeze({
      authoredIndex,
      rendition,
      geometry,
      decoderConfig: Object.freeze({
        codec: rendition.codec,
        codedWidth: rendition.codedWidth,
        codedHeight: rendition.codedHeight,
        displayAspectWidth: geometry.decodedStorageRect[2],
        displayAspectHeight: geometry.decodedStorageRect[3],
        colorSpace: BT709_LIMITED_COLOR_SPACE
      })
    });
  }));
}

function runtimeGeometry(
  manifest: Readonly<CompiledManifest>,
  rendition: Readonly<ProductionRendition>
): Readonly<VideoRenditionGeometry> {
  const visibleColorRect = rendition.alphaLayout.colorRect;
  const decodedWidth = alignEven(visibleColorRect[2]);
  const paneHeight = alignEven(visibleColorRect[3]);
  const decodedHeight = rendition.alphaLayout.type === "stacked"
    ? paneHeight * 2 + PACKED_ALPHA_GUTTER
    : paneHeight;
  const decodedStorageRect = Object.freeze([
    0,
    0,
    decodedWidth,
    decodedHeight
  ]) as Rect;
  const visibleColorArea = visibleColorRect[2] * visibleColorRect[3];
  return Object.freeze({
    layout: manifest.layout,
    visibleColorRect,
    ...(rendition.alphaLayout.type === "stacked"
      ? { visibleAlphaRect: rendition.alphaLayout.alphaRect }
      : {}),
    decodedStorageRect,
    codedWidth: rendition.codedWidth,
    codedHeight: rendition.codedHeight,
    visibleColorArea,
    decodedRgbaBytes: decodedWidth * decodedHeight * 4,
    codedRgbaBytes: rendition.codedWidth * rendition.codedHeight * 4
  });
}

function alignEven(value: number): number {
  return value % 2 === 0 ? value : value + 1;
}
