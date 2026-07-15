import { createHash } from "node:crypto";

import { canonicalJsonBytes } from "./canonical-json.js";
import { PUBLIC_RELEASE_PACKAGES } from "./compatibility.js";
import { SHA256_PATTERN } from "./model.js";

const INTEGRITY = /^sha512-[A-Za-z0-9+/]{86}==$/u;
const TAG = /^[a-z][a-z0-9._-]{0,63}$/u;
const VERSION = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const APPROVAL = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{7,255}$/u;
const RELEASE_PACKAGES = PUBLIC_RELEASE_PACKAGES;

export interface RegistryPackageState {
  readonly name: string;
  readonly version: string;
  readonly integrity: string | null;
  readonly tags: Readonly<Record<string, string | null>>;
  readonly deprecation?: string | null;
}

export type PublicationResult = "planned" | "applied" | "already-exact" | "failed" | "ambiguous" | "conflict";

export interface PublicationOperation {
  readonly sequence: number;
  readonly action: "publish" | "tag" | "deprecate" | "rollback-tag";
  readonly packageName: string;
  readonly version: string;
  readonly tarballSha256: string;
  readonly registryIntegrity: string;
  readonly tag: string;
  readonly before: string | null;
  readonly after: string | null;
  readonly beforeStateDigest: string;
  readonly afterStateDigest: string | null;
  readonly result: PublicationResult;
  readonly timestamp: string;
  readonly approvalId: string;
}

export interface PublicationLedger {
  readonly schemaVersion: "1.0";
  readonly releaseVersion: "1.0.0";
  readonly phase: "publish-next" | "promote-latest" | "cleanup-next" | "rollback";
  readonly mode: "dry-run" | "executed";
  readonly status: "planned" | "passed" | "failed" | "inconclusive";
  readonly candidateManifestDigest: string;
  readonly releaseManifestDigest: string;
  readonly releaseSetDigest: string;
  readonly registryUrl: string;
  readonly registryUrlSha256: string;
  readonly previousLedgerDigest: string | null;
  readonly phaseEvidenceDigest: string | null;
  readonly createdAt: string;
  readonly operations: readonly PublicationOperation[];
}

interface OperationIdentity {
  readonly packageName: string;
  readonly version: "1.0.0";
  readonly tarballSha256: string;
  readonly registryIntegrity: string;
  readonly sequence: number;
  readonly timestamp: string;
  readonly approvalId: string;
}

export function registryStateDigest(state: RegistryPackageState): string {
  validateRegistry(state, state.name, state.version);
  return createHash("sha256").update(canonicalJsonBytes({
    name: state.name,
    version: state.version,
    integrity: state.integrity,
    tags: state.tags,
    deprecation: state.deprecation ?? null
  })).digest("hex");
}

export function publicationLedgerDigest(ledger: PublicationLedger): string {
  validatePublicationLedger(ledger);
  return createHash("sha256").update(canonicalJsonBytes(ledger)).digest("hex");
}

export function planExactPublication(input: OperationIdentity & { readonly desiredTag: "next"; readonly registry: RegistryPackageState }): PublicationOperation {
  validateIdentity(input);
  validateRegistry(input.registry, input.packageName, input.version);
  if (input.registry.integrity !== null && input.registry.integrity !== input.registryIntegrity) throw new Error("immutable registry version exists with different bytes");
  const before = input.registry.tags[input.desiredTag] ?? null;
  const alreadyExact = input.registry.integrity === input.registryIntegrity && before === input.version;
  return operation(input, input.registry, {
    action: input.registry.integrity === null ? "publish" : "tag",
    tag: input.desiredTag,
    before,
    after: input.version,
    result: alreadyExact ? "already-exact" : "planned"
  });
}

