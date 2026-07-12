import { FormatError } from "@rendered-motion/format";

export interface BrowserPngNativeInflater {
  readonly supported: boolean;
  inflate(
    zlib: Uint8Array,
    expectedOutputLength: number,
    signal: AbortSignal
  ): Promise<Uint8Array>;
}

export type BrowserDecompressionStreamFactory = () => DecompressionStream;

/** Probe once; decode failures after a positive probe are never fallback cues. */
export function createBrowserPngNativeInflater(
  factory: BrowserDecompressionStreamFactory = defaultFactory
): Readonly<BrowserPngNativeInflater> {
  try {
    factory();
  } catch {
    return UNSUPPORTED_NATIVE_INFLATER;
  }
  return Object.freeze({
    supported: true,
    inflate: (
      zlib: Uint8Array,
      expectedOutputLength: number,
      signal: AbortSignal
    ) =>
      inflateWithBrowserStream(factory, zlib, expectedOutputLength, signal)
  });
}

export const UNSUPPORTED_NATIVE_INFLATER: Readonly<BrowserPngNativeInflater> =
  Object.freeze({
    supported: false,
    async inflate(): Promise<Uint8Array> {
      throw new FormatError(
        "PNG_DEFLATE_INVALID",
        "native PNG inflate is unavailable"
      );
    }
  });

async function inflateWithBrowserStream(
  factory: BrowserDecompressionStreamFactory,
  zlib: Uint8Array,
  expectedOutputLength: number,
  signal: AbortSignal
): Promise<Uint8Array> {
  validateInput(zlib, expectedOutputLength, signal);
  let stream: DecompressionStream;
  try {
    stream = factory();
  } catch {
    throw invalidDeflate();
  }
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const abort = (): void => {
    void writer.abort(abortReason(signal)).catch(() => undefined);
    void reader.cancel(abortReason(signal)).catch(() => undefined);
  };
  signal.addEventListener("abort", abort, { once: true });
  const writing = (async (): Promise<void> => {
    if (!(zlib.buffer instanceof ArrayBuffer)) throw invalidDeflate();
    const ownedView = new Uint8Array(
      zlib.buffer,
      zlib.byteOffset,
      zlib.byteLength
    );
    await writer.write(ownedView);
    await writer.close();
  })();
  const output = new Uint8Array(expectedOutputLength);
  let length = 0;
  try {
    for (;;) {
      throwIfAborted(signal);
      const result = await reader.read();
      throwIfAborted(signal);
      if (result.done) break;
      const chunk = result.value;
      if (!(chunk instanceof Uint8Array)) throw invalidDeflate();
      if (chunk.byteLength > expectedOutputLength - length) {
        throw invalidDeflate();
      }
      output.set(chunk, length);
      length += chunk.byteLength;
    }
    await writing;
    throwIfAborted(signal);
    if (length !== expectedOutputLength) throw invalidDeflate();
    return output;
  } catch (error) {
    const reason = signal.aborted ? abortReason(signal) : invalidDeflate();
    await settleFailedStream(writer, reader, writing, reason);
    if (signal.aborted) throw abortReason(signal);
    if (error instanceof FormatError) throw error;
    throw invalidDeflate();
  } finally {
    signal.removeEventListener("abort", abort);
    try {
      reader.releaseLock();
    } catch {
      // Stream cleanup cannot replace the selected inflate outcome.
    }
    try {
      writer.releaseLock();
    } catch {
      // Stream cleanup cannot replace the selected inflate outcome.
    }
  }
}

async function settleFailedStream(
  writer: WritableStreamDefaultWriter<BufferSource>,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  writing: Promise<void>,
  reason: unknown
): Promise<void> {
  const settlements: Promise<unknown>[] = [writing];
  try {
    settlements.push(writer.abort(reason));
  } catch {
    // Continue through reader cancellation and the original write settlement.
  }
  try {
    settlements.push(reader.cancel(reason));
  } catch {
    // Continue through writer cancellation and the original write settlement.
  }
  await Promise.allSettled(settlements);
}

function defaultFactory(): DecompressionStream {
  if (typeof DecompressionStream !== "function") {
    throw new TypeError("DecompressionStream is unavailable");
  }
  return new DecompressionStream("deflate");
}

function validateInput(
  zlib: Uint8Array,
  expectedOutputLength: number,
  signal: AbortSignal
): void {
  if (!(zlib instanceof Uint8Array)) {
    throw new TypeError("native PNG inflate input must be a Uint8Array");
  }
  if (!Number.isSafeInteger(expectedOutputLength) || expectedOutputLength < 1) {
    throw new RangeError("native PNG inflate output bound must be positive");
  }
  throwIfAborted(signal);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortReason(signal);
}

function abortReason(signal: AbortSignal): DOMException {
  return signal.reason instanceof DOMException &&
    signal.reason.name === "AbortError"
    ? signal.reason
    : new DOMException("native PNG inflate aborted", "AbortError");
}

function invalidDeflate(): FormatError {
  return new FormatError(
    "PNG_DEFLATE_INVALID",
    "native PNG inflate rejected the validated zlib member"
  );
}
