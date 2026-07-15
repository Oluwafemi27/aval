import { mkdtemp, open, rm, statfs } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";

import type { AvcRenditionGeometry } from "@aval/format";

import { throwIfAborted } from "../cancellation.js";
import { CompilerError } from "../diagnostics.js";
import {
  createExtractRgbaRangeInvocation,
  mediaTimeout,
  type FfmpegFrameInput,
  type FfmpegInvocation
} from "../ffmpeg/encode-unit.js";
import {
  MAX_PROCESS_STDERR_BYTES,
  type RationalV01
} from "../model.js";
import { runBoundedProcess } from "../process-runner.js";
import { packRgbaToPlanarYuv420 } from "./packed-yuv420.js";

const DISK_HEADROOM_BYTES = 64 * 1024 * 1024;

export interface ExpectedRgbaSpool {
  readonly path: string;
  readonly frameBytes: number;
}

export interface YuvUnitSpool {
  readonly input: Extract<FfmpegFrameInput, { readonly type: "raw-yuv420p" }>;
  readonly frameCount: number;
  readonly expectedRgba: Readonly<ExpectedRgbaSpool> | null;
  readonly cleanup: () => Promise<void>;
}

export interface MaterializedYuvUnitSpool extends YuvUnitSpool {
  readonly scaleInvocation: Readonly<FfmpegInvocation>;
}

export interface WriteYuvUnitSpoolInput {
  readonly geometry: Readonly<AvcRenditionGeometry>;
  readonly frameRate: RationalV01;
  readonly frames: readonly Uint8Array[];
  readonly temporaryRoot?: string;
  readonly signal?: AbortSignal;
}

export interface MaterializeScaledYuvUnitInput {
  readonly source: Extract<FfmpegFrameInput, { readonly type: "raw-rgba" }>;
  readonly startFrame: number;
  readonly endFrame: number;
  readonly geometry: Readonly<AvcRenditionGeometry>;
  readonly frameRate: RationalV01;
  readonly executable: string;
  readonly timeoutMs?: number;
  readonly temporaryRoot?: string;
  readonly signal?: AbortSignal;
}

/** Write caller-owned visible RGBA frames into one exact private YUV unit. */
export async function writeYuvUnitSpool(
  input: Readonly<WriteYuvUnitSpoolInput>
): Promise<Readonly<YuvUnitSpool>> {
  validateFrameCount(input.frames.length);
  const writer = await createSpoolWriter({
    geometry: input.geometry,
    frameRate: input.frameRate,
    frameCount: input.frames.length,
    ...(input.temporaryRoot === undefined
      ? {}
      : { temporaryRoot: input.temporaryRoot }),
    ...(input.signal === undefined ? {} : { signal: input.signal })
  });
  try {
    for (const frame of input.frames) await writer.append(frame);
    return await writer.finish();
  } catch (error) {
    await writer.abort();
    throw error;
  }
}

