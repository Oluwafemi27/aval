import {
  decodePngRgba,
  validatePngProfile
} from "@rendered-motion/format";
import type { GraphPresentation } from "@rendered-motion/graph";
import type {
  BrowserAvcCandidateComposition,
  BrowserAvcReadPixelsResult
} from "@rendered-motion/player-web";

export const ALPHA_MAE_LIMIT = 2;
export const ALPHA_P99_LIMIT = 8;
export const COMPOSITE_MAE_LIMIT = 4;
export const COMPOSITE_P99_LIMIT = 16;
export const PROOF_BACKING_BYTE_LIMIT = 16 * 1024 * 1024;

export const BACKGROUNDS = Object.freeze({
  black: Object.freeze([0, 0, 0] as const),
  white: Object.freeze([255, 255, 255] as const),
  magenta: Object.freeze([255, 0, 255] as const)
});

const SOURCE_START = Object.freeze({
  intro: 0,
  "idle-body": 3,
  "hover-shift": 11,
  "hover-body": 17,
  "loading-bridge": 25,
  "loading-body": 26,
  "done-body": 26
});

export interface M6ExpectedSourceFrame {
  readonly sourceOrdinal: number;
  readonly pngBase64: string;
}

export interface DecodedSourceFrame {
  readonly sourceOrdinal: number;
  readonly rgba: Uint8Array;
}

export interface ErrorMetrics {
  readonly sampleCount: number;
  readonly meanAbsoluteError: number;
  readonly p99AbsoluteError: number;
  readonly maximumAbsoluteError: number;
}

export interface FrameQualityEvidence {
  readonly drawSequence: number;
  readonly sourceOrdinal: number;
  readonly presentation: string;
  readonly routePhase: string;
  readonly candidateId: string;
  readonly alpha: Readonly<ErrorMetrics>;
  readonly composites: Readonly<Record<keyof typeof BACKGROUNDS, ErrorMetrics>>;
  readonly transparentEdgeMaximumAlpha: number;
  readonly transparentEdgeMaximumPremultipliedRgb: number;
}

export interface PlaneComparisonEvidence {
  readonly width: number;
  readonly height: number;
  readonly alpha: Readonly<ErrorMetrics>;
  readonly composites: Readonly<Record<keyof typeof BACKGROUNDS, ErrorMetrics>>;
}

export function decodeExpectedFrames(
  frames: readonly Readonly<M6ExpectedSourceFrame>[],
  canvas: Readonly<{ readonly width: number; readonly height: number }>
): readonly Readonly<DecodedSourceFrame>[] {
  const decoded = frames.map((frame) => {
    const png = decodeBase64(frame.pngBase64);
    const plan = validatePngProfile({
      png,
      expectedWidth: canvas.width,
      expectedHeight: canvas.height
    });
    return Object.freeze({
      sourceOrdinal: frame.sourceOrdinal,
      rgba: decodePngRgba(plan).rgba
    });
  });
  const ordinals = decoded.map(({ sourceOrdinal }) => sourceOrdinal);
  requireProof(
    new Set(ordinals).size === decoded.length,
    "M6 expected source ordinals must be unique"
  );
  return Object.freeze(decoded);
}

export function sourceOrdinalForPresentation(
  presentation: Readonly<GraphPresentation>
): number {
  requireProof(presentation.kind !== "static", "animated quality draw became static");
  const start = SOURCE_START[presentation.unitId as keyof typeof SOURCE_START];
  requireProof(start !== undefined, `unknown M6 fixture unit ${presentation.unitId}`);
  const ordinal = start + presentation.frameIndex;
  requireProof(
    Number.isSafeInteger(ordinal) && ordinal >= 0 && ordinal < 30,
    "M6 fixture source ordinal is out of range"
  );
  return ordinal;
}

export function presentationLabel(
  presentation: Readonly<GraphPresentation>
): string {
  return presentation.kind === "static"
    ? `static:${presentation.state}`
    : `${presentation.unitId}:${String(presentation.frameIndex)}`;
}

