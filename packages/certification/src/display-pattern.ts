export interface DisplayPatternDefinition {
  readonly bitWidth: 16;
  readonly calibrationPatchIds: readonly ["black", "white", "red", "green", "blue"];
  readonly markerKind: "aval-display";
  readonly markerVersion: "1.0";
  readonly modulus: 65_535;
  readonly parity: "xor-fold-v1";
}

export function validateDisplayPattern(input: unknown): DisplayPatternDefinition {
  const value = exactRecord(input, ["bitWidth", "calibrationPatchIds", "markerKind", "markerVersion", "modulus", "parity"], "$pattern");
  if (value.bitWidth !== 16 || value.markerKind !== "aval-display" || value.markerVersion !== "1.0" || value.modulus !== 65_535 || value.parity !== "xor-fold-v1") throw new TypeError("$pattern uses an unsupported marker contract");
  const patches = value.calibrationPatchIds;
  if (!Array.isArray(patches) || patches.length !== 5 || patches.some((patch, index) => patch !== ["black", "white", "red", "green", "blue"][index])) throw new TypeError("$pattern calibration patches are invalid");
  return Object.freeze({ bitWidth: 16, calibrationPatchIds: Object.freeze(["black", "white", "red", "green", "blue"] as const), markerKind: "aval-display", markerVersion: "1.0", modulus: 65_535, parity: "xor-fold-v1" });
}

export function displayMarkerFields(value: number, pattern: DisplayPatternDefinition): Readonly<{ readonly value: number; readonly complement: number; readonly parity: number }> {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("display marker value is invalid");
  const normalized = value & pattern.modulus;
  return Object.freeze({ value: normalized, complement: normalized ^ pattern.modulus, parity: parity(normalized, pattern.bitWidth) });
}

function parity(value: number, bits: number): number { let result = 0; for (let index = 0; index < bits; index += 1) result ^= (value >>> index) & 1; return result; }
function exactRecord(value: unknown, keys: readonly string[], path: string): Record<string, unknown> { if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${path} must be an object`); const record = value as Record<string, unknown>; const allowed = new Set(keys); for (const key of Object.keys(record)) if (!allowed.has(key)) throw new TypeError(`${path}.${key} is unknown`); for (const key of keys) if (!(key in record)) throw new TypeError(`${path}.${key} is required`); return record; }