/** Scale one canonical RGBA range and stream-pack it without output retention. */
export async function materializeScaledYuvUnitSpool(
  input: Readonly<MaterializeScaledYuvUnitInput>
): Promise<Readonly<MaterializedYuvUnitSpool>> {
  const frameCount = input.endFrame - input.startFrame;
  validateFrameCount(frameCount);
  if (
    !Number.isSafeInteger(input.startFrame) ||
    !Number.isSafeInteger(input.endFrame) ||
    input.startFrame < 0 ||
    input.endFrame <= input.startFrame
  ) {
    throw new CompilerError("FRAME_RANGE_INVALID", "YUV source range is invalid");
  }
  const visible = input.geometry.visibleColorRect;
  const visibleFrameBytes = checkedProduct(visible[2], visible[3], 4);
  const expectedBytes = checkedProduct(visibleFrameBytes, frameCount);
  const writer = await createSpoolWriter({
    geometry: input.geometry,
    frameRate: input.frameRate,
    frameCount,
    ...(input.temporaryRoot === undefined
      ? {}
      : { temporaryRoot: input.temporaryRoot }),
    ...(input.signal === undefined ? {} : { signal: input.signal })
  });
  let frameOffset = 0;
  let emittedFrames = 0;
  const frame = allocateBytes(visibleFrameBytes, "scaled RGBA frame");
  const sink = new Writable({
    highWaterMark: Math.min(visibleFrameBytes * 2, 32 * 1024 * 1024),
    write(chunk: Buffer, _encoding, callback): void {
      void consume(new Uint8Array(
        chunk.buffer,
        chunk.byteOffset,
        chunk.byteLength
      )).then(() => callback(), (error: unknown) =>
        callback(error instanceof Error ? error : new Error("YUV scale sink failed"))
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
      await writer.append(frame);
      emittedFrames += 1;
      frameOffset = 0;
    }
  };
  const scaleInvocation = createExtractRgbaRangeInvocation({
    source: input.source,
    startFrame: input.startFrame,
    endFrame: input.endFrame,
    width: visible[2],
    height: visible[3]
  });
  try {
    await runBoundedProcess({
      executable: input.executable,
      arguments: scaleInvocation.arguments,
      cwd: scaleInvocation.cwd,
      limits: {
        timeoutMs: mediaTimeout(input.timeoutMs),
        maxStdoutBytes: expectedBytes,
        maxStderrBytes: MAX_PROCESS_STDERR_BYTES
      },
      stdoutSink: sink,
      expectedStdoutBytes: expectedBytes,
      privateWorkingDirectory: true,
      ...(input.signal === undefined ? {} : { signal: input.signal })
    });
    if (emittedFrames !== frameCount || frameOffset !== 0) {
      throw new CompilerError(
        "FFMPEG_FAILED",
        "RGBA scaler did not emit the exact unit frame set"
      );
    }
    const spool = await writer.finish();
    return Object.freeze({ ...spool, scaleInvocation });
  } catch (error) {
    await writer.abort();
    throw error;
  }
}

/** Read one exact expected-alpha frame for immediate decode-back comparison. */
export async function readExpectedAlphaFrame(
  spool: Readonly<YuvUnitSpool>,
  frameIndex: number,
  signal?: AbortSignal
): Promise<Uint8Array> {
  const rgba = await readExpectedRgbaFrame(spool, frameIndex, signal);
  return extractAlpha(rgba, rgba.byteLength / 4);
}

/** Read one exact canonical RGBA frame for immediate quality comparison. */
export async function readExpectedRgbaFrame(
  spool: Readonly<YuvUnitSpool>,
  frameIndex: number,
  signal?: AbortSignal
): Promise<Uint8Array> {
  throwIfAborted(signal);
  if (
    !Number.isSafeInteger(frameIndex) ||
    frameIndex < 0 ||
    frameIndex >= spool.frameCount
  ) {
    throw new CompilerError(
      "FRAME_RANGE_INVALID",
      "Expected RGBA frame lies outside the unit spool"
    );
  }
  if (spool.expectedRgba === null) {
    throw new CompilerError("INPUT_INVALID", "Opaque YUV spool has no RGBA scratch");
  }
  const handle = await open(spool.expectedRgba.path, "r").catch((error: unknown) => {
    throw new CompilerError("IO_FAILED", "Could not open expected RGBA spool", {
      cause: error
    });
  });
  const bytes = allocateBytes(
    spool.expectedRgba.frameBytes,
    "expected RGBA frame"
  );
  try {
    await readAll(
      handle,
      bytes,
      checkedProduct(frameIndex, spool.expectedRgba.frameBytes),
      signal
    );
  } finally {
    await handle.close().catch(() => undefined);
  }
  return bytes;
}

interface SpoolWriter {
  readonly append: (rgba: Uint8Array) => Promise<void>;
  readonly finish: () => Promise<Readonly<YuvUnitSpool>>;
  readonly abort: () => Promise<void>;
}

async function createSpoolWriter(input: {
  readonly geometry: Readonly<AvcRenditionGeometry>;
  readonly frameRate: RationalV01;
  readonly frameCount: number;
  readonly temporaryRoot?: string;
  readonly signal?: AbortSignal;
}): Promise<SpoolWriter> {
  throwIfAborted(input.signal);
  validateFrameCount(input.frameCount);
  const frameBytes = checkedProduct(
    input.geometry.codedWidth,
    input.geometry.codedHeight,
    3
  ) / 2;
  if (!Number.isSafeInteger(frameBytes)) {
    throw new CompilerError("INPUT_INVALID", "YUV frame geometry is not 4:2:0 aligned");
  }
  const expectedRgbaFrameBytes = checkedProduct(
    input.geometry.visibleColorArea,
    4
  );
  const hasQualityScratch =
    input.geometry.profile === "avc-annexb-packed-alpha-v0" ||
    input.geometry.profile === "avc-annexb-packed-alpha-v1";
  const yuvBytes = checkedProduct(frameBytes, input.frameCount);
  const expectedRgbaBytes = hasQualityScratch
    ? checkedProduct(expectedRgbaFrameBytes, input.frameCount)
    : 0;
  const totalBytes = checkedSum(yuvBytes, expectedRgbaBytes);
  const root = input.temporaryRoot ?? tmpdir();
  await requireDisk(root, totalBytes);
  const directory = await createScratchDirectory(root, "aval-yuv-");
  const yuvPath = join(directory, "unit.yuv");
  const expectedRgbaPath = hasQualityScratch
    ? join(directory, "expected.rgba")
    : undefined;
  let yuv: Awaited<ReturnType<typeof open>> | undefined;
  let expectedRgba: Awaited<ReturnType<typeof open>> | undefined;
  let appended = 0;
  let closed = false;
  try {
    yuv = await open(yuvPath, "wx", 0o600);
    if (expectedRgbaPath !== undefined) {
      expectedRgba = await open(expectedRgbaPath, "wx", 0o600);
    }
  } catch (error) {
    await yuv?.close().catch(() => undefined);
    await expectedRgba?.close().catch(() => undefined);
    await discardScratchDirectory(directory);
    throw new CompilerError("IO_FAILED", "Could not create private YUV spool", {
      cause: error
    });
  }

  const abort = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await yuv?.close().catch(() => undefined);
    await expectedRgba?.close().catch(() => undefined);
    await discardScratchDirectory(directory);
  };
  const append = async (rgba: Uint8Array): Promise<void> => {
    throwIfAborted(input.signal);
    if (closed || yuv === undefined || appended >= input.frameCount) {
      throw new CompilerError("INPUT_INVALID", "YUV spool writer is closed or full");
    }
    const packed = packRgbaToPlanarYuv420({ geometry: input.geometry, rgba });
    if (packed.data.byteLength !== frameBytes) {
      throw new CompilerError("IO_FAILED", "Packed YUV frame size changed");
    }
    await writeAll(yuv, packed.data, input.signal);
    if (expectedRgba !== undefined) {
      await writeAll(expectedRgba, rgba, input.signal);
    }
    appended += 1;
  };
  const finish = async (): Promise<Readonly<YuvUnitSpool>> => {
    throwIfAborted(input.signal);
    if (closed || yuv === undefined || appended !== input.frameCount) {
      throw new CompilerError("IO_FAILED", "YUV spool did not receive every frame");
    }
    await yuv.sync();
    await expectedRgba?.sync();
    await yuv.close();
    await expectedRgba?.close();
    yuv = undefined;
    expectedRgba = undefined;
    closed = true;
    return Object.freeze({
      input: Object.freeze({
        type: "raw-yuv420p" as const,
        path: yuvPath,
        width: input.geometry.codedWidth,
        height: input.geometry.codedHeight,
        frameRate: Object.freeze({ ...input.frameRate }),
        frameBytes
      }),
      frameCount: input.frameCount,
      expectedRgba: expectedRgbaPath === undefined
        ? null
        : Object.freeze({
            path: expectedRgbaPath,
            frameBytes: expectedRgbaFrameBytes
          }),
      cleanup: () => removeScratchDirectory(directory, "Could not remove private YUV spool")
    });
  };
  return Object.freeze({ append, finish, abort });
}

function validateFrameCount(frameCount: number): void {
  if (!Number.isSafeInteger(frameCount) || frameCount < 1) {
    throw new CompilerError(
      "FRAME_RANGE_INVALID",
      "YUV unit spool requires a positive safe frame count"
    );
  }
}

function extractAlpha(rgba: Uint8Array, pixelCount: number): Uint8Array {
  if (rgba.byteLength !== pixelCount * 4) {
    throw new CompilerError("INPUT_INVALID", "Visible RGBA frame size is invalid");
  }
  const alpha = allocateBytes(pixelCount, "expected alpha frame");
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    alpha[pixel] = rgba[pixel * 4 + 3]!;
  }
  return alpha;
}

