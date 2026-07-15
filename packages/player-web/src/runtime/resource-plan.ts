import {
  maximumAvcDecodedRgbaBytes,
  type CompiledManifestV01,
  type RenditionV01
} from "@pixel-point/aval-format";

import type {
  RuntimeAssetCatalog,
  RuntimeCatalogAccessUnit
} from "./asset-catalog.js";
import {
  STREAMING_TEXTURE_LAYER_COUNT,
  checkedByteNumber,
  checkedByteSum,
  checkedRgbaBytes,
  roundedGpuAllocationBytes,
  validatePositiveSafeInteger
} from "./checked-runtime-bytes.js";
import type { InteractionCachePlan } from "./interaction-cache-plan.js";
import {
  createCanvasRuntimeResourcePlan,
  type RuntimeCanvasBackingSize,
  type RuntimeCanvasResourceCatalogView,
  type RuntimeCanvasResourcePlan as BaseRuntimeCanvasResourcePlan
} from "./canvas-resource-plan.js";

export {
  createCanvasRuntimeResourcePlan
} from "./canvas-resource-plan.js";
export type {
  RuntimeCanvasBackingSize,
  RuntimeCanvasResourceAllocationSnapshot,
  RuntimeCanvasResourceCatalogView,
  RuntimeCanvasResourceHost,
  RuntimeCanvasResourceLease,
  RuntimeCanvasResourcePlan,
  RuntimeCanvasResourcePlanInput
} from "./canvas-resource-plan.js";

export const RESOURCE_DECODE_SURFACE_COUNT = 12;
export const MIN_RESOURCE_RING_CAPACITY = 6;
export const MAX_RESOURCE_RING_CAPACITY = 12;

export interface RuntimeResourceCatalogView
extends RuntimeCanvasResourceCatalogView {
  readonly records: Pick<RuntimeAssetCatalog["records"], "require">;
}

export interface RuntimeResourcePlanInput {
  readonly catalog: RuntimeResourceCatalogView;
  readonly rendition: string;
  readonly interactionCache: Readonly<InteractionCachePlan>;
  readonly ringCapacity: number;
  readonly hostMaxRuntimeBytes?: number;
  /** Current animated-canvas backing; defaults to logical size. */
  readonly canvasBacking?: Readonly<RuntimeCanvasBackingSize>;
}

/** Every simultaneously live additive allocation in the selected peak. */
export interface RuntimeResourceAllocationSnapshot {
  readonly ownedAssetBytes: number;
  readonly maximumEncodedWindowBytes: number;
  readonly decoderEncodedWindowBytes: number;
  readonly decodedSurfaceBytes: number;
  readonly persistentAllocationBytes: number;
  readonly streamingAllocationBytes: number;
  readonly frameStagingBytes: number;
  readonly animatedCanvasBackingAllocationBytes: number;
  readonly totalBytes: number;
}

export interface RuntimeResourcePlan
extends Omit<BaseRuntimeCanvasResourcePlan, "allocationSnapshot"> {
  readonly rendition: string;
  readonly ringCapacity: number;
  readonly outstandingFrameLimit: typeof RESOURCE_DECODE_SURFACE_COUNT;
  readonly effectiveCapBytes: number;
  readonly manifestCapBytes: number;
  readonly hostCapBytes: number;
  readonly ownedAssetBytes: number;
  readonly maximumEncodedWindowBytes: number;
  /** Decoder-owned copies may coexist with transferred sample buffers. */
  readonly decoderEncodedWindowBytes: number;
  readonly decodedBytesPerSurface: number;
  readonly decodedSurfaceBytes: number;
  readonly persistentLayerBytes: number;
  readonly persistentAllocationBytes: number;
  readonly streamingLayerBytes: number;
  readonly streamingAllocationBytes: number;
  /** Persistent CPU staging owned by FrameRenderer. */
  readonly frameStagingBytes: number;
  /** The ring leases the twelve decoded surfaces already charged above. */
  readonly ringAdditionalBytes: 0;
  readonly allocationSnapshot: Readonly<RuntimeResourceAllocationSnapshot>;
  readonly totalBytes: number;
}

