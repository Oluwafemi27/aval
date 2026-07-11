import { encodeAccessUnitIndex } from "./access-unit-index.js";
import { serializeCanonicalJson } from "./canonical-json.js";
import {
  FORMAT_HEADER_LENGTH,
  FORMAT_VERSION_MAJOR,
  FORMAT_VERSION_MINOR
} from "./constants.js";
import { FormatError, isFormatError } from "./errors.js";
import { encodeHeader } from "./header.js";
import { planCanonicalAssetLayout } from "./layout.js";
import { validateCompiledManifestV01 } from "./manifest-schema.js";
import type {
  AccessUnitRecord,
  CanonicalAssetInputV01,
  CompiledManifestV01,
  FormatHeader,
  FormatOptions
} from "./model.js";
import { validateCompleteAsset } from "./parser.js";
import {
  normalizeWriterInput,
  type NormalizedWriterInput
} from "./writer-normalize.js";
import { resolveByteStableFixedPoint } from "./writer-fixed-point.js";

const MAX_FIXED_POINT_ITERATIONS = 32;

interface WriterLayout {
  readonly indexOffset: number;
  readonly indexLength: number;
  readonly records: readonly AccessUnitRecord[];
  readonly staticOffsets: readonly number[];
  readonly fileLength: number;
}

/** Write one byte-canonical version-0.1 rendered-motion asset. */
export function writeCanonicalAsset(
  input: CanonicalAssetInputV01,
  options?: FormatOptions
): Uint8Array {
  try {
    const normalized = normalizeWriterInput(input, options);
    let manifest = normalized.manifest;
    let manifestBytes = serializeCanonicalJson(manifest, options);
    const fixedPoint = resolveByteStableFixedPoint(
      manifest,
      manifestBytes,
      MAX_FIXED_POINT_ITERATIONS,
      (currentManifest, currentBytes) => {
        const layout = deriveLayout(
          normalized,
          currentManifest,
          currentBytes,
          options
        );
        const nextManifest = withStaticOffsets(
          currentManifest,
          layout.staticOffsets,
          options
        );
        return {
          value: nextManifest,
          bytes: serializeCanonicalJson(nextManifest, options),
          result: layout
        };
      }
    );
    manifest = fixedPoint.value;
    manifestBytes = fixedPoint.bytes;
    let finalLayout = fixedPoint.result;

    const verifiedLayout = deriveLayout(
      normalized,
      manifest,
      manifestBytes,
      options
    );
    if (
      !sameNumbers(finalLayout.staticOffsets, verifiedLayout.staticOffsets) ||
      finalLayout.fileLength !== verifiedLayout.fileLength
    ) {
      throw new FormatError(
        "WRITER_NONCONVERGENT",
        "canonical layout did not remain at its fixed point"
      );
    }
    finalLayout = verifiedLayout;

    const header: FormatHeader = Object.freeze({
      major: FORMAT_VERSION_MAJOR,
      minor: FORMAT_VERSION_MINOR,
      headerLength: FORMAT_HEADER_LENGTH,
      requiredFeatureFlags: 0,
      declaredFileLength: finalLayout.fileLength,
      manifestOffset: FORMAT_HEADER_LENGTH,
      manifestLength: manifestBytes.byteLength,
      indexOffset: finalLayout.indexOffset,
      indexLength: finalLayout.indexLength
    });
    const headerBytes = encodeHeader(header, options);
    const indexBytes = encodeAccessUnitIndex(finalLayout.records, manifest, options);
    if (indexBytes.byteLength !== finalLayout.indexLength) {
      throw new FormatError("WRITER_INVALID", "encoded index length changed");
    }

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(finalLayout.fileLength);
    } catch {
      throw new FormatError("BUDGET_EXCEEDED", "final file allocation failed");
    }
    bytes.set(headerBytes, 0);
    bytes.set(manifestBytes, FORMAT_HEADER_LENGTH);
    bytes.set(indexBytes, finalLayout.indexOffset);

    for (let index = 0; index < normalized.accessUnits.length; index += 1) {
      const payload = normalized.accessUnits[index];
      const record = finalLayout.records[index];
      if (payload === undefined || record === undefined) {
        throw new FormatError("WRITER_INVALID", "access-unit layout is sparse");
      }
      bytes.set(payload.bytes, record.payloadOffset);
    }
    for (let index = 0; index < normalized.staticPayloads.length; index += 1) {
      const payload = normalized.staticPayloads[index];
      const offset = finalLayout.staticOffsets[index];
      if (payload === undefined || offset === undefined) {
        throw new FormatError("WRITER_INVALID", "static layout is sparse");
      }
      bytes.set(payload.bytes, offset);
    }

    validateCompleteAsset({
      bytes,
      ...(options === undefined ? {} : { options })
    });
    return bytes;
  } catch (error) {
    if (isFormatError(error)) throw error;
    throw new FormatError("WRITER_INVALID", "canonical asset could not be written");
  }
}

function deriveLayout(
  normalized: Readonly<NormalizedWriterInput>,
  manifest: CompiledManifestV01,
  manifestBytes: Uint8Array,
  options?: FormatOptions
): WriterLayout {
  const plan = planCanonicalAssetLayout(
    manifestBytes.byteLength,
    manifest,
    normalized.accessUnits.map(({ bytes, key }) => ({
      payloadLength: bytes.byteLength,
      key
    })),
    normalized.staticPayloads.map(({ bytes }) => bytes.byteLength),
    options
  );
  return Object.freeze({
    indexOffset: plan.indexOffset,
    indexLength: plan.indexLength,
    records: plan.records,
    staticOffsets: plan.staticOffsets,
    fileLength: plan.fileRange.length
  });
}

function withStaticOffsets(
  manifest: CompiledManifestV01,
  offsets: readonly number[],
  options?: FormatOptions
): CompiledManifestV01 {
  if (offsets.length !== manifest.staticFrames.length) {
    throw new FormatError("WRITER_INVALID", "static offset count changed");
  }
  return validateCompiledManifestV01(
    {
      ...manifest,
      staticFrames: manifest.staticFrames.map((frame, index) => {
        const offset = offsets[index];
        if (offset === undefined) {
          throw new FormatError("WRITER_INVALID", "static offsets are sparse");
        }
        return { ...frame, offset };
      })
    },
    options
  );
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
