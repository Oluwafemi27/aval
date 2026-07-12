import type {
  MotionGraphReadiness,
  MotionGraphResult
} from "@rendered-motion/graph";
import type { ValidatedAssetLayout } from "@rendered-motion/format";

import {
  RUNTIME_TRACE_CAPACITY,
  AvcCandidateFactory,
  BrowserFrameBackend,
  BrowserPresentationPlanes,
  FrameRenderer,
  IntegratedPlayer,
  MOTION_POLICIES,
  MotionPolicyCoordinator,
  PRESENTATION_FIT_MODES,
  computePresentationGeometry,
  OpaqueCandidateFactory,
  RendererUploadTimeoutError,
  RuntimeAssetCatalog,
  RuntimePlaybackError,
  StaticSurfaceDecodeTimeoutError,
  UNSUPPORTED_NATIVE_INFLATER,
  createBrowserAvcCandidateComposition,
  createBrowserPngNativeInflater,
  createBrowserOpaqueCandidateComposition,
  createAvcRenditionCandidates,
  createOpaqueRenditionCandidates,
  installRuntimeAssetCatalog,
  inspectAvcRenditionCandidate,
  inspectOpaqueRenditionCandidate,
  normalizeRuntimeFailure,
  summarizeStaticReason,
  translateGraphReadiness,
  type DecoderWorkerMetrics,
  type DecoderWorkerSample,
  type ManagedDecoderWorkerFrame,
  type IntegratedContentTickResult,
  type IntegratedPlayerOptions,
  type IntegratedRealtimeDriverOptions,
  type MotionPolicy,
  type MotionPolicySnapshot,
  type MotionStaticOrigin,
  type MotionPolicyTransition,
  type PresentationFit,
  type PresentationGeometry,
  type PresentationGeometryInput,
  type PresentableFrameBackend,
  type AvcCandidateFactoryOptions,
  type BrowserAvcCandidateComposition,
  type BrowserAvcCandidateCompositionOptions,
  type BrowserAvcCandidateControls,
  type BrowserFrameBackendOptions,
  type BrowserPresentationPlanesOptions,
  type BrowserPresentationPlanesSnapshot,
  type BrowserPresentationResizeInput,
  type BrowserOpaqueCandidateComposition,
  type BrowserOpaqueCandidateCompositionOptions,
  type BrowserOpaqueCandidateControls,
  type BrowserOpaqueFrameBackendOptions,
  type BrowserPngNativeInflater,
  type BrowserStaticSurfaceDecoderOptions,
  type BrowserStaticSurfaceDecoderSnapshot,
  type FrameRendererOptions,
  type FrameRendererSnapshot,
  type FrameRendererTimerHost,
  type OpaqueFrameRendererTimerHost,
  type OpaqueCandidateFactoryOptions,
  type RuntimeCandidateReport,
  type RuntimeCatalogAccessUnit,
  type RuntimeCatalogStaticFrame,
  type RuntimeFailure,
  type RuntimeFrameKey,
  type RuntimeMediaPresentation,
  type RuntimeAvcRenditionCandidate,
  type RuntimeAvcRenditionInspection,
  type RuntimeOpaqueRenditionCandidate,
  type RuntimeOpaqueRenditionInspection,
  type RuntimeReadiness,
  type RuntimeReadinessReport,
  type RuntimeReadinessResult,
  type RuntimeSchedulerSnapshot,
  type RuntimeTraceRecord,
  type StaticPngInflatePath,
  type StaticReason
} from "../index.js";

// The integrated runtime is allowed to join these three existing authorities;
// it does not publish aliases that fork any of their contracts.
export type RuntimeBoundaryAuthorities = readonly [
  MotionGraphResult,
  ValidatedAssetLayout,
  DecoderWorkerSample,
  DecoderWorkerMetrics,
  ManagedDecoderWorkerFrame
];

const readiness: RuntimeReadiness = "metadataReady";
const graphReadiness: MotionGraphReadiness = "preparing";
const translation = translateGraphReadiness(graphReadiness);
const catalogFactory: (bytes: Uint8Array) => RuntimeAssetCatalog =
  installRuntimeAssetCatalog;
