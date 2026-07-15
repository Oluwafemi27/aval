import {
  avcQuantizationPolicyForRendition,
  avcCodecForLevel,
  maximumAvcDecodedRgbaBytes
} from "@pixel-point/aval-format";

import type { DecoderWorkerConfigureOptions } from "../decoder-worker/client.js";
import { DECODER_WORKER_HARD_LIMITS } from "../decoder-worker/protocol.js";
import type { IntegratedCandidateAttemptContext } from "./integrated-player-contracts.js";
import type { AvcCandidateWorkerSetup } from "./avc-candidate-factory-model.js";
import { RESOURCE_DECODE_SURFACE_COUNT } from "./resource-plan.js";

/** Derive the only accepted worker configuration from inspected asset facts. */
export function createAvcCandidateWorkerSetup(
  context: Readonly<IntegratedCandidateAttemptContext>
): Readonly<AvcCandidateWorkerSetup> {
  const rendition = context.candidate.rendition;
  const geometry = context.candidate.geometry;
  const parameterSet = context.inspection.parameterSet;
  const storage = geometry.decodedStorageRect;
  if (
    rendition.codec !== avcCodecForLevel(parameterSet.levelIdc) ||
    rendition.codedWidth !== parameterSet.codedWidth ||
    rendition.codedHeight !== parameterSet.codedHeight ||
    geometry.codedWidth !== parameterSet.codedWidth ||
    geometry.codedHeight !== parameterSet.codedHeight ||
    parameterSet.crop.left !== storage[0] ||
    parameterSet.crop.top !== storage[1] ||
    parameterSet.crop.visibleWidth !== storage[2] ||
    parameterSet.crop.visibleHeight !== storage[3] ||
    parameterSet.color.fullRange ||
    parameterSet.color.colourPrimaries !== 1 ||
    parameterSet.color.transferCharacteristics !== 1 ||
    parameterSet.color.matrixCoefficients !== 1
  ) {
    throw new RangeError(
      "AVC candidate inspection does not match its exact decoder profile"
    );
  }

  const decodedBytesPerSurface = maximumAvcDecodedRgbaBytes(
    parameterSet.codedWidth,
    parameterSet.codedHeight
  );
  if (
    decodedBytesPerSurface >
      Math.floor(Number.MAX_SAFE_INTEGER / RESOURCE_DECODE_SURFACE_COUNT)
  ) {
    throw new RangeError("AVC candidate decoded byte limit is unsafe");
  }
  const maxDecodedBytes =
    decodedBytesPerSurface * RESOURCE_DECODE_SURFACE_COUNT;
  const limits = Object.freeze({
    maxDecodeQueueSize: DECODER_WORKER_HARD_LIMITS.maxDecodeQueueSize,
    maxPendingSamples: DECODER_WORKER_HARD_LIMITS.maxPendingSamples,
    maxOutstandingFrames: RESOURCE_DECODE_SURFACE_COUNT,
    maxDecodedBytes
  });
  const configure: Readonly<DecoderWorkerConfigureOptions> = Object.freeze({
    config: Object.freeze({
      codec: rendition.codec,
      codedWidth: rendition.codedWidth,
      codedHeight: rendition.codedHeight,
      hardwareAcceleration: "no-preference" as const,
      optimizeForLatency: true as const
    }),
    avcProfile: Object.freeze({
      codedWidth: rendition.codedWidth,
      codedHeight: rendition.codedHeight,
      frameRate: Object.freeze({
        numerator: context.catalog.manifest.frameRate.numerator,
        denominator: context.catalog.manifest.frameRate.denominator
      }),
      averageBitrate: rendition.bitrate.average,
      peakBitrate: rendition.bitrate.peak,
      cpbBufferBits: rendition.bitrate.peak,
      requireBt709LimitedRange: true as const,
      quantizationPolicy: avcQuantizationPolicyForRendition(rendition.profile)
    }),
    expectedOutput: Object.freeze({
      codedWidth: parameterSet.codedWidth,
      codedHeight: parameterSet.codedHeight,
      displayWidth: parameterSet.crop.visibleWidth,
      displayHeight: parameterSet.crop.visibleHeight,
      visibleRect: Object.freeze({
        x: parameterSet.crop.left,
        y: parameterSet.crop.top,
        width: parameterSet.crop.visibleWidth,
        height: parameterSet.crop.visibleHeight
      }),
      colorSpace: Object.freeze({
        fullRange: false,
        matrix: "bt709" as const,
        primaries: "bt709" as const,
        transfer: "bt709" as const
      })
    }),
    limits
  });
  return Object.freeze({ configure, limits });
}

/** @deprecated Use createAvcCandidateWorkerSetup. */
export const createOpaqueCandidateWorkerSetup = createAvcCandidateWorkerSetup;
