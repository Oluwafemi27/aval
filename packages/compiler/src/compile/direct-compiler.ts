import { basename, dirname, extname, resolve } from "node:path";

import {
  FORMAT_DEFAULT_BUDGETS,
  FormatError,
  avcCodecForLevel,
  writeCanonicalAsset,
  type AvcRenditionGeometry,
  type AccessUnitInputV01,
  type CanonicalAssetInputV01,
  type UnitInputV01
} from "@aval/format";

import { CompilerError } from "../diagnostics.js";
import {
  discoverFfmpeg,
  verifyFfmpegProvenance
} from "../ffmpeg/discovery.js";
import { mediaTimeout, type FfmpegFrameInput } from "../ffmpeg/encode-unit.js";
import {
  createProbeMediaInvocation,
  createProbePngSequenceInvocation,
  probeMedia,
  probePngSequence,
  probeTimeout
} from "../ffmpeg/probe.js";
import { inspectPngSequence } from "../input/png-sequence.js";
import { resolveExistingLocalFile } from "../local-path.js";
import type {
  CompileArtifact,
  CompileContinuityDetails,
  CompileInvocationDetails,
  CompileResult,
  DirectArtifactOptions,
  DirectCompileOptions,
  MediaProbe,
  NormalizedAvcEncoding
} from "../model.js";
import {
  validateAvcEncoding
} from "./avc-encoding-policy.js";
import { analyzeSeam } from "./seam-analysis.js";
import { buildAvcManifestRendition } from "./avc-manifest-rendition.js";
import { compileAvcRendition } from "./avc-rendition-pipeline.js";
import {
  resolveDirectCanvas,
  type DirectCanvas
} from "./direct-canvas.js";
import { buildDirectFramePlan } from "./frame-plan.js";
import { sha256Concat, sha256Hex } from "./hash.js";
import { normalizeHoldTimeline } from "./normalize-timeline.js";
import { resolveAlphaPolicy } from "./alpha-policy.js";
import { ffmpegGenerator, writeAssetAtomic } from "./output.js";
import { validateCompiledOutput } from "./output-validation.js";
import {
  fingerprintSourceInputs,
  verifySourceInputFingerprints,
  type SourceInputFingerprint,
  type SourceNormalizationReport
} from "./project-source.js";
import {
  materializeNormalizedRgbaSource,
  readCanonicalRgbaRange
} from "./rgba-spool.js";
import { toolchainInvocations } from "./toolchain-invocations.js";

const DEFAULT_BITRATE = Object.freeze({
  average: 2_000_000,
  peak: 3_000_000
});

/** Compile the one-command intro + partial-loop opaque path. */
export async function compileDirectInput(
  options: DirectCompileOptions
): Promise<Readonly<CompileResult>> {
  const outputPath = resolve(options.outputPath);
  const artifact = await buildDirectArtifact(options);
  await writeAssetAtomic(outputPath, artifact.assetBytes, options.signal);
  return Object.freeze({
    outputPath,
    bytes: artifact.bytes,
    sha256: artifact.sha256,
    provenance: artifact.provenance,
    warnings: artifact.warnings,
    buildDetails: artifact.buildDetails
  });
}

