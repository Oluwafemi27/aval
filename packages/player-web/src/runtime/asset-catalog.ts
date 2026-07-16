import type { ValidatedMotionGraph } from "@pixel-point/aval-graph";
import {
  FORMAT_DEFAULT_BUDGETS,
  FormatError,
  validateCompleteAsset,
  type ByteRange,
  type CompiledManifest,
  type Edge,
  type ParsedFrontIndex,
  type ProductionRendition,
  type State,
  type ValidatedAssetLayout,
  type Unit
} from "@pixel-point/aval-format";

import {
  buildCatalogMaps,
  checkedCatalogRangeEnd,
  createCatalogChunkIndex,
  createCatalogIdIndex,
  createCatalogPortIndex,
  runtimeUnitBlobKey,
  type CatalogMaps,
  type RuntimeCatalogIdIndex,
  type RuntimeCatalogPortIndex,
  type RuntimeCatalogChunkIndex
} from "./asset-catalog-index.js";
import {
  RuntimePlaybackError,
  normalizeRuntimeFailure,
  type RuntimeFailureContext
} from "./errors.js";
import type {
  RuntimeAssetResidencySnapshot,
  RuntimeBlobResidencySnapshot,
  RuntimeBlobResidencyState,
  RuntimeTransportMode
} from "./model.js";
import {
  VerifiedBlobStore,
  type VerifiedBlobDescriptor,
  type VerifiedBlobStoreSnapshot
} from "./verified-blob-store.js";
import {
  certifyVideoRenditions,
  type CertifiedVideoRendition
} from "./video-rendition-certification.js";

export type { CertifiedVideoRendition } from "./video-rendition-certification.js";

export type {
  RuntimeCatalogChunk,
  RuntimeCatalogIdIndex,
  RuntimeCatalogPortEntry,
  RuntimeCatalogPortIndex,
  RuntimeCatalogChunkIndex
} from "./asset-catalog-index.js";
export { runtimeUnitBlobKey } from "./asset-catalog-index.js";

export interface MetadataRuntimeAssetCatalogInput {
  readonly frontIndex: Readonly<ParsedFrontIndex>;
  readonly declaredFileLength: number;
  readonly mode: RuntimeTransportMode;
  readonly blobStore: VerifiedBlobStore;
}

interface CatalogPayloadSnapshot {
  readonly generation: number;
  readonly verifiedBytes: number;
  readonly persistentBytes: number;
  readonly unitBlobs: Readonly<RuntimeBlobResidencySnapshot>;
}

interface CatalogPayloadAuthority {
  state(key: string): RuntimeBlobResidencyState;
  copyRange(
    key: string,
    relativeOffset: number,
    byteLength: number
  ): Uint8Array<ArrayBuffer>;
  snapshot(): Readonly<CatalogPayloadSnapshot>;
  dispose(): void;
}

const CATALOG_INSTALLATION = Symbol("runtime asset catalog installation");
const RUNTIME_CATALOG_COMPLETE_SOURCE: unique symbol = Symbol(
  "runtime catalog complete source"
);

interface CatalogInstallation {
  readonly [CATALOG_INSTALLATION]: true;
  readonly frontIndex: Readonly<ParsedFrontIndex>;
  readonly declaredFileLength: number;
  readonly mode: RuntimeTransportMode;
  readonly metadataBytes: number;
  readonly baseOwnedBytes: number;
  readonly payloadOwnership: "none" | "verified" | "persistent";
  readonly payloads: CatalogPayloadAuthority;
  readonly completeLayout: Readonly<ValidatedAssetLayout> | null;
}

/**
 * One immutable metadata catalog over either completely owned bytes or sparse
 * digest-verified blob residency. Both installation paths share every lookup
 * and downstream copy method.
 */
