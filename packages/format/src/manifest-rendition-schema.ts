import { deriveAvcRenditionGeometryAtPath } from "./avc/rendition-geometry.js";
import {
  avcLevelLimits,
  isAvcCodec,
  type AvcCodecV01
} from "./avc/codec.js";
import { FormatError } from "./errors.js";
import {
  boundedArray,
  exactKeys,
  identifier,
  invalid,
  literal,
  nonNegativeInteger,
  oneOf,
  positiveInteger,
  record,
  requireIdOrder,
  tuple
} from "./manifest-validation.js";
import type {
  AvcProductionRenditionProfileV01,
  BitrateV01,
  CanvasV01,
  FormatBudgets,
  RationalV01,
  Rect,
  RenditionV01
} from "./model.js";

const MAX_PIXEL_ASPECT_TERM = 10_000;
const MAX_FRAME_RATE = 60;
const MAX_FRAME_RATE_DENOMINATOR = 1_001;
const PNG_DIMENSION_MAX = 0xffff_ffff;
const REFERENCE_DIMENSION_MAX = 0xffff;
const REFERENCE_SAMPLE_HEADER_BYTES = 24n;
const UINT32_MAX_BIGINT = 0xffff_ffffn;

export function cloneCanvas(value: unknown, path: string): CanvasV01 {
  const input = record(value, path);
  exactKeys(
    input,
    ["width", "height", "fit", "pixelAspect", "colorSpace"],
    path
  );
  const width = positiveInteger(input.width, `${path}.width`, PNG_DIMENSION_MAX);
  const height = positiveInteger(
    input.height,
    `${path}.height`,
    PNG_DIMENSION_MAX
  );
  const fit = oneOf(input.fit, ["contain", "cover", "fill", "none"], `${path}.fit`);
  const pixelAspectInput = tuple(input.pixelAspect, 2, `${path}.pixelAspect`);
  const pixelAspect = Object.freeze([
    positiveInteger(
      pixelAspectInput[0],
      `${path}.pixelAspect[0]`,
      MAX_PIXEL_ASPECT_TERM
    ),
    positiveInteger(
      pixelAspectInput[1],
      `${path}.pixelAspect[1]`,
      MAX_PIXEL_ASPECT_TERM
    )
  ]) as readonly [number, number];
  literal(input.colorSpace, "srgb", `${path}.colorSpace`);
  return Object.freeze({ width, height, fit, pixelAspect, colorSpace: "srgb" });
}

export function cloneFrameRate(value: unknown, path: string): RationalV01 {
  const input = record(value, path);
  exactKeys(input, ["numerator", "denominator"], path);
  const numerator = positiveInteger(input.numerator, `${path}.numerator`);
  const denominator = positiveInteger(
    input.denominator,
    `${path}.denominator`,
    MAX_FRAME_RATE_DENOMINATOR
  );
  if (numerator > denominator * MAX_FRAME_RATE) {
    invalid(
      `${path}.numerator`,
      `must not exceed ${String(MAX_FRAME_RATE)} frames per second`
    );
  }
  return Object.freeze({ numerator, denominator });
}