export function planExactTag(input: OperationIdentity & {
  readonly action: "tag" | "rollback-tag";
  readonly desiredTag: "latest" | "next";
  readonly targetVersion: string;
  readonly registry: RegistryPackageState;
  readonly requiredSourceTag?: Readonly<{ readonly tag: string; readonly version: string }>;
  readonly targetVersionAvailable?: boolean;
}): PublicationOperation {
  validateIdentity(input);
  validateRegistry(input.registry, input.packageName, input.version);
  exactIntegrity(input.registry.integrity, input.registryIntegrity);
  version(input.targetVersion, "targetVersion");
  if (input.targetVersionAvailable === false) throw new Error("target registry version is unavailable");
  if (input.requiredSourceTag !== undefined) {
    tag(input.requiredSourceTag.tag, "requiredSourceTag.tag");
    version(input.requiredSourceTag.version, "requiredSourceTag.version");
    if ((input.registry.tags[input.requiredSourceTag.tag] ?? null) !== input.requiredSourceTag.version) throw new Error(`required ${input.requiredSourceTag.tag} source tag is not exact`);
  }
  const before = input.registry.tags[input.desiredTag] ?? null;
  return operation(input, input.registry, {
    action: input.action,
    tag: input.desiredTag,
    before,
    after: input.targetVersion,
    result: before === input.targetVersion ? "already-exact" : "planned"
  });
}

export function planDeprecation(input: OperationIdentity & { readonly registry: RegistryPackageState; readonly message: string }): PublicationOperation {
  validateIdentity(input);
  validateRegistry(input.registry, input.packageName, input.version);
  exactIntegrity(input.registry.integrity, input.registryIntegrity);
  if (typeof input.message !== "string" || input.message.length < 1 || input.message.length > 512) throw new TypeError("deprecation message is invalid");
  const before = input.registry.deprecation ?? null;
  return operation(input, input.registry, {
    action: "deprecate", tag: "deprecated", before, after: input.message,
    result: before === input.message ? "already-exact" : "planned"
  });
}

/** Plan compensation only when the tag still contains the value this transaction wrote. */
export function planTagCompensation(input: OperationIdentity & {
  readonly desiredTag: "latest" | "next";
  readonly targetVersion: string | null;
  readonly requiredCurrentTag: string;
  readonly registry: RegistryPackageState;
}): PublicationOperation {
  validateIdentity(input);
  validateRegistry(input.registry, input.packageName, input.version);
  exactIntegrity(input.registry.integrity, input.registryIntegrity);
  if (input.targetVersion !== null) version(input.targetVersion, "targetVersion");
  version(input.requiredCurrentTag, "requiredCurrentTag");
  const before = input.registry.tags[input.desiredTag] ?? null;
  return operation(input, input.registry, {
    action: "rollback-tag", tag: input.desiredTag, before, after: input.targetVersion,
    result: before === input.targetVersion ? "already-exact" : before !== input.requiredCurrentTag ? "conflict" : "planned"
  });
}

export function completePublicationOperation(planned: PublicationOperation, observed: RegistryPackageState): PublicationOperation {
  validateOperation(planned, "operation");
  validateRegistry(observed, planned.packageName, planned.version);
  if (planned.result === "already-exact") return planned;
  if (planned.result !== "planned") throw new Error("only a planned operation can be completed");
  exactIntegrity(observed.integrity, planned.registryIntegrity);
  const applied = planned.action === "deprecate" ? observed.deprecation === planned.after : (observed.tags[planned.tag] ?? null) === planned.after;
  if (!applied) throw new Error("post-mutation registry state does not match the planned operation");
  return Object.freeze({ ...planned, afterStateDigest: registryStateDigest(observed), result: "applied" });
}

export function failPublicationOperation(planned: PublicationOperation, observed?: RegistryPackageState): PublicationOperation {
  return settleUnsuccessful(planned, "failed", observed);
}

export function markPublicationOperationAmbiguous(planned: PublicationOperation, observed?: RegistryPackageState): PublicationOperation {
  return settleUnsuccessful(planned, "ambiguous", observed);
}

