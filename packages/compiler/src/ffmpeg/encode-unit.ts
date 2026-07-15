import { dirname } from "node:path";

import {
  avcRateControlArguments,
  validateAvcEncoding
} from "../compile/avc-encoding-policy.js";
import { CompilerError } from "../diagnostics.js";
import {
  DEFAULT_MEDIA_TIMEOUT_MS,
  MAX_PROCESS_OUTPUT_BYTES,
  MAX_PROCESS_STDERR_BYTES,
  type NormalizedAvcEncoding,
  type RationalV01
} from "../model.js";
import { runBoundedProcess } from "../process-runner.js";

export type FfmpegFrameInput =
  | {
      readonly type: "video";
      readonly path: string;
    }
  | {
      readonly type: "png-sequence";
      readonly path: string;
      readonly firstFileNumber: number;
      readonly frameRate: RationalV01;
    }
  | {
      readonly type: "raw-rgba";
      readonly path: string;
      readonly width: number;
      readonly height: number;
      readonly frameRate: RationalV01;
    }
  | {
      readonly type: "raw-yuv420p";
      readonly path: string;
      readonly width: number;
      readonly height: number;
      readonly frameRate: RationalV01;
      readonly frameBytes: number;
    };

export interface EncodeAvcUnitInput {
  readonly source: Extract<FfmpegFrameInput, { readonly type: "raw-yuv420p" }>;
  readonly startFrame: number;
  readonly endFrame: number;
  readonly codedWidth: number;
  readonly codedHeight: number;
  readonly decodedStorageRect?: readonly [number, number, number, number];
  readonly encoding: Readonly<NormalizedAvcEncoding>;
  readonly executable?: string;
  readonly signal?: AbortSignal;
  /** Positive per-subprocess wall limit; defaults to 120 seconds. */
  readonly timeoutMs?: number;
}

export interface EncodeAvcUnitInvocation {
  readonly arguments: readonly string[];
  readonly cwd: string;
  readonly stdinFile?: {
    readonly path: string;
    readonly offset: number;
    readonly length: number;
  };
}

export type FfmpegInvocation = EncodeAvcUnitInvocation;

export interface MaterializeRgbaInvocationInput {
  readonly source: FfmpegFrameInput;
  readonly sourceFrames: readonly number[];
  readonly outputWidth: number;
  readonly outputHeight: number;
}

/** Encode one independently decodable low-delay Annex B unit. */
export async function encodeAvcUnit(
  input: EncodeAvcUnitInput
): Promise<Uint8Array> {
  const invocation = createEncodeAvcUnitInvocation(input);
  const timeoutMs = mediaTimeout(input.timeoutMs);
  const result = await runBoundedProcess({
    executable: input.executable ?? "ffmpeg",
    arguments: invocation.arguments,
    cwd: invocation.cwd,
    limits: {
      timeoutMs,
      maxStdoutBytes: MAX_PROCESS_OUTPUT_BYTES,
      maxStderrBytes: MAX_PROCESS_STDERR_BYTES
    },
    privateWorkingDirectory: true,
    ...(invocation.stdinFile === undefined
      ? {}
      : { stdinFile: invocation.stdinFile }),
    ...(input.signal === undefined ? {} : { signal: input.signal })
  });
  if (result.stdout.byteLength === 0) {
    throw new CompilerError("FFMPEG_FAILED", "FFmpeg emitted an empty AVC unit");
  }
  return result.stdout;
}

