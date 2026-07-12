import {
  RuntimeAssetCatalog,
  installRuntimeAssetCatalog
} from "./asset-catalog.js";
import { MAX_PLAYER_RUNTIME_BYTES } from "./checked-runtime-bytes.js";
import {
  RuntimePlaybackError,
  normalizeRuntimeFailure
} from "./errors.js";
import type { IntegratedCandidateFactory } from "./integrated-player-contracts.js";
import {
  captureRuntimeCanvasResourceHost,
  createStaticRuntimeResourcePlan,
  type RuntimeCanvasResourceHost,
  type RuntimeCanvasResourceLease
} from "./static-resource-plan.js";

export interface IntegratedPlayerResourceAdmission {
  readonly catalog: RuntimeAssetCatalog;
  readonly hostMaxRuntimeBytes: number | null;
  readonly staticResourceLease: RuntimeCanvasResourceLease | null;
}

/** Admit owned bytes and the complete static peak as one constructor transaction. */
export function admitIntegratedPlayerResources(input: Readonly<{
  readonly bytes: Uint8Array;
  readonly candidateFactory: IntegratedCandidateFactory;
  readonly hostMaxRuntimeBytes?: number;
}>): Readonly<IntegratedPlayerResourceAdmission> {
  const hostMaxRuntimeBytes = input.hostMaxRuntimeBytes ?? null;
  if (
    hostMaxRuntimeBytes !== null &&
    (!Number.isSafeInteger(hostMaxRuntimeBytes) || hostMaxRuntimeBytes <= 0)
  ) {
    throw new RangeError("host runtime byte policy must be a positive integer");
  }
  const preinstallCap = Math.min(
    MAX_PLAYER_RUNTIME_BYTES,
    hostMaxRuntimeBytes ?? MAX_PLAYER_RUNTIME_BYTES
  );
  if (input.bytes.byteLength > preinstallCap) {
    throw resourceAdmissionError("asset-catalog-admission");
  }

  const resourceHost = captureCanvasResourceHost(input.candidateFactory);

  const catalog = installRuntimeAssetCatalog(input.bytes);
  let staticResourceLease: RuntimeCanvasResourceLease | null = null;
  try {
    const staticResourcePlan = createStaticRuntimeResourcePlan({
      catalog,
      ...(hostMaxRuntimeBytes === null ? {} : { hostMaxRuntimeBytes }),
      ...(resourceHost === null
        ? {}
        : { canvasBacking: resourceHost.currentCanvasBacking() })
    });
    if (resourceHost !== null) {
      staticResourceLease = resourceHost.reserveCanvasResources(
        staticResourcePlan
      );
    }
    return Object.freeze({
      catalog,
      hostMaxRuntimeBytes,
      staticResourceLease
    });
  } catch (error) {
    try {
      staticResourceLease?.release();
    } catch {
      // Cleanup cannot replace the admission result.
    }
    catalog.dispose();
    if (error instanceof RuntimePlaybackError) throw error;
    throw resourceAdmissionError("static-resource-admission");
  }
}

function captureCanvasResourceHost(
  factory: IntegratedCandidateFactory
): Readonly<RuntimeCanvasResourceHost> | null {
  try {
    const host = factory.resourceHost;
    if (host === undefined) return null;
    return captureRuntimeCanvasResourceHost(host);
  } catch (error) {
    if (error instanceof RuntimePlaybackError) throw error;
    throw resourceAdmissionError("static-resource-admission");
  }
}

function resourceAdmissionError(operation: string): RuntimePlaybackError {
  return new RuntimePlaybackError(normalizeRuntimeFailure(
    "resource-rejection",
    undefined,
    { operation }
  ));
}
