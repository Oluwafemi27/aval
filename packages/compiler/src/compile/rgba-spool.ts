import { mkdtemp, open, rm, statfs } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";

import { CompilerError } from "../diagnostics.js";
import { throwIfAborted } from "../cancellation.js";
import {
  createMaterializeRgbaInvocation,
  mediaTimeout,
  type FfmpegFrameInput,
  type FfmpegInvocation
} from "../ffmpeg/encode-unit.js";
import {
  MAX_PROCESS_STDERR_BYTES,
  type AlphaAuditSummary,
  type MediaProbe,
  type Rational
} from "../model.js";
import { runBoundedProcess } from "../process-runner.js";
import { createCanonicalAlphaAuditor } from "./alpha-policy.js";
import {
  decodeRgba64Le,
  downconvertRgba16ToRgba8
} from "./canonical-rgba16.js";

const DISK_HEADROOM_BYTES = 64 * 1024 * 1024;

export interface MaterializedRgbaSource {
  readonly input: Extract<FfmpegFrameInput, { readonly type: "raw-rgba64" }>;
  readonly frameCount: number;
  /** Exact FFmpeg invocation that produced this canonical spool. */
  readonly invocation: MaterializeRgbaInvocation;
  readonly alphaAudit: Readonly<AlphaAuditSummary>;
  readonly cleanup: () => Promise<void>;
}

export type MaterializeRgbaInvocation = FfmpegInvocation;

/** Materialize one monotonic hold-selection map into a private raw RGBA spool. */
export async function materializeNormalizedRgbaSource(input: {
  readonly source: FfmpegFrameInput;
  readonly probe: MediaProbe;
  readonly frameRate: Rational;
  readonly outputWidth: number;
  readonly outputHeight: number;
  readonly sourceFrameByOutputFrame: readonly number[];
  readonly alphaReferences?: readonly {
    readonly source: string;
    readonly frame: number;
  }[];
  readonly executable: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}): Promise<Readonly<MaterializedRgbaSource>> {
  if (input.sourceFrameByOutputFrame.length < 1) {
    throw new CompilerError(
      "INPUT_INVALID",
      "Normalized RGBA spool requires at least one frame"
    );
  }
  const frameBytes = checkedProduct(
    "normalized RGBA frame bytes",
    input.outputWidth,
    input.outputHeight,
    8
  );
  const outputBytes = checkedProduct(
    "normalized RGBA spool bytes",
    frameBytes,
    input.sourceFrameByOutputFrame.length
  );
  for (let index = 1; index < input.sourceFrameByOutputFrame.length; index += 1) {
    if (
      input.sourceFrameByOutputFrame[index]! <
      input.sourceFrameByOutputFrame[index - 1]!
    ) {
      throw new CompilerError("INPUT_INVALID", "Normalization map must be monotonic");
    }
  }
  const temporaryRoot = tmpdir();
  const available = await availableScratchBytes(temporaryRoot);
  if (available < BigInt(outputBytes) + BigInt(DISK_HEADROOM_BYTES)) {
    throw new CompilerError(
      "SOURCE_LIMIT",
      "Insufficient temporary disk space for normalized RGBA spool"
    );
  }
  const directory = await createScratchDirectory(temporaryRoot);
  const path = join(directory, "normalized.rgba");
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let invocation: Readonly<MaterializeRgbaInvocation> | undefined;
  let alphaAudit: Readonly<AlphaAuditSummary> | undefined;
  try {
    handle = await open(path, "wx", 0o600);
    const streamed = await streamSelectedCanonicalFrames(input, handle, frameBytes);
    invocation = streamed.invocation;
    alphaAudit = streamed.alphaAudit;
    await handle.sync();
    await handle.close();
    handle = undefined;
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await discardScratchDirectory(directory);
    throw error;
  }
  if (invocation === undefined || alphaAudit === undefined) {
    await discardScratchDirectory(directory);
    throw new CompilerError(
      "IO_FAILED",
      "Canonical RGBA spool completed without invocation provenance"
    );
  }
  return Object.freeze({
    input: Object.freeze({
      type: "raw-rgba64" as const,
      path,
      width: input.outputWidth,
      height: input.outputHeight,
      frameRate: Object.freeze({ ...input.frameRate })
    }),
    frameCount: input.sourceFrameByOutputFrame.length,
    invocation,
    alphaAudit,
    cleanup: () => removeScratchDirectory(directory)
  });
}

async function availableScratchBytes(root: string): Promise<bigint> {
  try {
    const filesystem = await statfs(root);
    return BigInt(filesystem.bavail) * BigInt(filesystem.bsize);
  } catch (error) {
    throw new CompilerError("IO_FAILED", "Could not inspect RGBA scratch storage", {
      cause: error
    });
  }
}

