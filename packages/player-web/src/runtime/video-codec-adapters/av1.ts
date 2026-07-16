import { inspectAv1Rendition } from "@pixel-point/aval-format";

import {
  requireBt709Limited,
  requireGeometry,
  type CodecAdapterInput,
  type VideoBitstreamAdapter
} from "./model.js";

export const AV1_BITSTREAM_ADAPTER: VideoBitstreamAdapter = Object.freeze({
  inspect(input: Readonly<CodecAdapterInput>) {
    const inspection = inspectAv1Rendition(Object.freeze({
      width: input.candidate.rendition.codedWidth,
      height: input.candidate.rendition.codedHeight,
      bitDepth: input.candidate.rendition.bitDepth,
      units: Object.freeze(input.units.map((unit) => Object.freeze({
        id: unit.id,
        expectedDisplayedFrames: unit.expectedDisplayedFrames,
        chunks: Object.freeze(unit.chunks.map((chunk) => Object.freeze({
          bytes: chunk.bytes,
          key: chunk.record.randomAccess,
          timestamp: chunk.record.presentationTimestamp
        })))
      })))
    }));
    requireGeometry(
      inspection.sequence.maxWidth,
      inspection.sequence.maxHeight,
      input.candidate,
      "AV1 sequence header"
    );
    requireBt709Limited(inspection.sequence, "AV1 sequence header");
    return Object.freeze({
      codec: inspection.codec,
      bitDepth: inspection.sequence.bitDepth,
      units: Object.freeze(inspection.units.map((unit) => Object.freeze({
        id: unit.id,
        chunks: Object.freeze(unit.chunks.map((chunk) => Object.freeze({
          chunkType: chunk.chunkType,
          displayedFrameCount: chunk.displayedFrameCount
        })))
      })))
    });
  }
});
