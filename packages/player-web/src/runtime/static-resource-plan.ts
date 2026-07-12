import type { CompiledManifestV01 } from "@rendered-motion/format";

import type { RuntimeAssetCatalog } from "./asset-catalog.js";
import {
  MAX_PLAYER_RUNTIME_BYTES,
  checkedByteNumber,
  checkedByteSum,
  checkedRgbaBytes,
  roundedGpuAllocationBytes,
  validatePositiveSafeInteger
} from "./checked-runtime-bytes.js";

export interface RuntimeCanvasBackingSize {
  readonly width: number;
  readonly height: number;
}

export interface RuntimeStaticResourceCatalogView {
  readonly ownedByteLength: number;
  readonly manifest: Readonly<CompiledManifestV01>;
  readonly staticFrames: Pick<RuntimeAssetCatalog["staticFrames"], "values">;
}

export interface StaticRuntimeResourcePlanInput {
  readonly catalog: RuntimeStaticResourceCatalogView;
  readonly hostMaxRuntimeBytes?: number;
  /** Current shared animated/static plane backing; defaults to logical size. */
  readonly canvasBacking?: Readonly<RuntimeCanvasBackingSize>;
}

export interface RuntimeCanvasResourcePlan {
  readonly effectiveCapBytes: number;
  readonly totalBytes: number;
  readonly canvasBackingWidth: number;
  readonly canvasBackingHeight: number;
  readonly canvasBackingBytesPerPlane: number;
  readonly animatedCanvasBackingAllocationBytes: number;
  readonly staticCanvasBackingAllocationBytes: number;
}

export interface RuntimeCanvasResourceLease {
  release(): void;
}

/** Optional host bridge that keeps presentation backing inside admitted bytes. */
export interface RuntimeCanvasResourceHost {
  currentCanvasBacking(): Readonly<RuntimeCanvasBackingSize>;
  reserveCanvasResources(
    plan: Readonly<RuntimeCanvasResourcePlan>
  ): RuntimeCanvasResourceLease;
}

/**
 * Capture a host-provided lease capability once and make release idempotent.
 * Hostile accessors never get another opportunity to replace the authority.
 */
export function captureRuntimeCanvasResourceLease(
  value: unknown
): RuntimeCanvasResourceLease {
  if (value === null || typeof value !== "object") {
    throw new TypeError("canvas resource lease must be an object");
  }
  let release: unknown;
  try {
    release = Reflect.get(value, "release");
  } catch {
    throw new TypeError("canvas resource lease release is inaccessible");
  }
  if (typeof release !== "function") {
    throw new TypeError("canvas resource lease is missing release");
  }
  let released = false;
  return Object.freeze({
    release(): void {
      if (released) return;
      released = true;
      Reflect.apply(release, value, []);
    }
  });
}

/**
 * Snapshot both host methods once. Every reservation returned by the stable
 * facade is converted into the single captured lease authority above.
 */
export function captureRuntimeCanvasResourceHost(
  value: unknown
): Readonly<RuntimeCanvasResourceHost> {
  if (value === null || typeof value !== "object") {
    throw new TypeError("canvas resource host must be an object");
  }
  let currentCanvasBacking: unknown;
  let reserveCanvasResources: unknown;
  try {
    currentCanvasBacking = Reflect.get(value, "currentCanvasBacking");
    reserveCanvasResources = Reflect.get(value, "reserveCanvasResources");
  } catch {
    throw new TypeError("canvas resource host capabilities are inaccessible");
  }
  if (
    typeof currentCanvasBacking !== "function" ||
    typeof reserveCanvasResources !== "function"
  ) {
    throw new TypeError("canvas resource host is malformed");
  }
  return Object.freeze({
    currentCanvasBacking: (): Readonly<RuntimeCanvasBackingSize> =>
      Reflect.apply(currentCanvasBacking, value, []) as Readonly<RuntimeCanvasBackingSize>,
    reserveCanvasResources: (
      plan: Readonly<RuntimeCanvasResourcePlan>
    ): RuntimeCanvasResourceLease => captureRuntimeCanvasResourceLease(
      Reflect.apply(reserveCanvasResources, value, [plan])
    )
  });
}

export interface StaticRuntimeResourceAllocationSnapshot {
  readonly ownedAssetBytes: number;
  readonly staticDecodePngCopyBytes: number;
  readonly staticDecodeOwnedZlibBytes: number;
  readonly staticDecodeWorkingPeakBytes: number;
  readonly currentStaticSurfaceAllocationBytes: number;
  readonly incomingStaticSurfaceAllocationBytes: number;
  readonly animatedCanvasBackingAllocationBytes: number;
  readonly staticCanvasBackingAllocationBytes: number;
  readonly totalBytes: number;
}