async function writeAll(
  handle: Awaited<ReturnType<typeof open>>,
  bytes: Uint8Array,
  signal?: AbortSignal
): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    throwIfAborted(signal);
    const result = await handle.write(bytes, offset, bytes.length - offset, null);
    if (result.bytesWritten < 1) {
      throw new CompilerError("IO_FAILED", "YUV spool write made no progress");
    }
    offset += result.bytesWritten;
  }
}

async function readAll(
  handle: Awaited<ReturnType<typeof open>>,
  bytes: Uint8Array,
  position: number,
  signal?: AbortSignal
): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    throwIfAborted(signal);
    const result = await handle.read(
      bytes,
      offset,
      bytes.length - offset,
      position + offset
    );
    if (result.bytesRead < 1) {
      throw new CompilerError("IO_FAILED", "Expected-alpha spool ended early");
    }
    offset += result.bytesRead;
  }
}

async function requireDisk(root: string, bytes: number): Promise<void> {
  let filesystem: Awaited<ReturnType<typeof statfs>>;
  try {
    filesystem = await statfs(root);
  } catch (error) {
    throw new CompilerError("IO_FAILED", "Could not inspect YUV scratch storage", {
      cause: error
    });
  }
  const available = BigInt(filesystem.bavail) * BigInt(filesystem.bsize);
  if (available < BigInt(bytes) + BigInt(DISK_HEADROOM_BYTES)) {
    throw new CompilerError(
      "SOURCE_LIMIT",
      "Insufficient temporary disk space for YUV unit scratch"
    );
  }
}

async function createScratchDirectory(root: string, prefix: string): Promise<string> {
  try {
    return await mkdtemp(join(root, prefix));
  } catch (error) {
    throw new CompilerError("IO_FAILED", "Could not create private YUV spool", {
      cause: error
    });
  }
}

async function removeScratchDirectory(directory: string, message: string): Promise<void> {
  try {
    await rm(directory, { recursive: true, force: true });
  } catch (error) {
    throw new CompilerError("IO_FAILED", message, { cause: error });
  }
}

async function discardScratchDirectory(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true }).catch(() => undefined);
}

function checkedProduct(...values: number[]): number {
  let result = 1;
  for (const value of values) {
    if (
      !Number.isSafeInteger(value) ||
      value < 0 ||
      (value !== 0 && result > Math.floor(Number.MAX_SAFE_INTEGER / value))
    ) {
      throw new CompilerError("SOURCE_LIMIT", "YUV scratch product exceeds safe range");
    }
    result *= value;
  }
  return result;
}

function checkedSum(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new CompilerError("SOURCE_LIMIT", "YUV scratch sum exceeds safe range");
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