export function validatePublicationLedger(input: unknown): PublicationLedger {
  const ledger = object(input, "ledger");
  exactKeys(ledger, "ledger", [
    "schemaVersion", "releaseVersion", "phase", "mode", "status",
    "candidateManifestDigest", "releaseManifestDigest", "releaseSetDigest",
    "registryUrl", "registryUrlSha256", "previousLedgerDigest", "phaseEvidenceDigest", "createdAt", "operations"
  ]);
  if (ledger.schemaVersion !== "1.0" || ledger.releaseVersion !== "1.0.0") throw new TypeError("publication ledger identity is invalid");
  if (!new Set(["publish-next", "promote-latest", "cleanup-next", "rollback"]).has(ledger.phase as string)) throw new TypeError("publication ledger phase is invalid");
  if (ledger.mode !== "dry-run" && ledger.mode !== "executed") throw new TypeError("publication ledger mode is invalid");
  if (!new Set(["planned", "passed", "failed", "inconclusive"]).has(ledger.status as string)) throw new TypeError("publication ledger status is invalid");
  for (const key of ["candidateManifestDigest", "releaseManifestDigest", "releaseSetDigest", "registryUrlSha256"] as const) digest(ledger[key], `ledger.${key}`);
  const registryUrl = exactRegistryUrl(ledger.registryUrl);
  if (createHash("sha256").update(registryUrl).digest("hex") !== ledger.registryUrlSha256) throw new Error("publication ledger registry URL digest mismatch");
  if (ledger.previousLedgerDigest !== null) digest(ledger.previousLedgerDigest, "ledger.previousLedgerDigest");
  if (ledger.phaseEvidenceDigest !== null) digest(ledger.phaseEvidenceDigest, "ledger.phaseEvidenceDigest");
  if ((ledger.phase === "promote-latest" || ledger.phase === "rollback") && ledger.phaseEvidenceDigest === null) throw new Error(`${String(ledger.phase)} ledger requires phase evidence`);
  timestamp(ledger.createdAt, "ledger.createdAt");
  if (!Array.isArray(ledger.operations) || ledger.operations.length < 1 || ledger.operations.length > 256) throw new RangeError("publication operation count is invalid");
  for (const [index, value] of ledger.operations.entries()) {
    const operation = validateOperation(value, `ledger.operations[${String(index)}]`);
    if (operation.sequence !== index + 1) throw new TypeError("publication operation sequence must be contiguous and ordered");
    if (ledger.mode === "dry-run" && operation.result !== "planned" && operation.result !== "already-exact") throw new TypeError("dry-run ledger contains an executed result");
  }
  if (ledger.mode === "dry-run" && ledger.status !== "planned") throw new TypeError("dry-run ledger status must be planned");
  if (ledger.mode === "executed" && ledger.status === "planned") throw new TypeError("executed ledger cannot remain planned");
  const results = (ledger.operations as readonly PublicationOperation[]).map(({ result }) => result);
  if (ledger.status === "passed" && results.some((result) => !new Set(["applied", "already-exact"]).has(result))) throw new TypeError("passed ledger contains an incomplete operation");
  if (ledger.status === "failed" && !results.some((result) => result === "failed")) throw new TypeError("failed ledger lacks a failed operation");
  if (ledger.status === "inconclusive" && !results.some((result) => result === "ambiguous" || result === "conflict")) throw new TypeError("inconclusive ledger lacks ambiguous/conflicting evidence");
  validatePhaseOperations(ledger as unknown as PublicationLedger);
  return input as PublicationLedger;
}

export function assertPromotionAllowed(ledger: PublicationLedger, packageNames: readonly string[], expected?: Readonly<{ candidateManifestDigest: string; releaseManifestDigest: string; releaseSetDigest: string }>): void {
  validatePublicationLedger(ledger);
  if (ledger.phase !== "publish-next" || ledger.mode !== "executed" || ledger.status !== "passed") throw new Error("latest promotion requires a passed executed next-publication ledger");
  if (expected !== undefined) for (const key of ["candidateManifestDigest", "releaseManifestDigest", "releaseSetDigest"] as const) if (ledger[key] !== expected[key]) throw new Error(`promotion ${key} does not match authorized release`);
  for (const name of packageNames) {
    const next = [...ledger.operations].reverse().find((operation) => operation.packageName === name && operation.tag === "next");
    if (next === undefined || (next.result !== "applied" && next.result !== "already-exact") || next.after !== "1.0.0") throw new Error(`package ${name} has not completed exact next publication`);
  }
}

export function rollbackOrder(packageNames: readonly string[]): readonly string[] { return Object.freeze([...packageNames].reverse()); }

