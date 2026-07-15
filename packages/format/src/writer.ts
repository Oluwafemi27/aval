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

interface WriterLayout {
  readonly indexOffset: number;
  readonly indexLength: number;
  readonly records: readonly AccessUnitRecord[];
  readonly fileLength: number;
}

/** Write one byte-canonical version-0.1 aval asset. */
export function writeCanonicalAsset(
  input: CanonicalAssetInputV01,
  options?: FormatOptions
): Uint8Array {
  try {
    const normalized = normalizeWriterInput(input, options);
    const manifest = normalized.manifest;
    const manifestBytes = serializeCanonicalJson(manifest, options);
    const finalLayout = deriveLayout(
      normalized,
      manifest,
      manifestBytes,
      options
    );

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
      throw new FormatError(
        "WRITER_INVALID",
        `final file allocation of ${String(finalLayout.fileLength)} bytes failed`
      );
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
    options
  );
  return Object.freeze({
    indexOffset: plan.indexOffset,
    indexLength: plan.indexLength,
    records: plan.records,
    fileLength: plan.fileRange.length
  });
}
