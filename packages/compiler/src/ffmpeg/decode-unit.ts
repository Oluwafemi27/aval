import { Writable } from "node:stream";

import type { AvcRenditionGeometry } from "@pixel-point/aval-format";

import { revalidateAvcRenditionGeometry } from "../compile/validated-rendition-geometry.js";
import { CompilerError } from "../diagnostics.js";
import {
  MAX_PROCESS_STDERR_BYTES
} from "../model.js";
import { runBoundedProcess } from "../process-runner.js";
import { mediaTimeout } from "./encode-unit.js";

export interface DecodeAvcUnitInvocationInput {
  readonly geometry: Readonly<AvcRenditionGeometry>;
  readonly expectedFrameCount: number;
}

export interface DecodeAvcUnitInvocation {
  readonly arguments: readonly string[];
  readonly cwd: ".";
  readonly expectedFrameBytes: number;
}

export interface DecodeAvcUnitFramesInput extends DecodeAvcUnitInvocationInput {
  readonly encodedBytes: Uint8Array;
  readonly onFrame: (
    rgba: Uint8Array,
    frameIndex: number
  ) => void | Promise<void>;
  readonly executable?: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface DecodeAvcUnitResult {
  readonly invocation: Readonly<DecodeAvcUnitInvocation>;
  readonly frameCount: number;
}

/** Own the filter-free AVC decode-back argv and exact cropped RGBA size. */
export function createDecodeAvcUnitInvocation(
  input: Readonly<DecodeAvcUnitInvocationInput>
): Readonly<DecodeAvcUnitInvocation> {
  const { width, height } = validateGeometry(input.geometry);
  if (
    !Number.isSafeInteger(input.expectedFrameCount) ||
    input.expectedFrameCount < 1
  ) {
    throw new CompilerError(
      "FRAME_RANGE_INVALID",
      "Decode-back frame count must be a positive safe integer"
    );
  }
  const expectedFrameBytes = checkedProduct(width, height, 4);
  return Object.freeze({
    arguments: Object.freeze([
      "-nostdin",
      "-hide_banner",
      "-loglevel", "error",
      "-xerror",
      "-protocol_whitelist", "pipe",
      "-f", "h264",
      "-i", "pipe:0",
      "-map", "0:v:0",
      "-an", "-sn", "-dn",
      "-map_metadata", "-1",
      "-map_chapters", "-1",
      "-threads", "1",
      "-filter_threads", "1",
      "-frames:v", String(input.expectedFrameCount),
      "-fps_mode", "passthrough",
      "-f", "rawvideo",
      "-pix_fmt", "rgba",
      "pipe:1"
    ]),
    cwd: "." as const,
    expectedFrameBytes
  });
}

/** Decode every frame through one exact bounded sink without retaining output. */
export async function decodeAvcUnitFrames(
  input: Readonly<DecodeAvcUnitFramesInput>
): Promise<Readonly<DecodeAvcUnitResult>> {
  if (!(input.encodedBytes instanceof Uint8Array) || input.encodedBytes.length < 1) {
    throw new CompilerError("INPUT_INVALID", "Decode-back AVC unit is empty");
  }
  if (typeof input.onFrame !== "function") {
    throw new CompilerError("INPUT_INVALID", "Decode-back frame sink is invalid");
  }
  const invocation = createDecodeAvcUnitInvocation(input);
  const expectedBytes = checkedProduct(
    invocation.expectedFrameBytes,
    input.expectedFrameCount
  );
  const frame = allocateBytes(
    invocation.expectedFrameBytes,
    "decode-back frame"
  );
  let frameOffset = 0;
  let frameIndex = 0;
  const sink = new Writable({
    highWaterMark: Math.min(invocation.expectedFrameBytes * 2, 32 * 1024 * 1024),
    write(chunk: Buffer, _encoding, callback): void {
      void consume(new Uint8Array(
        chunk.buffer,
        chunk.byteOffset,
        chunk.byteLength
      )).then(() => callback(), (error: unknown) =>
        callback(error instanceof Error ? error : new Error("Decode sink failed"))
      );
    }
  });
  const consume = async (chunk: Uint8Array): Promise<void> => {
    let offset = 0;
    while (offset < chunk.length) {
      const count = Math.min(frame.length - frameOffset, chunk.length - offset);
      frame.set(chunk.subarray(offset, offset + count), frameOffset);
      frameOffset += count;
      offset += count;
      if (frameOffset !== frame.length) continue;
      if (frameIndex >= input.expectedFrameCount) {
        throw new CompilerError("FFMPEG_FAILED", "Decode-back emitted extra frames");
      }
      await input.onFrame(frame, frameIndex);
      frameIndex += 1;
      frameOffset = 0;
    }
  };

  await runBoundedProcess({
    executable: input.executable ?? "ffmpeg",
    arguments: invocation.arguments,
    cwd: invocation.cwd,
    limits: {
      timeoutMs: mediaTimeout(input.timeoutMs),
      maxStdoutBytes: expectedBytes,
      maxStderrBytes: MAX_PROCESS_STDERR_BYTES
    },
    stdin: input.encodedBytes,
    stdoutSink: sink,
    expectedStdoutBytes: expectedBytes,
    privateWorkingDirectory: true,
    ...(input.signal === undefined ? {} : { signal: input.signal })
  });
  if (frameIndex !== input.expectedFrameCount || frameOffset !== 0) {
    throw new CompilerError(
      "FFMPEG_FAILED",
      "Decode-back did not produce the exact expected frame set"
    );
  }
  return Object.freeze({ invocation, frameCount: frameIndex });
}

function validateGeometry(
  geometry: Readonly<AvcRenditionGeometry>
): { readonly width: number; readonly height: number } {
  const validated = revalidateAvcRenditionGeometry(geometry, {
    message: "Decode-back geometry is invalid"
  });
  const rect = validated.decodedStorageRect;
  return Object.freeze({ width: rect[2], height: rect[3] });
}

function checkedProduct(...values: number[]): number {
  let result = 1;
  for (const value of values) {
    if (
      !Number.isSafeInteger(value) ||
      value < 0 ||
      (value !== 0 && result > Math.floor(Number.MAX_SAFE_INTEGER / value))
    ) {
      throw new CompilerError("SOURCE_LIMIT", "Decode-back size exceeds safe range");
    }
    result *= value;
  }
  return result;
}

function allocateBytes(length: number, operation: string): Uint8Array {
  try {
    return new Uint8Array(length);
  } catch (error) {
    throw new CompilerError(
      "SOURCE_LIMIT",
      `Could not allocate ${String(length)} bytes for ${operation}`,
      { cause: error }
    );
  }
}
