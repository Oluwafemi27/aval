import {
  VIDEO_BITSTREAM_BY_CODEC,
  parseVideoCodecString,
  type VideoCodec
} from "@pixel-point/aval-format";

import { AV1_BITSTREAM_ADAPTER } from "./video-codec-adapters/av1.js";
import { H264_BITSTREAM_ADAPTER } from "./video-codec-adapters/h264.js";
import { H265_BITSTREAM_ADAPTER } from "./video-codec-adapters/h265.js";
import {
  invalid,
  type BorrowedCodecUnit,
  type BorrowedVideoRenditionPlan,
  type BorrowVerifiedVideoRange,
  type SyntaxUnitInspection,
  type VideoBitstreamAdapter,
  type VideoCodecAdapterInspection,
  type VideoCodecUnitInspection
} from "./video-codec-adapters/model.js";
import { VP9_BITSTREAM_ADAPTER } from "./video-codec-adapters/vp9.js";

export type {
  BorrowedVideoChunkPlan,
  BorrowedVideoRenditionPlan,
  BorrowedVideoUnitPlan,
  BorrowVerifiedVideoRange,
  VideoCodecAdapterInspection,
  VideoCodecUnitInspection,
  VideoDecodeSubmissionMetadata
} from "./video-codec-adapters/model.js";

const BITSTREAM_ADAPTERS = Object.freeze({
  h264: H264_BITSTREAM_ADAPTER,
  h265: H265_BITSTREAM_ADAPTER,
  vp9: VP9_BITSTREAM_ADAPTER,
  av1: AV1_BITSTREAM_ADAPTER
} satisfies Readonly<Record<VideoCodec, VideoBitstreamAdapter>>);

/** Borrow verified chunks only for the duration of one codec-specific inspection. */
export function inspectBorrowedVideoRendition(
  plan: Readonly<BorrowedVideoRenditionPlan>,
  borrow: BorrowVerifiedVideoRange
): Readonly<VideoCodecAdapterInspection> {
  const parsed = parseVideoCodecString(plan.candidate.rendition.codec);
  if (parsed === undefined) invalid("certified rendition codec is unavailable");
  const family = parsed.family;
  const borrowedUnits = borrowUnits(plan.units, borrow);
  const syntax = BITSTREAM_ADAPTERS[family].inspect(Object.freeze({
    candidate: plan.candidate,
    frameRate: plan.frameRate,
    units: borrowedUnits
  }));
  if (syntax.bitDepth !== plan.candidate.rendition.bitDepth) {
    invalid("inspected bit depth disagrees with the certified rendition");
  }
  if (syntax.codec !== plan.candidate.rendition.codec) {
    invalid("inspected codec string disagrees with the certified rendition");
  }
  return Object.freeze({
    family,
    bitstream: VIDEO_BITSTREAM_BY_CODEC[family],
    bitDepth: syntax.bitDepth,
    decoderConfig: plan.candidate.decoderConfig,
    units: normalizeSubmissionMetadata(plan.units, syntax.units)
  });
}

function borrowUnits(
  units: BorrowedVideoRenditionPlan["units"],
  borrow: BorrowVerifiedVideoRange
): readonly Readonly<BorrowedCodecUnit>[] {
  return Object.freeze(units.map((unit, unitIndex) => Object.freeze({
    id: unit.id,
    expectedDisplayedFrames: unit.expectedDisplayedFrames,
    chunks: Object.freeze(unit.chunks.map((chunk, chunkIndex) => {
      const bytes = borrow(chunk.blobKey, chunk.relativeOffset, chunk.byteLength);
      if (!(bytes instanceof Uint8Array) || bytes.byteLength !== chunk.byteLength) {
        invalid(
          `borrowed bytes for units[${String(unitIndex)}].chunks[${String(chunkIndex)}] are malformed`
        );
      }
      return Object.freeze({ ...chunk, bytes });
    }))
  })));
}