/** Own the exact, snapshot-testable ordered invocation for one AVC unit. */
export function createEncodeAvcUnitInvocation(
  input: EncodeAvcUnitInput
): Readonly<EncodeAvcUnitInvocation> {
  const frameCount = validateRange(input.startFrame, input.endFrame);
  const keyInterval = Math.max(2, frameCount);
  const encoding = validateAvcEncoding(input.encoding);
  const source = input.source as FfmpegFrameInput;
  if (source.type !== "raw-yuv420p") {
    throw new CompilerError(
      "INPUT_INVALID",
      "AVC encoding requires compiler-packed raw yuv420p input"
    );
  }
  if (
    source.width !== input.codedWidth ||
    source.height !== input.codedHeight
  ) {
    throw new CompilerError(
      "INPUT_INVALID",
      "Raw YUV dimensions must equal the encoded coded dimensions"
    );
  }
  const cropParameter = x264CropParameter(input);
  const arguments_ = Object.freeze([
    "-nostdin",
    "-hide_banner",
    "-loglevel", "error",
    "-xerror",
    "-protocol_whitelist", "pipe",
    ...rawYuvPipeArguments(source),
    "-map", "0:v:0",
    "-an", "-sn", "-dn",
    "-map_metadata", "-1",
    "-map_chapters", "-1",
    "-frames:v", String(frameCount),
    "-fps_mode", "passthrough",
    "-c:v", "libx264",
    "-preset", encoding.preset,
    ...(encoding.legacyZeroLatency ? ["-tune", "zerolatency"] : []),
    "-profile:v", "baseline",
    "-pix_fmt", "yuv420p",
    "-color_range", "tv",
    "-color_primaries", "bt709",
    "-color_trc", "bt709",
    "-colorspace", "bt709",
    "-threads", "1",
    "-filter_threads", "1",
    "-g", String(keyInterval),
    "-keyint_min", String(keyInterval),
    "-sc_threshold", "0",
    "-bf", "0",
    "-refs", "1",
    ...avcRateControlArguments(encoding.rateControl),
    "-x264-params",
    [
      "aud=1",
      "bframes=0",
      "cabac=0",
      "colormatrix=bt709",
      "colorprim=bt709",
      ...(cropParameter === undefined ? [] : [cropParameter]),
      "force-cfr=1",
      `keyint=${String(keyInterval)}`,
      `min-keyint=${String(keyInterval)}`,
      "open-gop=0",
      "ref=1",
      "range=tv",
      "repeat-headers=1",
      "scenecut=0",
      "sliced-threads=0",
      "slices=1",
      "threads=1",
      "lookahead-threads=1",
      ...(encoding.legacyZeroLatency ? ["sync-lookahead=0"] : []),
      "transfer=bt709"
    ].join(":"),
    "-f", "h264",
    "pipe:1"
  ]);
  const frameBytes = checkedYuvFrameBytes(source);
  const offset = checkedProduct(input.startFrame, frameBytes, "raw unit offset");
  const length = checkedProduct(frameCount, frameBytes, "raw unit length");
  return Object.freeze({
    arguments: arguments_,
    cwd: dirname(input.source.path),
    stdinFile: Object.freeze({ path: input.source.path, offset, length })
  });
}

/** Own the exact ordered sparse canonical-RGBA materialization argv. */
export function createMaterializeRgbaInvocation(
  input: MaterializeRgbaInvocationInput
): Readonly<FfmpegInvocation> {
  const sourceFrames = validateSelectedFrames(input.sourceFrames);
  validateNativeDimensions(input.outputWidth, input.outputHeight);
  return Object.freeze({
    arguments: Object.freeze([
      ...decodePrefix(input.source),
      "-vf", [
        `select=${selectionExpression(sourceFrames)}`,
        `scale=${String(input.outputWidth)}:${String(input.outputHeight)}:flags=lanczos+accurate_rnd+full_chroma_int:in_range=auto:out_range=full:in_color_matrix=auto:out_color_matrix=bt709`,
        "setsar=1",
        "format=rgba"
      ].join(","),
      "-frames:v", String(sourceFrames.length),
      "-fps_mode", "passthrough",
      "-f", "rawvideo",
      "-pix_fmt", "rgba",
      "pipe:1"
    ]),
    cwd: dirname(input.source.path)
  });
}

export interface ExtractRgbaRangeInput {
  readonly source: FfmpegFrameInput;
  readonly startFrame: number;
  readonly endFrame: number;
  readonly width: number;
  readonly height: number;
  readonly executable?: string;
  readonly signal?: AbortSignal;
  /** Positive per-subprocess wall limit; defaults to 120 seconds. */
  readonly timeoutMs?: number;
}

