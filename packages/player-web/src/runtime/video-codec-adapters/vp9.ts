import { inspectVp9Rendition } from "@pixel-point/aval-format";

import {
  decodedStorageGeometry,
  freezeFrameRate,
  invalid,
  requireBt709Limited,
  requireGeometry,
  requireVisibleGeometry,
  type CodecAdapterInput,
  type DecodedStorageGeometry,
  type VideoBitstreamAdapter
} from "./model.js";

export const VP9_BITSTREAM_ADAPTER: VideoBitstreamAdapter = Object.freeze({
  inspect(input: Readonly<CodecAdapterInput>) {
    const geometry = decodedStorageGeometry(input.candidate);
    const inspection = inspectVp9Rendition(Object.freeze({
      width: input.candidate.rendition.codedWidth,
      height: input.candidate.rendition.codedHeight,
      frameRate: freezeFrameRate(input.frameRate),
      averageBitrate: input.candidate.rendition.bitrate.average,
      units: Object.freeze(input.units.map((unit) => Object.freeze({
        id: unit.id,
        expectedDisplayedFrames: unit.expectedDisplayedFrames,
        packets: Object.freeze(unit.chunks.map((chunk) => Object.freeze({
          bytes: chunk.bytes,
          key: chunk.record.randomAccess,
          timestamp: chunk.record.presentationTimestamp
        })))
      })))
    }));
    requireGeometry(
      inspection.width,
      inspection.height,
      input.candidate,
      "VP9 stream"
    );
    validateKeyGeometry(input, inspection.units, geometry);
    return Object.freeze({
      codec: inspection.codec,
      bitDepth: inspection.bitDepth,
      units: Object.freeze(inspection.units.map((unit) => Object.freeze({
        id: unit.id,
        chunks: Object.freeze(unit.packets.map((packet) => Object.freeze({
          chunkType: packet.chunkType,
          displayedFrameCount: packet.displayedFrameCount
        })))
      })))
    });
  }
});

function validateKeyGeometry(
  input: Readonly<CodecAdapterInput>,
  units: ReturnType<typeof inspectVp9Rendition>["units"],
  geometry: Readonly<DecodedStorageGeometry>
): void {
  let keyFrameCount = 0;
  for (const unit of units) {
    for (const packet of unit.packets) {
      for (const frame of packet.codedFrames) {
        if (!frame.key) continue;
        keyFrameCount += 1;
        requireGeometry(
          frame.width,
          frame.height,
          input.candidate,
          "VP9 key frame"
        );
        requireVisibleGeometry(
          frame.renderWidth,
          frame.renderHeight,
          geometry,
          "VP9 key frame"
        );
        requireBt709Limited(frame.color, "VP9 key frame");
      }
    }
  }
  if (keyFrameCount === 0) invalid("VP9 rendition contains no key-frame geometry");
}