/** Build the exact one-player steady-state plan for one selected candidate. */
export function createRuntimeResourcePlan(
  input: RuntimeResourcePlanInput
): Readonly<RuntimeResourcePlan> {
  validateObject(input, "runtime resource plan input");
  validateObject(input.catalog, "runtime resource catalog");
  validateObject(input.interactionCache, "interaction cache plan");
  validatePositiveSafeInteger(input.ringCapacity, "presentation ring capacity");
  if (
    input.ringCapacity < MIN_RESOURCE_RING_CAPACITY ||
    input.ringCapacity > MAX_RESOURCE_RING_CAPACITY
  ) {
    throw new RangeError("presentation ring capacity must be from 6 to 12");
  }

  const manifest = input.catalog.manifest;
  const rendition = requireProductionAvcRendition(manifest, input.rendition);
  if (
    input.interactionCache.rendition !== rendition.id ||
    input.interactionCache.width !== rendition.codedWidth ||
    input.interactionCache.height !== rendition.codedHeight
  ) {
    throw new RangeError("interaction cache does not match the selected rendition");
  }
  const expectedPersistentBytes = checkedRgbaBytes(
    rendition.codedWidth,
    rendition.codedHeight,
    input.interactionCache.layerCount,
    "persistent layer bytes"
  );
  if (
    checkedByteNumber(expectedPersistentBytes, "persistent layer bytes") !==
    input.interactionCache.persistentBytes
  ) {
    throw new RangeError("interaction cache byte accounting is inconsistent");
  }

  const canvasPlan = createCanvasRuntimeResourcePlan({
    catalog: input.catalog,
    ...(input.hostMaxRuntimeBytes === undefined
      ? {}
      : { hostMaxRuntimeBytes: input.hostMaxRuntimeBytes }),
    ...(input.canvasBacking === undefined
      ? {}
      : { canvasBacking: input.canvasBacking })
  });
  const maximumEncodedWindow = BigInt(maximumActualEncodedWindowBytes(
    input.catalog,
    rendition.id,
    RESOURCE_DECODE_SURFACE_COUNT
  ));
  const decodedPerSurface = BigInt(maximumAvcDecodedRgbaBytes(
    rendition.codedWidth,
    rendition.codedHeight
  ));
  const decodedSurfaces = decodedPerSurface *
    BigInt(RESOURCE_DECODE_SURFACE_COUNT);
  const persistent = expectedPersistentBytes;
  const persistentAllocation = roundedGpuAllocationBytes(persistent);
  const codedRgba = checkedRgbaBytes(
    rendition.codedWidth,
    rendition.codedHeight,
    1,
    "coded RGBA bytes"
  );
  const streaming = codedRgba * BigInt(STREAMING_TEXTURE_LAYER_COUNT);
  const streamingAllocation = roundedGpuAllocationBytes(streaming);
  const frameStaging = codedRgba;
  const snapshotTerms = Object.freeze({
    ownedAssetBytes: BigInt(canvasPlan.allocationSnapshot.ownedAssetBytes),
    maximumEncodedWindowBytes: maximumEncodedWindow,
    decoderEncodedWindowBytes: maximumEncodedWindow,
    decodedSurfaceBytes: decodedSurfaces,
    persistentAllocationBytes: persistentAllocation,
    streamingAllocationBytes: streamingAllocation,
    frameStagingBytes: frameStaging,
    animatedCanvasBackingAllocationBytes: BigInt(
      canvasPlan.animatedCanvasBackingAllocationBytes
    )
  });
  const total = checkedByteSum(
    Object.values(snapshotTerms),
    "runtime resource total"
  );
  if (total > BigInt(canvasPlan.effectiveCapBytes)) {
    throw new RangeError(
      `runtime resource total ${total.toString()} exceeds effective cap ${String(canvasPlan.effectiveCapBytes)}`
    );
  }

  const allocationSnapshot = freezeAllocationSnapshot(snapshotTerms, total);
  const plan = Object.freeze({
    rendition: rendition.id,
    ringCapacity: input.ringCapacity,
    outstandingFrameLimit: RESOURCE_DECODE_SURFACE_COUNT,
    ...canvasPlan,
    maximumEncodedWindowBytes: checkedByteNumber(
      maximumEncodedWindow,
      "maximum encoded window bytes"
    ),
    decoderEncodedWindowBytes: checkedByteNumber(
      maximumEncodedWindow,
      "decoder encoded window bytes"
    ),
    decodedBytesPerSurface: checkedByteNumber(
      decodedPerSurface,
      "decoded bytes per surface"
    ),
    decodedSurfaceBytes: checkedByteNumber(
      decodedSurfaces,
      "decoded surface bytes"
    ),
    persistentLayerBytes: input.interactionCache.persistentBytes,
    persistentAllocationBytes: checkedByteNumber(
      persistentAllocation,
      "persistent allocation bytes"
    ),
    streamingLayerBytes: checkedByteNumber(streaming, "streaming layer bytes"),
    streamingAllocationBytes: checkedByteNumber(
      streamingAllocation,
      "streaming allocation bytes"
    ),
    frameStagingBytes: checkedByteNumber(
      frameStaging,
      "frame staging bytes"
    ),
    ringAdditionalBytes: 0,
    allocationSnapshot,
    totalBytes: checkedByteNumber(total, "runtime resource total")
  });
  if (plan.totalBytes !== allocationSnapshot.totalBytes) {
    throw new RangeError("runtime resource snapshot does not reconcile");
  }
  return plan;
}