export interface PublicationSimulationResult { readonly publishedNext: readonly string[]; readonly promotedLatest: readonly string[]; readonly failedAt: string | null; readonly rollback: readonly string[]; }
export function simulatePublication(input: { readonly packageNames: readonly string[]; readonly failBeforeIndex?: number; readonly registryConsumerPassed: boolean }): PublicationSimulationResult {
  if (input.packageNames.length === 0 || input.packageNames.length > 256) throw new RangeError("packageNames length is invalid");
  if (new Set(input.packageNames).size !== input.packageNames.length) throw new TypeError("packageNames contains duplicates");
  const failBefore = input.failBeforeIndex ?? -1;
  if (!Number.isSafeInteger(failBefore) || failBefore < -1 || failBefore >= input.packageNames.length) throw new RangeError("failBeforeIndex is invalid");
  const publishedNext: string[] = [];
  let failedAt: string | null = null;
  for (const [index, name] of input.packageNames.entries()) { if (index === failBefore) { failedAt = name; break; } publishedNext.push(name); }
  const complete = failedAt === null && publishedNext.length === input.packageNames.length && input.registryConsumerPassed;
  return Object.freeze({ publishedNext: Object.freeze(publishedNext), promotedLatest: Object.freeze(complete ? [...input.packageNames] : []), failedAt, rollback: Object.freeze(complete ? [] : [...rollbackOrder(publishedNext)]) });
}

function operation(identity: OperationIdentity, registry: RegistryPackageState, change: Pick<PublicationOperation, "action" | "tag" | "before" | "after" | "result">): PublicationOperation {
  const beforeStateDigest = registryStateDigest(registry);
  return Object.freeze({
    sequence: identity.sequence, action: change.action, packageName: identity.packageName, version: identity.version,
    tarballSha256: identity.tarballSha256, registryIntegrity: identity.registryIntegrity, tag: change.tag,
    before: change.before, after: change.after, beforeStateDigest,
    afterStateDigest: change.result === "already-exact" || change.result === "conflict" ? beforeStateDigest : null,
    result: change.result, timestamp: identity.timestamp, approvalId: identity.approvalId
  });
}

function settleUnsuccessful(planned: PublicationOperation, result: "failed" | "ambiguous", observed?: RegistryPackageState): PublicationOperation {
  validateOperation(planned, "operation");
  if (planned.result !== "planned") throw new Error("only a planned operation can be settled unsuccessfully");
  if (observed !== undefined) validateRegistry(observed, planned.packageName, planned.version);
  return Object.freeze({ ...planned, afterStateDigest: observed === undefined ? null : registryStateDigest(observed), result });
}

function validateIdentity(input: OperationIdentity): void {
  if (!RELEASE_PACKAGES.includes(input.packageName as (typeof RELEASE_PACKAGES)[number])) throw new TypeError("invalid package name");
  if (input.version !== "1.0.0") throw new TypeError("publication version must be 1.0.0");
  digest(input.tarballSha256, "tarballSha256");
  integrity(input.registryIntegrity, "registry integrity");
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 1 || input.sequence > 256) throw new RangeError("publication sequence is invalid");
  timestamp(input.timestamp, "publication timestamp");
  if (typeof input.approvalId !== "string" || !APPROVAL.test(input.approvalId)) throw new TypeError("publication approval ID is invalid");
}

function validateOperation(input: unknown, path: string): PublicationOperation {
  const operationValue = object(input, path);
  exactKeys(operationValue, path, ["sequence", "action", "packageName", "version", "tarballSha256", "registryIntegrity", "tag", "before", "after", "beforeStateDigest", "afterStateDigest", "result", "timestamp", "approvalId"]);
  const operation = input as PublicationOperation;
  validateIdentity(operation as unknown as OperationIdentity);
  if (!new Set(["publish", "tag", "deprecate", "rollback-tag"]).has(operation.action)) throw new TypeError(`${path}.action is invalid`);
  tag(operation.tag, `${path}.tag`);
  if (operation.before !== null && (typeof operation.before !== "string" || operation.before.length > 512)) throw new TypeError(`${path}.before is invalid`);
  if (operation.after === null) { if (operation.action !== "rollback-tag") throw new TypeError(`${path}.after may be null only for tag compensation`); }
  else if (typeof operation.after !== "string" || operation.after.length < 1 || operation.after.length > 512) throw new TypeError(`${path}.after is invalid`);
  digest(operation.beforeStateDigest, `${path}.beforeStateDigest`);
  if (operation.afterStateDigest !== null) digest(operation.afterStateDigest, `${path}.afterStateDigest`);
  if (!new Set<PublicationResult>(["planned", "applied", "already-exact", "failed", "ambiguous", "conflict"]).has(operation.result)) throw new TypeError(`${path}.result is invalid`);
  if ((operation.result === "applied" || operation.result === "already-exact" || operation.result === "conflict") && operation.afterStateDigest === null) throw new TypeError(`${path}.afterStateDigest is required for terminal observed state`);
  return operation;
}

