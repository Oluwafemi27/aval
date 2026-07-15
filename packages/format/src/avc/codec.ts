import { FormatError } from "../errors.js";

export type AvcLevelIdc =
  | 10 | 11 | 12 | 13
  | 20 | 21 | 22
  | 30 | 31 | 32
  | 40 | 41 | 42
  | 50 | 51 | 52
  | 60 | 61 | 62;

export type AvcCodecV01 =
  | "avc1.42E00A" | "avc1.42E00B" | "avc1.42E00C" | "avc1.42E00D"
  | "avc1.42E014" | "avc1.42E015" | "avc1.42E016"
  | "avc1.42E01E" | "avc1.42E01F" | "avc1.42E020"
  | "avc1.42E028" | "avc1.42E029" | "avc1.42E02A"
  | "avc1.42E032" | "avc1.42E033" | "avc1.42E034"
  | "avc1.42E03C" | "avc1.42E03D" | "avc1.42E03E";

export interface AvcLevelLimits {
  readonly levelIdc: AvcLevelIdc;
  readonly codec: AvcCodecV01;
  readonly maximumMacroblocksPerSecond: number;
  readonly maximumMacroblocksPerFrame: number;
  readonly maximumMacroblockDimension: number;
  readonly maximumDpbMacroblocks: number;
  readonly maximumBitrate: number;
  readonly maximumCpbBits: number;
}

const LEVEL_ROWS = Object.freeze([
  [10, "avc1.42E00A", 1_485, 99, 396, 64_000, 175_000],
  [11, "avc1.42E00B", 3_000, 396, 900, 192_000, 500_000],
  [12, "avc1.42E00C", 6_000, 396, 2_376, 384_000, 1_000_000],
  [13, "avc1.42E00D", 11_880, 396, 2_376, 768_000, 2_000_000],
  [20, "avc1.42E014", 11_880, 396, 2_376, 2_000_000, 2_000_000],
  [21, "avc1.42E015", 19_800, 792, 4_752, 4_000_000, 4_000_000],
  [22, "avc1.42E016", 20_250, 1_620, 8_100, 4_000_000, 4_000_000],
  [30, "avc1.42E01E", 40_500, 1_620, 8_100, 10_000_000, 10_000_000],
  [31, "avc1.42E01F", 108_000, 3_600, 18_000, 14_000_000, 14_000_000],
  [32, "avc1.42E020", 216_000, 5_120, 20_480, 20_000_000, 20_000_000],
  [40, "avc1.42E028", 245_760, 8_192, 32_768, 20_000_000, 25_000_000],
  [41, "avc1.42E029", 245_760, 8_192, 32_768, 50_000_000, 62_500_000],
  [42, "avc1.42E02A", 522_240, 8_704, 34_816, 50_000_000, 62_500_000],
  [50, "avc1.42E032", 589_824, 22_080, 110_400, 135_000_000, 135_000_000],
  [51, "avc1.42E033", 983_040, 36_864, 184_320, 240_000_000, 240_000_000],
  [52, "avc1.42E034", 2_073_600, 36_864, 184_320, 240_000_000, 240_000_000],
  [60, "avc1.42E03C", 4_177_920, 139_264, 696_320, 240_000_000, 240_000_000],
  [61, "avc1.42E03D", 8_355_840, 139_264, 696_320, 480_000_000, 480_000_000],
  [62, "avc1.42E03E", 16_711_680, 139_264, 696_320, 800_000_000, 800_000_000]
] as const);

const LEVELS = new Map<number, AvcLevelLimits>(LEVEL_ROWS.map((row) => [
  row[0],
  Object.freeze({
    levelIdc: row[0],
    codec: row[1],
    maximumMacroblocksPerSecond: row[2],
    maximumMacroblocksPerFrame: row[3],
    maximumMacroblockDimension: Math.floor(Math.sqrt(row[3] * 8)),
    maximumDpbMacroblocks: row[4],
    maximumBitrate: row[5],
    maximumCpbBits: row[6]
  })
]));

const CODECS = new Map<string, AvcLevelLimits>(
  [...LEVELS.values()].map((limits) => [limits.codec, limits])
);

export function isAvcLevelIdc(value: number): value is AvcLevelIdc {
  return LEVELS.has(value);
}

export function avcLevelLimits(levelIdc: number): Readonly<AvcLevelLimits> {
  const limits = LEVELS.get(levelIdc);
  if (limits === undefined) {
    throw new FormatError("PROFILE_INVALID", "AVC level_idc is unsupported");
  }
  return limits;
}

export function avcCodecForLevel(levelIdc: number): AvcCodecV01 {
  return avcLevelLimits(levelIdc).codec;
}

export function parseAvcCodec(codec: unknown): Readonly<AvcLevelLimits> {
  const limits = typeof codec === "string" ? CODECS.get(codec) : undefined;
  if (limits === undefined) {
    throw new FormatError("PROFILE_INVALID", "AVC codec must identify a supported Constrained Baseline level");
  }
  return limits;
}

export function isAvcCodec(codec: unknown): codec is AvcCodecV01 {
  return typeof codec === "string" && CODECS.has(codec);
}
