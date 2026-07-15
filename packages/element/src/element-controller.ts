import type { ElementAssetGeneration } from "./asset-generation.js";
import { nextElementSequence } from "./element-sequence.js";

/** Latest-only serialized ownership for non-overlapping asset generations. */
export class ElementController {
  readonly #create: (generation: number) => ElementAssetGeneration | null;
  readonly #onRetired: () => void;
  readonly #maximumRequestSequence: number;
  readonly #maximumGeneration: number;
  #active: ElementAssetGeneration | null = null;
  #retiring: ElementAssetGeneration | null = null;
  #requested = 0;
  #published = 0;
  #lane: Promise<void> = Promise.resolve();
  #disposed = false;

  public constructor(options: Readonly<{
    create(generation: number): ElementAssetGeneration | null;
    onRetired?(): void;
    maximumSequence?: number;
    maximumRequestSequence?: number;
    maximumGeneration?: number;
  }>) {
    this.#create = options.create;
    this.#onRetired = options.onRetired ?? (() => undefined);
    this.#maximumRequestSequence = options.maximumRequestSequence ??
      options.maximumSequence ?? Number.MAX_SAFE_INTEGER;
    this.#maximumGeneration = options.maximumGeneration ??
      options.maximumSequence ?? Number.MAX_SAFE_INTEGER;
    nextElementSequence(0, "source request", this.#maximumRequestSequence);
    nextElementSequence(0, "source generation", this.#maximumGeneration);
  }

  public get active(): ElementAssetGeneration | null {
    return this.#active;
  }

  public replace(): Promise<void> {
    if (this.#disposed) return this.#lane;
    const request = this.#requested = nextElementSequence(
      this.#requested,
      "source request",
      this.#maximumRequestSequence
    );
    const retirement = this.#beginActiveRetirement();
    const operation = this.#lane.then(async () => {
      if (this.#disposed) return;
      if (retirement === null) await this.#ackLateRetirement();
      else await this.#retireOwned(retirement.owner, retirement.operation);
      if (this.#disposed || request !== this.#requested) return;
      this.#published = nextElementSequence(
        this.#published,
        "source generation",
        this.#maximumGeneration
      );
      this.#active = this.#create(this.#published);
    });
    this.#lane = operation.catch(() => undefined);
    return operation;
  }

  public retire(): Promise<void> {
    this.#requested = nextElementSequence(
      this.#requested,
      "source request",
      this.#maximumRequestSequence
    );
    const retirement = this.#beginActiveRetirement();
    const operation = this.#lane.then(async () => {
      if (retirement === null) await this.#ackLateRetirement();
      else await this.#retireOwned(retirement.owner, retirement.operation);
    });
    this.#lane = operation.catch(() => undefined);
    return operation;
  }

  public dispose(): Promise<void> {
    this.#disposed = true;
    return this.retire();
  }

  #beginActiveRetirement(): Readonly<{
    owner: ElementAssetGeneration;
    operation: Promise<void>;
  }> | null {
    const owner = this.#active;
    if (owner === null) return null;
    this.#active = null;
    this.#retiring = owner;
    return Object.freeze({ owner, operation: owner.dispose() });
  }

  async #retireOwned(
    owner: ElementAssetGeneration,
    operation: Promise<void>
  ): Promise<void> {
    await operation;
    if (owner.cleanupReceipt()?.completed !== true) {
      throw new Error("aval-player generation did not prove cleanup");
    }
    this.#retiring = null;
    this.#onRetired();
  }

  async #ackLateRetirement(): Promise<void> {
    const owner = this.#retiring;
    if (owner === null) return;
    await owner.dispose();
    if (owner.cleanupReceipt()?.completed !== true) {
      throw new Error("previous aval generation cleanup is incomplete");
    }
    this.#retiring = null;
    this.#onRetired();
  }
}