export function measureFrame(
  composition: Readonly<BrowserAvcCandidateComposition>,
  expected: Readonly<DecodedSourceFrame>,
  details: Readonly<{
    readonly drawSequence: number;
    readonly presentation: string;
    readonly routePhase: string;
    readonly candidateId: string;
  }>,
  aggregateAlpha: number[],
  aggregateComposites: Record<keyof typeof BACKGROUNDS, number[]>
): Readonly<FrameQualityEvidence> {
  const actual = composition.controls.readPixels();
  requireProof(
    actual.rgba.byteLength === expected.rgba.byteLength,
    "browser readback does not match expected source dimensions"
  );
  const measured = measurePremultipliedAgainstStraight(
    actual,
    Object.freeze({
      rgba: expected.rgba,
      width: actual.width,
      height: actual.height
    }),
    aggregateAlpha,
    aggregateComposites
  );
  requireQuality(measured, `frame ${String(expected.sourceOrdinal)}`);
  return deepFreeze({
    ...details,
    sourceOrdinal: expected.sourceOrdinal,
    ...measured
  });
}

export function compareRenderedPlanes(
  animatedPremultiplied: Readonly<BrowserAvcReadPixelsResult>,
  staticStraight: Readonly<BrowserAvcReadPixelsResult>,
  label: string
): Readonly<PlaneComparisonEvidence> {
  requireProof(
    animatedPremultiplied.width === staticStraight.width &&
      animatedPremultiplied.height === staticStraight.height &&
      animatedPremultiplied.rgba.byteLength === staticStraight.rgba.byteLength,
    `${label} planes have different raster dimensions`
  );
  const measured = measurePremultipliedAgainstStraight(
    animatedPremultiplied,
    staticStraight
  );
  requireProof(
    measured.alpha.meanAbsoluteError <= 10 &&
      measured.alpha.p99AbsoluteError <= 112,
    `${label} exceeds cross-backend alpha limits: ${JSON.stringify(measured.alpha)}`
  );
  for (const [background, result] of Object.entries(measured.composites)) {
    requireProof(
      result.meanAbsoluteError <= 12 && result.p99AbsoluteError <= 112,
      `${label} exceeds cross-backend ${background} limits: ${JSON.stringify(result)}`
    );
  }
  return deepFreeze({
    width: animatedPremultiplied.width,
    height: animatedPremultiplied.height,
    alpha: measured.alpha,
    composites: measured.composites
  });
}

function measurePremultipliedAgainstStraight(
  actual: Readonly<BrowserAvcReadPixelsResult>,
  expected: Readonly<BrowserAvcReadPixelsResult>,
  aggregateAlpha?: number[],
  aggregateComposites?: Record<keyof typeof BACKGROUNDS, number[]>
): Readonly<{
  readonly alpha: ErrorMetrics;
  readonly composites: Readonly<Record<keyof typeof BACKGROUNDS, ErrorMetrics>>;
  readonly transparentEdgeMaximumAlpha: number;
  readonly transparentEdgeMaximumPremultipliedRgb: number;
}> {
  const alphaErrors: number[] = [];
  const compositeErrors: Record<keyof typeof BACKGROUNDS, number[]> = {
    black: [], white: [], magenta: []
  };
  let transparentEdgeMaximumAlpha = 0;
  let transparentEdgeMaximumPremultipliedRgb = 0;
  for (let offset = 0; offset < expected.rgba.byteLength; offset += 4) {
    const expectedAlpha = expected.rgba[offset + 3]!;
    const actualAlpha = actual.rgba[offset + 3]!;
    const alphaError = Math.abs(actualAlpha - expectedAlpha);
    alphaErrors.push(alphaError);
    aggregateAlpha?.push(alphaError);
    if (expectedAlpha === 0) {
      transparentEdgeMaximumAlpha = Math.max(
        transparentEdgeMaximumAlpha,
        actualAlpha
      );
      transparentEdgeMaximumPremultipliedRgb = Math.max(
        transparentEdgeMaximumPremultipliedRgb,
        actual.rgba[offset]!,
        actual.rgba[offset + 1]!,
        actual.rgba[offset + 2]!
      );
    }
    for (const [name, background] of Object.entries(BACKGROUNDS) as Array<
      [keyof typeof BACKGROUNDS, readonly [number, number, number]]
    >) {
      for (let channel = 0; channel < 3; channel += 1) {
        const expectedComposite = roundedComposite(
          expected.rgba[offset + channel]!,
          expectedAlpha,
          background[channel]!
        );
        const actualComposite = Math.min(
          255,
          actual.rgba[offset + channel]! +
            Math.round(background[channel]! * (255 - actualAlpha) / 255)
        );
        const error = Math.abs(actualComposite - expectedComposite);
        compositeErrors[name].push(error);
        aggregateComposites?.[name].push(error);
      }
    }
  }
  return deepFreeze({
    alpha: metrics(alphaErrors),
    composites: mapMetrics(compositeErrors),
    transparentEdgeMaximumAlpha,
    transparentEdgeMaximumPremultipliedRgb
  });
}