/** Build and validate a direct-input artifact without publishing a destination. */
export async function buildDirectArtifact(
  options: DirectArtifactOptions
): Promise<Readonly<CompileArtifact>> {
  probeTimeout(options.probeTimeoutMs);
  mediaTimeout(options.mediaTimeoutMs);
  const inputPath = resolve(options.inputPath);
  const provenance = await discoverFfmpeg(
    options.ffmpegPath,
    options.signal,
    options.ffprobePath
  );
  const source = await resolveDirectSource(
    options,
    inputPath,
    provenance.ffprobeExecutable
  );
  const sourceProbe = source.probe;
  const sourceInput = source.input;
  let probe = sourceProbe;
  const canvas = resolveDirectCanvas(
    probe,
    options.canvas,
    sourceInput.type === "png-sequence"
  );
  let cleanup: (() => Promise<void>) | undefined;
  let sourceFrameByProjectFrame: readonly number[] | undefined;
  let duplicatedSourceFrames: readonly number[] = Object.freeze([]);
  let droppedSourceFrames: readonly number[] = Object.freeze([]);
  const normalizationWarnings: string[] = [];
  const invocations: CompileInvocationDetails[] = [
    ...toolchainInvocations("discover"),
    ...source.invocations
  ];
  const normalizeVideo =
    sourceInput.type === "video" && options.fps !== undefined;
  if (probe.variableFrameRate || normalizeVideo) {
    if (options.fps === undefined) {
      throw new CompilerError(
        "VFR_UNSUPPORTED",
        "Variable-frame-rate input requires an explicit --fps"
      );
    }
    const timeline = normalizeHoldTimeline(
      probe.frames,
      options.fps,
      probe.timeBase
    );
    sourceFrameByProjectFrame = timeline.sourceFrameByOutputFrame;
    duplicatedSourceFrames = timeline.duplicatedSourceFrames;
    droppedSourceFrames = timeline.droppedSourceFrames;
    normalizationWarnings.push(
      `VFR normalization produced ${String(timeline.sourceFrameByOutputFrame.length)} frames`,
      `duplicated source frames: ${timeline.duplicatedSourceFrames.join(",") || "none"}`,
      `dropped source frames: ${timeline.droppedSourceFrames.join(",") || "none"}`
    );
    probe = Object.freeze({
      ...probe,
      width: canvas.width,
      height: canvas.height,
      frameRate: Object.freeze({ ...options.fps }),
      timeBase: Object.freeze({
        numerator: options.fps.denominator,
        denominator: options.fps.numerator
      }),
      frameCount: timeline.sourceFrameByOutputFrame.length,
      durationMicros: framesToRoundedMicros(
        timeline.sourceFrameByOutputFrame.length,
        options.fps
      ),
      variableFrameRate: false,
      frames: Object.freeze([])
    });
  }
  try {
  const plan = buildDirectFramePlan(
    probe,
    options.loop,
    options.fps,
    false
  );
  const encoding = resolveDirectEncoding(options);
  const projectFrames = frameIndexes(options.loop[1]);
  const nativeFrames = projectFrames.map((frame) =>
    sourceFrameByProjectFrame?.[frame] ?? frame
  );
  const materialized = await materializeNormalizedRgbaSource({
    source: sourceInput,
    probe: sourceProbe,
    frameRate: plan.frameRate,
    outputWidth: canvas.width,
    outputHeight: canvas.height,
    sourceFrameByOutputFrame: nativeFrames,
    alphaReferences: projectFrames.map((frame) => Object.freeze({
      source: "direct",
      frame
    })),
    executable: provenance.executable,
    ...(options.mediaTimeoutMs === undefined
      ? {}
      : { timeoutMs: options.mediaTimeoutMs }),
    ...(options.signal === undefined ? {} : { signal: options.signal })
  });
  cleanup = materialized.cleanup;
  const alphaPolicy = resolveAlphaPolicy(
    options.alpha ?? "auto",
    materialized.alphaAudit
  );
  invocations.push(Object.freeze({
    operation: "materialize-rgba:direct",
    tool: "ffmpeg" as const,
    arguments: redactArguments(
      materialized.invocation.arguments,
      [[sourceInput.path, "$SOURCE/direct"]]
    )
  }));
  await verifySourceInputFingerprints(
    source.root,
    source.files,
    source.inputFiles,
    options.signal
  );
  const compilerSource = materialized.input;
  const retained = await readRetainedCanonicalFrames(
    compilerSource,
    materialized.frameCount,
    retainedFrameIndexes(options.loop),
    options.signal
  );
  const seamFrames = seamWindow(options.loop, retained);
  const seam = analyzeSeam({
    width: canvas.width,
    height: canvas.height,
    frames: seamFrames.frames,
    boundaryAfter: seamFrames.boundaryAfter
  });
  const continuity: CompileContinuityDetails[] = [continuityDetails({
    name: "body.default loop",
    kind: "loop",
    fromUnit: "body.default",
    fromFrame: options.loop[1] - 1,
    toUnit: "body.default",
    toFrame: options.loop[0],
    result: seam
  })];
  if (seam.repeatedEndpointPause) {
    throw new CompilerError(
      "CONTINUITY_FAILED",
      "Loop repeats an identical endpoint frame, which would create a visible pause",
      { hint: "Use a half-open loop range without duplicating its first frame at the end." }
    );
  }
  if (!seam.passes) {
    throw new CompilerError(
      "CONTINUITY_FAILED",
      `Loop boundary RMS ${seam.boundaryRms.toFixed(6)} exceeds neighboring motion ${seam.neighborP95.toFixed(6)}`,
      {
        hint: "Author a closed rendered loop, or describe the authored ranges and states in a project to preserve the source with a visual-review warning."
      }
    );
  }
  if (options.loop[0] > 0) {
    const introFrames = introBoundaryWindow(options.loop[0], retained);
    const introSeam = analyzeSeam({
      width: canvas.width,
      height: canvas.height,
      frames: introFrames.frames,
      boundaryAfter: introFrames.boundaryAfter
    });
    continuity.push(continuityDetails({
      name: "intro.default intro",
      kind: "intro",
      fromUnit: "intro.default",
      fromFrame: options.loop[0] - 1,
      toUnit: "body.default",
      toFrame: options.loop[0],
      result: introSeam
    }));
    if (introSeam.repeatedEndpointPause) {
      throw new CompilerError(
        "CONTINUITY_FAILED",
        "Intro repeats its endpoint at the loop entrance"
      );
    }
    if (!introSeam.passes) {
      throw new CompilerError(
        "CONTINUITY_FAILED",
        `Intro-to-loop RMS ${introSeam.boundaryRms.toFixed(6)} exceeds neighboring motion ${introSeam.neighborP95.toFixed(6)}`
      );
    }
  }

  const accessUnits: AccessUnitInputV01[] = [];
  let cumulativePayloadBytes = 0;
  const units: UnitInputV01[] = [];
  const renditionId = "avc.1x";
  const compiled = await compileAvcRendition({
    rendition: {
      id: renditionId,
      width: canvas.width,
      height: canvas.height,
      avcProfileVersion: encoding.legacyZeroLatency ? "v0" : "v1",
      encoding
    },
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    selectedAlphaProfile: alphaPolicy.selected,
    frameRate: plan.frameRate,
    units: plan.units.map((unit) => Object.freeze({
      id: unit.id,
      source: compilerSource,
      sourceToken: "$SPOOL/direct",
      startFrame: unit.startFrame,
      endFrame: unit.endFrame
    })),
    executable: provenance.executable,
    ...(options.mediaTimeoutMs === undefined
      ? {}
      : { timeoutMs: options.mediaTimeoutMs }),
    ...(options.signal === undefined ? {} : { signal: options.signal })
  });
  invocations.push(...compiled.invocations);
  const prepared = compiled.prepared;
  const samplesByUnit = new Map(
    prepared.units.map((unit) => [unit.id, unit.accessUnits])
  );
  for (const unit of plan.units) {
    const samples = samplesByUnit.get(unit.id)!;
    for (let frameIndex = 0; frameIndex < samples.length; frameIndex += 1) {
      const sample = samples[frameIndex]!;
      cumulativePayloadBytes = checkedMediaSum(
        cumulativePayloadBytes,
        sample.bytes.byteLength,
        "encoded payload bytes"
      );
      if (
        cumulativePayloadBytes > FORMAT_DEFAULT_BUDGETS.maxFileBytes
      ) {
        throw new CompilerError(
          "OUTPUT_LIMIT",
          "Encoded payloads exceed the compiled-file budget"
        );
      }
      accessUnits.push(Object.freeze({
        rendition: renditionId,
        unit: unit.id,
        frameIndex,
        key: sample.key,
        bytes: sample.bytes
      }));
    }
    const sampleDigest = sha256Concat(samples.map(({ bytes }) => bytes));
    if (unit.kind === "body") {
      units.push(Object.freeze({
        id: unit.id,
        kind: "body",
        playback: "loop",
        frameCount: unit.frameCount,
        ports: Object.freeze([{
          id: "default",
          entryFrame: 0 as const,
          portalFrames: Object.freeze([unit.frameCount - 1])
        }]),
        samples: Object.freeze([{
          rendition: renditionId,
          sha256: sampleDigest
        }])
      }));
    } else {
      units.push(Object.freeze({
        id: unit.id,
        kind: "one-shot",
        frameCount: unit.frameCount,
        samples: Object.freeze([{
          rendition: renditionId,
          sha256: sampleDigest
        }])
      }));
    }
  }

  const input = directAssetInput(
    canvas,
    plan.frameRate,
    compiled.bitrate,
    units,
    accessUnits,
    renditionId,
    compiled.geometry,
    avcCodecForLevel(prepared.inspection.parameterSet.levelIdc)
  );
  let bytes: Uint8Array;
  try {
    bytes = writeCanonicalAsset(input);
    validateCompiledOutput(bytes);
  } catch (error) {
    if (error instanceof FormatError) {
      throw new CompilerError("ASSET_INVALID", error.message, { cause: error });
    }
    throw error;
  }
  await verifyFfmpegProvenance(provenance, options.signal);
  invocations.push(...toolchainInvocations("verify"));
  const warnings = Object.freeze([
    ...normalizationWarnings,
    ...plan.warnings,
    ...alphaPolicy.warnings
  ]);
  const normalization: SourceNormalizationReport =
    sourceFrameByProjectFrame === undefined
      ? Object.freeze({
          mode: "exact" as const,
          projectFrameCount: probe.frameCount,
          selectedProjectFrames: projectFrames,
          selectedNativeFrames: Object.freeze([...nativeFrames])
        })
      : Object.freeze({
          mode: "normalize-hold" as const,
          projectFrameCount: probe.frameCount,
          selectedProjectFrames: projectFrames,
          selectedNativeFrames: Object.freeze([...nativeFrames]),
          duplicatedSourceFrames,
          droppedSourceFrames
        });
  const encodedPayloadBytes = accessUnits.reduce(
    (total, sample) => checkedMediaSum(
      total,
      sample.bytes.byteLength,
      "encoded payload bytes"
    ),
    0
  );
  const artifactBytes = bytes.slice();
  return Object.freeze({
    assetBytes: artifactBytes,
    bytes: artifactBytes.byteLength,
    sha256: sha256Hex(artifactBytes),
    provenance,
    warnings,
    buildDetails: Object.freeze({
      detailsVersion: "0.2" as const,
      mode: source.mode,
      projectFile: null,
      alphaPolicy,
      manifest: input.manifest,
      sources: Object.freeze([Object.freeze({
        id: "direct",
        type: source.mode,
        width: sourceProbe.width,
        height: sourceProbe.height,
        frameCount: sourceProbe.frameCount,
        frameRate: sourceProbe.frameRate,
        timeBase: sourceProbe.timeBase,
        durationMicros: sourceProbe.durationMicros,
        pixelFormat: sourceProbe.pixelFormat,
        hasAlpha: sourceProbe.hasAlpha,
        variableFrameRate: sourceProbe.variableFrameRate,
        frames: sourceProbe.frames,
        inputFiles: source.inputFiles,
        normalization,
        alphaAudit: materialized.alphaAudit,
        warnings: Object.freeze(normalizationWarnings)
      })]),
      renditions: Object.freeze([Object.freeze({
        id: renditionId,
        profile: compiled.geometry.profile,
        geometry: compiled.geometry,
        codedWidth: compiled.geometry.codedWidth,
        codedHeight: compiled.geometry.codedHeight,
        bitrate: compiled.bitrate,
        encoding: compiled.encoding,
        encodedBytes: encodedPayloadBytes,
        accessUnits: accessUnits.length,
        inspection: prepared.inspection,
        canonicalizations: prepared.canonicalizations,
        pixelPipeline: Object.freeze({
          yuvProfile: "bt709-limited-yuv420p-v0" as const,
          dilation: "nearest-radius-4-v0" as const
        }),
        alphaQuality: compiled.alphaQuality,
        compositeQuality: compiled.compositeQuality
      })]),
      invocations: Object.freeze(invocations),
      accessUnits: accessUnits.length,
      encodedPayloadBytes,
      normalization: Object.freeze(normalizationWarnings),
      continuity: Object.freeze(continuity)
    })
  });
  } finally {
    await cleanup?.();
  }
}

