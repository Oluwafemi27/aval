import {
  boundedArray,
  digest,
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
  BitrateV01,
  CanvasV01,
  FormatBudgets,
  RationalV01,
  Rect,
  RenditionV01,
  StaticFrameV01
} from "./model.js";

const MAX_CANVAS_DIMENSION = 512;
const MAX_CODED_DIMENSION = 2_048;
const MAX_CODED_PIXELS = 1_100_000;
const MAX_PIXEL_ASPECT_TERM = 10_000;
const MAX_FRAME_RATE = 60;
const MAX_FRAME_RATE_DENOMINATOR = 1_001;
const MAX_AVC_BITRATE = 8_000_000;

export function cloneCanvas(value: unknown, path: string): CanvasV01 {
  const input = record(value, path);
  exactKeys(
    input,
    ["width", "height", "fit", "pixelAspect", "colorSpace"],
    path
  );
  const width = positiveInteger(input.width, `${path}.width`, MAX_CANVAS_DIMENSION);
  const height = positiveInteger(
    input.height,
    `${path}.height`,
    MAX_CANVAS_DIMENSION
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
  budgets: FormatBudgets,
  path: string
): readonly RenditionV01[] {
  const inputs = boundedArray(value, path, 1, budgets.maxRenditions);
  const renditions = inputs.map((entry, index) =>
    cloneRendition(entry, canvas, `${path}[${String(index)}]`)
  );
  requireIdOrder(renditions, path);
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
    literal(input.codec, "rma.reference-rgba", `${path}.codec`);
    const alpha = record(input.alphaLayout, `${path}.alphaLayout`);
    exactKeys(alpha, ["type"], `${path}.alphaLayout`);
    literal(alpha.type, "straight-rgba-v0", `${path}.alphaLayout.type`);
    const capabilities = tuple(input.capabilities, 0, `${path}.capabilities`);
    return Object.freeze({
      id: common.id,
      profile,
      codec: "rma.reference-rgba",
      codedWidth: common.codedWidth,
      codedHeight: common.codedHeight,
      alphaLayout: Object.freeze({ type: "straight-rgba-v0" }),
      capabilities: Object.freeze(capabilities) as readonly []
    });
  }

  if (
    profile !== "avc-annexb-opaque-v0" &&
    profile !== "avc-annexb-packed-alpha-v0"
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
  literal(input.codec, "avc1.42E020", `${path}.codec`);
  const bitrate = cloneBitrate(input.bitrate, `${path}.bitrate`);
  const capabilitiesInput = tuple(input.capabilities, 2, `${path}.capabilities`);
  literal(capabilitiesInput[0], "webcodecs", `${path}.capabilities[0]`);
  literal(capabilitiesInput[1], "webgl2", `${path}.capabilities[1]`);
  const capabilities = Object.freeze([
    "webcodecs",
    "webgl2"
  ]) as readonly ["webcodecs", "webgl2"];
  const alpha = record(input.alphaLayout, `${path}.alphaLayout`);

  if (profile === "avc-annexb-opaque-v0") {
    exactKeys(alpha, ["type", "colorRect"], `${path}.alphaLayout`);
    literal(alpha.type, "opaque-v0", `${path}.alphaLayout.type`);
    const colorRect = cloneRect(
      alpha.colorRect,
      common.codedWidth,
      common.codedHeight,
      `${path}.alphaLayout.colorRect`
    );
    return Object.freeze({
      id: common.id,
      profile,
      codec: "avc1.42E020",
      codedWidth: common.codedWidth,
      codedHeight: common.codedHeight,
      alphaLayout: Object.freeze({ type: "opaque-v0", colorRect }),
      bitrate,
      capabilities
    });
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
  return Object.freeze({
    id: common.id,
    profile,
    codec: "avc1.42E020",
    codedWidth: common.codedWidth,
    codedHeight: common.codedHeight,
    alphaLayout: Object.freeze({ type: "stacked-v0", colorRect, alphaRect }),
    bitrate,
    capabilities
  });
}

function cloneRenditionCommon(
  input: Record<string, unknown>,
  path: string
): { readonly id: string; readonly codedWidth: number; readonly codedHeight: number } {
  const id = identifier(input.id, `${path}.id`);
  const codedWidth = positiveInteger(
    input.codedWidth,
    `${path}.codedWidth`,
    MAX_CODED_DIMENSION
  );
  const codedHeight = positiveInteger(
    input.codedHeight,
    `${path}.codedHeight`,
    MAX_CODED_DIMENSION
  );
  if (codedWidth * codedHeight > MAX_CODED_PIXELS) {
    invalid(path, `coded pixel count must be at most ${String(MAX_CODED_PIXELS)}`);
  }
  return { id, codedWidth, codedHeight };
}

function cloneBitrate(value: unknown, path: string): BitrateV01 {
  const input = record(value, path);
  exactKeys(input, ["average", "peak"], path);
  const average = positiveInteger(input.average, `${path}.average`, MAX_AVC_BITRATE);
  const peak = positiveInteger(input.peak, `${path}.peak`, MAX_AVC_BITRATE);
  if (average > peak) {
    invalid(`${path}.average`, "must not exceed peak bitrate");
  }
  return Object.freeze({ average, peak });
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

export function cloneStaticFrames(
  value: unknown,
  canvas: CanvasV01,
  budgets: FormatBudgets,
  path: string
): readonly StaticFrameV01[] {
  const inputs = boundedArray(value, path, 1, budgets.maxStaticFrames);
  const staticFrames = inputs.map((entry, index) => {
    const framePath = `${path}[${String(index)}]`;
    const input = record(entry, framePath);
    exactKeys(input, ["id", "offset", "length", "width", "height", "sha256"], framePath);
    const width = positiveInteger(input.width, `${framePath}.width`);
    const height = positiveInteger(input.height, `${framePath}.height`);
    if (width !== canvas.width || height !== canvas.height) {
      invalid(framePath, "static dimensions must equal the canvas");
    }
    return Object.freeze({
      id: identifier(input.id, `${framePath}.id`),
      offset: nonNegativeInteger(input.offset, `${framePath}.offset`),
      length: positiveInteger(
        input.length,
        `${framePath}.length`,
        budgets.maxStaticPngBytes
      ),
      width,
      height,
      sha256: digest(input.sha256, `${framePath}.sha256`)
    });
  });
  requireIdOrder(staticFrames, path);
  return Object.freeze(staticFrames);
}
