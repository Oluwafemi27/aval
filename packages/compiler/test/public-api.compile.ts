import {
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
  type AvcRenditionSummary,
  type Bt709LimitedChroma,
  type CompileResult,
  type CompileStaticValidationDetails,
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
  type SourceProjectV02
} from "../src/index.js";

const direct: (input: DirectCompileOptions) => Promise<Readonly<CompileResult>> =
  compileDirectInput;
const project: (input: ProjectCompileOptions) => Promise<Readonly<CompileResult>> =
  compileProjectFile;
const directTimeoutOptions: DirectCompileOptions = {
  inputPath: "input.mov",
  outputPath: "output.rma",
  loop: [0, 1],
  alpha: "auto",
  probeTimeoutMs: 1_000,
  mediaTimeoutMs: 5_000
};
const projectTimeoutOptions: ProjectCompileOptions = {
  projectPath: "project.json",
  outputPath: "output.rma",
  probeTimeoutMs: 1_000,
  mediaTimeoutMs: 5_000
};
const parsed: CliArguments = parseCliArguments(["inspect", "asset.rma"]);
const runtime: CliRuntime = {};
const cli: Promise<number> = runCli(["--help"], runtime);
const inspection = inspectAssetFile("asset.rma");
const controller = new AbortController();
const cancelledInspection = inspectAssetFile("asset.rma", controller.signal);
const validation = validateAssetFile("asset.rma");
const cancelledValidation = validateAssetFile("asset.rma", controller.signal);
const validationReport = validateAssetReport("asset.rma");
const cancelledValidationReport = validateAssetReport("asset.rma", controller.signal);
const unpack = unpackAssetFile("asset.rma", "output");
const cancelledUnpack = unpackAssetFile("asset.rma", "output", controller.signal);
const error: Error = new CompilerError("CLI_USAGE", "test");
const policy: SourceAlphaPolicy = "auto";
const normalized = null as unknown as Readonly<NormalizedSourceProject>;
const modern = null as unknown as Readonly<SourceProjectV02>;
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
const staticValidation = null as unknown as Readonly<
  CompileStaticValidationDetails
>;
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
void audit;
void avcSummary;
void decision;
void qualityStatistics;
void frameQuality;
void compositeBackground;
void compositeStatistics;
void compositeQuality;
void staticValidation;
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
