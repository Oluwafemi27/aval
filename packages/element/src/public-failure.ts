import type {
  RuntimeFailure,
  RuntimeFailureCode,
  StaticReason
} from "@aval/player-web";

import type {
  AvalElementFailureCode,
  AvalPublicFailure
} from "./public-types.js";

const MAX_PUBLIC_FAILURE_MESSAGE_LENGTH = 512;
const RUNTIME_CODE_RECORD: Readonly<Record<RuntimeFailureCode, true>> = Object.freeze({
  "invalid-asset": true,
  "load-failure": true,
  "range-response-invalid": true,
  "entity-changed": true,
  "integrity-mismatch": true,
  "unsupported-profile": true,
  "resource-rejection": true,
  "readiness-failure": true,
  "worker-decode-failure": true,
  "renderer-failure": true,
  "context-loss": true,
  "watchdog-timeout": true,
  underflow: true,
  abort: true,
  disposed: true
});
const STATIC_REASON_RECORD: Readonly<Record<StaticReason, true>> = Object.freeze({
  "reduced-motion": true,
  "no-avc-rendition": true,
  "worker-unavailable": true,
  "renderer-unavailable": true,
  "codec-unsupported": true,
  "resource-budget": true,
  "readiness-failed": true,
  "preparation-timeout": true,
  "animation-failure": true,
  "fallback-failure": true,
  "visibility-suspended": true,
  "decoder-queued": true
});
const RUNTIME_CODES: ReadonlySet<string> = new Set(Object.keys(RUNTIME_CODE_RECORD));
const STATIC_REASON_SET: ReadonlySet<string> = new Set(Object.keys(STATIC_REASON_RECORD));
const ELEMENT_CODES: ReadonlySet<string> = new Set([
  "invalid-configuration",
  "unsupported-browser",
  "interaction-target-unavailable",
  "element-cleanup-incomplete"
]);

export function normalizePublicFailure(
  error: unknown,
  fallbackCode: RuntimeFailureCode | AvalElementFailureCode = "readiness-failure"
): Readonly<AvalPublicFailure> {
  const runtime = readRuntimeFailure(error);
  const code = runtime?.code ?? (
    typeof error === "string" && ELEMENT_CODES.has(error)
      ? error as AvalElementFailureCode
      : fallbackCode
  );
  const operation = normalizeOperation(
    runtime === null ? undefined : ownDataProperty(runtime.context, "operation")
  );
  return Object.freeze({
    code,
    message: publicMessage(code).slice(0, MAX_PUBLIC_FAILURE_MESSAGE_LENGTH),
    operation
  });
}

export function normalizeStaticReason(value: unknown): StaticReason {
  return typeof value === "string" && STATIC_REASON_SET.has(value)
    ? value as StaticReason
    : "readiness-failed";
}

export function isExpectedAbort(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  return ownDataProperty(error, "name") === "AbortError";
}

function readRuntimeFailure(value: unknown): Readonly<RuntimeFailure> | null {
  const direct = asRuntimeFailure(value);
  if (direct !== null) return direct;
  if (value === null || typeof value !== "object") return null;
  return asRuntimeFailure(ownDataProperty(value, "failure"));
}

function asRuntimeFailure(value: unknown): Readonly<RuntimeFailure> | null {
  if (value === null || typeof value !== "object") return null;
  try {
    const code = ownDataProperty(value, "code");
    const context = ownDataProperty(value, "context");
    return typeof code === "string" &&
      RUNTIME_CODES.has(code) &&
      context !== null &&
      typeof context === "object"
      ? value as Readonly<RuntimeFailure>
      : null;
  } catch {
    return null;
  }
}

function ownDataProperty(value: object, key: PropertyKey): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && "value" in descriptor
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function normalizeOperation(value: unknown): string | null {
  return typeof value === "string" && /^[a-z0-9-]{1,128}$/u.test(value)
    ? value
    : null;
}

function publicMessage(
  code: RuntimeFailureCode | AvalElementFailureCode
): string {
  switch (code) {
    case "invalid-configuration":
      return "AVAL configuration is invalid";
    case "unsupported-browser":
      return "AVAL browser automation is unavailable";
    case "interaction-target-unavailable":
      return "AVAL interaction target is unavailable";
    case "element-cleanup-incomplete":
      return "AVAL element cleanup is incomplete";
    default:
      return `AVAL operation failed (${code})`;
  }
}