/** Ring capacity leases the already charged decoded surfaces; only metadata changes. */
export function withRuntimeResourceRingCapacity(
  plan: Readonly<RuntimeResourcePlan>,
  ringCapacity: number
): Readonly<RuntimeResourcePlan> {
  validateObject(plan, "runtime resource plan");
  validatePositiveSafeInteger(ringCapacity, "presentation ring capacity");
  if (
    ringCapacity < MIN_RESOURCE_RING_CAPACITY ||
    ringCapacity > MAX_RESOURCE_RING_CAPACITY
  ) {
    throw new RangeError("presentation ring capacity must be from 6 to 12");
  }
  if (plan.ringCapacity === ringCapacity) return plan;
  return Object.freeze({ ...plan, ringCapacity });
}

/**
 * Find the greatest exact encoded-byte sum accepted by the sequential worker.
 * A window may begin at any frame. Inside an occurrence it must advance in
 * local-frame order; only a complete unit boundary may start a new independently
 * decodable unit occurrence. This excludes impossible jumps between large
 * mid-unit samples while covering every legal M5 worker occurrence sequence.
 */
export function maximumActualEncodedWindowBytes(
  catalog: RuntimeResourceCatalogView,
  rendition: string,
  frameLimit = RESOURCE_DECODE_SURFACE_COUNT
): number {
  validatePositiveSafeInteger(frameLimit, "encoded window frame limit");
  const manifest = catalog.manifest;
  requireProductionAvcRendition(manifest, rendition);
  const nodes: {
    readonly record: Readonly<RuntimeCatalogAccessUnit>;
    readonly next: number | null;
  }[] = [];
  const firstNodes: number[] = [];

  for (const unit of manifest.units) {
    const firstNode = nodes.length;
    firstNodes.push(firstNode);
    for (let localFrame = 0; localFrame < unit.frameCount; localFrame += 1) {
      const record = catalog.records.require(rendition, unit.id, localFrame);
      validatePositiveSafeInteger(
        record.range.length,
        `encoded sample ${unit.id}/${String(localFrame)} bytes`
      );
      nodes.push({
        record,
        next: localFrame + 1 < unit.frameCount ? nodes.length + 1 : null
      });
    }
  }
  if (nodes.length < 1) {
    throw new RangeError("selected rendition has no encoded samples");
  }

  let previous = nodes.map(({ record }) => BigInt(record.range.length));
  let maximum = previous.reduce(
    (largest, value) => value > largest ? value : largest,
    0n
  );
  for (let frames = 2; frames <= frameLimit; frames += 1) {
    let greatestOccurrenceStart = 0n;
    for (const first of firstNodes) {
      const value = previous[first];
      if (value !== undefined && value > greatestOccurrenceStart) {
        greatestOccurrenceStart = value;
      }
    }
    const current = nodes.map((node) => {
      const continuation = node.next === null
        ? greatestOccurrenceStart
        : previous[node.next]!;
      return BigInt(node.record.range.length) + continuation;
    });
    for (const value of current) if (value > maximum) maximum = value;
    previous = current;
  }
  return checkedByteNumber(maximum, "maximum encoded window bytes");
}

