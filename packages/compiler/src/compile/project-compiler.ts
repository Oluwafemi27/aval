import { dirname, resolve } from "node:path";

import {
  FORMAT_DEFAULT_BUDGETS,
  FormatError,
  writeCanonicalAsset,
  type AccessUnitInputV01,
  type CanonicalAssetInputV01,
  type SampleDigestInputV01,
  type UnitInputV01
} from "@rendered-motion/format";

import { readBoundedRegularFile } from "../bounded-file.js";
import { CompilerError } from "../diagnostics.js";
import {
  discoverFfmpeg,
  verifyFfmpegProvenance
} from "../ffmpeg/discovery.js";
import { mediaTimeout } from "../ffmpeg/encode-unit.js";
import { probeTimeout } from "../ffmpeg/probe.js";
import type {
  CompileArtifact,
  CompileInvocationDetails,
  CompileRenditionDetails,
  CompileResult,
  NormalizedSourceProject,
  ProjectArtifactOptions,
  ProjectCompileOptions,
  SourceUnitV01
} from "../model.js";
import { parseSourceProject } from "../source-project-schema.js";
import { sha256Concat, sha256Hex } from "./hash.js";
import { compileAvcRendition } from "./avc-rendition-pipeline.js";
import {
  mergeCanonicalAlphaAudits,
  resolveAlphaPolicy
} from "./alpha-policy.js";
import { ffmpegGenerator, writeAssetAtomic } from "./output.js";
import { validateCompiledOutput } from "./output-validation.js";
import {
  encodeCanonicalRgbaPng,
  inspectCanonicalRgbaPng
} from "./png.js";
import { deriveReadiness } from "./readiness-plan.js";
import { estimateRuntimeLimits } from "./resource-estimate.js";
import { validateProjectMedia } from "./project-continuity.js";
import { toolchainInvocations } from "./toolchain-invocations.js";
import {
  cleanupProjectSources,
  prepareProjectSources,
  resolvePreparedFrameRange
} from "./project-source.js";