export class RuntimeAssetCatalog {
  public readonly videoRenditions: readonly Readonly<CertifiedVideoRendition>[];
  public readonly renditions: RuntimeCatalogIdIndex<ProductionRendition>;
  public readonly units: RuntimeCatalogIdIndex<Unit>;
  public readonly states: RuntimeCatalogIdIndex<State>;
  public readonly edges: RuntimeCatalogIdIndex<Edge>;
  public readonly ports: RuntimeCatalogPortIndex;
  public readonly chunks: RuntimeCatalogChunkIndex;
  readonly #declaredFileLength: number;
  #mode: RuntimeTransportMode;
  readonly #metadataBytes: number;
  #baseOwnedBytes: number;
  #payloadOwnership: "none" | "verified" | "persistent";
  readonly #payloads: CatalogPayloadAuthority;
  #disposed = false;
  #frontIndex: Readonly<ParsedFrontIndex> | null;
  #layout: Readonly<ValidatedAssetLayout> | null;
  #maps: CatalogMaps | null;
  public constructor(callerBytes: Uint8Array);
  /** @internal Branded sparse installation; use createMetadataRuntimeAssetCatalog. */
  public constructor(value: CatalogInstallation);
  public constructor(value: Uint8Array | CatalogInstallation) {
    const installed = isCatalogInstallation(value)
      ? value
      : installOwnedBytes(value);
    this.#frontIndex = installed.frontIndex;
    this.#layout = installed.completeLayout;
    this.#declaredFileLength = installed.declaredFileLength;
    this.#mode = installed.mode;
    this.#metadataBytes = installed.metadataBytes;
    this.#baseOwnedBytes = installed.baseOwnedBytes;
    this.#payloadOwnership = installed.payloadOwnership;
    this.#payloads = installed.payloads;
    this.#maps = buildCatalogMaps({
      frontIndex: installed.frontIndex,
      declaredFileLength: installed.declaredFileLength
    });
    this.videoRenditions = certifyVideoRenditions(installed.frontIndex.manifest);

    this.renditions = createCatalogIdIndex(
      "rendition",
      () => this.#requireMaps().renditions,
      (rendition) => ({ rendition })
    );
    this.units = createCatalogIdIndex(
      "unit",
      () => this.#requireMaps().units,
      (unit) => ({ unit })
    );
    this.states = createCatalogIdIndex(
      "state",
      () => this.#requireMaps().states,
      (state) => ({ state })
    );
    this.edges = createCatalogIdIndex(
      "edge",
      () => this.#requireMaps().edges,
      (edge) => ({ edge })
    );
    this.ports = createCatalogPortIndex(() => this.#requireMaps().ports);
    this.chunks = createCatalogChunkIndex(() => this.#requireMaps().chunks);
  }

  public get disposed(): boolean {
    return this.#disposed;
  }

  /** Exact identity proof for a byte-free rendition certified by this catalog. */
  public ownsVideoRendition(value: unknown): value is Readonly<CertifiedVideoRendition> {
    this.#throwIfDisposed();
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const authoredIndex = Reflect.get(value, "authoredIndex");
    return typeof authoredIndex === "number" &&
      Number.isSafeInteger(authoredIndex) && authoredIndex >= 0 &&
      this.videoRenditions[authoredIndex] === value;
  }

  /** Current retained source ownership plus verified payload copies. */
  public get ownedByteLength(): number {
    if (this.#disposed) return 0;
    if (this.#payloadOwnership === "none") return this.#baseOwnedBytes;
    const payloads = this.#payloads.snapshot();
    return checkedOwnedByteSum(
      this.#baseOwnedBytes,
      this.#payloadOwnership === "verified"
        ? payloads.verifiedBytes
        : payloads.persistentBytes
    );
  }

  /** @internal Switch sparse accounting after an entity-safe full replacement. */
  public [RUNTIME_CATALOG_COMPLETE_SOURCE](): void {
    this.#throwIfDisposed();
    this.#mode = "full";
    this.#baseOwnedBytes = this.#declaredFileLength;
    this.#payloadOwnership = "persistent";
  }

  public get layout(): Readonly<ValidatedAssetLayout> {
    this.#throwIfDisposed();
    if (this.#layout !== null) return this.#layout;
    const frontIndex = this.#requireFrontIndex();
    this.#layout = Object.freeze({
      frontIndex,
      fileRange: Object.freeze({
        offset: 0,
        length: this.#declaredFileLength
      })
    });
    return this.#layout;
  }

  public get manifest(): Readonly<CompiledManifest> {
    return this.#requireFrontIndex().manifest;
  }

  public get graph(): Readonly<ValidatedMotionGraph> {
    return this.#requireFrontIndex().graph;
  }

  /** A fresh exact-length ArrayBuffer that the caller charges and transfers. */
  public copyChunk(
    rendition: string,
    unit: string,
    decodeIndex: number
  ): ArrayBuffer {
    const entry = this.chunks.require(rendition, unit, decodeIndex);
    const blobKey = requireCatalogBlobKey(entry.blobKey);
    const relativeRange = requireCatalogRelativeRange(entry.relativeRange);
    this.#requireVerifiedBlob(blobKey, {
      rendition,
      unit,
      decodeIndex
    });
    return this.#payloads.copyRange(
      blobKey,
      relativeRange.offset,
      relativeRange.length
    ).buffer;
  }

  public residencySnapshot(): Readonly<RuntimeAssetResidencySnapshot> {
    const payloads = this.#payloads.snapshot();
    return Object.freeze({
      generation: payloads.generation,
      mode: this.#mode,
      declaredFileBytes: this.#declaredFileLength,
      metadataBytes: this.#disposed ? 0 : this.#metadataBytes,
      verifiedPayloadBytes: this.#disposed ? 0 : payloads.verifiedBytes,
      unitBlobs: payloads.unitBlobs
    });
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#payloads.dispose();
    this.#frontIndex = null;
    this.#layout = null;
    const maps = this.#maps;
    this.#maps = null;
    if (maps !== null) {
      maps.renditions.clear();
      maps.units.clear();
      maps.states.clear();
      maps.edges.clear();
      maps.ports.clear();
      maps.chunks.clear();
    }
  }

  #requireVerifiedBlob(
    key: string,
    context: Readonly<RuntimeFailureContext>
  ): void {
    const state = this.#payloadState(key);
    if (state !== "verified") {
      throw catalogError(
        "load-failure",
        "asset catalog blob is not verified",
        { ...context, policyPhase: state }
      );
    }
  }

  #payloadState(key: string): RuntimeBlobResidencyState {
    this.#throwIfDisposed();
    try {
      return this.#payloads.state(key);
    } catch (error) {
      if (error instanceof RuntimePlaybackError) throw error;
      throw catalogError("invalid-asset", "asset catalog blob key is invalid");
    }
  }

  #requireFrontIndex(): Readonly<ParsedFrontIndex> {
    if (this.#frontIndex === null) throw disposedCatalogError();
    return this.#frontIndex;
  }

  #requireMaps(): CatalogMaps {
    if (this.#maps === null) throw disposedCatalogError();
    return this.#maps;
  }

  #throwIfDisposed(): void {
    if (this.#disposed) throw disposedCatalogError();
  }
}