function directAssetInput(
  canvas: Readonly<DirectCanvas>,
  frameRate: MediaProbe["frameRate"],
  bitrate: { readonly average: number; readonly peak: number },
  units: readonly UnitInputV01[],
  accessUnits: readonly AccessUnitInputV01[],
  renditionId: string,
  geometry: Readonly<AvcRenditionGeometry>,
  codec: ReturnType<typeof avcCodecForLevel>
): CanonicalAssetInputV01 {
  const bootstrapUnits = units.map(({ id }) => id).sort();
  const decodedPixelBytes = geometry.codedRgbaBytes;
  const encodedBytes = accessUnits.reduce(
    (total, sample) => checkedMediaSum(
      total,
      sample.bytes.byteLength,
      "encoded payload bytes"
    ),
    0
  );
  const decoderRingBytes = checkedMediaProduct(
    decodedPixelBytes,
    13,
    "direct decoder ring bytes"
  );
  const runtimeWorkingSetBytes = checkedMediaSum(
    decoderRingBytes,
    encodedBytes,
    "direct runtime working-set bytes"
  );
  return {
    manifest: {
      formatVersion: "0.1",
      generator: ffmpegGenerator(),
      canvas: {
        width: canvas.width,
        height: canvas.height,
        fit: "contain",
        pixelAspect: [1, 1],
        colorSpace: "srgb"
      },
      frameRate,
      renditions: [buildAvcManifestRendition({
        id: renditionId,
        codec,
        geometry,
        bitrate
      })],
      units,
      initialState: "default",
      states: [{
        id: "default",
        bodyUnit: "body.default",
        ...(units.some(({ id }) => id === "intro.default")
          ? { initialUnit: "intro.default" }
          : {})
      }],
      edges: [],
      bindings: [],
      readiness: {
        policy: "all-routes",
        bootstrapUnits,
        immediateEdges: []
      },
      limits: {
        maxCompiledBytes: FORMAT_DEFAULT_BUDGETS.maxFileBytes,
        maxRuntimeBytes: Number.MAX_SAFE_INTEGER,
        decodedPixelBytes,
        persistentCacheBytes: 0,
        runtimeWorkingSetBytes
      }
    },
    accessUnits
  };
}

