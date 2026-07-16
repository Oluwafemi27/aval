import { isAv1Codec } from "../av1/codec.js";
import { isH264Codec } from "../h264/codec.js";
import { parseH265Codec } from "../h265/codec.js";
import { isVp9Codec } from "../vp9/codec.js";
import type {
  VideoBitDepth,
  VideoBitstream,
  VideoCodec
} from "../model.js";

export const VIDEO_CODECS = Object.freeze([
  "h264",
  "h265",
  "vp9",
  "av1"
] as const satisfies readonly VideoCodec[]);

export const VIDEO_BITSTREAM_BY_CODEC: Readonly<
  Record<VideoCodec, VideoBitstream>
> = Object.freeze({
  h264: "annex-b",
  h265: "annex-b",
  vp9: "frame",
  av1: "low-overhead"
});

export type ParsedVideoCodecString =
  | { readonly family: "h264"; readonly bitDepth: 8 }
  | { readonly family: "h265"; readonly bitDepth: 8 | 10 }
  | { readonly family: "vp9"; readonly bitDepth: 8 }
  | { readonly family: "av1"; readonly bitDepth: 8 | 10 };

const VP9_SHORT =
  /^vp09\.00\.(?:10|11|20|21|30|31|40|41|50|51|52|60|61|62)\.08$/u;
const AV1_SHORT =
  /^av01\.0\.(?:0[0-9]|[12][0-9]|3[01])[MH]\.(08|10)$/u;
/** Parse one canonical WebCodecs codec string supported by the AVAL format. */
export function parseVideoCodecString(
  value: string
): Readonly<ParsedVideoCodecString> | undefined {
  if (isH264Codec(value)) {
    return Object.freeze({ family: "h264", bitDepth: 8 });
  }

  const h265 = parseH265Codec(value);
  if (h265 !== undefined) {
    return Object.freeze({ family: "h265", bitDepth: h265.bitDepth });
  }

  if (isVp9Codec(value) || VP9_SHORT.test(value)) {
    return Object.freeze({ family: "vp9", bitDepth: 8 });
  }

  const av1Short = AV1_SHORT.exec(value);
  if (isAv1Codec(value) || av1Short !== null) {
    const bitDepthTerm = av1Short?.[1] ?? value.split(".")[3];
    return Object.freeze({
      family: "av1",
      bitDepth: bitDepthTerm === "10" ? 10 : 8
    });
  }

  return undefined;
}

export function isVideoCodecString(
  value: unknown,
  family: VideoCodec,
  bitDepth: VideoBitDepth
): value is string {
  if (typeof value !== "string") return false;
  const parsed = parseVideoCodecString(value);
  return parsed?.family === family && parsed.bitDepth === bitDepth;
}
