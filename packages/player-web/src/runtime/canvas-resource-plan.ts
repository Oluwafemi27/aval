import type { CompiledManifestV01 } from "@aval/format";

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

export interface RuntimeCanvasResourceCatalogView {
  readonly ownedByteLength: number;
  readonly manifest: Readonly<CompiledManifestV01>;
}

export interface RuntimeCanvasResourcePlanInput {
  readonly catalog: RuntimeCanvasResourceCatalogView;
  readonly hostMaxRuntimeBytes?: number;
  /** Current animated-canvas backing; defaults to the logical canvas size. */
  readonly canvasBacking?: Readonly<RuntimeCanvasBackingSize>;
}

export interface RuntimeCanvasResourceAllocationSnapshot {
  readonly ownedAssetBytes: number;
  readonly animatedCanvasBackingAllocationBytes: number;
  readonly totalBytes: number;
}

export interface RuntimeCanvasResourcePlan {
  readonly effectiveCapBytes: number;
  readonly manifestCapBytes: number;
  readonly hostCapBytes: number;
  readonly ownedAssetBytes: number;
  readonly canvasBackingWidth: number;
  readonly canvasBackingHeight: number;
  readonly canvasBackingBytes: number;
  readonly animatedCanvasBackingAllocationBytes: number;
  readonly allocationSnapshot: Readonly<RuntimeCanvasResourceAllocationSnapshot>;
  readonly totalBytes: number;
}

export interface RuntimeCanvasResourceLease {
  release(): void;
}

/** Optional host bridge that keeps the animated backing inside admitted bytes. */
export interface RuntimeCanvasResourceHost {
  currentCanvasBacking(): Readonly<RuntimeCanvasBackingSize>;
  reserveCanvasResources(
    plan: Readonly<RuntimeCanvasResourcePlan>
  ): RuntimeCanvasResourceLease;
}

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

/** Admit owned asset bytes plus the single animated canvas backing. */
export function createCanvasRuntimeResourcePlan(
  input: Readonly<RuntimeCanvasResourcePlanInput>
): Readonly<RuntimeCanvasResourcePlan> {
  validateObject(input, "canvas runtime resource plan input");
  validateObject(input.catalog, "canvas runtime resource catalog");
  validatePositiveSafeInteger(
    input.catalog.ownedByteLength,
    "owned complete asset bytes"
  );
  validatePositiveSafeInteger(
    input.catalog.manifest.limits.maxRuntimeBytes,
    "manifest maxRuntimeBytes"
  );
  const hostCap = input.hostMaxRuntimeBytes ?? MAX_PLAYER_RUNTIME_BYTES;
  validatePositiveSafeInteger(hostCap, "host runtime byte cap");
  const effectiveCap = Math.min(
    MAX_PLAYER_RUNTIME_BYTES,
    input.catalog.manifest.limits.maxRuntimeBytes,
    hostCap
  );
  const selected = input.canvasBacking ?? input.catalog.manifest.canvas;
  validateObject(selected, "canvas backing dimensions");
  validatePositiveSafeInteger(selected.width, "canvas backing width");
  validatePositiveSafeInteger(selected.height, "canvas backing height");
  const rawBacking = checkedRgbaBytes(
    selected.width,
    selected.height,
    1,
    "animated canvas backing bytes"
  );
  const allocation = roundedGpuAllocationBytes(rawBacking);
  const total = checkedByteSum(
    [input.catalog.ownedByteLength, allocation],
    "canvas runtime resource total"
  );
  if (total > BigInt(effectiveCap)) {
    throw new RangeError(
      `canvas runtime resource total ${total.toString()} exceeds effective cap ${String(effectiveCap)}`
    );
  }
  const ownedAssetBytes = input.catalog.ownedByteLength;
  const animatedCanvasBackingAllocationBytes = checkedByteNumber(
    allocation,
    "animated canvas backing allocation bytes"
  );
  const totalBytes = checkedByteNumber(total, "canvas runtime resource total");
  return Object.freeze({
    effectiveCapBytes: effectiveCap,
    manifestCapBytes: input.catalog.manifest.limits.maxRuntimeBytes,
    hostCapBytes: hostCap,
    ownedAssetBytes,
    canvasBackingWidth: selected.width,
    canvasBackingHeight: selected.height,
    canvasBackingBytes: checkedByteNumber(rawBacking, "canvas backing bytes"),
    animatedCanvasBackingAllocationBytes,
    allocationSnapshot: Object.freeze({
      ownedAssetBytes,
      animatedCanvasBackingAllocationBytes,
      totalBytes
    }),
    totalBytes
  });
}

function validateObject(value: unknown, label: string): void {
  if (value === null || typeof value !== "object") {
    throw new TypeError(`${label} must be an object`);
  }
}