export function installRuntimeAssetCatalog(
  bytes: Uint8Array
): RuntimeAssetCatalog {
  return new RuntimeAssetCatalog(bytes);
}

export function createMetadataRuntimeAssetCatalog(
  input: Readonly<MetadataRuntimeAssetCatalogInput>
): RuntimeAssetCatalog {
  const installation = installMetadata(input);
  return new RuntimeAssetCatalog(installation);
}

/** @internal Account a retained complete source exactly once. */
export function adoptRuntimeCatalogCompleteSource(
  catalog: RuntimeAssetCatalog
): void {
  catalog[RUNTIME_CATALOG_COMPLETE_SOURCE]();
}

export function createRuntimeCatalogBlobDescriptors(
  frontIndex: Readonly<ParsedFrontIndex>
): readonly Readonly<VerifiedBlobDescriptor>[] {
  if (typeof frontIndex !== "object" || frontIndex === null) {
    throw catalogError("invalid-asset", "asset front index is unavailable");
  }
  const descriptors: Readonly<VerifiedBlobDescriptor>[] = [];
  for (const blob of frontIndex.unitBlobs) {
    checkedCatalogRangeEnd(
      blob.offset,
      blob.length,
      frontIndex.header.declaredFileLength
    );
    descriptors.push(Object.freeze({
      key: runtimeUnitBlobKey(blob.rendition, blob.unit),
      kind: "unit",
      byteLength: blob.length
    }));
  }
  return Object.freeze(descriptors);
}

function installOwnedBytes(callerBytes: Uint8Array): CatalogInstallation {
  if (!(callerBytes instanceof Uint8Array)) {
    throw catalogError(
      "invalid-asset",
      "asset catalog input must be a Uint8Array"
    );
  }
  if (callerBytes.byteLength > FORMAT_DEFAULT_BUDGETS.maxFileBytes) {
    throw catalogError(
      "invalid-asset",
      "asset catalog input exceeds the complete-file limit"
    );
  }

  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = new Uint8Array(new ArrayBuffer(callerBytes.byteLength));
    bytes.set(callerBytes);
  } catch {
    throw catalogError(
      "resource-rejection",
      "asset catalog owned-byte allocation failed"
    );
  }

  let layout: Readonly<ValidatedAssetLayout>;
  try {
    layout = validateCompleteAsset({ bytes });
  } catch (error) {
    throw normalizeInstallError(error);
  }
  return freezeInstallation({
    frontIndex: layout.frontIndex,
    declaredFileLength: bytes.byteLength,
    mode: "full",
    metadataBytes: layout.frontIndex.frontIndexRange.length,
    baseOwnedBytes: bytes.byteLength,
    payloadOwnership: "none",
    payloads: createOwnedPayloadAuthority(bytes, layout.frontIndex),
    completeLayout: layout
  });
}