async function resolveDirectSource(
  options: DirectArtifactOptions,
  inputPath: string,
  ffprobe: string
): Promise<{
  readonly input: FfmpegFrameInput;
  readonly probe: Readonly<MediaProbe>;
  readonly root: string;
  readonly files: readonly string[];
  readonly inputFiles: readonly SourceInputFingerprint[];
  readonly mode: "direct-video" | "direct-png-sequence";
  readonly invocations: readonly CompileInvocationDetails[];
}> {
  if (inputPath.includes("%")) {
    if (options.fps === undefined) {
      throw new CompilerError("INPUT_INVALID", "PNG patterns require --fps");
    }
    if (options.frames === undefined) {
      throw new CompilerError(
        "INPUT_INVALID",
        "PNG patterns require an explicit frame selection"
      );
    }
    const sequence = await inspectPngSequence(
      dirname(inputPath),
      basename(inputPath),
      options.frames.firstNumber,
      options.frames.frameCount,
      options.signal
    );
    const root = dirname(inputPath);
    const inputFiles = await fingerprintSourceInputs(
      root,
      sequence.files,
      options.signal
    );
    const probeInvocation = createProbePngSequenceInvocation(
      sequence.pattern,
      sequence.firstFileNumber,
      options.fps,
      options.frames.frameCount
    );
    const input: FfmpegFrameInput = {
      type: "png-sequence",
      path: sequence.pattern,
      firstFileNumber: sequence.firstFileNumber,
      frameRate: options.fps
    };
    const probe = await probePngSequence(
      sequence.pattern,
      sequence.firstFileNumber,
      options.fps,
      ffprobe,
      options.signal,
      options.frames.frameCount,
      options.probeTimeoutMs
    );
    if (probe.frameCount !== sequence.frameCount) {
      throw new CompilerError(
        "FFMPEG_FAILED",
        "PNG scan and FFprobe frame counts disagree"
      );
    }
    return {
      input,
      probe,
      root,
      files: sequence.files,
      inputFiles,
      mode: "direct-png-sequence",
      invocations: Object.freeze([Object.freeze({
        operation: "probe:direct",
        tool: "ffprobe" as const,
        arguments: redactArguments(
          probeInvocation.arguments,
          [[sequence.pattern, "$SOURCE/direct"]]
        )
      })])
    };
  }
  if (!new Set([".mov", ".mp4", ".m4v"]).has(extname(inputPath).toLowerCase())) {
    throw new CompilerError(
      "INPUT_INVALID",
      "Direct video input must use .mov, .mp4, or .m4v"
    );
  }
  const resolvedInput = await resolveExistingLocalFile(
    dirname(inputPath),
    inputPath,
    false
  );
  const input: FfmpegFrameInput = { type: "video", path: resolvedInput };
  const root = dirname(inputPath);
  const files = Object.freeze([resolvedInput]);
  const inputFiles = await fingerprintSourceInputs(root, files, options.signal);
  const probeInvocation = createProbeMediaInvocation(resolvedInput);
  const probe = await probeMedia(
    resolvedInput,
    ffprobe,
    options.signal,
    options.probeTimeoutMs
  );
  return {
    input,
    probe,
    root,
    files,
    inputFiles,
    mode: "direct-video",
    invocations: Object.freeze([Object.freeze({
      operation: "probe:direct",
      tool: "ffprobe" as const,
      arguments: redactArguments(
        probeInvocation.arguments,
        [[resolvedInput, "$SOURCE/direct"]]
      )
    })])
  };
}