export function cloneRenditions(
  value: unknown,
  canvas: CanvasV01,
  frameRate: RationalV01,
  budgets: FormatBudgets,
  path: string
): readonly RenditionV01[] {
  const inputs = boundedArray(value, path, 1, budgets.maxRenditions);
  const renditions = inputs.map((entry, index) =>
    cloneRendition(entry, canvas, `${path}[${String(index)}]`)
  );
  requireIdOrder(renditions, path);
  let productionProfile: AvcProductionRenditionProfileV01 | undefined;
  for (let index = 0; index < renditions.length; index += 1) {
    const rendition = renditions[index]!;
    if (rendition.profile === "reference-rgba-v0") continue;
    if (rendition.codedWidth % 16 !== 0 || rendition.codedHeight % 16 !== 0) {
      invalid(
        `${path}[${String(index)}]`,
        "AVC coded dimensions must be multiples of 16"
      );
    }
    const level = avcLevelLimitsForManifest(rendition.codec);
    const widthInMacroblocks = rendition.codedWidth / 16;
    const heightInMacroblocks = rendition.codedHeight / 16;
    if (
      widthInMacroblocks > level.maximumMacroblockDimension ||
      heightInMacroblocks > level.maximumMacroblockDimension
    ) {
      invalid(
        `${path}[${String(index)}]`,
        "coded width or height exceeds the declared AVC level dimension limit"
      );
    }
    const macroblocksPerFrame = widthInMacroblocks * heightInMacroblocks;
    if (macroblocksPerFrame > level.maximumMacroblocksPerFrame) {
      invalid(
        `${path}[${String(index)}]`,
        "coded dimensions exceed the declared AVC level macroblocks-per-frame limit"
      );
    }
    if (
      BigInt(macroblocksPerFrame) * BigInt(frameRate.numerator) >
      BigInt(level.maximumMacroblocksPerSecond) * BigInt(frameRate.denominator)
    ) {
      invalid(
        `${path}[${String(index)}]`,
        "coded dimensions and frame rate exceed the declared AVC level macroblocks-per-second limit"
      );
    }
    const common = {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      codedWidth: rendition.codedWidth,
      codedHeight: rendition.codedHeight,
      colorRect: rendition.alphaLayout.colorRect
    } as const;
    deriveAvcRenditionGeometryAtPath(
      rendition.profile === "avc-annexb-packed-alpha-v0" ||
        rendition.profile === "avc-annexb-packed-alpha-v1"
        ? {
            ...common,
            profile: rendition.profile,
            alphaRect: rendition.alphaLayout.alphaRect
          }
        : { ...common, profile: rendition.profile },
      `${path}[${String(index)}]`
    );
    if (productionProfile === undefined) {
      productionProfile = rendition.profile;
    } else if (productionProfile !== rendition.profile) {
      throw new FormatError(
        "PROFILE_INVALID",
        "all production AVC renditions must use one profile and version",
        { path }
      );
    }
  }
  return Object.freeze(renditions);
}

function cloneRendition(
  value: unknown,
  canvas: CanvasV01,
  path: string
): RenditionV01 {
  const input = record(value, path);
  const profile = input.profile;
  if (profile === "reference-rgba-v0") {
    exactKeys(
      input,
      [
        "id",
        "profile",
        "codec",
        "codedWidth",
        "codedHeight",
        "alphaLayout",
        "capabilities"
      ],
      path
    );
    const common = cloneRenditionCommon(input, path);
    if (
      common.codedWidth !== canvas.width ||
      common.codedHeight !== canvas.height
    ) {
      invalid(path, "reference rendition dimensions must equal the canvas");
    }
    if (
      common.codedWidth > REFERENCE_DIMENSION_MAX ||
      common.codedHeight > REFERENCE_DIMENSION_MAX
    ) {
      invalid(path, "reference rendition dimensions must fit uint16");
    }
    const referenceSampleBytes = REFERENCE_SAMPLE_HEADER_BYTES +
      BigInt(common.codedWidth) * BigInt(common.codedHeight) * 4n;
    if (referenceSampleBytes > UINT32_MAX_BIGINT) {
      invalid(path, "reference rendition sample length must fit uint32");
    }
    literal(input.codec, "aval.reference-rgba", `${path}.codec`);
    const alpha = record(input.alphaLayout, `${path}.alphaLayout`);
    exactKeys(alpha, ["type"], `${path}.alphaLayout`);
    literal(alpha.type, "straight-rgba-v0", `${path}.alphaLayout.type`);
    const capabilities = tuple(input.capabilities, 0, `${path}.capabilities`);
    return Object.freeze({
      id: common.id,
      profile,
      codec: "aval.reference-rgba",
      codedWidth: common.codedWidth,
      codedHeight: common.codedHeight,
      alphaLayout: Object.freeze({ type: "straight-rgba-v0" }),
      capabilities: Object.freeze(capabilities) as readonly []
    });
  }

  if (
    profile !== "avc-annexb-opaque-v0" &&
    profile !== "avc-annexb-packed-alpha-v0" &&
    profile !== "avc-annexb-opaque-v1" &&
    profile !== "avc-annexb-packed-alpha-v1"
  ) {
    invalid(`${path}.profile`, "has an unsupported rendition profile");
  }
  exactKeys(
    input,
    [
      "id",
      "profile",
      "codec",
      "codedWidth",
      "codedHeight",
      "alphaLayout",
      "bitrate",
      "capabilities"
    ],
    path
  );
  const common = cloneRenditionCommon(input, path);
  const codec = cloneAvcCodec(input.codec, `${path}.codec`);
  const bitrate = cloneBitrate(
    input.bitrate,
    `${path}.bitrate`,
    avcLevelLimitsForManifest(codec).maximumBitrate
  );
  const capabilitiesInput = tuple(input.capabilities, 2, `${path}.capabilities`);
  literal(capabilitiesInput[0], "webcodecs", `${path}.capabilities[0]`);
  literal(capabilitiesInput[1], "webgl2", `${path}.capabilities[1]`);
  const capabilities = Object.freeze([
    "webcodecs",
    "webgl2"
  ]) as readonly ["webcodecs", "webgl2"];
  const alpha = record(input.alphaLayout, `${path}.alphaLayout`);

  if (
    profile === "avc-annexb-opaque-v0" ||
    profile === "avc-annexb-opaque-v1"
  ) {
    exactKeys(alpha, ["type", "colorRect"], `${path}.alphaLayout`);
    literal(alpha.type, "opaque-v0", `${path}.alphaLayout.type`);
    const colorRect = cloneRect(
      alpha.colorRect,
      common.codedWidth,
      common.codedHeight,
      `${path}.alphaLayout.colorRect`
    );
    const opaque = {
      id: common.id,
      codec,
      codedWidth: common.codedWidth,
      codedHeight: common.codedHeight,
      alphaLayout: Object.freeze({ type: "opaque-v0" as const, colorRect }),
      bitrate,
      capabilities
    } as const;
    if (profile === "avc-annexb-opaque-v0") {
      return Object.freeze({ ...opaque, profile });
    }
    return Object.freeze({ ...opaque, profile });
  }

  exactKeys(
    alpha,
    ["type", "colorRect", "alphaRect"],
    `${path}.alphaLayout`
  );
  literal(alpha.type, "stacked-v0", `${path}.alphaLayout.type`);
  const colorRect = cloneRect(
    alpha.colorRect,
    common.codedWidth,
    common.codedHeight,
    `${path}.alphaLayout.colorRect`
  );
  const alphaRect = cloneRect(
    alpha.alphaRect,
    common.codedWidth,
    common.codedHeight,
    `${path}.alphaLayout.alphaRect`
  );
  const packed = {
    id: common.id,
    codec,
    codedWidth: common.codedWidth,
    codedHeight: common.codedHeight,
    alphaLayout: Object.freeze({
      type: "stacked-v0" as const,
      colorRect,
      alphaRect
    }),
    bitrate,
    capabilities
  } as const;
  if (profile === "avc-annexb-packed-alpha-v0") {
    return Object.freeze({ ...packed, profile });
  }
  return Object.freeze({ ...packed, profile });
}

