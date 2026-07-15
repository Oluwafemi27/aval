import {
  FormatError,
  deriveAvcRenditionGeometryFromVisible,
  inspectAvcAnnexBRendition,
  prepareAvcEncoderRendition,
  type AvcEncoderRenditionPreparation,
  type AvcRenditionGeometry
} from "@aval/format";

import { CompilerError } from "../diagnostics.js";
import {
  createEncodeAvcUnitInvocation,
  encodeAvcUnit,
  type FfmpegFrameInput
} from "../ffmpeg/encode-unit.js";
import {
  decodeAvcUnitFrames
} from "../ffmpeg/decode-unit.js";
import type {
  AlphaQualitySummary,
  CompileInvocationDetails,
  CompileRenditionDetails,
  CompositeQualitySummary,
  NormalizedAvcEncoding,
  RationalV01,
  SourceAlphaPolicy
} from "../model.js";
import { createAlphaQualityAccumulator } from "./alpha-quality.js";
import {
  avcPeakBitrate,
  deriveCanonicalAverageBitrate,
  validateAvcEncoding
} from "./avc-encoding-policy.js";
import { createCompositeQualityAccumulator } from "./composite-quality.js";
import {
  materializeScaledYuvUnitSpool,
  readExpectedRgbaFrame,
  type YuvUnitSpool
} from "./yuv-spool.js";

export interface AvcPipelineUnit {
  readonly id: string;
  readonly source: Extract<FfmpegFrameInput, { readonly type: "raw-rgba" }>;
  readonly sourceToken: string;
  readonly startFrame: number;
  readonly endFrame: number;
}

