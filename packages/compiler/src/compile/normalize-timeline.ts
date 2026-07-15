import { CompilerError } from "../diagnostics.js";
import type { MediaProbeFrame, RationalV01 } from "../model.js";

export interface NormalizedTimeline {
  readonly sourceFrameByOutputFrame: readonly number[];
  readonly duplicatedSourceFrames: readonly number[];
  readonly droppedSourceFrames: readonly number[];
}

/** Deterministic hold normalization: latest source PTS <= each target tick. */
export function normalizeHoldTimeline(
  frames: readonly MediaProbeFrame[],
  frameRate: RationalV01,
  timeBase: RationalV01
): Readonly<NormalizedTimeline> {
  if (frames.length < 1) {
    throw new CompilerError("VFR_UNSUPPORTED", "Cannot normalize an empty timeline");
  }
  const firstPts = BigInt(frames[0]!.timestampTicks);
  const last = frames.at(-1)!;
  const endTicks =
    BigInt(last.timestampTicks) - firstPts + BigInt(last.durationTicks);
  const targetStep =
    BigInt(frameRate.denominator) * BigInt(timeBase.denominator);
  const sourceScale =
    BigInt(timeBase.numerator) * BigInt(frameRate.numerator);
  const outputCountBig = (endTicks * sourceScale + targetStep - 1n) / targetStep;
  if (outputCountBig < 1n || outputCountBig > 0xffff_ffffn) {
    throw new CompilerError(
      "SOURCE_LIMIT",
      "Normalized timeline cannot be represented by a JavaScript array"
    );
  }
  const outputCount = Number(outputCountBig);
  let mapping: number[];
  try {
    mapping = new Array<number>(outputCount);
  } catch (error) {
    throw new CompilerError(
      "SOURCE_LIMIT",
      `Could not allocate normalized timeline for ${String(outputCount)} frames`,
      { cause: error }
    );
  }
  let sourceIndex = 0;
  for (let outputIndex = 0; outputIndex < outputCount; outputIndex += 1) {
    const targetScale =
      BigInt(outputIndex) *
      targetStep;
    while (
      sourceIndex + 1 < frames.length &&
      (BigInt(frames[sourceIndex + 1]!.timestampTicks) - firstPts) * sourceScale <=
        targetScale
    ) {
      sourceIndex += 1;
    }
    mapping[outputIndex] = sourceIndex;
  }
  const counts = new Map<number, number>();
  for (const source of mapping) counts.set(source, (counts.get(source) ?? 0) + 1);
  const duplicatedSourceFrames = [...counts]
    .filter(([, count]) => count > 1)
    .map(([index]) => index);
  const droppedSourceFrames = frames.flatMap((_, index) =>
    counts.has(index) ? [] : [index]
  );
  return Object.freeze({
    sourceFrameByOutputFrame: Object.freeze(mapping),
    duplicatedSourceFrames: Object.freeze(duplicatedSourceFrames),
    droppedSourceFrames: Object.freeze(droppedSourceFrames)
  });
}