function requireQuality(
  result: Readonly<{
    readonly alpha: ErrorMetrics;
    readonly composites: Readonly<Record<keyof typeof BACKGROUNDS, ErrorMetrics>>;
  }>,
  label: string
): void {
  requireProof(
    result.alpha.meanAbsoluteError <= ALPHA_MAE_LIMIT &&
      result.alpha.p99AbsoluteError <= ALPHA_P99_LIMIT,
    `${label} exceeds alpha quality limits: ${JSON.stringify(result.alpha)}`
  );
  for (const [name, metrics] of Object.entries(result.composites)) {
    requireProof(
      metrics.meanAbsoluteError <= COMPOSITE_MAE_LIMIT &&
        metrics.p99AbsoluteError <= COMPOSITE_P99_LIMIT,
      `${label} exceeds ${name} composite limits: ${JSON.stringify(metrics)}`
    );
  }
}

export function metrics(errors: readonly number[]): Readonly<ErrorMetrics> {
  requireProof(errors.length > 0, "quality metric has no samples");
  const sorted = [...errors].sort((left, right) => left - right);
  const sum = errors.reduce((total, value) => total + value, 0);
  return Object.freeze({
    sampleCount: errors.length,
    meanAbsoluteError: sum / errors.length,
    p99AbsoluteError: sorted[Math.max(0, Math.ceil(sorted.length * 0.99) - 1)]!,
    maximumAbsoluteError: sorted.at(-1)!
  });
}

export function mapMetrics(
  errors: Readonly<Record<keyof typeof BACKGROUNDS, readonly number[]>>
): Readonly<Record<keyof typeof BACKGROUNDS, ErrorMetrics>> {
  return Object.freeze({
    black: metrics(errors.black),
    white: metrics(errors.white),
    magenta: metrics(errors.magenta)
  });
}

export function decodeBase64(value: string): Uint8Array {
  requireProof(typeof value === "string" && value.length > 0, "base64 input is required");
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new TypeError("base64 input is invalid");
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function requireProof(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) throw new Error(message);
}

export function safeStringify(value: unknown): string {
  return JSON.stringify(value, (_key, child: unknown) =>
    typeof child === "bigint" ? child.toString() : child
  );
}

export function deepFreeze<T>(value: T): Readonly<T> {
  if (Array.isArray(value)) {
    for (const child of value) deepFreeze(child);
    return Object.freeze(value) as Readonly<T>;
  }
  if (value !== null && typeof value === "object") {
    if (value instanceof Uint8Array) return value as Readonly<T>;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value) as Readonly<T>;
  }
  return value;
}

function roundedComposite(source: number, alpha: number, background: number): number {
  return Math.round((source * alpha + background * (255 - alpha)) / 255);
}
