import { parseAccessUnitIndex } from "./access-unit-index.js";
import { parseCanonicalJson, serializeCanonicalJson } from "./canonical-json.js";
import { checkedAdd, requireByteRange } from "./checked-integer.js";
import { adaptManifestToMotionGraph } from "./graph-adapter.js";
import { parseHeader } from "./header.js";
import {
  deriveCanonicalAssetLayout,
  validateZeroPadding
} from "./layout.js";
import { validateCompiledManifestV01 } from "./manifest-schema.js";
import { validateReferenceFrame } from "./reference-frame.js";
import { FormatError, isFormatError } from "./errors.js";
import type {
  AccessUnitRecord,
  CompiledManifestV01,
  FormatHeader,
  FormatOptions,
  ParsedFrontIndex,
  ValidatedAssetLayout
} from "./model.js";

const HEADER_FIELDS = Object.freeze([
  "major",
  "minor",
  "headerLength",
  "requiredFeatureFlags",
  "declaredFileLength",
  "manifestOffset",
  "manifestLength",
  "indexOffset",
  "indexLength"
] as const satisfies readonly (keyof FormatHeader)[]);

const RECORD_FIELDS = Object.freeze([
  "payloadOffset",
  "payloadLength",
  "unitIndex",
  "renditionIndex",
  "key",
  "frameIndex"
] as const satisfies readonly (keyof AccessUnitRecord)[]);