function validateRegistry(state: RegistryPackageState, name: string, requestedVersion: string): void {
  if (state === null || typeof state !== "object") throw new TypeError("registry read is invalid");
  if (state.name !== name || state.version !== requestedVersion) throw new Error("registry read does not identify requested package/version");
  if (state.integrity !== null) integrity(state.integrity, "registry integrity");
  if (state.tags === null || typeof state.tags !== "object" || Array.isArray(state.tags)) throw new TypeError("registry returned invalid dist-tags");
  const tags = Object.entries(state.tags);
  if (tags.length > 64) throw new RangeError("registry returned too many dist-tags");
  for (const [tagName, value] of tags) { tag(tagName, "registry tag"); if (value !== null) version(value, "registry tag version"); }
  if (state.deprecation !== undefined && state.deprecation !== null && (typeof state.deprecation !== "string" || state.deprecation.length > 512)) throw new TypeError("registry returned an invalid deprecation");
}

function exactRegistryUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 512) throw new TypeError("registry URL is invalid");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "" || !url.pathname.endsWith("/") || url.href !== value) throw new TypeError("registry URL must be credential-free canonical HTTPS");
  return url.href;
}
function integrity(value: unknown, path: string): string {
  if (typeof value !== "string" || !INTEGRITY.test(value)) throw new TypeError(`${path} is not canonical SHA-512 integrity`);
  const encoded = value.slice("sha512-".length);
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.byteLength !== 64 || bytes.toString("base64") !== encoded) throw new TypeError(`${path} is not canonical SHA-512 integrity`);
  return value;
}

function validatePhaseOperations(ledger: PublicationLedger): void {
  const operations = ledger.operations;
  for (const operation of operations) if (!RELEASE_PACKAGES.includes(operation.packageName as typeof RELEASE_PACKAGES[number])) throw new TypeError(`publication ledger contains an unknown package: ${operation.packageName}`);
  if (ledger.phase === "publish-next") {
    validateForwardWithCompensation(operations, new Set(["publish", "tag"]), "next");
    if ((ledger.mode === "dry-run" || ledger.status === "passed") && !isExactPrimarySet(operations, new Set(["publish", "tag"]), "next", RELEASE_PACKAGES)) throw new TypeError("publish-next ledger does not cover the exact release set in dependency order");
    return;
  }
  if (ledger.phase === "promote-latest") {
    validateForwardWithCompensation(operations, new Set(["tag"]), "latest");
    if ((ledger.mode === "dry-run" || ledger.status === "passed") && !isExactPrimarySet(operations, new Set(["tag"]), "latest", RELEASE_PACKAGES)) throw new TypeError("promote-latest ledger does not cover the exact release set in dependency order");
    return;
  }
  if (ledger.phase === "cleanup-next") {
    validateExactActionOrder(operations, "rollback-tag", "next", [...RELEASE_PACKAGES].reverse(), ledger.status === "passed");
    return;
  }
  validateRollbackOperations(ledger);
}

function validateForwardWithCompensation(operations: readonly PublicationOperation[], primaryActions: ReadonlySet<string>, primaryTag: string): void {
  let primaryCount = 0;
  while (primaryCount < operations.length && primaryActions.has(operations[primaryCount]!.action)) primaryCount += 1;
  if (primaryCount < 1 || primaryCount > RELEASE_PACKAGES.length) throw new TypeError("publication ledger primary operation count is invalid");
  for (let index = 0; index < primaryCount; index += 1) {
    const operation = operations[index]!;
    if (operation.packageName !== RELEASE_PACKAGES[index] || operation.tag !== primaryTag || operation.after !== "1.0.0") throw new TypeError("publication ledger primary operations are not the exact ordered release prefix");
  }
  const eligibleCompensation = new Set(operations.slice(0, primaryCount).filter(({ result }) => result === "applied" || result === "ambiguous").map(({ packageName }) => packageName));
  let previousIndex: number = RELEASE_PACKAGES.length;
  const compensated = new Set<string>();
  for (const operation of operations.slice(primaryCount)) {
    const index = RELEASE_PACKAGES.indexOf(operation.packageName as typeof RELEASE_PACKAGES[number]);
    if (operation.action !== "rollback-tag" || operation.tag !== primaryTag || index >= previousIndex || !eligibleCompensation.has(operation.packageName) || compensated.has(operation.packageName)) throw new TypeError("publication ledger compensation operations are invalid");
    previousIndex = index;
    compensated.add(operation.packageName);
  }
}

