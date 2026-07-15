import { avalAbortError } from "./errors.js";

export const MAX_PUBLIC_PREPARE_TIMEOUT_MS = 30_000;

export function waitForPublicOperation<T>(
  operation: Promise<T>,
  options: Readonly<{ signal?: AbortSignal; timeoutMs?: number }> = {}
): Promise<T> {
  if (options.signal?.aborted === true) {
    return Promise.reject(options.signal.reason ?? avalAbortError());
  }
  if (
    options.timeoutMs !== undefined &&
    (
      !Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0 ||
      options.timeoutMs > MAX_PUBLIC_PREPARE_TIMEOUT_MS
    )
  ) {
    return Promise.reject(new RangeError(
      `timeoutMs must be finite, positive, and at most ${String(MAX_PUBLIC_PREPARE_TIMEOUT_MS)}`
    ));
  }
  if (options.signal === undefined && options.timeoutMs === undefined) return operation;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = (): void => {
      options.signal?.removeEventListener("abort", abort);
      if (timer !== undefined) clearTimeout(timer);
    };
    const settle = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const abort = (): void => settle(() => reject(
      options.signal?.reason ?? avalAbortError()
    ));
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.timeoutMs !== undefined) {
      timer = setTimeout(() => settle(() => {
        const error = new Error("aval-player prepare wait timed out");
        error.name = "TimeoutError";
        reject(error);
      }), options.timeoutMs);
    }
    operation.then(
      (value) => settle(() => resolve(value)),
      (error: unknown) => settle(() => reject(error))
    );
  });
}