function rethrowAtFileOffset(error: unknown, baseOffset: number): never {
  if (isFormatError(error)) {
    throw new FormatError(
      error.code,
      error.message,
      error.offset === undefined
        ? error.path === undefined
          ? undefined
          : { path: error.path }
        : error.path === undefined
          ? { offset: baseOffset + error.offset }
          : { path: error.path, offset: baseOffset + error.offset }
    );
  }
  throw error;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function assertMatchingFrontIndex(
  supplied: ParsedFrontIndex,
  reparsed: ParsedFrontIndex,
  options?: FormatOptions
): void {
  if (typeof supplied !== "object" || supplied === null) {
    throw new FormatError(
      "INPUT_INVALID",
      "supplied front index must be an object"
    );
  }
  for (const field of HEADER_FIELDS) {
    if (supplied.header[field] !== reparsed.header[field]) {
      throw new FormatError(
        "LAYOUT_INVALID",
        `supplied front index header field ${field} does not match the asset`
      );
    }
  }

  let suppliedManifestBytes: Uint8Array;
  let reparsedManifestBytes: Uint8Array;
  try {
    const suppliedManifest = validateCompiledManifestV01(
      supplied.manifest,
      options
    );
    suppliedManifestBytes = serializeCanonicalJson(suppliedManifest, options);
    reparsedManifestBytes = serializeCanonicalJson(reparsed.manifest, options);
  } catch (error) {
    if (isFormatError(error)) {
      throw new FormatError(
        "LAYOUT_INVALID",
        "supplied front index manifest is not the asset manifest"
      );
    }
    throw error;
  }
  if (!bytesEqual(suppliedManifestBytes, reparsedManifestBytes)) {
    throw new FormatError(
      "LAYOUT_INVALID",
      "supplied front index manifest does not match the asset"
    );
  }

  if (supplied.records.length !== reparsed.records.length) {
    throw new FormatError(
      "LAYOUT_INVALID",
      "supplied front index record count does not match the asset"
    );
  }
  for (let index = 0; index < reparsed.records.length; index += 1) {
    const suppliedRecord = supplied.records[index];
    const reparsedRecord = reparsed.records[index];
    if (suppliedRecord === undefined || reparsedRecord === undefined) {
      throw new FormatError(
        "LAYOUT_INVALID",
        "supplied front index record set is incomplete"
      );
    }
    for (const field of RECORD_FIELDS) {
      if (suppliedRecord[field] !== reparsedRecord[field]) {
        throw new FormatError(
          "LAYOUT_INVALID",
          `supplied front index record ${String(index)} field ${field} does not match the asset`
        );
      }
    }
  }
}

function parseManifest(
  bytes: Uint8Array,
  header: FormatHeader,
  options?: FormatOptions
): CompiledManifestV01 {
  const end = requireByteRange(
    bytes,
    header.manifestOffset,
    header.manifestLength,
    "JSON_INVALID",
    "manifest"
  );
  let parsed: unknown;
  try {
    parsed = parseCanonicalJson(
      bytes.subarray(header.manifestOffset, end),
      options
    );
  } catch (error) {
    rethrowAtFileOffset(error, header.manifestOffset);
  }
  return validateCompiledManifestV01(parsed, options);
}

/**
 * Parse exactly the bounded metadata prefix needed to route and range-load an
 * asset. Payload bytes, when present in the input view, are ignored.
 */
export function parseFrontIndex(
  bytesFromFileStart: Uint8Array,
  options?: FormatOptions
): ParsedFrontIndex {
  try {
    if (!(bytesFromFileStart instanceof Uint8Array)) {
      throw new FormatError(
        "INPUT_INVALID",
        "front-index input must be a Uint8Array"
      );
    }
    const header = parseHeader(bytesFromFileStart, options) as FormatHeader;
    const frontIndexEnd = checkedAdd(
      header.indexOffset,
      header.indexLength,
      header.declaredFileLength,
      "front index end"
    );
    if (bytesFromFileStart.byteLength < frontIndexEnd) {
      throw new FormatError("INDEX_INVALID", "front index is truncated", {
        offset: bytesFromFileStart.byteLength
      });
    }

    const manifest = parseManifest(bytesFromFileStart, header, options);
    const manifestEnd = checkedAdd(
      header.manifestOffset,
      header.manifestLength,
      header.indexOffset,
      "manifest end"
    );
    validateZeroPadding(bytesFromFileStart, [
      Object.freeze({
        offset: manifestEnd,
        length: header.indexOffset - manifestEnd
      })
    ]);

    let records: readonly AccessUnitRecord[];
    try {
      records = parseAccessUnitIndex(
        bytesFromFileStart.subarray(header.indexOffset, frontIndexEnd),
        manifest,
        options
      );
    } catch (error) {
      rethrowAtFileOffset(error, header.indexOffset);
    }

    const graph = adaptManifestToMotionGraph(manifest);
    const layout = deriveCanonicalAssetLayout(header, manifest, records, options);
    return Object.freeze({
      header,
      manifest,
      graph,
      records,
      frontIndexRange: layout.frontIndexRange,
      unitBlobs: layout.unitBlobs
    });
  } catch (error) {
    if (isFormatError(error)) {
      throw error;
    }
    throw new FormatError("INPUT_INVALID", "front index could not be parsed");
  }
}

function validatePayloadProfiles(
  bytes: Uint8Array,
  frontIndex: ParsedFrontIndex,
  options?: FormatOptions
): void {
  for (const record of frontIndex.records) {
    const rendition = frontIndex.manifest.renditions[record.renditionIndex];
    if (rendition?.profile !== "reference-rgba-v0") continue;
    const sampleEnd = checkedAdd(
      record.payloadOffset,
      record.payloadLength,
      bytes.byteLength,
      "reference sample end"
    );
    try {
      validateReferenceFrame({
        sample: bytes.subarray(record.payloadOffset, sampleEnd),
        expectedWidth: rendition.codedWidth,
        expectedHeight: rendition.codedHeight,
        expectedFrameIndex: record.frameIndex,
        options
      });
    } catch (error) {
      rethrowAtFileOffset(error, record.payloadOffset);
    }
  }

}

/** Reparse and completely validate one exact, caller-owned asset byte array. */
export function validateCompleteAsset(input: {
  readonly bytes: Uint8Array;
  readonly frontIndex?: ParsedFrontIndex;
  readonly options?: FormatOptions;
}): ValidatedAssetLayout {
  try {
    if (typeof input !== "object" || input === null) {
      throw new FormatError(
        "INPUT_INVALID",
        "complete-asset input must be an object"
      );
    }
    if (!(input.bytes instanceof Uint8Array)) {
      throw new FormatError("INPUT_INVALID", "asset bytes must be a Uint8Array");
    }

    const reparsed = parseFrontIndex(input.bytes, input.options);
    if (input.bytes.byteLength !== reparsed.header.declaredFileLength) {
      throw new FormatError(
        "LAYOUT_INVALID",
        input.bytes.byteLength < reparsed.header.declaredFileLength
          ? "asset bytes are truncated"
          : "asset contains bytes beyond the declared file length",
        {
          offset: Math.min(
            input.bytes.byteLength,
            reparsed.header.declaredFileLength
          )
        }
      );
    }
    if (input.frontIndex !== undefined) {
      assertMatchingFrontIndex(input.frontIndex, reparsed, input.options);
    }

    const layout = deriveCanonicalAssetLayout(
      reparsed.header,
      reparsed.manifest,
      reparsed.records,
      input.options
    );
    validateZeroPadding(input.bytes, layout.paddingRanges);
    validatePayloadProfiles(input.bytes, reparsed, input.options);

    return Object.freeze({
      frontIndex: reparsed,
      fileRange: layout.fileRange
    });
  } catch (error) {
    if (isFormatError(error)) {
      throw error;
    }
    throw new FormatError("INPUT_INVALID", "complete asset could not be validated");
  }
}