async function createScratchDirectory(root: string): Promise<string> {
  try {
    return await mkdtemp(join(root, "aval-rgba-"));
  } catch (error) {
    throw new CompilerError("IO_FAILED", "Could not create private RGBA spool", {
      cause: error
    });
  }
}

async function removeScratchDirectory(directory: string): Promise<void> {
  try {
    await rm(directory, { recursive: true, force: true });
  } catch (error) {
    throw new CompilerError("IO_FAILED", "Could not remove private RGBA spool", {
      cause: error
    });
  }
}

async function discardScratchDirectory(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true }).catch(() => undefined);
}

async function streamSelectedCanonicalFrames(
  input: Parameters<typeof materializeNormalizedRgbaSource>[0],
  handle: Awaited<ReturnType<typeof open>>,
  frameBytes: number
): Promise<Readonly<{
  readonly invocation: MaterializeRgbaInvocation;
  readonly alphaAudit: Readonly<AlphaAuditSummary>;
}>> {
  const uniqueSourceFrames = [...new Set(input.sourceFrameByOutputFrame)];
  if (
    uniqueSourceFrames.some((frame, index) =>
      !Number.isSafeInteger(frame) ||
      frame < 0 ||
      frame >= input.probe.frameCount ||
      (index > 0 && frame <= uniqueSourceFrames[index - 1]!)
    )
  ) {
    throw new CompilerError(
      "VFR_UNSUPPORTED",
      "Normalization map references an unavailable source frame"
    );
  }
  const expectedDecodedBytes = checkedProduct(
    "selected RGBA decode bytes",
    uniqueSourceFrames.length,
    frameBytes
  );
  const alphaReferences = input.alphaReferences ?? Object.freeze(
    input.sourceFrameByOutputFrame.map((_frame, index) => Object.freeze({
      source: "canonical",
      frame: index
    }))
  );
  if (alphaReferences.length !== input.sourceFrameByOutputFrame.length) {
    throw new CompilerError(
      "INPUT_INVALID",
      "Canonical alpha references must match materialized output frames"
    );
  }
  const alphaAuditor = createCanonicalAlphaAuditor(input.signal);
  const frame = allocateBytes(frameBytes, "canonical RGBA frame");
  let frameOffset = 0;
  let decodedIndex = 0;
  let outputIndex = 0;
  const sink = new Writable({
    highWaterMark: Math.min(frameBytes * 2, 32 * 1024 * 1024),
    write(chunk: Buffer, _encoding, callback): void {
      void consumeChunk(new Uint8Array(
        chunk.buffer,
        chunk.byteOffset,
        chunk.byteLength
      )).then(() => callback(), (error: unknown) =>
        callback(error instanceof Error ? error : new Error("RGBA sink failed"))
      );
    }
  });

  const consumeChunk = async (chunk: Uint8Array): Promise<void> => {
    let offset = 0;
    while (offset < chunk.byteLength) {
      const count = Math.min(frameBytes - frameOffset, chunk.byteLength - offset);
      frame.set(chunk.subarray(offset, offset + count), frameOffset);
      frameOffset += count;
      offset += count;
      if (frameOffset !== frameBytes) continue;
      const sourceFrame = uniqueSourceFrames[decodedIndex];
      if (sourceFrame === undefined) {
        throw new CompilerError("FFMPEG_FAILED", "FFmpeg emitted extra RGBA frames");
      }
      while (input.sourceFrameByOutputFrame[outputIndex] === sourceFrame) {
        const reference = alphaReferences[outputIndex];
        if (reference === undefined) {
          throw new CompilerError(
            "IO_FAILED",
            "Canonical alpha reference is unavailable"
          );
        }
        alphaAuditor.include({
          ...reference,
          width: input.outputWidth,
          height: input.outputHeight,
          rgba: downconvertRgba16ToRgba8(decodeRgba64Le(frame))
        });
        await writeAll(handle, frame, input.signal);
        outputIndex += 1;
      }
      decodedIndex += 1;
      frameOffset = 0;
    }
  };

  const invocation = createMaterializeRgbaInvocation({
    source: input.source,
    sourceFrames: uniqueSourceFrames,
    outputWidth: input.outputWidth,
    outputHeight: input.outputHeight
  });

  await runBoundedProcess({
    executable: input.executable,
    arguments: invocation.arguments,
    cwd: invocation.cwd,
    limits: {
      ...(input.timeoutMs === undefined
        ? {}
        : { timeoutMs: mediaTimeout(input.timeoutMs) }),
      maxStdoutBytes: expectedDecodedBytes,
      maxStderrBytes: MAX_PROCESS_STDERR_BYTES
    },
    stdoutSink: sink,
    privateWorkingDirectory: true,
    ...(input.signal === undefined ? {} : { signal: input.signal })
  });
  if (
    decodedIndex !== uniqueSourceFrames.length ||
    outputIndex !== input.sourceFrameByOutputFrame.length ||
    frameOffset !== 0
  ) {
    throw new CompilerError(
      "FFMPEG_FAILED",
      "Canonical RGBA decode did not produce the exact selected frame set"
    );
  }
  return Object.freeze({
    invocation,
    alphaAudit: alphaAuditor.finish()
  });
}

