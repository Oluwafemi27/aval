import { IDENTIFIER_PATTERN } from "@aval/format";

import { throwIfAborted } from "../cancellation.js";
import { CompilerError } from "../diagnostics.js";
import type {
  AlphaAuditSummary,
  AlphaPixelLocation,
  AlphaPolicyDecision,
  SourceAlphaPolicy
} from "../model.js";

const CANCELLATION_PIXEL_INTERVAL = 4_096;

export interface CanonicalAlphaFrame {
  readonly source: string;
  readonly frame: number;
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

export interface CanonicalAlphaAuditor {
  readonly include: (frame: Readonly<CanonicalAlphaFrame>) => void;
  readonly finish: () => Readonly<AlphaAuditSummary>;
}

/**
 * Inspect each unique `(source, frame)` canonical RGBA reference exactly once.
 * Duplicate references are skipped; the materializer owns their one canonical
 * byte value and supplies it consistently.
 */
export function auditCanonicalAlphaFrames(
  frames: readonly Readonly<CanonicalAlphaFrame>[],
  signal?: AbortSignal
): Readonly<AlphaAuditSummary> {
  throwIfAborted(signal);
  if (
    !Array.isArray(frames) ||
    frames.length < 1
  ) {
    throw new CompilerError(
      "INPUT_INVALID",
      "Canonical alpha audit requires at least one reference"
    );
  }

  const auditor = createCanonicalAlphaAuditor(signal);
  for (const candidate of frames) {
    auditor.include(candidate);
  }
  return auditor.finish();
}

/** Create the bounded streaming authority used by RGBA materialization. */
export function createCanonicalAlphaAuditor(
  signal?: AbortSignal
): CanonicalAlphaAuditor {
  const unique = new Set<string>();
  let minimumAlpha = 255;
  let firstNonopaque: AlphaPixelLocation | null = null;
  let finished = false;
  const include = (candidate: Readonly<CanonicalAlphaFrame>): void => {
    if (finished) {
      throw new CompilerError("INPUT_INVALID", "Canonical alpha audit is closed");
    }
    throwIfAborted(signal);
    validateFrame(candidate);
    const key = `${candidate.source}\u0000${String(candidate.frame)}`;
    if (unique.has(key)) return;
    unique.add(key);
    for (let offset = 3; offset < candidate.rgba.byteLength; offset += 4) {
      if (((offset - 3) / 4) % CANCELLATION_PIXEL_INTERVAL === 0) {
        throwIfAborted(signal);
      }
      const alpha = candidate.rgba[offset]!;
      if (alpha < minimumAlpha) minimumAlpha = alpha;
      if (alpha === 255) continue;
      const pixel = (offset - 3) / 4;
      const location = Object.freeze({
        source: candidate.source,
        frame: candidate.frame,
        x: pixel % candidate.width,
        y: Math.floor(pixel / candidate.width),
        alpha
      });
      if (
        firstNonopaque === null ||
        compareLocation(location, firstNonopaque) < 0
      ) {
        firstNonopaque = location;
      }
    }
  };
  const finish = (): Readonly<AlphaAuditSummary> => {
    throwIfAborted(signal);
    if (finished) {
      throw new CompilerError("INPUT_INVALID", "Canonical alpha audit is closed");
    }
    finished = true;
    if (unique.size < 1) {
      throw new CompilerError("INPUT_INVALID", "Canonical alpha audit is empty");
    }
    return Object.freeze({
      uniqueReferencedFrames: unique.size,
      minimumAlpha,
      allOpaque: firstNonopaque === null,
      firstNonopaque
    });
  };
  return Object.freeze({ include, finish });
}

/** Resolve the one asset-wide encoder profile from a completed byte audit. */
export function resolveAlphaPolicy(
  requested: SourceAlphaPolicy,
  audit: Readonly<AlphaAuditSummary>,
  options: {
    readonly rejectionCode?: "ALPHA_POLICY_REJECTED" | "OPAQUE_ONLY_M5";
  } = {}
): Readonly<AlphaPolicyDecision> {
  if (requested !== "auto" && requested !== "opaque" && requested !== "packed") {
    throw new CompilerError("INPUT_INVALID", "Alpha policy is invalid");
  }
  validateAudit(audit);
  if (requested === "opaque" && !audit.allOpaque) {
    const first = audit.firstNonopaque!;
    throw new CompilerError(
      options.rejectionCode ?? "ALPHA_POLICY_REJECTED",
      "Explicit opaque alpha policy rejected a nonopaque canonical pixel",
      {
        source: first.source,
        frame: first.frame,
        x: first.x,
        y: first.y,
        alpha: first.alpha,
        statistic: "minimum-alpha",
        value: audit.minimumAlpha,
        limit: 255,
        policy: requested,
        phase: "classification"
      }
    );
  }
  const selected = requested === "auto"
    ? (audit.allOpaque ? "opaque" : "packed")
    : requested;
  const warnings = requested === "packed" && audit.allOpaque
    ? Object.freeze([
        "Packed alpha was requested for fully opaque canonical pixels"
      ])
    : Object.freeze([] as string[]);
  return Object.freeze({
    requested,
    selected,
    audit,
    warnings
  });
}

/** Merge independently streamed source audits into the one asset decision. */
export function mergeCanonicalAlphaAudits(
  audits: readonly Readonly<AlphaAuditSummary>[]
): Readonly<AlphaAuditSummary> {
  if (!Array.isArray(audits) || audits.length < 1 || audits.length > 32) {
    throw new CompilerError("INPUT_INVALID", "Canonical alpha audit set is invalid");
  }
  let uniqueReferencedFrames = 0;
  let minimumAlpha = 255;
  let firstNonopaque: Readonly<AlphaPixelLocation> | null = null;
  for (const audit of audits) {
    validateAudit(audit);
    if (
      uniqueReferencedFrames >
      Number.MAX_SAFE_INTEGER - audit.uniqueReferencedFrames
    ) {
      throw new CompilerError(
        "SOURCE_LIMIT",
        "Canonical alpha audit reference count exceeds safe representation"
      );
    }
    uniqueReferencedFrames += audit.uniqueReferencedFrames;
    minimumAlpha = Math.min(minimumAlpha, audit.minimumAlpha);
    if (
      audit.firstNonopaque !== null &&
      (firstNonopaque === null ||
        compareLocation(audit.firstNonopaque, firstNonopaque) < 0)
    ) {
      firstNonopaque = audit.firstNonopaque;
    }
  }
  return Object.freeze({
    uniqueReferencedFrames,
    minimumAlpha,
    allOpaque: firstNonopaque === null,
    firstNonopaque
  });
}

function validateFrame(frame: Readonly<CanonicalAlphaFrame>): void {
  if (
    typeof frame !== "object" ||
    frame === null ||
    typeof frame.source !== "string" ||
    !IDENTIFIER_PATTERN.test(frame.source) ||
    !Number.isSafeInteger(frame.frame) ||
    frame.frame < 0 ||
    !Number.isSafeInteger(frame.width) ||
    !Number.isSafeInteger(frame.height) ||
    frame.width < 1 ||
    frame.height < 1 ||
    !(frame.rgba instanceof Uint8Array)
  ) {
    throw new CompilerError("INPUT_INVALID", "Canonical alpha frame is invalid");
  }
  const pixels = checkedProduct(frame.width, frame.height);
  const expectedBytes = checkedProduct(pixels, 4);
  if (
    frame.rgba.byteLength !== expectedBytes
  ) {
    throw new CompilerError(
      "SOURCE_LIMIT",
      "Canonical alpha frame geometry does not match its RGBA bytes"
    );
  }
}

function compareLocation(
  left: Readonly<AlphaPixelLocation>,
  right: Readonly<AlphaPixelLocation>
): number {
  if (left.source !== right.source) return left.source < right.source ? -1 : 1;
  if (left.frame !== right.frame) return left.frame - right.frame;
  if (left.y !== right.y) return left.y - right.y;
  return left.x - right.x;
}

function validateAudit(audit: Readonly<AlphaAuditSummary>): void {
  const first = audit.firstNonopaque;
  if (
    !Number.isSafeInteger(audit.uniqueReferencedFrames) ||
    audit.uniqueReferencedFrames < 1 ||
    !Number.isSafeInteger(audit.minimumAlpha) ||
    audit.minimumAlpha < 0 ||
    audit.minimumAlpha > 255 ||
    audit.allOpaque !== (first === null) ||
    audit.allOpaque !== (audit.minimumAlpha === 255) ||
    (first !== null && (
      typeof first.source !== "string" ||
      !IDENTIFIER_PATTERN.test(first.source) ||
      !Number.isSafeInteger(first.frame) ||
      first.frame < 0 ||
      !Number.isSafeInteger(first.x) ||
      first.x < 0 ||
      !Number.isSafeInteger(first.y) ||
      first.y < 0 ||
      !Number.isSafeInteger(first.alpha) ||
      first.alpha < 0 ||
      first.alpha >= 255 ||
      audit.minimumAlpha > first.alpha
    ))
  ) {
    throw new CompilerError("INPUT_INVALID", "Canonical alpha audit is invalid");
  }
}

function checkedProduct(left: number, right: number): number {
  if (left > Math.floor(Number.MAX_SAFE_INTEGER / right)) {
    throw new CompilerError(
      "SOURCE_LIMIT",
      "Canonical alpha frame geometry exceeds safe byte representation"
    );
  }
  return left * right;
}
