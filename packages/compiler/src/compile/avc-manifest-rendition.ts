import type {
  AvcCodecV01,
  AvcRenditionGeometry,
  BitrateV01,
  RenditionV01
} from "@aval/format";

import { CompilerError } from "../diagnostics.js";

/** Lower validated compiler geometry into one exact wire rendition variant. */
export function buildAvcManifestRendition(input: Readonly<{
  readonly id: string;
  readonly codec: AvcCodecV01;
  readonly geometry: Readonly<AvcRenditionGeometry>;
  readonly bitrate: Readonly<BitrateV01>;
}>): Extract<RenditionV01, { readonly codec: AvcCodecV01 }> {
  const common = {
    id: input.id,
    codec: input.codec,
    codedWidth: input.geometry.codedWidth,
    codedHeight: input.geometry.codedHeight,
    bitrate: input.bitrate,
    capabilities: ["webcodecs", "webgl2"] as const
  };
  switch (input.geometry.profile) {
    case "avc-annexb-opaque-v0":
      return {
        ...common,
        profile: "avc-annexb-opaque-v0",
        alphaLayout: {
          type: "opaque-v0",
          colorRect: input.geometry.visibleColorRect
        }
      };
    case "avc-annexb-opaque-v1":
      return {
        ...common,
        profile: "avc-annexb-opaque-v1",
        alphaLayout: {
          type: "opaque-v0",
          colorRect: input.geometry.visibleColorRect
        }
      };
    case "avc-annexb-packed-alpha-v0":
      return {
        ...common,
        profile: "avc-annexb-packed-alpha-v0",
        alphaLayout: {
          type: "stacked-v0",
          colorRect: input.geometry.visibleColorRect,
          alphaRect: requiredAlphaRect(input.geometry)
        }
      };
    case "avc-annexb-packed-alpha-v1":
      return {
        ...common,
        profile: "avc-annexb-packed-alpha-v1",
        alphaLayout: {
          type: "stacked-v0",
          colorRect: input.geometry.visibleColorRect,
          alphaRect: requiredAlphaRect(input.geometry)
        }
      };
  }
}

function requiredAlphaRect(
  geometry: Readonly<AvcRenditionGeometry>
): NonNullable<AvcRenditionGeometry["visibleAlphaRect"]> {
  if (geometry.visibleAlphaRect === undefined) {
    throw new CompilerError(
      "IO_FAILED",
      "Packed AVC rendition geometry is missing its alpha rectangle"
    );
  }
  return geometry.visibleAlphaRect;
}
