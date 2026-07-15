export interface ReleasePolicy {
  readonly releaseVersion: "1.0.0";
  readonly publicPackages: readonly string[];
}

export interface InspectedReleasePackage {
  readonly name: string;
  readonly version: "1.0.0";
  readonly filename: string;
  readonly path: string;
  readonly bytes: Buffer;
  readonly byteLength: number;
  readonly unpackedSize: number;
  readonly tarballSha256: string;
  readonly registryIntegrity: string;
  readonly fileListSha256: string;
  readonly files: readonly string[];
  readonly manifest: Readonly<Record<string, unknown>>;
}

export const RELEASE_VERSION: "1.0.0";
export const RELEASE_PACKAGE_NAMES: readonly string[];
export const RELEASE_PACKAGE_SPECS: readonly Readonly<{ name: string; directory: string; dependencies: readonly string[] }>[];
export function releasePackageDirectory(name: string): string;
export function releaseArchiveFilename(name: string): string;
export function topologicalPackageOrder(specifications: readonly Readonly<{ name: string; dependencies: readonly string[] }>[]): string[];
export function validateReleasePolicy<T extends ReleasePolicy>(policy: T): T;
export function validateReleasePackageManifests<T extends object>(manifests: readonly T[]): readonly T[];
export function computeReleaseSetDigest(packages: readonly InspectedReleasePackage[]): string;
export function loadVerifiedReleaseSet(input: { directory: string; policy: ReleasePolicy; packageIndex?: unknown }): Promise<Readonly<{
  schemaVersion: "1.0";
  releaseVersion: "1.0.0";
  order: readonly string[];
  packages: readonly InspectedReleasePackage[];
  manifests: readonly Readonly<Record<string, unknown>>[];
  releaseSetDigest: string;
}>>;
export function reconcilePackageIndex(input: unknown, packages: readonly InspectedReleasePackage[]): void;
export function reconcilePackageInspection(input: unknown, releaseSet: Awaited<ReturnType<typeof loadVerifiedReleaseSet>>): void;
export function releaseSetSummary(releaseSet: Awaited<ReturnType<typeof loadVerifiedReleaseSet>>): Readonly<Record<string, unknown>>;