export interface StaticRuntimeResourcePlan extends RuntimeCanvasResourcePlan {
  readonly manifestCapBytes: number;
  readonly hostCapBytes: number;
  readonly ownedAssetBytes: number;
  readonly largestStaticPngCopyBytes: number;
  readonly largestStaticZlibBytes: number;
  readonly staticFilteredBytes: number;
  readonly staticRgbaWorkingBytes: number;
  readonly nativeStaticWorkingPeakBytes: number;
  readonly pureStaticWorkingPeakBytes: number;
  readonly staticDecodeWorkingPeakBytes: number;
  readonly staticDecodePeakBytes: number;
  readonly staticRgbaBytesPerSurface: number;
  readonly currentStaticSurfaceBytes: number;
  readonly currentStaticSurfaceAllocationBytes: number;
  readonly incomingStaticSurfaceBytes: number;
  readonly incomingStaticSurfaceAllocationBytes: number;
  readonly staticSwapBytes: number;
  readonly staticSwapAllocationBytes: number;
  readonly allocationSnapshot: Readonly<StaticRuntimeResourceAllocationSnapshot>;
}

/** Admit the complete strict-static peak before any PNG copy or decode starts. */
export function createStaticRuntimeResourcePlan(
  input: Readonly<StaticRuntimeResourcePlanInput>
): Readonly<StaticRuntimeResourcePlan> {
  validateObject(input, "static runtime resource plan input");
  validateObject(input.catalog, "static runtime resource catalog");
  const manifest = input.catalog.manifest;
  validatePositiveSafeInteger(
    input.catalog.ownedByteLength,
    "owned complete asset bytes"
  );
  validatePositiveSafeInteger(
    manifest.limits.maxRuntimeBytes,
    "manifest maxRuntimeBytes"
  );
  const hostCap = input.hostMaxRuntimeBytes ?? MAX_PLAYER_RUNTIME_BYTES;
  validatePositiveSafeInteger(hostCap, "host runtime byte cap");
  const effectiveCap = Math.min(
    MAX_PLAYER_RUNTIME_BYTES,
    manifest.limits.maxRuntimeBytes,
    hostCap
  );

  const facts = measureStaticPngPeaks(input.catalog, manifest);
  const rgba = checkedRgbaBytes(
    manifest.canvas.width,
    manifest.canvas.height,
    1,
    "logical static RGBA bytes"
  );
  if (checkedByteNumber(rgba, "logical static RGBA bytes") !== facts.rgbaBytes) {
    throw new RangeError("static PNG RGBA length does not match the canvas");
  }
  const zlib = BigInt(facts.largestZlibBytes);
  const filtered = BigInt(facts.filteredBytes);
  const nativeStreamPeak = checkedByteSum(
    [zlib, filtered, filtered],
    "native static stream working peak"
  );
  const unfilterPeak = checkedByteSum(
    [filtered, rgba],
    "static unfilter working peak"
  );
  const nativeWorkingPeak = nativeStreamPeak > unfilterPeak
    ? nativeStreamPeak
    : unfilterPeak;
  const pureWorkingPeak = unfilterPeak;
  const workingPeak = nativeWorkingPeak > pureWorkingPeak
    ? nativeWorkingPeak
    : pureWorkingPeak;
  const staticDecodePeak = checkedByteSum([
    facts.largestPngCopyBytes,
    facts.largestZlibBytes,
    workingPeak
  ], "static decode peak bytes");

  const currentSurface = rgba;
  const incomingSurface = rgba;
  const currentSurfaceAllocation = roundedGpuAllocationBytes(currentSurface);
  const incomingSurfaceAllocation = roundedGpuAllocationBytes(incomingSurface);
  const staticSwap = checkedByteSum(
    [currentSurface, incomingSurface],
    "static swap bytes"
  );
  const staticSwapAllocation = checkedByteSum(
    [currentSurfaceAllocation, incomingSurfaceAllocation],
    "static swap allocation bytes"
  );
  const canvasBacking = resolveCanvasBacking(input.canvasBacking, manifest);
  const canvasBackingBytes = checkedRgbaBytes(
    canvasBacking.width,
    canvasBacking.height,
    1,
    "canvas backing bytes"
  );
  const animatedCanvasAllocation = roundedGpuAllocationBytes(canvasBackingBytes);
  const staticCanvasAllocation = roundedGpuAllocationBytes(canvasBackingBytes);
  const terms = Object.freeze({
    ownedAssetBytes: BigInt(input.catalog.ownedByteLength),
    staticDecodePngCopyBytes: BigInt(facts.largestPngCopyBytes),
    staticDecodeOwnedZlibBytes: zlib,
    staticDecodeWorkingPeakBytes: workingPeak,
    currentStaticSurfaceAllocationBytes: currentSurfaceAllocation,
    incomingStaticSurfaceAllocationBytes: incomingSurfaceAllocation,
    animatedCanvasBackingAllocationBytes: animatedCanvasAllocation,
    staticCanvasBackingAllocationBytes: staticCanvasAllocation
  });
  const total = checkedByteSum(Object.values(terms), "static runtime resource total");
  if (total > BigInt(effectiveCap)) {
    throw new RangeError(
      `static runtime resource total ${total.toString()} exceeds effective cap ${String(effectiveCap)}`
    );
  }
  const allocationSnapshot = freezeStaticAllocationSnapshot(terms, total);
  return Object.freeze({
    effectiveCapBytes: effectiveCap,
    manifestCapBytes: manifest.limits.maxRuntimeBytes,
    hostCapBytes: hostCap,
    ownedAssetBytes: input.catalog.ownedByteLength,
    largestStaticPngCopyBytes: facts.largestPngCopyBytes,
    largestStaticZlibBytes: facts.largestZlibBytes,
    staticFilteredBytes: facts.filteredBytes,
    staticRgbaWorkingBytes: facts.rgbaBytes,
    nativeStaticWorkingPeakBytes: checkedByteNumber(
      nativeWorkingPeak,
      "native static working peak bytes"
    ),
    pureStaticWorkingPeakBytes: checkedByteNumber(
      pureWorkingPeak,
      "pure static working peak bytes"
    ),
    staticDecodeWorkingPeakBytes: checkedByteNumber(
      workingPeak,
      "static decode working peak bytes"
    ),
    staticDecodePeakBytes: checkedByteNumber(
      staticDecodePeak,
      "static decode peak bytes"
    ),
    staticRgbaBytesPerSurface: facts.rgbaBytes,
    currentStaticSurfaceBytes: checkedByteNumber(
      currentSurface,
      "current static surface bytes"
    ),
    currentStaticSurfaceAllocationBytes: checkedByteNumber(
      currentSurfaceAllocation,
      "current static surface allocation bytes"
    ),
    incomingStaticSurfaceBytes: checkedByteNumber(
      incomingSurface,
      "incoming static surface bytes"
    ),
    incomingStaticSurfaceAllocationBytes: checkedByteNumber(
      incomingSurfaceAllocation,
      "incoming static surface allocation bytes"
    ),
    staticSwapBytes: checkedByteNumber(staticSwap, "static swap bytes"),
    staticSwapAllocationBytes: checkedByteNumber(
      staticSwapAllocation,
      "static swap allocation bytes"
    ),
    canvasBackingWidth: canvasBacking.width,
    canvasBackingHeight: canvasBacking.height,
    canvasBackingBytesPerPlane: checkedByteNumber(
      canvasBackingBytes,
      "canvas backing bytes per plane"
    ),
    animatedCanvasBackingAllocationBytes: checkedByteNumber(
      animatedCanvasAllocation,
      "animated canvas backing allocation bytes"
    ),
    staticCanvasBackingAllocationBytes: checkedByteNumber(
      staticCanvasAllocation,
      "static canvas backing allocation bytes"
    ),
    allocationSnapshot,
    totalBytes: checkedByteNumber(total, "static runtime resource total")
  });
}