/** Compile one strict multi-state project through the shared M4 writer. */
export async function compileProjectFile(
  options: ProjectCompileOptions
): Promise<Readonly<CompileResult>> {
  const outputPath = resolve(options.outputPath);
  const artifact = await buildProjectArtifact(options);
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

/** Build and validate a project artifact without publishing any destination. */
export async function buildProjectArtifact(
  options: ProjectArtifactOptions
): Promise<Readonly<CompileArtifact>> {
  probeTimeout(options.probeTimeoutMs);
  mediaTimeout(options.mediaTimeoutMs);
  const projectPath = resolve(options.projectPath);
  const projectFile = await readProject(projectPath, options.signal);
  const project = projectFile.project;
  const provenance = await discoverFfmpeg(
    options.ffmpegPath,
    options.signal,
    options.ffprobePath
  );
  const sources = await prepareProjectSources({
    root: dirname(projectPath),
    sources: project.sources,
    canvas: project.canvas,
    frameRate: project.frameRate,
    sourceFrameReferences: collectSourceFrameReferences(project),
    ffmpeg: provenance.executable,
    ffprobe: provenance.ffprobeExecutable,
    ...(options.probeTimeoutMs === undefined
      ? {}
      : { probeTimeoutMs: options.probeTimeoutMs }),
    ...(options.mediaTimeoutMs === undefined
      ? {}
      : { mediaTimeoutMs: options.mediaTimeoutMs }),
    ...(options.signal === undefined ? {} : { signal: options.signal })
  });
  try {
    const alphaPolicy = resolveAlphaPolicy(
      project.alphaPolicy,
      mergeCanonicalAlphaAudits(
        [...sources.values()].map(({ alphaAudit }) => alphaAudit)
      ),
      { rejectionCode: project.alphaPolicyRejectionCode }
    );
    const media = await validateProjectMedia({
      project,
      sources,
      ffmpeg: provenance.executable,
      ...(options.signal === undefined ? {} : { signal: options.signal })
    });
    const posterPlan = buildPosters(project, media.posters);
    const accessUnits: AccessUnitInputV01[] = [];
    let cumulativePayloadBytes = posterPlan.frames.reduce(
      (total, frame) => total + frame.bytes.byteLength,
      0
    );
    let cumulativeRawEncodedBytes = cumulativePayloadBytes;
    const sampleDigests = new Map<string, SampleDigestInputV01[]>();
    const renditionDetails: CompileRenditionDetails[] = [];
    const invocations: CompileInvocationDetails[] = [
      ...toolchainInvocations("discover"),
      ...[...sources.values()]
        .flatMap(({ invocations: sourceInvocations }) => sourceInvocations)
        .map((invocation) => Object.freeze({
        operation: invocation.operation,
        tool: invocation.tool,
        arguments: invocation.arguments
        }))
    ];

    for (const rendition of project.renditions) {
      const pipelineUnits = project.units.map((unit) => {
        const source = sources.get(unit.source)!;
        const [startFrame, endFrame] = resolvePreparedFrameRange(
          source,
          unit.range[0],
          unit.range[1]
        );
        return Object.freeze({
          id: unit.id,
          source: source.input,
          sourceToken: `$SPOOL/${unit.source}`,
          startFrame,
          endFrame
        });
      });
      const compiled = await compileAvcRendition({
        rendition,
        canvasWidth: project.canvas.width,
        canvasHeight: project.canvas.height,
        selectedAlphaProfile: alphaPolicy.selected,
        frameRate: project.frameRate,
        units: pipelineUnits,
        executable: provenance.executable,
        ...(options.mediaTimeoutMs === undefined
          ? {}
          : { timeoutMs: options.mediaTimeoutMs }),
        ...(options.signal === undefined ? {} : { signal: options.signal })
      });
      invocations.push(...compiled.invocations);
      cumulativeRawEncodedBytes += compiled.rawEncodedBytes;
      if (
        !Number.isSafeInteger(cumulativeRawEncodedBytes) ||
        cumulativeRawEncodedBytes > FORMAT_DEFAULT_BUDGETS.maxFileBytes
      ) {
        throw new CompilerError(
          "OUTPUT_LIMIT",
          "Raw encoder output exceeds the compiled-file budget"
        );
      }
      const prepared = compiled.prepared;
      const encodedUnits = new Map(
        prepared.units.map((unit) => [unit.id, unit.accessUnits])
      );
      let encodedBytes = 0;
      let renditionAccessUnits = 0;
      for (const unit of project.units) {
        const samples = encodedUnits.get(unit.id)!;
        renditionAccessUnits += samples.length;
        const digests = sampleDigests.get(unit.id) ?? [];
        digests.push(Object.freeze({
          rendition: rendition.id,
          sha256: sha256Concat(samples.map(({ bytes }) => bytes))
        }));
        sampleDigests.set(unit.id, digests);
        for (let frameIndex = 0; frameIndex < samples.length; frameIndex += 1) {
          const sample = samples[frameIndex]!;
          cumulativePayloadBytes += sample.bytes.byteLength;
          encodedBytes += sample.bytes.byteLength;
          if (
            !Number.isSafeInteger(cumulativePayloadBytes) ||
            cumulativePayloadBytes > FORMAT_DEFAULT_BUDGETS.maxFileBytes
          ) {
            throw new CompilerError(
              "OUTPUT_LIMIT",
              "Encoded and static payloads exceed the compiled-file budget"
            );
          }
          accessUnits.push(Object.freeze({
            rendition: rendition.id,
            unit: unit.id,
            frameIndex,
            key: sample.key,
            bytes: sample.bytes
          }));
        }
      }
      renditionDetails.push(Object.freeze({
        id: rendition.id,
        profile: compiled.geometry.profile,
        geometry: compiled.geometry,
        codedWidth: compiled.geometry.codedWidth,
        codedHeight: compiled.geometry.codedHeight,
        bitrate: rendition.bitrate,
        encodedBytes,
        accessUnits: renditionAccessUnits,
        inspection: prepared.inspection,
        canonicalizations: prepared.canonicalizations,
        pixelPipeline: Object.freeze({
          yuvProfile: "bt709-limited-yuv420p-v0" as const,
          dilation: "nearest-radius-4-v0" as const
        }),
        alphaQuality: compiled.alphaQuality,
        compositeQuality: compiled.compositeQuality
      }));
    }

    const units = project.units.map((unit) =>
      lowerUnit(unit, Object.freeze(sampleDigests.get(unit.id) ?? []))
    );
    const assetInput = buildAssetInput({
      project,
      units,
      accessUnits,
      posters: posterPlan,
      renditions: renditionDetails
    });
    let bytes: Uint8Array;
    try {
      bytes = writeCanonicalAsset(assetInput);
      validateCompiledOutput(bytes);
    } catch (error) {
      if (error instanceof FormatError) {
        throw new CompilerError("ASSET_INVALID", error.message, { cause: error });
      }
      throw error;
    }
    await verifyFfmpegProvenance(provenance, options.signal);
    invocations.push(...toolchainInvocations("verify"));
    const sourceWarnings = [...sources.values()].flatMap(({ warnings }) => warnings);
    const publicWarnings = Object.freeze([
      ...new Set([...sourceWarnings, ...alphaPolicy.warnings])
    ]);
    const staticDetails = posterPlan.frames.map((frame) => Object.freeze({
      id: frame.id,
      bytes: frame.bytes.byteLength,
      sha256: sha256Hex(frame.bytes),
      states: Object.freeze(project.states
        .filter((state) => posterPlan.staticIdByState.get(state.id) === frame.id)
        .map(({ id }) => id)
        .sort()),
      validation: inspectCanonicalRgbaPng({
        png: frame.bytes,
        expectedWidth: project.canvas.width,
        expectedHeight: project.canvas.height
      })
    }));
    const encodedPayloadBytes = accessUnits.reduce(
      (total, sample) => total + sample.bytes.byteLength,
      0
    );
    const staticPayloadBytes = posterPlan.frames.reduce(
      (total, frame) => total + frame.bytes.byteLength,
      0
    );
    const artifactBytes = bytes.slice();
    return Object.freeze({
      assetBytes: artifactBytes,
      bytes: artifactBytes.byteLength,
      sha256: sha256Hex(artifactBytes),
      provenance,
      warnings: publicWarnings,
      buildDetails: Object.freeze({
        detailsVersion: "0.1" as const,
        mode: "project" as const,
        projectFile: Object.freeze({
          bytes: projectFile.bytes,
          sha256: projectFile.sha256
        }),
        alphaPolicy,
        manifest: assetInput.manifest,
        sources: Object.freeze(project.sources.map((source) => {
          const prepared = sources.get(source.id)!;
          return Object.freeze({
            id: source.id,
            type: source.type,
            width: prepared.sourceProbe.width,
            height: prepared.sourceProbe.height,
            frameCount: prepared.sourceProbe.frameCount,
            frameRate: prepared.sourceProbe.frameRate,
            timeBase: prepared.sourceProbe.timeBase,
            durationMicros: prepared.sourceProbe.durationMicros,
            pixelFormat: prepared.sourceProbe.pixelFormat,
            hasAlpha: prepared.sourceProbe.hasAlpha,
            variableFrameRate: prepared.sourceProbe.variableFrameRate,
            frames: prepared.sourceProbe.frames,
            inputFiles: prepared.inputFiles,
            normalization: prepared.normalization,
            alphaAudit: prepared.alphaAudit,
            warnings: prepared.warnings
          });
        })),
        renditions: Object.freeze(renditionDetails),
        statics: Object.freeze(staticDetails),
        invocations: Object.freeze(invocations),
        accessUnits: accessUnits.length,
        encodedPayloadBytes,
        staticPayloadBytes,
        normalization: Object.freeze(sourceWarnings),
        continuity: media.reports
      })
    });
  } finally {
    await cleanupProjectSources(sources);
  }
}

function collectSourceFrameReferences(
  project: NormalizedSourceProject
): ReadonlyMap<string, readonly number[]> {
  const references = new Map<string, Set<number>>(
    project.sources.map(({ id }) => [id, new Set<number>()])
  );
  const units = new Map(project.units.map((unit) => [unit.id, unit]));
  for (const unit of project.units) {
    const frames = references.get(unit.source)!;
    for (let frame = unit.range[0]; frame < unit.range[1]; frame += 1) {
      frames.add(frame);
    }
  }
  for (const state of project.states) {
    const body = units.get(state.bodyUnit)!;
    const source = state.poster?.source ?? body.source;
    const frame = state.poster?.frame ?? body.range[0];
    references.get(source)?.add(frame);
  }
  return new Map([...references].map(([source, frames]) => [
    source,
    Object.freeze([...frames].sort((left, right) => left - right))
  ]));
}

interface PosterPlan {
  readonly frames: readonly {
    readonly id: string;
    readonly bytes: Uint8Array;
  }[];
  readonly staticIdByState: ReadonlyMap<string, string>;
}

export function buildPosters(
  project: Pick<NormalizedSourceProject, "canvas" | "states">,
  rgbaByState: ReadonlyMap<string, Uint8Array>
): Readonly<PosterPlan> {
  const framesByDigest = new Map<
    string,
    { readonly id: string; readonly bytes: Uint8Array }[]
  >();
  const frames: { readonly id: string; readonly bytes: Uint8Array }[] = [];
  const staticIdByState = new Map<string, string>();
  const states = [...project.states].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  );
  for (let stateIndex = 0; stateIndex < states.length; stateIndex += 1) {
    const state = states[stateIndex]!;
    const rgba = rgbaByState.get(state.id);
    if (rgba === undefined) {
      throw new CompilerError("IO_FAILED", `Missing poster for ${state.id}`);
    }
    const bytes = encodeCanonicalRgbaPng({
      width: project.canvas.width,
      height: project.canvas.height,
      rgba
    });
    const digest = sha256Hex(bytes);
    const existing = framesByDigest.get(digest)?.find((candidate) =>
      equalBytes(candidate.bytes, bytes)
    );
    let id: string;
    if (existing !== undefined) {
      id = existing.id;
    } else {
      id = `static.${String(stateIndex).padStart(2, "0")}`;
      const frame = Object.freeze({ id, bytes });
      frames.push(frame);
      const bucket = framesByDigest.get(digest);
      if (bucket === undefined) {
        framesByDigest.set(digest, [frame]);
      } else {
        bucket.push(frame);
      }
    }
    staticIdByState.set(state.id, id);
  }
  return Object.freeze({
    frames: Object.freeze(frames),
    staticIdByState
  });
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index]);
}

