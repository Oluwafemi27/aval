import {
  deriveVideoRenditionGeometry,
  type VideoLayout
} from "@pixel-point/aval-format";

import { CompilerError } from "../diagnostics.js";
import type {
  CompileInvocationDetails,
  NormalizedSourceProject,
  NormalizedVideoEncoding
} from "../model.js";
import {
  createExtractRgba16RangeInvocation,
  extractRgba16Range
} from "../ffmpeg/encode-unit.js";
import type { PreparedEncodingRendition } from "./project-encoding-compiler.js";
import {
  resolvePreparedFrameRange,
  type PreparedProjectSource
} from "./project-source.js";
import {
  AV1_VIDEO_CODEC_COMPILER,
  H264_VIDEO_CODEC_COMPILER,
  H265_VIDEO_CODEC_COMPILER,
  VP9_VIDEO_CODEC_COMPILER,
  type VideoCodecCompiler
} from "./video-codec-compiler.js";
import { writeVideoYuvUnitSpool } from "./video-yuv-spool.js";

export interface CompileVideoEncodingRenditionsInput {
  readonly project: Readonly<NormalizedSourceProject>;
  readonly encoding: Readonly<NormalizedVideoEncoding>;
  readonly layout: VideoLayout;
  readonly sources: ReadonlyMap<string, Readonly<PreparedProjectSource>>;
  readonly executable: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface CompiledVideoEncodingRenditions {
  readonly renditions: readonly Readonly<PreparedEncodingRendition>[];
  readonly invocations: readonly Readonly<CompileInvocationDetails>[];
}

type CodecPipelineInput<E extends NormalizedVideoEncoding> = Omit<
  CompileVideoEncodingRenditionsInput,
  "encoding"
> & { readonly encoding: Readonly<E> };

/** Dispatch once, then compile through a codec-typed adapter. */
export function compileVideoEncodingRenditions(
  input: Readonly<CompileVideoEncodingRenditionsInput>
): Promise<Readonly<CompiledVideoEncodingRenditions>> {
  switch (input.encoding.codec) {
    case "h264":
      return compileCodecRenditions(
        { ...input, encoding: input.encoding },
        H264_VIDEO_CODEC_COMPILER
      );
    case "h265":
      return compileCodecRenditions(
        { ...input, encoding: input.encoding },
        H265_VIDEO_CODEC_COMPILER
      );
    case "vp9":
      return compileCodecRenditions(
        { ...input, encoding: input.encoding },
        VP9_VIDEO_CODEC_COMPILER
      );
    case "av1":
      return compileCodecRenditions(
        { ...input, encoding: input.encoding },
        AV1_VIDEO_CODEC_COMPILER
      );
  }
}

async function compileCodecRenditions<
  E extends NormalizedVideoEncoding,
  U
>(
  input: Readonly<CodecPipelineInput<E>>,
  compiler: Readonly<VideoCodecCompiler<E, U>>
): Promise<Readonly<CompiledVideoEncodingRenditions>> {
  const renditions: PreparedEncodingRendition[] = [];
  const invocations: CompileInvocationDetails[] = [];
  for (const rendition of input.encoding.renditions) {
    const geometry = deriveVideoRenditionGeometry({
      canvasWidth: input.project.canvas.width,
      canvasHeight: input.project.canvas.height,
      layout: input.layout,
      visibleWidth: rendition.width,
      visibleHeight: rendition.height,
      storage: {
        widthAlignment: compiler.alignment.width,
        heightAlignment: compiler.alignment.height
      }
    });
    const encodedUnits: Readonly<U>[] = [];
    for (const unit of input.project.units) {
      const source = input.sources.get(unit.source);
      if (source === undefined) {
        throw new CompilerError(
          "IO_FAILED",
          `Prepared source ${unit.source} is missing`
        );
      }
      const [startFrame, endFrame] = resolvePreparedFrameRange(
        source,
        unit.range[0],
        unit.range[1]
      );
      const extraction = {
        source: source.input,
        startFrame,
        endFrame,
        width: rendition.width,
        height: rendition.height,
        executable: input.executable,
        ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
        ...(input.signal === undefined ? {} : { signal: input.signal })
      };
      invocations.push(Object.freeze({
        operation: `${input.encoding.codec}:${rendition.id}:${unit.id}:scale-rgba`,
        tool: "ffmpeg",
        arguments: redactArguments(
          createExtractRgba16RangeInvocation(extraction).arguments,
          source.input.path,
          `$SPOOL/${unit.source}`
        )
      }));
      const rgba16 = await extractRgba16Range(extraction);
      const spool = await writeVideoYuvUnitSpool({
        geometry,
        frameRate: input.project.frameRate,
        bitDepth: compiler.bitDepth(input.encoding),
        frames: rgba16,
        ...(input.signal === undefined ? {} : { signal: input.signal })
      });
      try {
        const encoded = await compiler.encode({
          unitId: unit.id,
          expectedFrames: spool.frameCount,
          source: spool.source,
          encoding: input.encoding,
          rendition,
          geometry,
          executable: input.executable,
          ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
          ...(input.signal === undefined ? {} : { signal: input.signal })
        });
        invocations.push(Object.freeze({
          operation: `${input.encoding.codec}:${rendition.id}:${unit.id}:encode`,
          tool: "ffmpeg",
          arguments: encoded.invocationArguments
        }));
        encodedUnits.push(encoded.unit);
      } finally {
        await spool.cleanup();
      }
    }
    renditions.push(compiler.prepare({
      encoding: input.encoding,
      renditionId: rendition.id,
      geometry,
      frameRate: input.project.frameRate,
      units: encodedUnits
    }));
  }
  return Object.freeze({
    renditions: Object.freeze(renditions),
    invocations: Object.freeze(invocations)
  });
}

function redactArguments(
  arguments_: readonly string[],
  path: string,
  token: string
): readonly string[] {
  return Object.freeze(arguments_.map((argument) =>
    argument.split(path).join(token)
  ));
}