const candidateFactory: typeof createOpaqueRenditionCandidates =
  createOpaqueRenditionCandidates;
const inspector: typeof inspectOpaqueRenditionCandidate =
  inspectOpaqueRenditionCandidate;
const avcCandidateFactory: typeof createAvcRenditionCandidates =
  createAvcRenditionCandidates;
const avcInspector: typeof inspectAvcRenditionCandidate =
  inspectAvcRenditionCandidate;
const catalogEntry = null as unknown as RuntimeCatalogAccessUnit;
const staticEntry = null as unknown as RuntimeCatalogStaticFrame;
const opaqueCandidate = null as unknown as RuntimeOpaqueRenditionCandidate;
const opaqueInspection = null as unknown as RuntimeOpaqueRenditionInspection;
const avcCandidate = null as unknown as RuntimeAvcRenditionCandidate;
const avcInspection = null as unknown as RuntimeAvcRenditionInspection;
const frameKey: RuntimeFrameKey = {
  rendition: "opaque",
  unit: "idle",
  localFrame: 0
};
const candidate = null as unknown as RuntimeCandidateReport;
const report = null as unknown as RuntimeReadinessReport;
const result = null as unknown as RuntimeReadinessResult;
const presentation = null as unknown as RuntimeMediaPresentation;
const scheduler = null as unknown as RuntimeSchedulerSnapshot;
const trace = null as unknown as RuntimeTraceRecord;
const reason = null as unknown as StaticReason;
const failure: RuntimeFailure = normalizeRuntimeFailure("readiness-failure");
const error: Error = new RuntimePlaybackError(failure);
const summarized = summarizeStaticReason({
  phase: "preparation",
  staticReady: true,
  deadlineExpired: false,
  hasAvcRendition: true,
  workerAvailable: true,
  rendererAvailable: true,
  candidateFailures: [failure]
});
const traceCapacity: 512 = RUNTIME_TRACE_CAPACITY;
const motionPolicies: readonly MotionPolicy[] = MOTION_POLICIES;
const motionCoordinatorConstructor: typeof MotionPolicyCoordinator =
  MotionPolicyCoordinator;
const motionSnapshot = null as unknown as MotionPolicySnapshot;
const motionTransition = null as unknown as MotionPolicyTransition;
const motionStaticOrigin = null as unknown as MotionStaticOrigin;
const presentationFits: readonly PresentationFit[] = PRESENTATION_FIT_MODES;
const presentationInput = null as unknown as PresentationGeometryInput;
const presentationGeometry: PresentationGeometry =
  computePresentationGeometry(presentationInput);
const integratedPlayerConstructor: typeof IntegratedPlayer = IntegratedPlayer;
const avcFactoryConstructor: typeof AvcCandidateFactory = AvcCandidateFactory;
const opaqueFactoryConstructor: typeof OpaqueCandidateFactory =
  OpaqueCandidateFactory;
const compatibleOpaqueFactory: typeof AvcCandidateFactory =
  OpaqueCandidateFactory;
const integratedOptions = null as unknown as IntegratedPlayerOptions;
const integratedRealtimeOptions = null as unknown as IntegratedRealtimeDriverOptions;
const opaqueFactoryOptions = null as unknown as OpaqueCandidateFactoryOptions;
const avcFactoryOptions: AvcCandidateFactoryOptions = opaqueFactoryOptions;
const compatibleOpaqueOptions: OpaqueCandidateFactoryOptions = avcFactoryOptions;
const tickResult = null as unknown as IntegratedContentTickResult;
const avcBrowserCompositionFactory:
  typeof createBrowserAvcCandidateComposition =
    createBrowserAvcCandidateComposition;
const browserCompositionFactory: typeof createBrowserOpaqueCandidateComposition =
  createBrowserOpaqueCandidateComposition;
const compatibleOpaqueCompositionFactory:
  typeof createBrowserAvcCandidateComposition =
    createBrowserOpaqueCandidateComposition;
const avcBrowserComposition = null as unknown as BrowserAvcCandidateComposition;
const avcBrowserCompositionOptions =
  null as unknown as BrowserAvcCandidateCompositionOptions;
