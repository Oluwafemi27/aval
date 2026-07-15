#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import {
  parseCliArguments,
  type CliArguments
} from "./cli-args.js";
import {
  exitStatusForCode,
  sanitizeTerminalText,
  writeJsonDiagnostic,
  writeJsonResult,
  writeTextDiagnostic,
  writeTextResult,
  type CliIo
} from "./cli-output.js";
import {
  runCompileCommand,
  type CompileCommandDependencies,
  type CompileCommandResult
} from "./commands/compile.js";
import {
  createCompileAdoptionSummary,
  formatCompileAdoptionSummary
} from "./adoption-summary.js";
import {
  startDevCommand,
  type DevCommandDependencies
} from "./commands/dev.js";
import { runInitCommand } from "./commands/init.js";
import { openDevServer, startDevServer } from "./commands/dev-server.js";
import { runInspectCommand } from "./commands/inspect.js";
import { runUnpackCommand } from "./commands/unpack.js";
import { runValidateCommand } from "./commands/validate.js";
import {
  CompilerError,
  diagnosticFromError,
  type CompilerDiagnostic
} from "./diagnostics.js";

export interface CliRuntime {
  readonly cwd?: string;
  readonly io?: CliIo;
  readonly signal?: AbortSignal;
  readonly compileDependencies?: CompileCommandDependencies;
  readonly devDependencies?: DevCommandDependencies;
  readonly devDebounceMs?: number;
}

const PROCESS_IO: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text)
};