function lowerUnit(
  unit: SourceUnitV01,
  samples: readonly SampleDigestInputV01[]
): UnitInputV01 {
  const frameCount = unit.range[1] - unit.range[0];
  if (unit.kind === "body") {
    return Object.freeze({
      id: unit.id,
      kind: unit.kind,
      playback: unit.playback,
      frameCount,
      ports: unit.ports,
      samples
    });
  }
  if (unit.kind === "reversible") {
    return Object.freeze({
      id: unit.id,
      kind: unit.kind,
      frameCount,
      residency: unit.residency,
      samples
    });
  }
  return Object.freeze({
    id: unit.id,
    kind: unit.kind,
    frameCount,
    samples
  });
}

function buildAssetInput(input: {
  readonly project: NormalizedSourceProject;
  readonly units: readonly UnitInputV01[];
  readonly accessUnits: readonly AccessUnitInputV01[];
  readonly posters: Readonly<PosterPlan>;
  readonly renditions: readonly CompileRenditionDetails[];
}): CanonicalAssetInputV01 {
  const readiness = deriveReadiness(input.project);
  const limits = estimateRuntimeLimits(
    input.project,
    input.accessUnits,
    input.renditions.map(({ geometry }) => geometry)
  );
  const geometryById = new Map(
    input.renditions.map(({ id, geometry }) => [id, geometry])
  );
  return {
    manifest: {
      formatVersion: "0.1",
      generator: ffmpegGenerator(),
      canvas: input.project.canvas,
      frameRate: input.project.frameRate,
      renditions: input.project.renditions.map((rendition) => {
        const geometry = geometryById.get(rendition.id);
        if (geometry === undefined) {
          throw new CompilerError("IO_FAILED", "Compiled rendition geometry is missing");
        }
        const common = {
          id: rendition.id,
          codec: "avc1.42E020" as const,
          codedWidth: geometry.codedWidth,
          codedHeight: geometry.codedHeight,
          bitrate: rendition.bitrate,
          capabilities: ["webcodecs", "webgl2"] as const
        };
        return geometry.profile === "avc-annexb-opaque-v0"
          ? {
              ...common,
              profile: geometry.profile,
              alphaLayout: {
                type: "opaque-v0" as const,
                colorRect: geometry.visibleColorRect
              }
            }
          : {
              ...common,
              profile: geometry.profile,
              alphaLayout: {
                type: "stacked-v0" as const,
                colorRect: geometry.visibleColorRect,
                alphaRect: geometry.visibleAlphaRect!
              }
            };
      }),
      units: input.units,
      staticFrames: input.posters.frames.map(({ id, bytes }) => ({
        id,
        width: input.project.canvas.width,
        height: input.project.canvas.height,
        sha256: sha256Hex(bytes)
      })),
      initialState: input.project.initialState,
      states: input.project.states.map((state) => ({
        id: state.id,
        bodyUnit: state.bodyUnit,
        staticFrame: input.posters.staticIdByState.get(state.id)!,
        ...(state.initialUnit === undefined ? {} : { initialUnit: state.initialUnit })
      })),
      edges: input.project.edges,
      bindings: input.project.bindings,
      readiness,
      fallback: {
        unsupported: "per-state-static",
        reducedMotion: "per-state-static"
      },
      limits
    },
    accessUnits: input.accessUnits,
    staticPayloads: input.posters.frames.map(({ id, bytes }) => ({
      staticFrame: id,
      bytes
    }))
  };
}

async function readProject(
  path: string,
  signal?: AbortSignal
): Promise<Readonly<{
  readonly project: NormalizedSourceProject;
  readonly bytes: number;
  readonly sha256: string;
}>> {
  const bytes = await readBoundedRegularFile({
    path,
    maxBytes: 1024 * 1024,
    label: "project JSON",
    limitCode: "SOURCE_LIMIT",
    ...(signal === undefined ? {} : { signal })
  });
  return Object.freeze({
    project: parseSourceProject(bytes),
    bytes: bytes.byteLength,
    sha256: sha256Hex(bytes)
  });
}