function isExactPrimarySet(operations: readonly PublicationOperation[], actions: ReadonlySet<string>, tagName: string, order: readonly string[]): boolean {
  return operations.length === order.length && operations.every((operation, index) => actions.has(operation.action) && operation.packageName === order[index] && operation.tag === tagName && operation.after === "1.0.0");
}

function validateExactActionOrder(operations: readonly PublicationOperation[], action: PublicationOperation["action"], tagName: string, order: readonly string[], requireComplete: boolean): void {
  if (operations.length > order.length || (requireComplete && operations.length !== order.length)) throw new TypeError("publication ledger package coverage is invalid");
  for (const [index, operation] of operations.entries()) if (operation.action !== action || operation.tag !== tagName || operation.packageName !== order[index]) throw new TypeError("publication ledger operation order is invalid");
}

function validateRollbackOperations(ledger: PublicationLedger): void {
  const order = [...RELEASE_PACKAGES].reverse();
  const noPriorRelease = ledger.operations[0]?.action === "rollback-tag" && ledger.operations[0].tag === "latest" && ledger.operations[0].after === null;
  const shape = noPriorRelease
    ? Object.freeze([
        Object.freeze({ action: "rollback-tag" as const, tag: "latest", after: null }),
        Object.freeze({ action: "rollback-tag" as const, tag: "next", after: null }),
        Object.freeze({ action: "deprecate" as const, tag: "deprecated", after: undefined })
      ])
    : Object.freeze([
        Object.freeze({ action: "rollback-tag" as const, tag: "latest", after: undefined }),
        Object.freeze({ action: "deprecate" as const, tag: "deprecated", after: undefined })
      ]);
  const maximum = order.length * shape.length;
  if (ledger.operations.length > maximum) throw new TypeError("rollback ledger has too many operations");
  let priorVersion: string | null = null;
  for (const [index, operation] of ledger.operations.entries()) {
    const expected = shape[index % shape.length]!;
    const packageName = order[Math.floor(index / shape.length)];
    if (operation.packageName !== packageName || operation.action !== expected.action || operation.tag !== expected.tag || (expected.after === null && operation.after !== null)) throw new TypeError("rollback ledger operations do not match the exact authorized reverse-order shape");
    if (!noPriorRelease && operation.action === "rollback-tag") {
      if (operation.after === null || operation.after === "1.0.0") throw new TypeError("rollback ledger previous release target is invalid");
      if (priorVersion === null) priorVersion = operation.after;
      else if (operation.after !== priorVersion) throw new TypeError("rollback ledger previous release targets are inconsistent");
    }
  }
  if ((ledger.mode === "dry-run" || ledger.status === "passed") && ledger.operations.length !== maximum) throw new TypeError("rollback ledger does not cover the exact release set");
}
function exactIntegrity(actual: string | null, expected: string): void { if (actual === null) throw new Error("required immutable registry version is unavailable"); if (actual !== expected) throw new Error("immutable registry version exists with different bytes"); }
function version(value: unknown, path: string): string { if (typeof value !== "string" || !VERSION.test(value) || value.length > 128) throw new TypeError(`${path} is not an exact version`); return value; }
function tag(value: unknown, path: string): string { if (typeof value !== "string" || !TAG.test(value)) throw new TypeError(`${path} is invalid`); return value; }
function digest(value: unknown, path: string): string { if (typeof value !== "string" || !SHA256_PATTERN.test(value)) throw new TypeError(`${path} is not a SHA-256 digest`); return value; }
function timestamp(value: unknown, path: string): string {
  if (typeof value !== "string" || !TIMESTAMP.test(value)) throw new TypeError(`${path} is invalid`);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) throw new TypeError(`${path} is not a canonical real UTC timestamp`);
  return value;
}
function object(value: unknown, path: string): Record<string, unknown> { if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${path} must be an object`); return value as Record<string, unknown>; }
function exactKeys(value: Record<string, unknown>, path: string, allowed: readonly string[]): void { const set = new Set(allowed); for (const key of Object.keys(value)) if (!set.has(key)) throw new TypeError(`${path}.${key} is an unknown field`); for (const key of allowed) if (!(key in value)) throw new TypeError(`${path}.${key} is required`); }