function redactArguments(
  arguments_: readonly string[],
  replacements: readonly (readonly [path: string, token: string])[]
): readonly string[] {
  return Object.freeze(arguments_.map((argument) => {
    let redacted = argument;
    for (const [path, token] of replacements) {
      redacted = redacted.split(path).join(token);
    }
    return redacted;
  }));
}

function continuityDetails(input: {
  readonly name: string;
  readonly kind: "loop" | "intro";
  readonly fromUnit: string;
  readonly fromFrame: number;
  readonly toUnit: string;
  readonly toFrame: number;
  readonly result: ReturnType<typeof analyzeSeam>;
}): CompileContinuityDetails {
  return Object.freeze({
    name: input.name,
    kind: input.kind,
    status: "pass" as const,
    from: Object.freeze({
      unit: input.fromUnit,
      frame: input.fromFrame,
      direction: "forward" as const
    }),
    to: Object.freeze({
      unit: input.toUnit,
      frame: input.toFrame,
      direction: "forward" as const
    }),
    metrics: Object.freeze({
      boundaryRms: input.result.boundaryRms,
      alphaBoundaryRms: input.result.alphaBoundaryRms,
      neighborP95: input.result.neighborP95,
      alphaNeighborP95: input.result.alphaNeighborP95,
      identicalBoundary: input.result.identicalBoundary,
      repeatedEndpointPause: input.result.repeatedEndpointPause
    })
  });
}

