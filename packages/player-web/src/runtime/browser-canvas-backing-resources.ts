import {
  checkedByteNumber,
  roundedGpuAllocationBytes
} from "./checked-runtime-bytes.js";
import type { PresentationGeometry } from "./presentation-geometry.js";
import type { RuntimeCanvasResourcePlan } from "./canvas-resource-plan.js";

export interface BrowserCanvasBackingResourceInput {
  readonly animatedAllocationBytes: number;
}

export interface BrowserCanvasBackingResourceTransition {
  /** Optional freshness proof used by asynchronous production admission. */
  readonly assertActive?: () => void;
  commit(): void;
  rollback(): void;
}

/** Synchronous transaction owner used before either canvas backing mutates. */
export interface BrowserCanvasBackingResourceHost {
  /** True when growth may await page-pressure reclamation. */
  readonly asynchronous?: boolean;
  /** Primed constructors are sync once; every later growth is async. */
  readonly asynchronousAfterInitial?: boolean;
  beginTransition(
    input: Readonly<BrowserCanvasBackingResourceInput>
  ): BrowserCanvasBackingResourceTransition |
    PromiseLike<BrowserCanvasBackingResourceTransition>;
  release(): void;
}

export interface PresentationResourceReservation {
  readonly effectiveCapBytes: number;
  readonly nonCanvasBytes: number;
  readonly maximumRawBackingBytes: number;
}

export function createPresentationResourceReservation(
  plan: Readonly<RuntimeCanvasResourcePlan>
): Readonly<PresentationResourceReservation> {
  if (plan === null || typeof plan !== "object") {
    throw new TypeError("canvas resource plan must be an object");
  }
  const effectiveCapBytes = plan.effectiveCapBytes;
  const totalBytes = plan.totalBytes;
  const animatedCanvasBackingAllocationBytes =
    plan.animatedCanvasBackingAllocationBytes;
  for (const value of [
    effectiveCapBytes,
    totalBytes,
    animatedCanvasBackingAllocationBytes
  ]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError("canvas resource plan bytes are invalid");
    }
  }
  const nonCanvasBytes = totalBytes - animatedCanvasBackingAllocationBytes;
  const allocationBudget = effectiveCapBytes - nonCanvasBytes;
  if (nonCanvasBytes < 0 || allocationBudget < 1) {
    throw new RangeError("canvas resource plan has no backing allocation budget");
  }
  const rawBacking = Math.floor(allocationBudget * 4 / 5);
  if (!Number.isSafeInteger(rawBacking) || rawBacking < 4) {
    throw new RangeError("canvas resource plan cannot hold a backing pixel");
  }
  return Object.freeze({
    effectiveCapBytes,
    nonCanvasBytes,
    maximumRawBackingBytes: rawBacking
  });
}

export function assertResourceReservations(
  reservations: Iterable<Readonly<PresentationResourceReservation>>,
  geometry: Readonly<PresentationGeometry>
): void {
  for (const reservation of reservations) {
    if (
      liveResourceTotal(reservation, geometry.byteTerms.bytesPerPlane) >
      reservation.effectiveCapBytes
    ) {
      throw new RangeError("presentation resize exceeds an admitted resource cap");
    }
  }
}

export function liveResourceTotal(
  reservation: Readonly<PresentationResourceReservation>,
  rawBytesPerPlane: number
): number {
  const allocation = checkedByteNumber(
    roundedGpuAllocationBytes(rawBytesPerPlane),
    "presentation backing allocation"
  );
  const total = reservation.nonCanvasBytes + allocation;
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new RangeError("live presentation resource total is unsafe");
  }
  return total;
}

export function canvasBackingAllocationBytes(
  geometry: Readonly<PresentationGeometry>
): number {
  return checkedByteNumber(
    roundedGpuAllocationBytes(geometry.byteTerms.bytesPerPlane),
    "presentation canvas backing allocation"
  );
}

export function safelyRollbackBackingTransition(
  transition: BrowserCanvasBackingResourceTransition | null
): void {
  if (transition === null) return;
  try {
    transition.rollback();
  } catch {
    // Canvas rollback/disposal remains authoritative over accounting cleanup.
  }
}

export function safelyReleaseBackingResources(
  resources: Readonly<BrowserCanvasBackingResourceHost> | null
): void {
  if (resources === null) return;
  try {
    resources.release();
  } catch {
    // Terminal canvas cleanup continues across a hostile accounting host.
  }
}
