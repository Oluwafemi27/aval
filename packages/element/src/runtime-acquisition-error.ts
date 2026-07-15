/**
 * Internal hand-off used when runtime construction failed after acquiring host
 * resources and its first cleanup attempt could not prove completion.
 */
export class RuntimeAcquisitionCleanupError extends Error {
  readonly #retry: () => Promise<void>;

  public constructor(cause: unknown, retry: () => Promise<void>) {
    super("aval-player runtime acquisition cleanup is incomplete", { cause });
    this.name = "RuntimeAcquisitionCleanupError";
    this.#retry = retry;
  }

  public async retryCleanup(): Promise<void> {
    try {
      await this.#retry();
    } catch (error) {
      throw new RuntimeAcquisitionCleanupError(error, this.#retry);
    }
  }
}