function retainedFrameIndexes(loop: readonly [number, number]): Set<number> {
  const [start, end] = loop;
  const result = new Set<number>([start]);
  for (let frame = Math.max(0, start - 5); frame < start; frame += 1) {
    result.add(frame);
  }
  for (let frame = Math.max(start, end - 5); frame < end; frame += 1) {
    result.add(frame);
  }
  for (let frame = start; frame < Math.min(end, start + 5); frame += 1) {
    result.add(frame);
  }
  return result;
}

function introBoundaryWindow(
  loopStart: number,
  frames: ReadonlyMap<number, Uint8Array>
): { readonly frames: readonly Uint8Array[]; readonly boundaryAfter: number } {
  const ordered: Uint8Array[] = [];
  for (let frame = Math.max(0, loopStart - 5); frame < loopStart; frame += 1) {
    ordered.push(requiredFrame(frames, frame));
  }
  const boundaryAfter = ordered.length - 1;
  for (let frame = loopStart; frame < loopStart + 5; frame += 1) {
    if (!frames.has(frame)) break;
    ordered.push(requiredFrame(frames, frame));
  }
  return { frames: Object.freeze(ordered), boundaryAfter };
}

async function readRetainedCanonicalFrames(
  source: Extract<FfmpegFrameInput, { readonly type: "raw-rgba" }>,
  frameCount: number,
  indexes: ReadonlySet<number>,
  signal?: AbortSignal
): Promise<ReadonlyMap<number, Uint8Array>> {
  const frames = new Map<number, Uint8Array>();
  for (const index of [...indexes].sort((left, right) => left - right)) {
    const [frame] = await readCanonicalRgbaRange({
      source,
      frameCount,
      startFrame: index,
      endFrame: index + 1,
      ...(signal === undefined ? {} : { signal })
    });
    if (frame === undefined) {
      throw new CompilerError("IO_FAILED", "Canonical frame is missing");
    }
    frames.set(index, frame);
  }
  return frames;
}

function framesToRoundedMicros(
  frameCount: number,
  frameRate: MediaProbe["frameRate"]
): number {
  const denominator = BigInt(frameRate.numerator);
  const numerator =
    BigInt(frameCount) * BigInt(frameRate.denominator) * 1_000_000n;
  const rounded = (numerator + denominator / 2n) / denominator;
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new CompilerError("SOURCE_LIMIT", "Normalized duration is too large");
  }
  return Number(rounded);
}