type ProductionAvcRendition = Extract<
  RenditionV01,
  {
    readonly profile:
      | "avc-annexb-opaque-v0"
      | "avc-annexb-packed-alpha-v0"
      | "avc-annexb-opaque-v1"
      | "avc-annexb-packed-alpha-v1";
  }
>;

function requireProductionAvcRendition(
  manifest: Readonly<CompiledManifestV01>,
  rendition: string
): Readonly<ProductionAvcRendition> {
  const selected = manifest.renditions.find(({ id }) => id === rendition);
  if (
    selected?.profile !== "avc-annexb-opaque-v0" &&
    selected?.profile !== "avc-annexb-packed-alpha-v0" &&
    selected?.profile !== "avc-annexb-opaque-v1" &&
    selected?.profile !== "avc-annexb-packed-alpha-v1"
  ) {
    throw new RangeError("selected resource rendition must be production AVC");
  }
  return selected;
}

interface BigIntAllocationSnapshotTerms {
  readonly ownedAssetBytes: bigint;
  readonly maximumEncodedWindowBytes: bigint;
  readonly decoderEncodedWindowBytes: bigint;
  readonly decodedSurfaceBytes: bigint;
  readonly persistentAllocationBytes: bigint;
  readonly streamingAllocationBytes: bigint;
  readonly frameStagingBytes: bigint;
  readonly animatedCanvasBackingAllocationBytes: bigint;
}

function freezeAllocationSnapshot(
  terms: Readonly<BigIntAllocationSnapshotTerms>,
  total: bigint
): Readonly<RuntimeResourceAllocationSnapshot> {
  const snapshot = Object.freeze({
    ownedAssetBytes: checkedByteNumber(
      terms.ownedAssetBytes,
      "snapshot owned asset bytes"
    ),
    maximumEncodedWindowBytes: checkedByteNumber(
      terms.maximumEncodedWindowBytes,
      "snapshot maximum encoded window bytes"
    ),
    decoderEncodedWindowBytes: checkedByteNumber(
      terms.decoderEncodedWindowBytes,
      "snapshot decoder encoded window bytes"
    ),
    decodedSurfaceBytes: checkedByteNumber(
      terms.decodedSurfaceBytes,
      "snapshot decoded surface bytes"
    ),
    persistentAllocationBytes: checkedByteNumber(
      terms.persistentAllocationBytes,
      "snapshot persistent allocation bytes"
    ),
    streamingAllocationBytes: checkedByteNumber(
      terms.streamingAllocationBytes,
      "snapshot streaming allocation bytes"
    ),
    frameStagingBytes: checkedByteNumber(
      terms.frameStagingBytes,
      "snapshot frame staging bytes"
    ),
    animatedCanvasBackingAllocationBytes: checkedByteNumber(
      terms.animatedCanvasBackingAllocationBytes,
      "snapshot animated canvas allocation bytes"
    ),
    totalBytes: checkedByteNumber(total, "snapshot total bytes")
  });
  const reconciled = checkedByteSum([
    snapshot.ownedAssetBytes,
    snapshot.maximumEncodedWindowBytes,
    snapshot.decoderEncodedWindowBytes,
    snapshot.decodedSurfaceBytes,
    snapshot.persistentAllocationBytes,
    snapshot.streamingAllocationBytes,
    snapshot.frameStagingBytes,
    snapshot.animatedCanvasBackingAllocationBytes
  ], "runtime resource snapshot total");
  if (reconciled !== total) {
    throw new RangeError("runtime resource snapshot does not reconcile");
  }
  return snapshot;
}

function validateObject(value: unknown, label: string): void {
  if (value === null || typeof value !== "object") {
    throw new TypeError(`${label} must be an object`);
  }
}