/** Decode one bounded half-open source range to tightly packed RGBA bytes. */
export async function extractRgbaRange(
  input: ExtractRgbaRangeInput
): Promise<readonly Uint8Array[]> {
  const frameCount = validateRange(input.startFrame, input.endFrame);
  const frameBytes = checkedFrameBytes(input.width, input.height);
  const outputBytes = checkedProduct(frameBytes, frameCount, "RGBA extraction bytes");
  const invocation = createExtractRgbaRangeInvocation(input);
  const result = await runBoundedProcess({
    executable: input.executable ?? "ffmpeg",
    arguments: invocation.arguments,
    cwd: invocation.cwd,
    limits: {
      timeoutMs: mediaTimeout(input.timeoutMs),
      maxStdoutBytes: outputBytes,
      maxStderrBytes: MAX_PROCESS_STDERR_BYTES
    },
    expectedStdoutBytes: outputBytes,
    privateWorkingDirectory: true,
    ...(input.signal === undefined ? {} : { signal: input.signal })
  });
  if (result.stdout.byteLength !== outputBytes) {
    throw new CompilerError(
      "FFMPEG_FAILED",
      `RGBA extraction returned ${String(result.stdout.byteLength)} bytes; expected ${String(outputBytes)}`
    );
  }
  return Object.freeze(Array.from({ length: frameCount }, (_, index) =>
    result.stdout.slice(index * frameBytes, (index + 1) * frameBytes)
  ));
}

/** Own the exact ordered RGBA extraction argv. */
export function createExtractRgbaRangeInvocation(
  input: ExtractRgbaRangeInput
): Readonly<FfmpegInvocation> {
  const frameCount = validateRange(input.startFrame, input.endFrame);
  checkedFrameBytes(input.width, input.height);
  return Object.freeze({
    arguments: Object.freeze([
      ...decodePrefix(input.source),
      "-vf",
      [
        rangeSelection(input.startFrame, input.endFrame),
        `scale=${String(input.width)}:${String(input.height)}:flags=lanczos+accurate_rnd+full_chroma_int:in_range=auto:out_range=full:in_color_matrix=auto:out_color_matrix=bt709`,
        "setsar=1",
        "format=rgba"
      ].join(","),
      "-frames:v", String(frameCount),
      "-fps_mode", "passthrough",
      "-f", "rawvideo",
      "-pix_fmt", "rgba",
      "pipe:1"
    ]),
    cwd: dirname(input.source.path)
  });
}

export function sourceArguments(source: FfmpegFrameInput): string[] {
  if (source.type === "video") return ["-f", "mov", "-i", source.path];
  if (source.type === "png-sequence") {
    return [
        "-f", "image2",
        "-framerate", `${String(source.frameRate.numerator)}/${String(source.frameRate.denominator)}`,
        "-start_number", String(source.firstFileNumber),
        "-i", source.path
      ];
  }
  return source.type === "raw-rgba" ? [
    "-f", "rawvideo",
    "-pixel_format", "rgba",
    "-video_size", `${String(source.width)}x${String(source.height)}`,
    "-framerate", `${String(source.frameRate.numerator)}/${String(source.frameRate.denominator)}`,
    "-i", source.path
  ] : [
    "-f", "rawvideo",
    "-pixel_format", "yuv420p",
    "-video_size", `${String(source.width)}x${String(source.height)}`,
    "-framerate", `${String(source.frameRate.numerator)}/${String(source.frameRate.denominator)}`,
    "-i", source.path
  ];
}

function rawYuvPipeArguments(
  source: Extract<FfmpegFrameInput, { readonly type: "raw-yuv420p" }>
): string[] {
  return [
    "-f", "rawvideo",
    "-pixel_format", "yuv420p",
    "-video_size", `${String(source.width)}x${String(source.height)}`,
    "-framerate", `${String(source.frameRate.numerator)}/${String(source.frameRate.denominator)}`,
    "-i", "pipe:0"
  ];
}

function checkedYuvFrameBytes(
  source: Extract<FfmpegFrameInput, { readonly type: "raw-yuv420p" }>
): number {
  if (source.width % 2 !== 0 || source.height % 2 !== 0) {
    throw new CompilerError("INPUT_INVALID", "Raw YUV dimensions must be even");
  }
  const pixels = checkedProduct(source.width, source.height, "raw YUV pixels");
  const frameBytes = checkedProduct(pixels, 3, "raw YUV frame bytes") / 2;
  if (!Number.isSafeInteger(frameBytes) || source.frameBytes !== frameBytes) {
    throw new CompilerError(
      "INPUT_INVALID",
      "Raw YUV frame byte count does not match yuv420p geometry"
    );
  }
  return frameBytes;
}