function seamWindow(
  loop: readonly [number, number],
  frames: ReadonlyMap<number, Uint8Array>
): { readonly frames: readonly Uint8Array[]; readonly boundaryAfter: number } {
  const [start, end] = loop;
  const ordered: Uint8Array[] = [];
  for (let frame = Math.max(start, end - 5); frame < end; frame += 1) {
    ordered.push(requiredFrame(frames, frame));
  }
  const boundaryAfter = ordered.length - 1;
  for (let frame = start; frame < Math.min(end, start + 5); frame += 1) {
    ordered.push(requiredFrame(frames, frame));
  }
  return { frames: Object.freeze(ordered), boundaryAfter };
}

function requiredFrame(
  frames: ReadonlyMap<number, Uint8Array>,
  index: number
): Uint8Array {
  const frame = frames.get(index);
  if (frame === undefined) {
    throw new CompilerError("IO_FAILED", `Frame ${String(index)} was not retained`);
  }
  return frame;
}

function validateBitrate(value: {
  readonly average: number;
  readonly peak: number;
}): { readonly average: number; readonly peak: number } {
  if (
    !Number.isSafeInteger(value.average) ||
    !Number.isSafeInteger(value.peak) ||
    value.average < 1 ||
    value.peak < value.average
  ) {
    throw new CompilerError(
      "INPUT_INVALID",
      "Bitrate must use positive safe integers with average <= peak"
    );
  }
  return Object.freeze({ ...value });
}

function resolveDirectEncoding(
  options: Readonly<DirectArtifactOptions>
): Readonly<NormalizedAvcEncoding> {
  if (options.crf !== undefined) {
    if (options.bitrate !== undefined) {
      throw new CompilerError(
        "INPUT_INVALID",
        "Direct CRF and bitrate modes are mutually exclusive"
      );
    }
    if (options.maxBitrate === undefined) {
      throw new CompilerError(
        "INPUT_INVALID",
        "Direct CRF mode requires maxBitrate"
      );
    }
    return validateAvcEncoding({
      codec: "h264",
      preset: options.preset ?? "medium",
      legacyZeroLatency: false,
      rateControl: {
        mode: "crf",
        crf: options.crf,
        maxBitrate: options.maxBitrate
      }
    });
  }
  if (options.maxBitrate !== undefined) {
    throw new CompilerError(
      "INPUT_INVALID",
      "Direct maxBitrate is valid only with CRF mode"
    );
  }
  const bitrate = validateBitrate(options.bitrate ?? DEFAULT_BITRATE);
  const preset = options.preset ?? "medium";
  return validateAvcEncoding({
    codec: "h264",
    preset,
    legacyZeroLatency: preset === "medium",
    rateControl: {
      mode: "abr",
      averageBitrate: bitrate.average,
      maxBitrate: bitrate.peak
    }
  });
}

function frameIndexes(frameCount: number): readonly number[] {
  if (
    !Number.isSafeInteger(frameCount) ||
    frameCount < 1 ||
    frameCount > 0xffff_ffff
  ) {
    throw new CompilerError(
      "SOURCE_LIMIT",
      "Direct frame selection cannot be represented by a JavaScript array"
    );
  }
  try {
    return Object.freeze(Array.from({ length: frameCount }, (_, frame) => frame));
  } catch (error) {
    throw new CompilerError(
      "SOURCE_LIMIT",
      `Could not allocate the ${String(frameCount)}-frame direct selection`,
      { cause: error }
    );
  }
}

function checkedMediaSum(left: number, right: number, label: string): number {
  if (
    !Number.isSafeInteger(left) ||
    !Number.isSafeInteger(right) ||
    left < 0 ||
    right < 0 ||
    left > Number.MAX_SAFE_INTEGER - right
  ) {
    throw new CompilerError("SOURCE_LIMIT", `${label} exceeds safe arithmetic`);
  }
  return left + right;
}

function checkedMediaProduct(left: number, right: number, label: string): number {
  if (
    !Number.isSafeInteger(left) ||
    !Number.isSafeInteger(right) ||
    left < 0 ||
    right < 0 ||
    (right !== 0 && left > Math.floor(Number.MAX_SAFE_INTEGER / right))
  ) {
    throw new CompilerError("SOURCE_LIMIT", `${label} exceeds safe arithmetic`);
  }
  return left * right;
}