function installMetadata(
  input: Readonly<MetadataRuntimeAssetCatalogInput>
): CatalogInstallation {
  if (typeof input !== "object" || input === null) {
    throw catalogError("invalid-asset", "metadata catalog input is invalid");
  }
  const frontIndex = input.frontIndex;
  const declared = input.declaredFileLength;
  if (
    typeof frontIndex !== "object" ||
    frontIndex === null ||
    !Number.isSafeInteger(declared) ||
    declared < 1 ||
    declared > FORMAT_DEFAULT_BUDGETS.maxFileBytes ||
    frontIndex.header?.declaredFileLength !== declared ||
    frontIndex.frontIndexRange?.offset !== 0 ||
    !Number.isSafeInteger(frontIndex.frontIndexRange.length) ||
    frontIndex.frontIndexRange.length < 1 ||
    frontIndex.frontIndexRange.length > declared ||
    (input.mode !== "range" && input.mode !== "full")
  ) {
    throw catalogError(
      "invalid-asset",
      "metadata catalog declared geometry is invalid"
    );
  }
  if (!(input.blobStore instanceof VerifiedBlobStore)) {
    throw catalogError("invalid-asset", "verified blob store is unavailable");
  }
  const descriptors = createRuntimeCatalogBlobDescriptors(frontIndex);
  const snapshot = input.blobStore.snapshot();
  if (
    snapshot.disposed ||
    snapshot.unitBlobs.total !== frontIndex.unitBlobs.length
  ) {
    throw catalogError(
      "invalid-asset",
      "verified blob store descriptors do not match metadata"
    );
  }
  try {
    for (const descriptor of descriptors) input.blobStore.state(descriptor.key);
  } catch {
    throw catalogError(
      "invalid-asset",
      "verified blob store key mapping does not match metadata"
    );
  }
  return freezeInstallation({
    frontIndex,
    declaredFileLength: declared,
    mode: input.mode,
    metadataBytes: frontIndex.frontIndexRange.length,
    baseOwnedBytes: input.mode === "full"
      ? declared
      : frontIndex.frontIndexRange.length,
    payloadOwnership: input.mode === "range" ? "verified" : "persistent",
    payloads: createVerifiedPayloadAuthority(input.blobStore),
    completeLayout: null
  });
}

function createVerifiedPayloadAuthority(
  store: VerifiedBlobStore
): CatalogPayloadAuthority {
  const state = store.state;
  const copyRange = store.copyRange;
  const snapshot = store.snapshot;
  const dispose = store.dispose;
  return Object.freeze({
    state: (key: string) => Reflect.apply(state, store, [key]) as
      RuntimeBlobResidencyState,
    copyRange: (key: string, offset: number, length: number) =>
      Reflect.apply(copyRange, store, [key, offset, length]) as
        Uint8Array<ArrayBuffer>,
    snapshot: (): Readonly<CatalogPayloadSnapshot> => {
      const value = Reflect.apply(snapshot, store, []) as
        Readonly<VerifiedBlobStoreSnapshot>;
      return value;
    },
    dispose: () => {
      void (Reflect.apply(dispose, store, []) as Promise<void>);
    }
  });
}

function createOwnedPayloadAuthority(
  initialBytes: Uint8Array<ArrayBuffer>,
  frontIndex: Readonly<ParsedFrontIndex>
): CatalogPayloadAuthority {
  let bytes: Uint8Array<ArrayBuffer> | null = initialBytes;
  const ranges = new Map<string, Readonly<ByteRange>>();
  for (const blob of frontIndex.unitBlobs) {
    ranges.set(
      runtimeUnitBlobKey(blob.rendition, blob.unit),
      Object.freeze({ offset: blob.offset, length: blob.length })
    );
  }
  const snapshot = (disposed: boolean): Readonly<CatalogPayloadSnapshot> => {
    const unitBlobs = summarizeOwnedBlobs(
      frontIndex.unitBlobs.map((blob) => blob.length),
      disposed
    );
    return Object.freeze({
      generation: 0,
      verifiedBytes: disposed
        ? 0
        : unitBlobs.verifiedBytes,
      persistentBytes: 0,
      unitBlobs
    });
  };
  return Object.freeze({
    state(key: string): RuntimeBlobResidencyState {
      if (!ranges.has(key)) {
        throw catalogError("invalid-asset", "owned blob key is unavailable");
      }
      return bytes === null ? "absent" : "verified";
    },
    copyRange(
      key: string,
      relativeOffset: number,
      byteLength: number
    ): Uint8Array<ArrayBuffer> {
      const range = requireOwnedRange(ranges, key);
      return copyOwnedBytes(bytes, range, relativeOffset, byteLength);
    },
    snapshot: () => snapshot(bytes === null),
    dispose(): void {
      bytes = null;
      ranges.clear();
    }
  });
}

