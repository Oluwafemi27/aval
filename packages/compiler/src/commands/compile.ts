import { resolve } from "node:path";

import type { CompileCliArguments } from "../cli-args.js";
import { buildDirectArtifact } from "../compile/direct-compiler.js";
import { buildProjectArtifact } from "../compile/project-compiler.js";
import { CompilerError } from "../diagnostics.js";
import {
  createCompileAdoptionSummary,
  type CompileAdoptionSummary
} from "../adoption-summary.js";
import type {
  CompileArtifact,
  CompileResult,
  DirectArtifactOptions,
  ProjectArtifactOptions
} from "../model.js";
import {
  buildReportInvocation,
  prepareCompilePublication
} from "./compile-publication.js";
import { assertDistinctCompileOutputs } from "./compile-collisions.js";

export interface CompileCommandDependencies {
  readonly buildDirectArtifact: (
    options: DirectArtifactOptions
  ) => Promise<Readonly<CompileArtifact>>;
  readonly buildProjectArtifact: (
    options: ProjectArtifactOptions
  ) => Promise<Readonly<CompileArtifact>>;
}

export interface CompileCommandResult extends CompileResult {
  readonly command: "compile";
  readonly reportPath: string;
  readonly adoption: Readonly<CompileAdoptionSummary>;
}

const DEFAULT_DEPENDENCIES: CompileCommandDependencies = {
  buildDirectArtifact,
  buildProjectArtifact
};

/** Run one preflighted compile and publish its deterministic JSON build report. */
export async function runCompileCommand(
  arguments_: CompileCliArguments,
  options: {
    readonly cwd: string;
    readonly signal?: AbortSignal;
    readonly dependencies?: CompileCommandDependencies;
  }
): Promise<Readonly<CompileCommandResult>> {
  const dependencies = options.dependencies ?? DEFAULT_DEPENDENCIES;
  const inputPath = resolve(options.cwd, arguments_.input);
  const outputPath = resolve(options.cwd, arguments_.output);
  const reportPath = resolve(
    options.cwd,
    arguments_.report ?? `${arguments_.output}.build.json`
  );
  if (outputPath === reportPath) {
    throw new CompilerError("CLI_USAGE", "Asset and report paths must differ");
  }
  await assertDistinctCompileOutputs(
    arguments_,
    inputPath,
    outputPath,
    reportPath
  );
  const publication = await prepareCompilePublication(
    outputPath,
    reportPath,
    arguments_.force
  );

  const artifact = inputPath.toLowerCase().endsWith(".json")
    ? await dependencies.buildProjectArtifact({
        projectPath: inputPath,
        ...(arguments_.ffmpegPath === undefined
          ? {}
          : { ffmpegPath: arguments_.ffmpegPath }),
        ...(arguments_.ffprobePath === undefined
          ? {}
          : { ffprobePath: arguments_.ffprobePath }),
        ...(arguments_.mediaTimeoutMs === undefined
          ? {}
          : { mediaTimeoutMs: arguments_.mediaTimeoutMs }),
        ...(options.signal === undefined ? {} : { signal: options.signal })
      })
    : await dependencies.buildDirectArtifact(directOptions(
        arguments_,
        inputPath,
        options.signal
      ));

  await publication.publishArtifact(
    artifact,
    buildReportInvocation(arguments_, inputPath, outputPath),
    options.signal
  );
  const result: CompileResult = Object.freeze({
    outputPath,
    bytes: artifact.bytes,
    sha256: artifact.sha256,
    provenance: artifact.provenance,
    warnings: artifact.warnings,
    buildDetails: artifact.buildDetails
  });
  return Object.freeze({
    command: "compile",
    reportPath,
    ...result,
    adoption: createCompileAdoptionSummary(result)
  });
}

function directOptions(
  arguments_: CompileCliArguments,
  inputPath: string,
  signal: AbortSignal | undefined
): DirectArtifactOptions {
  if (arguments_.loop === undefined) {
    throw new CompilerError("CLI_USAGE", "Direct compile requires --loop");
  }
  const extended = {
    inputPath,
    loop: arguments_.loop,
    ...(arguments_.fps === undefined ? {} : { fps: arguments_.fps }),
    normalizeVfr:
      arguments_.normalizeVfr ||
      (arguments_.fps !== undefined && !inputPath.includes("%")),
    ...(arguments_.bitrate === undefined ? {} : { bitrate: arguments_.bitrate }),
    ...(arguments_.crf === undefined ? {} : { crf: arguments_.crf }),
    ...(arguments_.maxBitrate === undefined
      ? {}
      : { maxBitrate: arguments_.maxBitrate }),
    ...(arguments_.preset === undefined ? {} : { preset: arguments_.preset }),
    ...(arguments_.alpha === undefined ? {} : { alpha: arguments_.alpha }),
    ...(arguments_.ffmpegPath === undefined
      ? {}
      : { ffmpegPath: arguments_.ffmpegPath }),
    ...(arguments_.ffprobePath === undefined
      ? {}
      : { ffprobePath: arguments_.ffprobePath }),
    ...(arguments_.mediaTimeoutMs === undefined
      ? {}
      : { mediaTimeoutMs: arguments_.mediaTimeoutMs }),
    ...(signal === undefined ? {} : { signal }),
    ...(arguments_.canvas === undefined ? {} : { canvas: arguments_.canvas }),
    ...(arguments_.frames === undefined ? {} : { frames: arguments_.frames })
  };
  return extended;
}
