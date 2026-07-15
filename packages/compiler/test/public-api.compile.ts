import {
  AVC_ENCODER_PRESETS,
  CompilerError,
  bt709LimitedAlphaLuma,
  bt709LimitedChroma2x2,
  bt709LimitedLuma,
  compileDirectInput,
  compileProjectFile,
  dilateTransparentRgba,
  inspectAssetFile,
  packRgbaToPlanarYuv420,
  parseCliArguments,
  runCli,
  roundSignedRatio,
  startDevCommand,
  unpackAssetFile,
  validateAssetFile,
  validateAssetReport,
  type CliArguments,
  type CliRuntime,
  type AlphaAuditSummary,
  type AlphaErrorStatistics,
  type AlphaFrameQualitySummary,
  type AlphaPolicyDecision,
  type AvcEncoderPreset,
  type AvcEncodingV03,
  type AvcRateControlV03,
  type AvcRenditionSummary,
  type Bt709LimitedChroma,
  type CompileResult,
  type CompositeBackground,
  type CompositeBackgroundQualitySummary,
  type CompositeQualitySummary,
  type DevSession,
  type DirectCompileOptions,
  type NormalizedSourceProject,
  type PackedPlanarYuv420Frame,
  type PlanarYuv420Planes,
  type ProjectCompileOptions,
  type SourceAlphaPolicy,
  type SourceProjectV02,
  type SourceProjectV03
} from "../src/index.js";

const direct: (input: DirectCompileOptions) => Promise<Readonly<CompileResult>> =
  compileDirectInput;
const project: (input: ProjectCompileOptions) => Promise<Readonly<CompileResult>> =
  compileProjectFile;
const directTimeoutOptions: DirectCompileOptions = {
  inputPath: "input.mov",
  outputPath: "output.avl",
  loop: [0, 1],
  alpha: "auto",
  probeTimeoutMs: 1_000,
  mediaTimeoutMs: 5_000
};
const preset: AvcEncoderPreset = "veryslow";
const rateControl: AvcRateControlV03 = {
  mode: "crf",
  crf: 20,
  maxBitrate: 10_000_000
};
const encoding: AvcEncodingV03 = {
  codec: "h264",
  preset,
  rateControl
};
const directCrfOptions: DirectCompileOptions = {
  inputPath: "input.mov",
  outputPath: "output.avl",
  loop: [0, 1],
  crf: rateControl.crf,
  maxBitrate: rateControl.maxBitrate,
  preset
};
const projectTimeoutOptions: ProjectCompileOptions = {
  projectPath: "project.json",
  outputPath: "output.avl",
  probeTimeoutMs: 1_000,
  mediaTimeoutMs: 5_000
};
const parsed: CliArguments = parseCliArguments(["inspect", "asset.avl"]);
const runtime: CliRuntime = {};
const cli: Promise<number> = runCli(["--help"], runtime);
const inspection = inspectAssetFile("asset.avl");
const controller = new AbortController();
const cancelledInspection = inspectAssetFile("asset.avl", controller.signal);
const validation = validateAssetFile("asset.avl");
const cancelledValidation = validateAssetFile("asset.avl", controller.signal);
const validationReport = validateAssetReport("asset.avl");
const cancelledValidationReport = validateAssetReport("asset.avl", controller.signal);
const unpack = unpackAssetFile("asset.avl", "output");
const cancelledUnpack = unpackAssetFile("asset.avl", "output", controller.signal);
const error: Error = new CompilerError("CLI_USAGE", "test");
const policy: SourceAlphaPolicy = "auto";
const normalized = null as unknown as Readonly<NormalizedSourceProject>;
const modern = null as unknown as Readonly<SourceProjectV02>;
const current = null as unknown as Readonly<SourceProjectV03>;
const audit = null as unknown as Readonly<AlphaAuditSummary>;
const avcSummary = null as unknown as Readonly<AvcRenditionSummary>;
const decision = null as unknown as Readonly<AlphaPolicyDecision>;
const qualityStatistics = null as unknown as Readonly<AlphaErrorStatistics>;
const frameQuality = null as unknown as Readonly<AlphaFrameQualitySummary>;
const compositeBackground: CompositeBackground = "black";
const compositeStatistics = null as unknown as Readonly<
  CompositeBackgroundQualitySummary
>;
const compositeQuality = null as unknown as Readonly<CompositeQualitySummary>;
const rounded: number = roundSignedRatio(-3, 2);
const luma: number = bt709LimitedLuma(1, 2, 3);
const alphaLuma: number = bt709LimitedAlphaLuma(128);
const chroma: Readonly<Bt709LimitedChroma> = bt709LimitedChroma2x2(
  new Uint8Array(12)
);
const dilated: Uint8Array = dilateTransparentRgba({
  width: 1,
  height: 1,
  rgba: Uint8Array.of(0, 0, 0, 0)
});
const packed = null as unknown as Readonly<PackedPlanarYuv420Frame>;
const planes: Readonly<PlanarYuv420Planes> = packed.planes;
const packer: typeof packRgbaToPlanarYuv420 = packRgbaToPlanarYuv420;

void direct;
void project;
void directTimeoutOptions;
void AVC_ENCODER_PRESETS;
void encoding;
void directCrfOptions;
void projectTimeoutOptions;
void parsed;
void cli;
void inspection;
void cancelledInspection;
void validation;
void cancelledValidation;
void validationReport;
void cancelledValidationReport;
void unpack;
void cancelledUnpack;
void error;
void policy;
void normalized;
void modern;
void current;
void audit;
void avcSummary;
void decision;
void qualityStatistics;
void frameQuality;
void compositeBackground;
void compositeStatistics;
void compositeQuality;
void rounded;
void luma;
void alphaLuma;
void chroma;
void dilated;
void planes;
void packer;

// Verify the public session shape without starting a watcher.
const sessionFactory: typeof startDevCommand = startDevCommand;
type Session = Awaited<ReturnType<typeof sessionFactory>>;
const sessionAssignable = null as unknown as Session satisfies DevSession;
void sessionAssignable;
