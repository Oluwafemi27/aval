import { AvcIncrementalInspector } from "@pixel-point/aval-format";

import {
  type DecoderWorkerAvcProfile,
  type DecoderWorkerOutputExpectation,
  type DecoderWorkerSample
} from "./protocol.js";

export interface WorkerAvcSampleInspection {
  readonly chunkType: EncodedVideoChunkType;
}

export interface WorkerAvcInspector {
  inspect(input: {
    readonly unitId: string;
    readonly unitInstance: number;
    readonly unitFrame: number;
    readonly unitFrameCount: number;
    readonly key: boolean;
    readonly bytes: Uint8Array;
  }): WorkerAvcSampleInspection;
  resetUnitSequence(): void;
}

export type WorkerAvcInspectorFactory = (
  profile: DecoderWorkerAvcProfile,
  expectedOutput: DecoderWorkerOutputExpectation
) => WorkerAvcInspector;

export function createDefaultWorkerAvcInspector(
  profile: DecoderWorkerAvcProfile,
  expectedOutput: DecoderWorkerOutputExpectation
): WorkerAvcInspector {
  const rect = expectedOutput.visibleRect;
  return new AvcIncrementalInspector({
    ...profile,
    expectedDecodedStorageRect: Object.freeze([
      rect.x,
      rect.y,
      rect.width,
      rect.height
    ])
  });
}

export function inspectWorkerSample(
  inspector: WorkerAvcInspector,
  sample: DecoderWorkerSample
): DecoderWorkerSample {
  const inspection = inspector.inspect({
    unitId: sample.unitId,
    unitInstance: sample.unitInstance,
    unitFrame: sample.unitFrame,
    unitFrameCount: sample.unitFrameCount,
    key: sample.type === "key",
    bytes: new Uint8Array(sample.data)
  });
  return inspection.chunkType === sample.type
    ? sample
    : Object.freeze({ ...sample, type: inspection.chunkType });
}