interface StaticPngPeaks {
  readonly largestPngCopyBytes: number;
  readonly largestZlibBytes: number;
  readonly filteredBytes: number;
  readonly rgbaBytes: number;
}

function measureStaticPngPeaks(
  catalog: RuntimeStaticResourceCatalogView,
  manifest: Readonly<CompiledManifestV01>
): Readonly<StaticPngPeaks> {
  if (typeof catalog.staticFrames?.values !== "function") {
    throw new TypeError("runtime resource catalog must expose static PNG facts");
  }
  const entries = catalog.staticFrames.values();
  if (entries.length !== manifest.staticFrames.length || entries.length < 1) {
    throw new RangeError("runtime resource static PNG facts are incomplete");
  }
  let largestPngCopyBytes = 0;
  let largestZlibBytes = 0;
  let filteredBytes = 0;
  let rgbaBytes = 0;
  for (const entry of entries) {
    if (
      entry.range.length !== entry.frame.length ||
      entry.png.byteRange.length !== entry.frame.length ||
      entry.png.width !== entry.frame.width ||
      entry.png.height !== entry.frame.height
    ) {
      throw new RangeError("validated static PNG facts are inconsistent");
    }
    largestPngCopyBytes = Math.max(largestPngCopyBytes, entry.range.length);
    largestZlibBytes = Math.max(
      largestZlibBytes,
      entry.png.zlibByteLength
    );
    if (filteredBytes === 0) {
      filteredBytes = entry.png.expectedFilteredBytes;
      rgbaBytes = entry.png.expectedRgbaBytes;
    } else if (
      filteredBytes !== entry.png.expectedFilteredBytes ||
      rgbaBytes !== entry.png.expectedRgbaBytes
    ) {
      throw new RangeError("static PNG decoded lengths do not share one canvas");
    }
  }
  validatePositiveSafeInteger(largestPngCopyBytes, "largest static PNG bytes");
  validatePositiveSafeInteger(largestZlibBytes, "largest static zlib bytes");
  validatePositiveSafeInteger(filteredBytes, "static filtered bytes");
  validatePositiveSafeInteger(rgbaBytes, "static RGBA bytes");
  return Object.freeze({
    largestPngCopyBytes,
    largestZlibBytes,
    filteredBytes,
    rgbaBytes
  });
}

