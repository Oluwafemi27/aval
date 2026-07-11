import { FormatError } from "./errors.js";

export interface ByteFixedPointStep<TValue, TResult> {
  readonly value: TValue;
  readonly bytes: Uint8Array;
  readonly result: TResult;
}

export interface ByteFixedPointResult<TValue, TResult>
  extends ByteFixedPointStep<TValue, TResult> {
  readonly iterations: number;
}

/** Internal deterministic fixed-point runner with an injectable test seam. */
export function resolveByteStableFixedPoint<TValue, TResult>(
  initialValue: TValue,
  initialBytes: Uint8Array,
  maximumIterations: number,
  advance: (
    value: TValue,
    bytes: Uint8Array
  ) => ByteFixedPointStep<TValue, TResult>
): Readonly<ByteFixedPointResult<TValue, TResult>> {
  if (!Number.isSafeInteger(maximumIterations) || maximumIterations < 1) {
    throw new FormatError(
      "WRITER_INVALID",
      "fixed-point iteration limit must be a positive safe integer"
    );
  }
  let value = initialValue;
  let bytes = initialBytes;
  for (let iteration = 1; iteration <= maximumIterations; iteration += 1) {
    const next = advance(value, bytes);
    if (equalBytes(bytes, next.bytes)) {
      return Object.freeze({ ...next, iterations: iteration });
    }
    value = next.value;
    bytes = next.bytes;
  }
  throw new FormatError(
    "WRITER_NONCONVERGENT",
    `canonical layout did not converge in ${String(maximumIterations)} iterations`
  );
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