function x264CropParameter(input: EncodeAvcUnitInput): string | undefined {
  const rect = input.decodedStorageRect;
  if (rect === undefined) return undefined;
  if (
    !Array.isArray(rect) ||
    rect.length !== 4 ||
    rect[0] !== 0 ||
    rect[1] !== 0 ||
    !Number.isSafeInteger(rect[2]) ||
    !Number.isSafeInteger(rect[3]) ||
    rect[2] < 1 ||
    rect[3] < 1 ||
    rect[2] > input.codedWidth ||
    rect[3] > input.codedHeight
  ) {
    throw new CompilerError("INPUT_INVALID", "Decoded storage crop is invalid");
  }
  const right = input.codedWidth - rect[2];
  const bottom = input.codedHeight - rect[3];
  if (right % 2 !== 0 || bottom % 2 !== 0) {
    throw new CompilerError(
      "INPUT_INVALID",
      "Decoded storage crop must preserve yuv420p chroma alignment"
    );
  }
  return right === 0 && bottom === 0
    ? undefined
    : `crop-rect=0,0,${String(right)},${String(bottom)}`;
}

function decodePrefix(source: FfmpegFrameInput): readonly string[] {
  return Object.freeze([
    "-nostdin",
    "-hide_banner",
    "-loglevel", "error",
    "-xerror",
    "-protocol_whitelist", "file,pipe",
    ...sourceArguments(source),
    "-map", "0:v:0",
    "-an", "-sn", "-dn",
    "-map_metadata", "-1",
    "-map_chapters", "-1",
    "-threads", "1",
    "-filter_threads", "1"
  ]);
}

function rangeSelection(startFrame: number, endFrame: number): string {
  return `select=between(n\\,${String(startFrame)}\\,${String(endFrame - 1)})`;
}

function selectionExpression(frames: readonly number[]): string {
  const parts: string[] = [];
  let start = frames[0]!;
  let end = start;
  for (let index = 1; index <= frames.length; index += 1) {
    const frame = frames[index];
    if (frame === end + 1) {
      end = frame;
      continue;
    }
    parts.push(start === end
      ? `eq(n\\,${String(start)})`
      : `between(n\\,${String(start)}\\,${String(end)})`);
    if (frame !== undefined) {
      start = frame;
      end = frame;
    }
  }
  return parts.join("+");
}

function validateSelectedFrames(frames: readonly number[]): readonly number[] {
  if (
    frames.length < 1 ||
    frames.some((frame, index) =>
      !Number.isSafeInteger(frame) ||
      frame < 0 ||
      (index > 0 && frame <= frames[index - 1]!)
    )
  ) {
    throw new CompilerError(
      "FRAME_RANGE_INVALID",
      "RGBA frame selection must be nonempty, unique, and increasing"
    );
  }
  return frames;
}

function validateNativeDimensions(width: number, height: number): void {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1
  ) {
    throw new CompilerError(
      "INPUT_INVALID",
      "RGBA materialization dimensions must be positive safe integers"
    );
  }
}

export function mediaTimeout(timeoutMs: number | undefined): number {
  const value = timeoutMs ?? DEFAULT_MEDIA_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(value) ||
    value < 1
  ) {
    throw new CompilerError(
      "INPUT_INVALID",
      "Media timeout must be a positive safe integer in milliseconds"
    );
  }
  return value;
}

function checkedProduct(left: number, right: number, label: string): number {
  const result = left * right;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new CompilerError("SOURCE_LIMIT", `${label} exceeds the safe range`);
  }
  return result;
}

function validateRange(startFrame: number, endFrame: number): number {
  if (
    !Number.isSafeInteger(startFrame) ||
    !Number.isSafeInteger(endFrame) ||
    startFrame < 0 ||
    endFrame <= startFrame
  ) {
    throw new CompilerError(
      "FRAME_RANGE_INVALID",
      "Frame range must be nonempty, nonnegative, and half-open"
    );
  }
  return endFrame - startFrame;
}

function checkedFrameBytes(width: number, height: number): number {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1
  ) {
    throw new CompilerError(
      "INPUT_INVALID",
      "RGBA dimensions must be positive safe integers"
    );
  }
  return checkedProduct(
    checkedProduct(width, height, "RGBA pixels"),
    4,
    "RGBA frame bytes"
  );
}
