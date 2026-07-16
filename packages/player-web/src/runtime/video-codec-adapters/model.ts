import type {
  EncodedChunkRecord,
  Rational,
  VideoBitDepth,
  VideoCodec
} from "@pixel-point/aval-format";

import type { CertifiedVideoRendition } from "../asset-catalog.js";

export interface BorrowedVideoChunkPlan {
  readonly blobKey: string;
  readonly relativeOffset: number;
  readonly byteLength: number;
  readonly record: Readonly<EncodedChunkRecord>;
}

export interface BorrowedVideoUnitPlan {
  readonly id: string;
  readonly expectedDisplayedFrames: number;
  readonly chunks: readonly Readonly<BorrowedVideoChunkPlan>[];
}

export interface BorrowedVideoRenditionPlan {
  readonly candidate: Readonly<CertifiedVideoRendition>;
  readonly frameRate: Readonly<Rational>;
  readonly units: readonly Readonly<BorrowedVideoUnitPlan>[];
}

export type BorrowVerifiedVideoRange = (
  blobKey: string,
  relativeOffset: number,
  byteLength: number
) => Uint8Array;

export interface VideoDecodeSubmissionMetadata {
  readonly decodeIndex: number;
  readonly chunkType: EncodedVideoChunkType;
  readonly presentationTimestamp: number;
  readonly duration: number;
  readonly displayedFrameCount: number;
  readonly presentationIndices: readonly number[];
}

export interface VideoCodecUnitInspection {
  readonly id: string;
  readonly displayedFrameCount: number;
  readonly submissions: readonly Readonly<VideoDecodeSubmissionMetadata>[];
}

export interface VideoCodecAdapterInspection {
  readonly family: VideoCodec;
  readonly bitstream: "annex-b" | "frame" | "low-overhead";
  readonly bitDepth: VideoBitDepth;
  readonly decoderConfig: Readonly<VideoDecoderConfig>;
  readonly units: readonly Readonly<VideoCodecUnitInspection>[];
}

export interface BorrowedCodecChunk extends BorrowedVideoChunkPlan {
  readonly bytes: Uint8Array;
}

export interface BorrowedCodecUnit {
  readonly id: string;
  readonly expectedDisplayedFrames: number;
  readonly chunks: readonly Readonly<BorrowedCodecChunk>[];
}

export interface CodecAdapterInput {
  readonly candidate: Readonly<CertifiedVideoRendition>;
  readonly frameRate: Readonly<Rational>;
  readonly units: readonly Readonly<BorrowedCodecUnit>[];
}

export interface SyntaxChunkInspection {
  readonly chunkType: EncodedVideoChunkType;
  readonly displayedFrameCount: number;
  readonly expectedPresentationIndex?: number;
}

export interface SyntaxUnitInspection {
  readonly id: string;
  readonly chunks: readonly Readonly<SyntaxChunkInspection>[];
}

export interface CodecSyntaxInspection {
  readonly codec: string;
  readonly bitDepth: VideoBitDepth;
  readonly units: readonly Readonly<SyntaxUnitInspection>[];
}

export interface VideoBitstreamAdapter {
  inspect(input: Readonly<CodecAdapterInput>): Readonly<CodecSyntaxInspection>;
}

export interface DecodedStorageGeometry {
  readonly width: number;
  readonly height: number;
  readonly rect: readonly [x: 0, y: 0, width: number, height: number];
}

export function decodedStorageGeometry(
  candidate: Readonly<CertifiedVideoRendition>
): Readonly<DecodedStorageGeometry> {
  const rect = candidate.geometry.decodedStorageRect as readonly [
    x: 0,
    y: 0,
    width: number,
    height: number
  ];
  return Object.freeze({ width: rect[2], height: rect[3], rect });
}

export function freezeFrameRate(value: Readonly<Rational>): Readonly<Rational> {
  return Object.freeze({
    numerator: value.numerator,
    denominator: value.denominator
  });
}

export function requireGeometry(
  width: number | undefined,
  height: number | undefined,
  candidate: Readonly<CertifiedVideoRendition>,
  source: string
): void {
  if (
    width !== candidate.rendition.codedWidth ||
    height !== candidate.rendition.codedHeight
  ) {
    invalid(`${source} coded geometry disagrees with the manifest rendition`);
  }
}

export function requireVisibleGeometry(
  width: number | undefined,
  height: number | undefined,
  geometry: Readonly<DecodedStorageGeometry>,
  source: string
): void {
  if (width !== geometry.width || height !== geometry.height) {
    invalid(`${source} visible geometry disagrees with the manifest rendition`);
  }
}

export function requireBt709Limited(
  color: {
    readonly fullRange: boolean;
    readonly colourPrimaries?: number;
    readonly colorPrimaries?: number;
    readonly transferCharacteristics?: number;
    readonly matrixCoefficients?: number;
  } | undefined,
  source: string
): void {
  const primaries = color?.colourPrimaries ?? color?.colorPrimaries;
  if (
    color?.fullRange !== false ||
    primaries !== 1 ||
    color.transferCharacteristics !== 1 ||
    color.matrixCoefficients !== 1
  ) {
    invalid(`${source} must signal BT.709 limited-range color`);
  }
}

export function invalid(message: string): never {
  throw new TypeError(`video codec adapter: ${message}`);
}
