import { requireH265 } from "./failure.js";
import type { H265ProfileTierLevel, ParsedH265Sps } from "./parameter-sets.js";
import type { H265VideoDecoderConfig } from "./types.js";

const PROFILE_SPACE_PREFIX = Object.freeze(["", "A", "B", "C"] as const);
const H265_MAIN_CODEC =
  /^hvc1\.1\.(0|[1-9A-F][0-9A-F]*)\.[LH](0|[1-9][0-9]*)\.((?:[0-9A-F]{2}\.){0,5}(?!00)[0-9A-F]{2})$/u;

export interface ParsedH265Codec {
  readonly codec: string;
  readonly bitDepth: 8;
}

/** Parse the canonical Main/8-bit HEVC profile accepted by AVAL inspection. */
export function parseH265Codec(
  value: unknown
): Readonly<ParsedH265Codec> | undefined {
  if (typeof value !== "string") return undefined;
  const match = H265_MAIN_CODEC.exec(value);
  if (match === null) return undefined;
  const compatibilityFlags = Number.parseInt(match[1]!, 16);
  const levelIdc = Number(match[2]);
  const firstConstraintByte = Number.parseInt(match[3]!.slice(0, 2), 16);
  if (
    compatibilityFlags > 0xffff_ffff ||
    (compatibilityFlags & 0x02) === 0 ||
    levelIdc < 1 ||
    levelIdc > 255 ||
    (firstConstraintByte & 0x80) === 0 ||
    (firstConstraintByte & 0x40) !== 0 ||
    (firstConstraintByte & 0x10) === 0
  ) {
    return undefined;
  }
  return Object.freeze({ codec: value, bitDepth: 8 });
}

/** Derives the RFC 6381/ISO BMFF HEVC identifier used by WebCodecs. */
export function h265CodecString(profileTierLevel: H265ProfileTierLevel): string {
  const prefix = PROFILE_SPACE_PREFIX[profileTierLevel.profileSpace];
  requireH265(prefix !== undefined, "profileTierLevel", "invalid profile space");
  const compatibility = profileTierLevel.profileCompatibilityFlags
    .toString(16)
    .toUpperCase();
  const constraints = [...profileTierLevel.constraintIndicatorFlags];
  while (constraints.at(-1) === 0) constraints.pop();
  const suffix = constraints
    .map((byte) => byte.toString(16).toUpperCase().padStart(2, "0"))
    .join(".");
  return `hvc1.${prefix}${String(profileTierLevel.profileIdc)}.${compatibility}.${
    profileTierLevel.tierFlag ? "H" : "L"
  }${String(profileTierLevel.levelIdc)}${suffix.length === 0 ? "" : `.${suffix}`}`;
}

export function createH265VideoDecoderConfig(
  sps: ParsedH265Sps
): H265VideoDecoderConfig {
  requireH265(
    sps.color.fullRange === false &&
      sps.color.colourPrimaries === 1 &&
      sps.color.transferCharacteristics === 1 &&
      sps.color.matrixCoefficients === 1,
    "sps.vui",
    "HEVC decoder configuration requires BT.709 limited-range signalling"
  );
  return Object.freeze({
    codec: h265CodecString(sps.profileTierLevel),
    codedWidth: sps.codedWidth,
    codedHeight: sps.codedHeight,
    displayAspectWidth: sps.crop.visibleWidth,
    displayAspectHeight: sps.crop.visibleHeight,
    colorSpace: Object.freeze({
      primaries: "bt709" as const,
      transfer: "bt709" as const,
      matrix: "bt709" as const,
      fullRange: false as const
    })
  });
}
