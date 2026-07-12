import {
  deriveAvcRenditionGeometry,
  validateCompleteAsset
} from "@rendered-motion/format";

import {
  probeM55IntegratedSupport,
  runM55IntegratedProof,
  type M55BrowserSupport,
  type M55IntegratedProofReport
} from "./m55-integrated-proof";
import {
  runContextFailureProof,
  runForcedFallbackProofs,
  runRealtimeOrdinalProof,
  runReduceBeforePrepareProof,
  type ContextFailureEvidence,
  type ForcedFallbackEvidence
} from "./m6-proof/fallback-scenarios";
import {
  runPixelMotionProof,
  type M6PixelMotionEvidence
} from "./m6-proof/pixel-motion";
import {
  ALPHA_MAE_LIMIT,
  ALPHA_P99_LIMIT,
  COMPOSITE_MAE_LIMIT,
  COMPOSITE_P99_LIMIT,
  decodeBase64,
  decodeExpectedFrames,
  deepFreeze,
  requireProof,
  type M6ExpectedSourceFrame
} from "./m6-proof/shared";

export type { M6ExpectedSourceFrame } from "./m6-proof/shared";

export interface M6BrowserSupport extends M55BrowserSupport {
  readonly profile: "avc-annexb-packed-alpha-v0";
  readonly canvas: Readonly<{ readonly width: number; readonly height: number }>;
  readonly geometry: readonly Readonly<{
    readonly id: string;
    readonly visibleColorRect: readonly [number, number, number, number];
    readonly visibleAlphaRect: readonly [number, number, number, number];
    readonly decodedStorageRect: readonly [number, number, number, number];
    readonly codedWidth: number;
    readonly codedHeight: number;
  }>[];
}

export interface M6TransparencyStaticProofReport {
  readonly status: "supported";
  readonly support: Readonly<M6BrowserSupport> & { readonly status: "supported" };
  readonly allRoutes: {
    readonly selectedRendition: string;
    readonly directEdgeCount: number;
    readonly loopCount: number;
    readonly endpointCount: number;
    readonly realtimeAdvancedTicks: number;
    readonly realtimeUnderflows: number;
    readonly manualUnderflows: number;
    readonly recoveryState: string;
    readonly recoveryReason: "animation-failure";
    readonly cleanupComplete: boolean;
  };
  readonly pixelsAndMotion: Readonly<M6PixelMotionEvidence>;
  readonly forcedFallbacks: readonly Readonly<ForcedFallbackEvidence>[];
  readonly contextFailure: Readonly<ContextFailureEvidence>;
  readonly limits: {
    readonly alphaMaeBytes: 2;
    readonly alphaP99Bytes: 8;
    readonly compositeMaeBytes: 4;
    readonly compositeP99Bytes: 16;
  };
}

export async function probeM6TransparencyStaticSupport(
  assetBase64: string
): Promise<Readonly<M6BrowserSupport>> {
  const base = await probeM55IntegratedSupport(assetBase64);
  const bytes = decodeBase64(assetBase64);
  const manifest = validateCompleteAsset({ bytes }).frontIndex.manifest;
  const renditions = manifest.renditions.filter((rendition) =>
    rendition.profile === "avc-annexb-packed-alpha-v0"
  );
  requireProof(
    renditions.length > 0 && renditions.length === manifest.renditions.length,
    "M6 browser proof requires one packed-alpha AVC rendition class"
  );
  const geometry = renditions.map((rendition) => {
    requireProof(rendition.alphaLayout.type === "stacked-v0",
      "packed-alpha rendition has no stacked layout");
    const derived = deriveAvcRenditionGeometry({
      profile: "avc-annexb-packed-alpha-v0",
      canvasWidth: manifest.canvas.width,
      canvasHeight: manifest.canvas.height,
      colorRect: rendition.alphaLayout.colorRect,
      alphaRect: rendition.alphaLayout.alphaRect,
      codedWidth: rendition.codedWidth,
      codedHeight: rendition.codedHeight
    });
    return Object.freeze({
      id: rendition.id,
      visibleColorRect: derived.visibleColorRect,
      visibleAlphaRect: derived.visibleAlphaRect!,
      decodedStorageRect: derived.decodedStorageRect,
      codedWidth: derived.codedWidth,
      codedHeight: derived.codedHeight
    });
  });
  return deepFreeze({
    ...base,
    profile: "avc-annexb-packed-alpha-v0" as const,
    canvas: { width: manifest.canvas.width, height: manifest.canvas.height },
    geometry
  });
}

export async function runM6TransparencyStaticProof(
  assetBase64: string,
  expectedFrames: readonly Readonly<M6ExpectedSourceFrame>[]
): Promise<Readonly<M6TransparencyStaticProofReport | M6BrowserSupport>> {
  const support = await probeM6TransparencyStaticSupport(assetBase64);
  if (support.status === "unsupported") return support;
  requireProof(expectedFrames.length === 30,
    "M6 proof requires all 30 fixture source PNGs");
  const expected = decodeExpectedFrames(expectedFrames, support.canvas);

  const pixelsAndMotion = await runPixelMotionProof(
    assetBase64,
    expected,
    runRealtimeOrdinalProof,
    runReduceBeforePrepareProof
  );
  const forcedFallbacks = await runForcedFallbackProofs(assetBase64);
  const contextFailure = await runContextFailureProof(assetBase64);
  const routeResult = await runM55IntegratedProof(assetBase64);
  requireProof(routeResult.status === "supported",
    "packed all-routes proof became unsupported");
  const routes = routeResult as M55IntegratedProofReport;

  return deepFreeze({
    status: "supported" as const,
    support: support as Readonly<M6BrowserSupport> & { readonly status: "supported" },
    allRoutes: {
      selectedRendition: routes.selection.selectedRendition,
      directEdgeCount: routes.readiness.directEdgeCount,
      loopCount: routes.readiness.loopCount,
      endpointCount: routes.readiness.endpointCount,
      realtimeAdvancedTicks: routes.realtime.advancedTicks,
      realtimeUnderflows: routes.realtime.underflows,
      manualUnderflows: routes.cadence.underflows,
      recoveryState: routes.recovery.staticState,
      recoveryReason: routes.recovery.reason,
      cleanupComplete:
        routes.cleanup.workerAlive === false &&
        routes.cleanup.rendererLiveResources === 0 &&
        routes.cleanup.staticRetainedSurfaces === 0 &&
        routes.cleanup.pendingCallbacks === 0 &&
        routes.cleanup.pendingPromises === 0
    },
    pixelsAndMotion,
    forcedFallbacks,
    contextFailure,
    limits: {
      alphaMaeBytes: ALPHA_MAE_LIMIT as 2,
      alphaP99Bytes: ALPHA_P99_LIMIT as 8,
      compositeMaeBytes: COMPOSITE_MAE_LIMIT as 4,
      compositeP99Bytes: COMPOSITE_P99_LIMIT as 16
    }
  });
}
