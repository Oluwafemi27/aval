import { IDENTIFIER_PATTERN, SHA256_HEX_PATTERN } from "./constants.js";
import { FormatError } from "./errors.js";
import { utf8ByteLength } from "./utf8.js";
import type { ResidencyEndpointV01 } from "./model.js";

export function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(path, "must be an object");
  }
  return value as Record<string, unknown>;
}

export function array(value: unknown, path: string): readonly unknown[] {
  const result = arrayValue(value, path);
  requireDenseArray(result, path);
  return result;
}

function arrayValue(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    invalid(path, "must be an array");
  }
  return value;
}

function requireDenseArray(value: readonly unknown[], path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    if (!owns(value, String(index))) {
      invalid(`${path}[${String(index)}]`, "must not be sparse");
    }
  }
}

export function boundedArray(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number
): readonly unknown[] {
  const result = arrayValue(value, path);
  if (result.length < minimum || result.length > maximum) {
    invalid(
      path,
      `must contain between ${String(minimum)} and ${String(maximum)} entries`
    );
  }
  requireDenseArray(result, path);
  return result;
}

export function tuple(
  value: unknown,
  length: number,
  path: string
): readonly unknown[] {
  const result = arrayValue(value, path);
  if (result.length !== length) {
    invalid(path, `must contain exactly ${String(length)} entries`);
  }
  requireDenseArray(result, path);
  return result;
}

export function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  path: string,
  optional: readonly string[] = []
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) {
      invalid(
        path,
        `contains unknown field ${typeof key === "string" ? quote(key) : "[symbol]"}`
      );
    }
  }
  for (const key of required) {
    if (!owns(value, key)) {
      invalid(`${path}.${key}`, "is required");
    }
  }
}

export function owns(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function generatorString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    invalid(path, "must be a string");
  }
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) <= 0x1f) {
      invalid(path, "must not contain C0 controls");
    }
  }
  const length = utf8ByteLength(value, () =>
    invalid(path, "contains a lone surrogate")
  );
  if (length < 1 || length > 128) {
    invalid(path, "must contain between 1 and 128 UTF-8 bytes");
  }
  return value;
}

export function identifier(value: unknown, path: string): string {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    invalid(path, `must match ${String(IDENTIFIER_PATTERN)}`);
  }
  return value;
}

export function digest(value: unknown, path: string): string {
  if (typeof value !== "string" || !SHA256_HEX_PATTERN.test(value)) {
    invalid(path, "must be a lowercase 64-character SHA-256 hexadecimal string");
  }
  return value;
}

export function positiveInteger(
  value: unknown,
  path: string,
  maximum = Number.MAX_SAFE_INTEGER
): number {
  return integerInRange(value, path, 1, maximum);
}

export function nonNegativeInteger(value: unknown, path: string): number {
  return integerInRange(value, path, 0, Number.MAX_SAFE_INTEGER);
}

export function integerInRange(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    invalid(
      path,
      `must be a safe integer from ${String(minimum)} to ${String(maximum)}`
    );
  }
  return value;
}

export function literal<T extends string | number>(
  value: unknown,
  expected: T,
  path: string
): T {
  if (value !== expected) {
    invalid(path, `must be ${quote(String(expected))}`);
  }
  return expected;
}

export function oneOf<const T extends readonly string[]>(
  value: unknown,
  choices: T,
  path: string
): T[number] {
  if (typeof value !== "string" || !choices.includes(value)) {
    invalid(path, `must be one of ${choices.map(quote).join(", ")}`);
  }
  return value as T[number];
}

export function requireIdOrder(
  values: readonly { readonly id: string }[],
  path: string
): void {
  requireStringOrder(
    values.map((value) => value.id),
    path
  );
}

export function requireStringOrder(values: readonly string[], path: string): void {
  for (let index = 1; index < values.length; index += 1) {
    if (compareAscii(values[index - 1]!, values[index]!) >= 0) {
      invalid(path, "must be sorted by ID and contain no duplicates");
    }
  }
}

export function requireNumberOrder(values: readonly number[], path: string): void {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1]! >= values[index]!) {
      invalid(path, "must be numerically sorted and unique");
    }
  }
}

export function compareEndpoint(
  a: ResidencyEndpointV01,
  b: ResidencyEndpointV01
): number {
  return compareAscii(a.state, b.state) || compareAscii(a.port, b.port);
}

export function compareAscii(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function quote(value: string): string {
  return JSON.stringify(value);
}

export function invalid(path: string, message: string): never {
  throw new FormatError("MANIFEST_INVALID", `${path} ${message}`, { path });
}
