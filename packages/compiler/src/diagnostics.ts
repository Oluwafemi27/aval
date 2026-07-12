export type CompilerErrorCode =
  | "ALPHA_POLICY_REJECTED"
  | "ALPHA_QUALITY_REJECTED"
  | "ASSET_INVALID"
  | "AVC_PROFILE_INVALID"
  | "CANCELLED"
  | "CLI_USAGE"
  | "CONTINUITY_FAILED"
  | "FFMPEG_FAILED"
  | "FFMPEG_NOT_FOUND"
  | "FFMPEG_UNSUPPORTED"
  | "FRAME_RANGE_INVALID"
  | "INPUT_INVALID"
  | "IO_FAILED"
  | "OPAQUE_ONLY_M5"
  | "OUTPUT_LIMIT"
  | "PATH_OUTSIDE_ROOT"
  | "PROCESS_TIMEOUT"
  | "SOURCE_LIMIT"
  | "VFR_UNSUPPORTED";

export interface CompilerErrorDetails {
  readonly path?: string;
  readonly field?: string;
  readonly hint?: string;
  readonly cause?: unknown;
  readonly width?: number;
  readonly height?: number;
  readonly source?: string;
  readonly rendition?: string;
  readonly unit?: string;
  readonly frame?: number;
  readonly x?: number;
  readonly y?: number;
  readonly alpha?: number;
  readonly statistic?: "mae" | "p99" | "minimum-alpha";
  readonly value?: number;
  readonly limit?: number;
  readonly policy?: "auto" | "opaque" | "packed";
  readonly phase?: "classification" | "packing" | "quality";
}

/** Stable diagnostic boundary for CLI, API, and subprocess failures. */
export class CompilerError extends Error {
  public declare readonly code: CompilerErrorCode;
  public declare readonly path?: string;
  public declare readonly field?: string;
  public declare readonly hint?: string;
  public declare readonly cause?: unknown;
  public declare readonly width?: number;
  public declare readonly height?: number;
  public declare readonly source?: string;
  public declare readonly rendition?: string;
  public declare readonly unit?: string;
  public declare readonly frame?: number;
  public declare readonly x?: number;
  public declare readonly y?: number;
  public declare readonly alpha?: number;
  public declare readonly statistic?: "mae" | "p99" | "minimum-alpha";
  public declare readonly value?: number;
  public declare readonly limit?: number;
  public declare readonly policy?: "auto" | "opaque" | "packed";
  public declare readonly phase?: "classification" | "packing" | "quality";

  public constructor(
    code: CompilerErrorCode,
    message: string,
    details: CompilerErrorDetails = {}
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    Object.defineProperties(this, {
      name: { value: "CompilerError", writable: false },
      code: { value: code, enumerable: true, writable: false }
    });
    for (const key of [
      "path",
      "field",
      "hint",
      "cause",
      "width",
      "height",
      "source",
      "rendition",
      "unit",
      "frame",
      "x",
      "y",
      "alpha",
      "statistic",
      "value",
      "limit",
      "policy",
      "phase"
    ] as const) {
      if (details[key] !== undefined) {
        Object.defineProperty(this, key, {
          value: details[key],
          enumerable: key !== "cause",
          writable: false
        });
      }
    }
    Object.freeze(this);
  }
}

export interface CompilerDiagnostic {
  readonly severity: "error" | "warning" | "info";
  readonly code: string;
  readonly message: string;
  readonly path?: string;
  readonly field?: string;
  readonly hint?: string;
  readonly width?: number;
  readonly height?: number;
  readonly source?: string;
  readonly rendition?: string;
  readonly unit?: string;
  readonly frame?: number;
  readonly x?: number;
  readonly y?: number;
  readonly alpha?: number;
  readonly statistic?: "mae" | "p99" | "minimum-alpha";
  readonly value?: number;
  readonly limit?: number;
  readonly policy?: "auto" | "opaque" | "packed";
  readonly phase?: "classification" | "packing" | "quality";
}

export function diagnosticFromError(error: unknown): CompilerDiagnostic {
  if (error instanceof CompilerError) {
    return Object.freeze({
      severity: "error",
      code: error.code,
      message: error.message,
      ...(error.path === undefined ? {} : { path: error.path }),
      ...(error.field === undefined ? {} : { field: error.field }),
      ...(error.hint === undefined ? {} : { hint: error.hint }),
      ...(error.width === undefined ? {} : { width: error.width }),
      ...(error.height === undefined ? {} : { height: error.height }),
      ...(error.source === undefined ? {} : { source: error.source }),
      ...(error.rendition === undefined ? {} : { rendition: error.rendition }),
      ...(error.unit === undefined ? {} : { unit: error.unit }),
      ...(error.frame === undefined ? {} : { frame: error.frame }),
      ...(error.x === undefined ? {} : { x: error.x }),
      ...(error.y === undefined ? {} : { y: error.y }),
      ...(error.alpha === undefined ? {} : { alpha: error.alpha }),
      ...(error.statistic === undefined ? {} : { statistic: error.statistic }),
      ...(error.value === undefined ? {} : { value: error.value }),
      ...(error.limit === undefined ? {} : { limit: error.limit }),
      ...(error.policy === undefined ? {} : { policy: error.policy }),
      ...(error.phase === undefined ? {} : { phase: error.phase })
    });
  }
  return Object.freeze({
    severity: "error",
    code: "IO_FAILED",
    message: "Unexpected compiler failure"
  });
}

export function formatDiagnostic(diagnostic: CompilerDiagnostic): string {
  const location = [diagnostic.path, diagnostic.field]
    .filter((value): value is string => value !== undefined)
    .join(":");
  return [
    `${diagnostic.severity.toUpperCase()} ${diagnostic.code}`,
    location === "" ? undefined : location,
    diagnostic.message,
    diagnostic.hint === undefined ? undefined : `Hint: ${diagnostic.hint}`
  ].filter((value): value is string => value !== undefined).join(" — ");
}