function normalizeSubmissionMetadata(
  units: BorrowedVideoRenditionPlan["units"],
  syntaxUnits: readonly Readonly<SyntaxUnitInspection>[]
): readonly Readonly<VideoCodecUnitInspection>[] {
  if (syntaxUnits.length !== units.length) {
    invalid("codec inspection unit count disagrees with the manifest plan");
  }
  return Object.freeze(units.map((unit, unitIndex) => {
    const syntaxUnit = syntaxUnits[unitIndex];
    if (
      syntaxUnit === undefined ||
      syntaxUnit.id !== unit.id ||
      syntaxUnit.chunks.length !== unit.chunks.length
    ) {
      invalid(`codec inspection disagrees with units[${String(unitIndex)}]`);
    }

    const presentationIndices = unit.chunks.map(() => [] as number[]);
    const frames: Array<{
      readonly chunkIndex: number;
      readonly codedFrameIndex: number;
      readonly timestamp: number;
    }> = [];
    let displayedFrameCount = 0;
    for (let chunkIndex = 0; chunkIndex < unit.chunks.length; chunkIndex += 1) {
      const chunk = unit.chunks[chunkIndex]!;
      const chunkSyntax = syntaxUnit.chunks[chunkIndex]!;
      if (chunkSyntax.displayedFrameCount !== chunk.record.displayedFrameCount) {
        invalid(
          `bitstream displayed frame count disagrees with units[${String(unitIndex)}].chunks[${String(chunkIndex)}]`
        );
      }
      if (chunk.record.randomAccess !== (chunkSyntax.chunkType === "key")) {
        invalid(
          `bitstream chunk type disagrees with units[${String(unitIndex)}].chunks[${String(chunkIndex)}]`
        );
      }
      displayedFrameCount += chunkSyntax.displayedFrameCount;
      for (
        let codedFrameIndex = 0;
        codedFrameIndex < chunkSyntax.displayedFrameCount;
        codedFrameIndex += 1
      ) {
        frames.push({
          chunkIndex,
          codedFrameIndex,
          timestamp: presentationTimestamp(
            chunk.record.presentationTimestamp,
            chunk.record.duration,
            codedFrameIndex,
            `units[${String(unitIndex)}].chunks[${String(chunkIndex)}]`
          )
        });
      }
    }
    if (displayedFrameCount !== unit.expectedDisplayedFrames) {
      invalid(`unit ${unit.id} displayed frame count disagrees with the manifest plan`);
    }

    frames.sort((left, right) => left.timestamp - right.timestamp);
    for (let presentationIndex = 0; presentationIndex < frames.length; presentationIndex += 1) {
      const frame = frames[presentationIndex]!;
      if (
        presentationIndex > 0 &&
        frame.timestamp === frames[presentationIndex - 1]!.timestamp
      ) {
        invalid(`unit ${unit.id} contains duplicate presentation timestamps`);
      }
      presentationIndices[frame.chunkIndex]![frame.codedFrameIndex] = presentationIndex;
    }

    const submissions = Object.freeze(unit.chunks.map((chunk, chunkIndex) => {
      const chunkSyntax = syntaxUnit.chunks[chunkIndex]!;
      const indices = Object.freeze(presentationIndices[chunkIndex]!);
      if (
        chunkSyntax.expectedPresentationIndex !== undefined &&
        (indices.length !== 1 || indices[0] !== chunkSyntax.expectedPresentationIndex)
      ) {
        invalid(
          `bitstream presentation order disagrees with units[${String(unitIndex)}].chunks[${String(chunkIndex)}]`
        );
      }
      return Object.freeze({
        decodeIndex: chunkIndex,
        chunkType: chunkSyntax.chunkType,
        presentationTimestamp: chunk.record.presentationTimestamp,
        duration: chunk.record.duration,
        displayedFrameCount: chunkSyntax.displayedFrameCount,
        presentationIndices: indices
      });
    }));
    return Object.freeze({ id: unit.id, displayedFrameCount, submissions });
  }));
}

function presentationTimestamp(
  timestamp: number,
  duration: number,
  frameIndex: number,
  path: string
): number {
  const result = BigInt(timestamp) + BigInt(duration) * BigInt(frameIndex);
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) {
    invalid(`${path} presentation timeline exceeds the safe integer range`);
  }
  return Number(result);
}