function summarizeOwnedBlobs(
  lengths: readonly number[],
  disposed: boolean
): Readonly<RuntimeBlobResidencySnapshot> {
  const verifiedBytes = disposed
    ? 0
    : lengths.reduce((total, length) => total + length, 0);
  return Object.freeze({
    total: lengths.length,
    absent: disposed ? lengths.length : 0,
    loading: 0,
    verified: disposed ? 0 : lengths.length,
    verifiedBytes
  });
}

function requireOwnedRange(
  ranges: ReadonlyMap<string, Readonly<ByteRange>>,
  key: string
): Readonly<ByteRange> {
  const range = ranges.get(key);
  if (range === undefined) {
    throw catalogError("invalid-asset", "owned blob key is unavailable");
  }
  return range;
}

function copyOwnedBytes(
  bytes: Uint8Array<ArrayBuffer> | null,
  range: Readonly<ByteRange>,
  relativeOffset: number,
  byteLength: number
): Uint8Array<ArrayBuffer> {
  if (bytes === null) throw disposedCatalogError();
  if (
    !Number.isSafeInteger(relativeOffset) ||
    !Number.isSafeInteger(byteLength) ||
    relativeOffset < 0 ||
    byteLength < 1 ||
    relativeOffset > range.length ||
    byteLength > range.length - relativeOffset
  ) {
    throw catalogError("invalid-asset", "owned blob copy range is invalid");
  }
  const absoluteOffset = range.offset + relativeOffset;
  const end = checkedCatalogRangeEnd(absoluteOffset, byteLength, bytes.byteLength);
  let copy: Uint8Array<ArrayBuffer>;
  try {
    copy = new Uint8Array(new ArrayBuffer(byteLength));
  } catch {
    throw catalogError(
      "resource-rejection",
      "asset catalog byte-copy allocation failed"
    );
  }
  copy.set(bytes.subarray(absoluteOffset, end));
  return copy;
}

function freezeInstallation(
  value: Omit<CatalogInstallation, typeof CATALOG_INSTALLATION>
): CatalogInstallation {
  return Object.freeze({
    [CATALOG_INSTALLATION]: true as const,
    ...value
  });
}

function requireCatalogBlobKey(value: string | undefined): string {
  if (typeof value !== "string" || value.length === 0) {
    throw catalogError("invalid-asset", "asset catalog blob key is missing");
  }
  return value;
}

function requireCatalogRelativeRange(
  value: Readonly<ByteRange> | undefined
): Readonly<ByteRange> {
  if (value === undefined) {
    throw catalogError("invalid-asset", "asset catalog chunk range is missing");
  }
  return value;
}

function isCatalogInstallation(value: unknown): value is CatalogInstallation {
  if (typeof value !== "object" || value === null) return false;
  try {
    return Reflect.get(value, CATALOG_INSTALLATION) === true;
  } catch {
    return false;
  }
}

function checkedOwnedByteSum(metadataBytes: number, payloadBytes: number): number {
  const total = metadataBytes + payloadBytes;
  if (!Number.isSafeInteger(total) || total > FORMAT_DEFAULT_BUDGETS.maxFileBytes) {
    throw catalogError(
      "resource-rejection",
      "asset catalog owned byte total is invalid"
    );
  }
  return total;
}

function normalizeInstallError(error: unknown): RuntimePlaybackError {
  if (error instanceof RuntimePlaybackError) return error;
  if (error instanceof FormatError) {
    return new RuntimePlaybackError(normalizeRuntimeFailure(
      "invalid-asset",
      undefined,
      {
        sourceCode: error.code,
        ...(error.path === undefined ? {} : { sourcePath: error.path }),
        ...(error.offset === undefined ? {} : { offset: error.offset })
      }
    ));
  }
  return catalogError("invalid-asset", "complete asset validation failed");
}

function disposedCatalogError(): RuntimePlaybackError {
  return catalogError("disposed", "asset catalog is disposed");
}

function catalogError(
  code:
    | "invalid-asset"
    | "load-failure"
    | "resource-rejection"
    | "disposed",
  message: string,
  context: Readonly<RuntimeFailureContext> = {}
): RuntimePlaybackError {
  return new RuntimePlaybackError(
    normalizeRuntimeFailure(code, message, context)
  );
}