function cloneRenditionCommon(
  input: Record<string, unknown>,
  path: string
): { readonly id: string; readonly codedWidth: number; readonly codedHeight: number } {
  const id = identifier(input.id, `${path}.id`);
  const codedWidth = positiveInteger(
    input.codedWidth,
    `${path}.codedWidth`
  );
  const codedHeight = positiveInteger(
    input.codedHeight,
    `${path}.codedHeight`
  );
  return { id, codedWidth, codedHeight };
}

function cloneBitrate(
  value: unknown,
  path: string,
  maximum: number
): BitrateV01 {
  const input = record(value, path);
  exactKeys(input, ["average", "peak"], path);
  const average = positiveInteger(input.average, `${path}.average`, maximum);
  const peak = positiveInteger(input.peak, `${path}.peak`, maximum);
  if (average > peak) {
    invalid(`${path}.average`, "must not exceed peak bitrate");
  }
  return Object.freeze({ average, peak });
}

function cloneAvcCodec(value: unknown, path: string): AvcCodecV01 {
  if (!isAvcCodec(value)) {
    invalid(path, "must identify a supported Constrained Baseline AVC level");
  }
  return value;
}

function avcLevelLimitsForManifest(codec: AvcCodecV01) {
  const levelHex = codec.slice(-2);
  return avcLevelLimits(Number.parseInt(levelHex, 16));
}

function cloneRect(
  value: unknown,
  surfaceWidth: number,
  surfaceHeight: number,
  path: string
): Rect {
  const input = tuple(value, 4, path);
  const x = nonNegativeInteger(input[0], `${path}[0]`);
  const y = nonNegativeInteger(input[1], `${path}[1]`);
  const width = positiveInteger(input[2], `${path}[2]`);
  const height = positiveInteger(input[3], `${path}[3]`);
  if (x > surfaceWidth - width || y > surfaceHeight - height) {
    invalid(path, "must lie inside the coded surface");
  }
  return Object.freeze([x, y, width, height]);
}