export interface CompileAvcRenditionInput {
  readonly rendition: {
    readonly id: string;
    readonly width: number;
    readonly height: number;
    readonly avcProfileVersion: "v0" | "v1";
    readonly encoding: Readonly<NormalizedAvcEncoding>;
  };
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly selectedAlphaProfile: Exclude<SourceAlphaPolicy, "auto">;
  readonly frameRate: RationalV01;
  readonly units: readonly Readonly<AvcPipelineUnit>[];
  readonly executable: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface CompiledAvcRendition {
  readonly geometry: Readonly<AvcRenditionGeometry>;
  readonly prepared: Readonly<AvcEncoderRenditionPreparation>;
  readonly rawEncodedBytes: number;
  readonly bitrate: Readonly<CompileRenditionDetails["bitrate"]>;
  readonly encoding: Readonly<CompileRenditionDetails["encoding"]>;
  readonly alphaQuality: Readonly<AlphaQualitySummary> | null;
  readonly compositeQuality: Readonly<CompositeQualitySummary> | null;
  readonly invocations: readonly CompileInvocationDetails[];
}

interface EncodedUnitScratch {
  readonly unit: Readonly<AvcPipelineUnit>;
  readonly spool: Readonly<YuvUnitSpool>;
  readonly rawBytes: Uint8Array;
}

/** Compile one opaque or packed rendition through the sole direct-YUV path. */
export async function compileAvcRendition(
  input: Readonly<CompileAvcRenditionInput>
): Promise<Readonly<CompiledAvcRendition>> {
  if (!Array.isArray(input.units) || input.units.length < 1) {
    throw new CompilerError("INPUT_INVALID", "AVC rendition requires units");
  }
  const encoding = validateAvcEncoding(input.rendition.encoding);
  const profile = input.selectedAlphaProfile === "packed"
    ? input.rendition.avcProfileVersion === "v1"
      ? "avc-annexb-packed-alpha-v1" as const
      : "avc-annexb-packed-alpha-v0" as const
    : input.rendition.avcProfileVersion === "v1"
      ? "avc-annexb-opaque-v1" as const
      : "avc-annexb-opaque-v0" as const;
  let geometry: Readonly<AvcRenditionGeometry>;
  try {
    geometry = deriveAvcRenditionGeometryFromVisible({
      canvasWidth: input.canvasWidth,
      canvasHeight: input.canvasHeight,
      profile,
      visibleWidth: input.rendition.width,
      visibleHeight: input.rendition.height
    });
  } catch (error) {
    if (error instanceof FormatError) {
      throw new CompilerError("AVC_PROFILE_INVALID", error.message, {
        cause: error
      });
    }
    throw error;
  }
  const invocations: CompileInvocationDetails[] = [];
  const scratch: EncodedUnitScratch[] = [];
  let rawEncodedBytes = 0;
  try {
    for (const unit of input.units) {
      const spool = await materializeScaledYuvUnitSpool({
        source: unit.source,
        startFrame: unit.startFrame,
        endFrame: unit.endFrame,
        geometry,
        frameRate: input.frameRate,
        executable: input.executable,
        ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
        ...(input.signal === undefined ? {} : { signal: input.signal })
      });
      invocations.push(Object.freeze({
        operation: `scale:${input.rendition.id}:${unit.id}`,
        tool: "ffmpeg" as const,
        arguments: redactArguments(
          spool.scaleInvocation.arguments,
          unit.source.path,
          unit.sourceToken
        )
      }));
      try {
        const encodeInput = {
          source: spool.input,
          startFrame: 0,
          endFrame: spool.frameCount,
          codedWidth: geometry.codedWidth,
          codedHeight: geometry.codedHeight,
          decodedStorageRect: geometry.decodedStorageRect,
          encoding,
          executable: input.executable,
          ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
          ...(input.signal === undefined ? {} : { signal: input.signal })
        };
        const encodeInvocation = createEncodeAvcUnitInvocation(encodeInput);
        invocations.push(Object.freeze({
          operation: `encode:${input.rendition.id}:${unit.id}`,
          tool: "ffmpeg" as const,
          arguments: encodeInvocation.arguments
        }));
        const rawBytes = await encodeAvcUnit(encodeInput);
        rawEncodedBytes += rawBytes.byteLength;
        if (
          !Number.isSafeInteger(rawEncodedBytes)
        ) {
          throw new CompilerError(
            "OUTPUT_LIMIT",
            "Raw encoder output exceeds the safe-integer range"
          );
        }
        scratch.push(Object.freeze({ unit, spool, rawBytes }));
      } catch (error) {
        await spool.cleanup();
        throw error;
      }
    }

    let prepared: Readonly<AvcEncoderRenditionPreparation>;
    const peakBitrate = avcPeakBitrate(encoding);
    const configuredAverage = encoding.rateControl.mode === "abr"
      ? encoding.rateControl.averageBitrate
      : peakBitrate;
    try {
      prepared = prepareAvcEncoderRendition({
        profile: {
          codedWidth: geometry.codedWidth,
          codedHeight: geometry.codedHeight,
          expectedDecodedStorageRect: geometry.decodedStorageRect,
          frameRate: input.frameRate,
          averageBitrate: configuredAverage,
          peakBitrate,
          cpbBufferBits: peakBitrate,
          quantizationPolicy: input.rendition.avcProfileVersion === "v1"
            ? "bounded-qp-v1"
            : "fixed-qp26-v0",
          requireBt709LimitedRange: true
        },
        units: scratch.map(({ unit, rawBytes }) => Object.freeze({
          id: unit.id,
          bytes: rawBytes,
          expectedAccessUnitCount: unit.endFrame - unit.startFrame
        }))
      });
    } catch (error) {
      if (error instanceof FormatError) {
        throw new CompilerError("AVC_PROFILE_INVALID", error.message, {
          cause: error
        });
      }
      throw error;
    }

    const canonicalBytes = prepared.units.reduce(
      (total, unit) => unit.accessUnits.reduce(
        (unitTotal, accessUnit) => checkedByteSum(
          unitTotal,
          accessUnit.bytes.byteLength,
          "canonical AVC bytes"
        ),
        total
      ),
      0
    );
    const frameCount = input.units.reduce(
      (total, unit) => checkedByteSum(
        total,
        unit.endFrame - unit.startFrame,
        "AVC frame count"
      ),
      0
    );
    const measuredAverageBitrate = deriveCanonicalAverageBitrate({
      canonicalBytes,
      frameCount,
      frameRate: input.frameRate
    });
    if (
      input.rendition.avcProfileVersion === "v1" &&
      measuredAverageBitrate > peakBitrate
    ) {
      throw new CompilerError(
        "AVC_PROFILE_INVALID",
        `Measured AVC average bitrate ${String(measuredAverageBitrate)} exceeds the configured maximum ${String(peakBitrate)}`
      );
    }
    const bitrate = Object.freeze({
      average: input.rendition.avcProfileVersion === "v1"
        ? measuredAverageBitrate
        : configuredAverage,
      peak: peakBitrate
    });
    if (input.rendition.avcProfileVersion === "v1") {
      try {
        const inspection = inspectAvcAnnexBRendition({
          profile: {
            codedWidth: geometry.codedWidth,
            codedHeight: geometry.codedHeight,
            expectedDecodedStorageRect: geometry.decodedStorageRect,
            frameRate: input.frameRate,
            averageBitrate: bitrate.average,
            peakBitrate: bitrate.peak,
            cpbBufferBits: bitrate.peak,
            quantizationPolicy: "bounded-qp-v1",
            requireBt709LimitedRange: true
          },
          units: prepared.units
        });
        prepared = Object.freeze({ ...prepared, inspection });
      } catch (error) {
        if (error instanceof FormatError) {
          throw new CompilerError("AVC_PROFILE_INVALID", error.message, {
            cause: error
          });
        }
        throw error;
      }
    }

    let alphaQuality: Readonly<AlphaQualitySummary> | null = null;
    let compositeQuality: Readonly<CompositeQualitySummary> | null = null;
    if (
      profile === "avc-annexb-packed-alpha-v0" ||
      profile === "avc-annexb-packed-alpha-v1"
    ) {
      const quality = createAlphaQualityAccumulator({
        rendition: input.rendition.id,
        geometry,
        ...(input.signal === undefined ? {} : { signal: input.signal })
      });
      const composite = createCompositeQualityAccumulator({
        rendition: input.rendition.id,
        geometry,
        ...(input.signal === undefined ? {} : { signal: input.signal })
      });
      const canonicalByUnit = new Map(
        prepared.units.map((unit) => [unit.id, unit.accessUnits])
      );
      for (const item of scratch) {
        const accessUnits = canonicalByUnit.get(item.unit.id);
        if (accessUnits === undefined) {
          throw new CompilerError("IO_FAILED", "Prepared AVC unit is unavailable");
        }
        const canonicalBytes = concatenate(
          accessUnits.map(({ bytes }) => bytes)
        );
        const decoded = await decodeAvcUnitFrames({
          encodedBytes: canonicalBytes,
          geometry,
          expectedFrameCount: item.spool.frameCount,
          onFrame: async (rgba, frameIndex) => {
            const expectedRgba = await readExpectedRgbaFrame(
              item.spool,
              frameIndex,
              input.signal
            );
            quality.includeFrame({
              unit: item.unit.id,
              frameIndex,
              expectedAlpha: extractAlpha(expectedRgba),
              decodedRgba: rgba
            });
            composite.includeFrame({
              unit: item.unit.id,
              frameIndex,
              expectedRgba,
              decodedRgba: rgba
            });
          },
          executable: input.executable,
          ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
          ...(input.signal === undefined ? {} : { signal: input.signal })
        });
        invocations.push(Object.freeze({
          operation: `decode-back:${input.rendition.id}:${item.unit.id}`,
          tool: "ffmpeg" as const,
          arguments: decoded.invocation.arguments
        }));
      }
      alphaQuality = quality.finish();
      compositeQuality = composite.finish();
    }
    return Object.freeze({
      geometry,
      prepared,
      rawEncodedBytes,
      bitrate,
      encoding: Object.freeze({
        codec: "libx264" as const,
        preset: encoding.preset,
        rateControl: encoding.rateControl,
        legacyZeroLatency: encoding.legacyZeroLatency,
        canonicalBytes,
        measuredAverageBitrate
      }),
      alphaQuality,
      compositeQuality,
      invocations: Object.freeze(invocations)
    });
  } finally {
    await Promise.all(scratch.map(({ spool }) => spool.cleanup()));
  }
}

function checkedByteSum(left: number, right: number, label: string): number {
  if (
    !Number.isSafeInteger(left) ||
    !Number.isSafeInteger(right) ||
    left < 0 ||
    right < 0 ||
    left > Number.MAX_SAFE_INTEGER - right
  ) {
    throw new CompilerError("OUTPUT_LIMIT", `${label} exceeds safe arithmetic`);
  }
  return left + right;
}

function extractAlpha(rgba: Uint8Array): Uint8Array {
  const alpha = new Uint8Array(rgba.byteLength / 4);
  for (let pixel = 0; pixel < alpha.byteLength; pixel += 1) {
    alpha[pixel] = rgba[pixel * 4 + 3]!;
  }
  return alpha;
}

function redactArguments(
  arguments_: readonly string[],
  path: string,
  token: string
): readonly string[] {
  return Object.freeze(arguments_.map((argument) =>
    argument.split(path).join(token)
  ));
}

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  let length = 0;
  for (const part of parts) {
    length += part.byteLength;
    if (!Number.isSafeInteger(length)) {
      throw new CompilerError(
        "OUTPUT_LIMIT",
        "Canonical AVC unit exceeds the safe-integer range"
      );
    }
  }
  let output: Uint8Array;
  try {
    output = new Uint8Array(length);
  } catch (cause) {
    throw new CompilerError(
      "OUTPUT_LIMIT",
      `Could not allocate ${String(length)} bytes for the canonical AVC unit`,
      { cause }
    );
  }
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}