/** Read exact caller-owned copies from a compiler-private canonical spool. */
export async function readCanonicalRgbaRange(input: {
  readonly source: Extract<FfmpegFrameInput, { readonly type: "raw-rgba64" }>;
  readonly frameCount: number;
  readonly startFrame: number;
  readonly endFrame: number;
  readonly signal?: AbortSignal;
}): Promise<readonly Uint8Array[]> {
  const frames = await readCanonicalRgba16Range(input);
  return Object.freeze(frames.map(downconvertRgba16ToRgba8));
}

/** Read exact caller-owned canonical RGBA16 frames from the private spool. */
export async function readCanonicalRgba16Range(input: {
  readonly source: Extract<FfmpegFrameInput, { readonly type: "raw-rgba64" }>;
  readonly frameCount: number;
  readonly startFrame: number;
  readonly endFrame: number;
  readonly signal?: AbortSignal;
}): Promise<readonly Uint16Array[]> {
  throwIfAborted(input.signal);
  if (
    !Number.isSafeInteger(input.startFrame) ||
    !Number.isSafeInteger(input.endFrame) ||
    input.startFrame < 0 ||
    input.endFrame <= input.startFrame ||
    input.endFrame > input.frameCount
  ) {
    throw new CompilerError(
      "FRAME_RANGE_INVALID",
      "Canonical RGBA read lies outside the private spool"
    );
  }
  const frameBytes = checkedProduct(
    "canonical RGBA frame bytes",
    input.source.width,
    input.source.height,
    8
  );
  const count = input.endFrame - input.startFrame;
  const length = checkedProduct("canonical RGBA read bytes", frameBytes, count);
  const handle = await open(input.source.path, "r").catch(() => {
    throw new CompilerError("IO_FAILED", "Could not open canonical RGBA spool");
  });
  const bytes = allocateBytes(length, "canonical RGBA read");
  try {
    throwIfAborted(input.signal);
    let offset = 0;
    const fileOffset = checkedProduct(
      "canonical RGBA read offset",
      input.startFrame,
      frameBytes
    );
    while (offset < length) {
      throwIfAborted(input.signal);
      const result = await handle.read(
        bytes,
        offset,
        length - offset,
        fileOffset + offset
      );
      throwIfAborted(input.signal);
      if (result.bytesRead < 1) {
        throw new CompilerError(
          "IO_FAILED",
          "Canonical RGBA spool ended before the requested frame range"
        );
      }
      offset += result.bytesRead;
    }
  } finally {
    await handle.close().catch(() => undefined);
  }
  try {
    return Object.freeze(Array.from({ length: count }, (_, index) =>
      decodeRgba64Le(bytes.subarray(
        index * frameBytes,
        (index + 1) * frameBytes
      ))
    ));
  } catch (error) {
    throw new CompilerError(
      "SOURCE_LIMIT",
      `Could not materialize ${String(count)} canonical RGBA frame copies`,
      { cause: error }
    );
  }
}

async function writeAll(
  handle: Awaited<ReturnType<typeof open>>,
  bytes: Uint8Array,
  signal?: AbortSignal
): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    throwIfAborted(signal);
    const result = await handle.write(
      bytes,
      offset,
      bytes.byteLength - offset,
      null
    );
    throwIfAborted(signal);
    if (result.bytesWritten < 1) {
      throw new CompilerError("IO_FAILED", "RGBA spool write made no progress");
    }
    offset += result.bytesWritten;
  }
}

function checkedProduct(label: string, ...values: number[]): number {
  let result = 1;
  for (const value of values) {
    if (
      !Number.isSafeInteger(value) ||
      value < 0 ||
      (value !== 0 && result > Math.floor(Number.MAX_SAFE_INTEGER / value))
    ) {
      throw new CompilerError("SOURCE_LIMIT", `${label} exceeds safe arithmetic`);
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
