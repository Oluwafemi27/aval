export {
  CompilerError,
  diagnosticFromError,
  formatDiagnostic
} from "./diagnostics.js";
export type {
  CompilerDiagnostic,
  CompilerErrorCode,
  CompilerErrorDetails
} from "./diagnostics.js";
export {
  AVC_ENCODER_PRESETS,
  COMPILER_PROJECT_VERSION,
  DEFAULT_MEDIA_TIMEOUT_MS,
  DEFAULT_PROBE_TIMEOUT_MS,
  DEFAULT_PROCESS_TIMEOUT_MS,
  MAX_PROCESS_OUTPUT_BYTES,
  MAX_PROCESS_STDERR_BYTES
} from "./model.js";
export type {
  AvcEncoderPreset,
  AvcEncodingV03,
  AvcRateControlV03,
  CompileArtifact,
  AlphaAuditSummary,
  AlphaErrorStatistics,
  AlphaFrameQualitySummary,
  AlphaPixelLocation,
  AlphaPolicyDecision,
  AlphaQualitySummary,
  CompositeBackground,
  CompositeBackgroundQualitySummary,
  CompositeQualitySummary,
  CompileBuildDetails,
  CompileContinuityDetails,
  CompileInvocationDetails,
  CompileRenditionDetails,
  CompileResult,
  CompileSourceDetails,
  DirectArtifactOptions,
  DirectCompileOptions,
  MediaProbe,
  MediaProbeFrame,
  NormalizedAvcEncoding,
  NormalizedSourceProject,
  NormalizedSourceRenditionTarget,
  OpaqueRenditionTargetV01,
  ProcessLimits,
  ProjectArtifactOptions,
  ProjectCompileOptions,
  SourceDescriptorV01,
  SourceAlphaPolicy,
  SourceAvcProfileV02,
  SourceAvcProfileV03,
  SourceProjectV01,
  SourceProjectV02,
  SourceProjectV03,
  SourceRangeV01,
  SourceRenditionTargetV02,
  SourceRenditionTargetV03,
  SourceStateV01,
  SourceUnitV01,
  ToolProvenance
} from "./model.js";
export { HELP_TEXT, runCli } from "./cli.js";
export type { CliRuntime } from "./cli.js";
export { parseCliArguments } from "./cli-args.js";
export type {
  CliArguments,
  CompileCliArguments,
  DevCliArguments,
  HelpCliArguments,
  InitCliArguments,
  InspectCliArguments,
  UnpackCliArguments,
  ValidateCliArguments
} from "./cli-args.js";
export { compileDirectInput } from "./compile/direct-compiler.js";
export { compileProjectFile } from "./compile/project-compiler.js";
export {
  bt709LimitedAlphaLuma,
  bt709LimitedChroma2x2,
  bt709LimitedLuma,
  roundSignedRatio
} from "./compile/bt709-limited.js";
export type { Bt709LimitedChroma } from "./compile/bt709-limited.js";
export {
  packRgbaToPlanarYuv420
} from "./compile/packed-yuv420.js";
export type {
  PackedPlanarYuv420Frame,
  PackRgbaToPlanarYuv420Input,
  PlanarYuv420Plane,
  PlanarYuv420Planes
} from "./compile/packed-yuv420.js";
export { dilateTransparentRgba } from "./compile/rgba-dilation.js";
export type { RgbaDilationInput } from "./compile/rgba-dilation.js";
export {
  inspectAssetFile,
  unpackAssetFile,
  validateAssetFile,
  validateAssetReport
} from "./commands/asset.js";
export type {
  AssetInspection,
  AssetValidationReport,
  AvcRenditionSummary,
  InspectedAccessUnitRange,
  OpaqueRenditionSummary,
  UnpackReport
} from "./commands/asset.js";
export { startDevCommand } from "./commands/dev.js";
export {
  createCompileAdoptionSummary,
  formatCompileAdoptionSummary,
  type CompileAdoptionSummary,
  type CompileAdoptionUnitSummary
} from "./adoption-summary.js";
export type {
  DevBuildEvent,
  DevCommandDependencies,
  DevFailureEvent,
  DevSession,
  WatchHandle
} from "./commands/dev.js";
export type {
  CompileCommandDependencies,
  CompileCommandResult
} from "./commands/compile.js";