const avcBrowserControls = null as unknown as BrowserAvcCandidateControls;
const browserComposition = null as unknown as BrowserOpaqueCandidateComposition;
const browserCompositionOptions =
  null as unknown as BrowserOpaqueCandidateCompositionOptions;
const browserControls = null as unknown as BrowserOpaqueCandidateControls;
const frameBackendConstructor: typeof BrowserFrameBackend = BrowserFrameBackend;
const presentationPlanesConstructor: typeof BrowserPresentationPlanes =
  BrowserPresentationPlanes;
const frameRendererConstructor: typeof FrameRenderer = FrameRenderer;
const frameBackendOptions = null as unknown as BrowserFrameBackendOptions;
const presentationPlanesOptions =
  null as unknown as BrowserPresentationPlanesOptions;
const presentationPlanesSnapshot =
  null as unknown as BrowserPresentationPlanesSnapshot;
const presentationResizeInput =
  null as unknown as BrowserPresentationResizeInput;
const presentableBackend = null as unknown as PresentableFrameBackend;
const browserBackendOptions = null as unknown as BrowserOpaqueFrameBackendOptions;
const rendererOptions = null as unknown as FrameRendererOptions;
const rendererSnapshot = null as unknown as FrameRendererSnapshot;
const frameRendererTimer = null as unknown as FrameRendererTimerHost;
const staticDecoderOptions =
  null as unknown as BrowserStaticSurfaceDecoderOptions;
const staticDecoderSnapshot =
  null as unknown as BrowserStaticSurfaceDecoderSnapshot;
const nativeInflaterFactory: typeof createBrowserPngNativeInflater =
  createBrowserPngNativeInflater;
const nativeInflater: Readonly<BrowserPngNativeInflater> =
  UNSUPPORTED_NATIVE_INFLATER;
const inflatePath = null as unknown as StaticPngInflatePath;
const rendererTimer = null as unknown as OpaqueFrameRendererTimerHost;
const uploadTimeout: Error = new RendererUploadTimeoutError(1);
const staticTimeout: Error = new StaticSurfaceDecodeTimeoutError(1);

void readiness;
void translation;
void catalogFactory;
void candidateFactory;
void inspector;
void avcCandidateFactory;
void avcInspector;
void catalogEntry;
void staticEntry;
void opaqueCandidate;
void opaqueInspection;
void avcCandidate;
void avcInspection;
void frameKey;
void candidate;
void report;
void result;
void presentationGeometry;
void scheduler;
void trace;
void reason;
void error;
void summarized;
void traceCapacity;
void motionPolicies;
void motionCoordinatorConstructor;
void motionSnapshot;
void motionTransition;
void motionStaticOrigin;
void presentationFits;
void presentation;
void integratedPlayerConstructor;
void avcFactoryConstructor;
void opaqueFactoryConstructor;
void compatibleOpaqueFactory;
void integratedOptions;
void integratedRealtimeOptions;
void opaqueFactoryOptions;
void avcFactoryOptions;
void compatibleOpaqueOptions;
void tickResult;
void avcBrowserCompositionFactory;
void browserCompositionFactory;
void compatibleOpaqueCompositionFactory;
void avcBrowserComposition;
void avcBrowserCompositionOptions;
void avcBrowserControls;
void browserComposition;
void browserCompositionOptions;
void browserControls;
void frameBackendConstructor;
void presentationPlanesConstructor;
void frameRendererConstructor;
void frameBackendOptions;
void presentationPlanesOptions;
void presentationPlanesSnapshot;
void presentationResizeInput;
void presentableBackend;
void browserBackendOptions;
void rendererOptions;
void rendererSnapshot;
void frameRendererTimer;
void staticDecoderOptions;
void staticDecoderSnapshot;
void nativeInflaterFactory;
void nativeInflater;
void inflatePath;
void rendererTimer;
void uploadTimeout;
void staticTimeout;

// This project compiles with `types: []`: browser runtime code cannot rely on
// Node ambient globals. Explicit browser APIs remain available through DOM.
declare const browserWorker: Worker;
declare const browserFrame: VideoFrame;
void browserWorker;
void browserFrame;
// @ts-expect-error Node ambient APIs must not cross the browser package build
declare const nodeBuffer: Buffer;
void nodeBuffer;
