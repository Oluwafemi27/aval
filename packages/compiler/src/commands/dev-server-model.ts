import { FORMAT_DEFAULT_BUDGETS } from "@aval/format";

export interface DevServerBuild {
  readonly generation: number;
  readonly bytes: number;
  readonly sha256: string;
  readonly warnings: readonly string[];
  readonly report?: Readonly<DevServerReport>;
}

export interface DevServerReport {
  readonly frameRate: string;
  readonly units: readonly Readonly<{
    id: string;
    kind: string;
    frameRange: readonly [number, number];
    timeRange: readonly [string, string];
  }>[];
  readonly geometry: Readonly<{
    visibleWidth: number;
    visibleHeight: number;
    codedWidth: number;
    codedHeight: number;
  }>;
  readonly alpha: "opaque" | "packed";
  readonly continuityPassed: number;
  readonly continuityCuts: number;
  readonly alphaAuditedFrames: number;
}

export const MAX_ASSET_BYTES = FORMAT_DEFAULT_BUDGETS.maxFileBytes;
const MAX_WARNINGS = 64;

export function normalizePublishedBuild(
  build: Readonly<DevServerBuild>,
  priorGeneration: number | null
): Readonly<DevServerBuild> {
  if (
    build === null || typeof build !== "object" ||
    !Number.isSafeInteger(build.generation) || build.generation < 1 ||
    (priorGeneration !== null && build.generation <= priorGeneration) ||
    !Number.isSafeInteger(build.bytes) || build.bytes < 1 ||
    build.bytes > MAX_ASSET_BYTES ||
    typeof build.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(build.sha256) ||
    !Array.isArray(build.warnings) || build.warnings.length > MAX_WARNINGS ||
    !build.warnings.every((warning) => typeof warning === "string" && warning.length <= 512)
  ) throw new TypeError("dev build publication is malformed");
  return Object.freeze({
    generation: build.generation,
    bytes: build.bytes,
    sha256: build.sha256,
    warnings: Object.freeze([...build.warnings]),
    ...(build.report === undefined ? {} : { report: normalizeReport(build.report) })
  });
}

function normalizeReport(value: Readonly<DevServerReport>): Readonly<DevServerReport> {
  const integer = (input: number): number => Number.isSafeInteger(input) && input >= 0 ? input : 0;
  const text = (input: string): string => typeof input === "string" ? input.slice(0, 256) : "";
  return Object.freeze({
    frameRate: text(value.frameRate),
    units: Object.freeze((Array.isArray(value.units) ? value.units : []).slice(0, 256).map((unit) => Object.freeze({
      id: text(unit.id),
      kind: text(unit.kind),
      frameRange: Object.freeze([integer(unit.frameRange?.[0] ?? 0), integer(unit.frameRange?.[1] ?? 0)] as const),
      timeRange: Object.freeze([text(unit.timeRange?.[0] ?? ""), text(unit.timeRange?.[1] ?? "")] as const)
    }))),
    geometry: Object.freeze({
      visibleWidth: integer(value.geometry?.visibleWidth ?? 0),
      visibleHeight: integer(value.geometry?.visibleHeight ?? 0),
      codedWidth: integer(value.geometry?.codedWidth ?? 0),
      codedHeight: integer(value.geometry?.codedHeight ?? 0)
    }),
    alpha: value.alpha === "packed" ? "packed" : "opaque",
    continuityPassed: integer(value.continuityPassed),
    continuityCuts: integer(value.continuityCuts),
    alphaAuditedFrames: integer(value.alphaAuditedFrames)
  });
}