function resolveCanvasBacking(
  backing: Readonly<RuntimeCanvasBackingSize> | undefined,
  manifest: Readonly<CompiledManifestV01>
): Readonly<RuntimeCanvasBackingSize> {
  const selected = backing === undefined ? manifest.canvas : backing;
  validateObject(selected, "canvas backing dimensions");
  validatePositiveSafeInteger(selected.width, "canvas backing width");
  validatePositiveSafeInteger(selected.height, "canvas backing height");
  return Object.freeze({ width: selected.width, height: selected.height });
}

interface BigIntStaticAllocationTerms {
  readonly ownedAssetBytes: bigint;
  readonly staticDecodePngCopyBytes: bigint;
  readonly staticDecodeOwnedZlibBytes: bigint;
  readonly staticDecodeWorkingPeakBytes: bigint;
  readonly currentStaticSurfaceAllocationBytes: bigint;
  readonly incomingStaticSurfaceAllocationBytes: bigint;
  readonly animatedCanvasBackingAllocationBytes: bigint;
  readonly staticCanvasBackingAllocationBytes: bigint;
}

function freezeStaticAllocationSnapshot(
  terms: Readonly<BigIntStaticAllocationTerms>,
  total: bigint
): Readonly<StaticRuntimeResourceAllocationSnapshot> {
  const snapshot = Object.freeze({
    ownedAssetBytes: checkedByteNumber(terms.ownedAssetBytes, "snapshot asset bytes"),
    staticDecodePngCopyBytes: checkedByteNumber(
      terms.staticDecodePngCopyBytes,
      "snapshot static PNG copy bytes"
    ),
    staticDecodeOwnedZlibBytes: checkedByteNumber(
      terms.staticDecodeOwnedZlibBytes,
      "snapshot static zlib bytes"
    ),
    staticDecodeWorkingPeakBytes: checkedByteNumber(
      terms.staticDecodeWorkingPeakBytes,
      "snapshot static decode working bytes"
    ),
    currentStaticSurfaceAllocationBytes: checkedByteNumber(
      terms.currentStaticSurfaceAllocationBytes,
      "snapshot current static allocation bytes"
    ),
    incomingStaticSurfaceAllocationBytes: checkedByteNumber(
      terms.incomingStaticSurfaceAllocationBytes,
      "snapshot incoming static allocation bytes"
    ),
    animatedCanvasBackingAllocationBytes: checkedByteNumber(
      terms.animatedCanvasBackingAllocationBytes,
      "snapshot animated canvas allocation bytes"
    ),
    staticCanvasBackingAllocationBytes: checkedByteNumber(
      terms.staticCanvasBackingAllocationBytes,
      "snapshot static canvas allocation bytes"
    ),
    totalBytes: checkedByteNumber(total, "snapshot static total bytes")
  });
  const reconciled = checkedByteSum([
    snapshot.ownedAssetBytes,
    snapshot.staticDecodePngCopyBytes,
    snapshot.staticDecodeOwnedZlibBytes,
    snapshot.staticDecodeWorkingPeakBytes,
    snapshot.currentStaticSurfaceAllocationBytes,
    snapshot.incomingStaticSurfaceAllocationBytes,
    snapshot.animatedCanvasBackingAllocationBytes,
    snapshot.staticCanvasBackingAllocationBytes
  ], "static runtime resource snapshot total");
  if (reconciled !== total) {
    throw new RangeError("static runtime resource snapshot does not reconcile");
  }
  return snapshot;
}

function validateObject(value: unknown, label: string): void {
  if (value === null || typeof value !== "object") {
    throw new TypeError(`${label} must be an object`);
  }
}
