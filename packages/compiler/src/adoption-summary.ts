import { basename } from "node:path";

import type { CompileResult } from "./model.js";

const SYNCHRONIZED_PUBLIC_VERSION = "1.0.0";

export interface CompileAdoptionUnitSummary {
  readonly id: string;
  readonly kind: "intro" | "body" | "transition";
  readonly frameRange: readonly [number, number];
  readonly timeRange: readonly [string, string];
}

export interface CompileAdoptionSummary {
  readonly summaryVersion: "0.1";
  readonly sourceMode: "project" | "direct-video" | "direct-png-sequence";
  readonly frameRate: Readonly<{ numerator: number; denominator: number; text: string }>;
  readonly units: readonly Readonly<CompileAdoptionUnitSummary>[];
  readonly geometry: Readonly<{
    visibleWidth: number;
    visibleHeight: number;
    codedWidth: number;
    codedHeight: number;
  }>;
  readonly alpha: "opaque" | "packed";
  readonly bytes: number;
  readonly resourceEstimate: Readonly<{
    maxCompiledBytes: number;
    maxRuntimeBytes: number;
    decodedPixelBytes: number;
    persistentCacheBytes: number;
    runtimeWorkingSetBytes: number;
  }>;
  readonly reports: Readonly<{
    continuityPassed: number;
    continuityCuts: number;
    alphaAuditedFrames: number;
  }>;
  readonly sha256: string;
  readonly snippets: Readonly<{ npm: string; html: string }>;
}

export function createCompileAdoptionSummary(
  result: Readonly<CompileResult>
): Readonly<CompileAdoptionSummary> {
  const details = result.buildDetails as Partial<CompileResult["buildDetails"]>;
  const manifest = details.manifest;
  const frameRate = manifest?.frameRate ?? { numerator: 1, denominator: 1 };
  let cursor = 0;
  const units = (manifest?.units ?? []).map((unit) => {
    const start = cursor;
    const end = start + unit.frameCount;
    cursor = end;
    return Object.freeze({
      id: unit.id,
      kind: unit.kind === "body"
        ? "body" as const
        : unit.kind === "one-shot"
          ? "intro" as const
          : "transition" as const,
      frameRange: Object.freeze([start, end] as const),
      timeRange: Object.freeze([
        frameTime(start, frameRate.numerator, frameRate.denominator),
        frameTime(end, frameRate.numerator, frameRate.denominator)
      ] as const)
    });
  });
  const rendition = details.renditions?.[0];
  const canvas = manifest?.canvas ?? { width: 0, height: 0 };
  const limits = manifest?.limits ?? {
    maxCompiledBytes: 0,
    maxRuntimeBytes: 0,
    decodedPixelBytes: 0,
    persistentCacheBytes: 0,
    runtimeWorkingSetBytes: 0
  };
  const alphaPolicy = details.alphaPolicy;
  const continuity = details.continuity ?? [];
  const fileName = safeAssetFileName(basename(result.outputPath));
  return Object.freeze({
    summaryVersion: "0.1" as const,
    sourceMode: details.mode ?? "project",
    frameRate: Object.freeze({
      numerator: frameRate.numerator,
      denominator: frameRate.denominator,
      text: `${String(frameRate.numerator)}/${String(frameRate.denominator)} fps`
    }),
    units: Object.freeze(units),
    geometry: Object.freeze({
      visibleWidth: canvas.width,
      visibleHeight: canvas.height,
      codedWidth: rendition?.codedWidth ?? canvas.width,
      codedHeight: rendition?.codedHeight ?? canvas.height
    }),
    alpha: alphaPolicy?.selected ?? "opaque",
    bytes: result.bytes,
    resourceEstimate: Object.freeze({ ...limits }),
    reports: Object.freeze({
      continuityPassed: continuity.filter(({ status }) => status === "pass").length,
      continuityCuts: continuity.filter(({ status }) => status === "cut").length,
      alphaAuditedFrames: alphaPolicy?.audit.uniqueReferencedFrames ?? 0
    }),
    sha256: result.sha256,
    snippets: Object.freeze({
      npm: `npm install @pixel-point/aval-element@${SYNCHRONIZED_PUBLIC_VERSION}`,
      html: `<aval-player src="./${fileName}"><span slot="fallback">Add an author-owned static fallback here.</span></aval-player>`
    })
  });
}

export function formatCompileAdoptionSummary(
  summary: Readonly<CompileAdoptionSummary>
): string {
  const units = summary.units.map((unit) =>
    `${unit.kind} ${unit.id}: frames ${String(unit.frameRange[0])}:${String(unit.frameRange[1])} (${unit.timeRange[0]}:${unit.timeRange[1]})`
  );
  return [
    `Frame rate: ${summary.frameRate.text}`,
    ...units,
    `Geometry: ${String(summary.geometry.visibleWidth)}x${String(summary.geometry.visibleHeight)} visible, ${String(summary.geometry.codedWidth)}x${String(summary.geometry.codedHeight)} coded, alpha ${summary.alpha}`,
    `Asset: ${String(summary.bytes)} bytes; SHA-256 ${summary.sha256}`,
    `Runtime estimate: ${String(summary.resourceEstimate.maxRuntimeBytes)} bytes`,
    `Reports: continuity ${String(summary.reports.continuityPassed)} passed, alpha frames ${String(summary.reports.alphaAuditedFrames)}`,
    summary.snippets.npm,
    summary.snippets.html
  ].join("\n");
}

function frameTime(frame: number, numerator: number, denominator: number): string {
  const seconds = frame * denominator / numerator;
  return `${seconds.toFixed(6).replace(/0+$/u, "").replace(/\.$/u, "")}s`;
}

function safeAssetFileName(value: string): string {
  return /^[A-Za-z0-9._-]{1,128}$/u.test(value) ? value : "motion.avl";
}