/** Programmatic, captured-IO entry point used by the executable and tests. */
export async function runCli(
  argv: readonly string[],
  runtime: CliRuntime = {}
): Promise<number> {
  const io = runtime.io ?? PROCESS_IO;
  const cwd = runtime.cwd ?? process.cwd();
  let arguments_: CliArguments | undefined;
  const requestedJson = argv.includes("--json");
  try {
    arguments_ = parseCliArguments(argv);
    switch (arguments_.command) {
      case "help":
        writeTextResult(io, HELP_TEXT);
        return 0;
      case "compile": {
        const result = await runCompileCommand(arguments_, {
          cwd,
          ...(runtime.signal === undefined ? {} : { signal: runtime.signal }),
          ...(runtime.compileDependencies === undefined
            ? {}
            : { dependencies: runtime.compileDependencies })
        });
        const warnings = result.warnings.length === 0
          ? ""
          : `\n${result.warnings.map((warning) => `WARNING ${safe(warning)}`).join("\n")}`;
        outputResult(
          io,
          arguments_.json,
          result,
          `Compiled ${safe(result.outputPath)} (${String(result.bytes)} bytes, ${result.sha256})\nReport ${safe(result.reportPath)}\n${formatCompileAdoptionSummary(result.adoption)}${encodingOutput(result)}${warnings}`
        );
        return 0;
      }
      case "inspect": {
        const result = await runInspectCommand(arguments_, cwd, runtime.signal);
        outputResult(io, arguments_.json, result, inspectText(result));
        return 0;
      }
      case "validate": {
        const result = await runValidateCommand(arguments_, cwd, runtime.signal);
        outputResult(
          io,
          arguments_.json,
          result,
          `Valid ${safe(result.file)} (${String(result.bytes)} bytes, ${String(result.accessUnits)} access units)\nAVC: ${result.avcClaim}; digests: ${result.digestClaim}`
        );
        return 0;
      }
      case "unpack": {
        const result = await runUnpackCommand(arguments_, cwd, runtime.signal);
        outputResult(
          io,
          arguments_.json,
          result,
          `Unpacked ${safe(result.source)} to ${safe(result.outputDirectory)} (${String(result.files.length)} files)`
        );
        return 0;
      }
      case "init": {
        const result = await runInitCommand(arguments_, cwd);
        outputResult(
          io,
          arguments_.json,
          result,
          `Created ${safe(result.project)} with ${String(result.files.length)} generated files`
        );
        return 0;
      }
      case "dev": {
        const server = await startDevServer({
          assetPath: resolve(cwd, arguments_.output),
          port: arguments_.port ?? 4174
        });
        outputResult(io, arguments_.json, {
          command: "dev",
          event: "listening",
          url: server.url
        }, `Dev playground ${server.url}`);
        if (arguments_.open === true) openDevServer(server.url);
        let session: Awaited<ReturnType<typeof startDevCommand>> | null = null;
        try {
          session = await startDevCommand(arguments_, {
            cwd,
            ...(runtime.signal === undefined ? {} : { signal: runtime.signal }),
            ...(runtime.devDebounceMs === undefined
              ? {}
              : { debounceMs: runtime.devDebounceMs }),
            ...(runtime.devDependencies === undefined
              ? {}
              : { dependencies: runtime.devDependencies }),
            onBuild: ({ sequence, result }) => {
              const adoption = createCompileAdoptionSummary(result);
              server.publish({
                generation: sequence,
                bytes: result.bytes,
                sha256: result.sha256,
                warnings: result.warnings,
                report: {
                  frameRate: adoption.frameRate.text,
                  units: adoption.units,
                  geometry: adoption.geometry,
                  alpha: adoption.alpha,
                  continuityPassed: adoption.reports.continuityPassed,
                  continuityCuts: adoption.reports.continuityCuts,
                  alphaAuditedFrames: adoption.reports.alphaAuditedFrames
                }
              });
              outputResult(
                io,
                arguments_?.command === "dev" && arguments_.json,
                {
                  command: "dev",
                  event: "build",
                  sequence,
                  outputPath: result.outputPath,
                  bytes: result.bytes,
                  sha256: result.sha256,
                  warnings: result.warnings
                },
                `Build ${String(sequence)}: ${safe(result.outputPath)} (${String(result.bytes)} bytes)${encodingOutput(result)}`
              );
            },
            onFailure: ({ error }) => {
              outputDiagnostic(
                io,
                arguments_?.command === "dev" && arguments_.json,
                diagnosticFromError(error)
              );
            }
          });
          await Promise.race([session.closed, server.closed]);
        } finally {
          await Promise.allSettled([
            session?.close() ?? Promise.resolve(),
            server.close()
          ]);
        }
        return runtime.signal?.aborted === true ? 130 : 0;
      }
    }
  } catch (error) {
    const diagnostic = diagnosticFromError(error);
    outputDiagnostic(
      io,
      arguments_ === undefined ? requestedJson : "json" in arguments_ && arguments_.json,
      diagnostic
    );
    return error instanceof CompilerError ? exitStatusForCode(error.code) : 6;
  }
}

function outputResult(
  io: CliIo,
  json: boolean,
  value: unknown,
  text: string
): void {
  if (json) writeJsonResult(io, value);
  else writeTextResult(io, text);
}

function outputDiagnostic(
  io: CliIo,
  json: boolean,
  diagnostic: CompilerDiagnostic
): void {
  if (json) writeJsonDiagnostic(io, diagnostic);
  else writeTextDiagnostic(io, diagnostic);
}

function inspectText(result: Awaited<ReturnType<typeof runInspectCommand>>): string {
  const lines = [
    `${safe(result.file)}: AVAL ${result.formatVersion}, ${String(result.bytes)} bytes`,
    `Canvas ${String(result.canvas.width)}x${String(result.canvas.height)} at ${result.frameRate} fps`,
    `Initial state ${safe(result.initialState)}; states ${result.states.map(safe).join(", ")}`,
    `SHA-256 ${result.sha256}`,
    ...result.units.map((unit) =>
      `Unit ${safe(unit.id)}: ${safe(unit.kind)}, frames ${String(unit.startFrame)}:${String(unit.endFrame)}, time ${safe(unit.startTime)}:${safe(unit.endTime)}`
    ),
    ...result.avc.flatMap((rendition) => [
      `AVC ${safe(rendition.rendition)}: ${String(rendition.codedWidth)}x${String(rendition.codedHeight)}, ${String(rendition.macroblocksPerFrame)} macroblocks/frame, constraint_set2=${String(rendition.constraintSet2)}`,
      ...rendition.units.flatMap((unit) => unit.frames.map((frame) =>
        `AU ${safe(unit.id)}/${String(frame.frameIndex)}: ${frame.key ? "key" : "delta"}, ${frame.sliceType}, slices=${String(frame.sliceCount)}, NAL=${frame.nalUnitTypes.join(",")}`
      ))
    ]),
    ...result.samples.map((sample) =>
      `Sample ${safe(sample.rendition)}/${safe(sample.unit)}/${String(sample.frameIndex)}: offset=${String(sample.offset)}, length=${String(sample.length)}, sha256=${sample.sha256}`
    ),
    `AVC: ${result.avcClaim}; digests: ${result.digestClaim}`
  ];
  return lines.join("\n");
}

function safe(value: string): string {
  return sanitizeTerminalText(value);
}

export const HELP_TEXT = `Usage:
  avl compile <project.json> --out <asset.avl> [--report <report.json>]
  avl compile <input.mov|input.mp4|input.m4v> --loop <start:end> [--crf <1..51> --max-bitrate <bits/second> | --bitrate <average:peak>] [--preset <name>] [--alpha auto|opaque|packed] --out <asset.avl>
  avl compile <prefix%0Nd.png> --frames <first:count> --fps <n/d> --loop <start:end> [--crf <1..51> --max-bitrate <bits/second> | --bitrate <average:peak>] [--preset <name>] [--canvas <wxh>] [--alpha auto|opaque|packed] --out <asset.avl>
  avl inspect <asset.avl> [--json]
  avl validate <asset.avl> [--json]
  avl unpack <asset.avl> --out <empty-directory> [--json]
  avl init <directory> [--json]
  avl dev <project.json> --out <asset.avl> [--media-timeout-ms <integer>] [--port <0-65535>] [--open] [--force] [--json]

Direct AVC encoding options:
  --bitrate <average:peak>       ABR average and peak in bits/second
  --crf <1..51>                  constrained CRF for direct media
  --max-bitrate <bits/second>    required ceiling with --crf
  --preset <name>                allowlisted x264 preset through veryslow

Operational options:
  --media-timeout-ms <integer>   per FFmpeg operation for slow/large encodes

Project files own their rendition encoding policy. HEVC/WebM output, faststart,
muxer tags, and arbitrary FFmpeg arguments are unavailable.

Common compile options: --ffmpeg <absolute-path> --ffprobe <absolute-path> --force --json`;

function encodingOutput(
  result: Pick<CompileCommandResult, "buildDetails">
): string {
  const renditions = result.buildDetails.renditions;
  if (!Array.isArray(renditions) || renditions.length === 0) return "";
  return `\n${renditions.map((rendition) => {
    const rateControl = rendition.encoding.rateControl;
    const configured = rateControl.mode === "crf"
      ? `CRF ${String(rateControl.crf)}`
      : `ABR ${String(rateControl.averageBitrate)} bit/s`;
    return `Encoding ${safe(rendition.id)}: ${configured}, preset ${safe(rendition.encoding.preset)}; measured average ${String(rendition.encoding.measuredAverageBitrate)} bit/s, configured peak ${String(rendition.bitrate.peak)} bit/s`;
  }).join("\n")}`;
}

async function main(): Promise<void> {
  const controller = new AbortController();
  const cancel = (): void => controller.abort(new CompilerError("CANCELLED", "Interrupted"));
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    process.exitCode = await runCli(process.argv.slice(2), {
      signal: controller.signal
    });
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && isInvokedModule(invokedPath)) {
  await main();
}

function isInvokedModule(invokedPath: string): boolean {
  try {
    return realpathSync(invokedPath) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
