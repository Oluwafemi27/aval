import { encodeAccessUnitIndex } from "../src/access-unit-index.js";
import { serializeCanonicalJson } from "../src/canonical-json.js";
import { align8 } from "../src/checked-integer.js";
import {
  ACCESS_UNIT_INDEX_HEADER_LENGTH,
  ACCESS_UNIT_RECORD_LENGTH,
  FORMAT_HEADER_LENGTH
} from "../src/constants.js";
import { encodeHeader } from "../src/header.js";
import { encodeReferenceFrame } from "../src/reference-frame.js";
import { validateCompiledManifestV01 } from "../src/manifest-schema.js";
import type {
  AccessUnitRecord,
  CompiledManifestV01,
  FormatHeader
} from "../src/model.js";
import { validManifest } from "./manifest-fixture.js";
import { makeSizedTestPng } from "./png-test-fixture.js";

export interface AssetFixture {
  readonly bytes: Uint8Array;
  readonly manifest: CompiledManifestV01;
  readonly manifestBytes: Uint8Array;
  readonly records: readonly AccessUnitRecord[];
  readonly payloads: readonly Uint8Array[];
}

export interface AssetFixtureOptions {
  readonly profile?: "reference" | "avc";
  readonly sampleLength?: (ordinal: number) => number;
  readonly staticLength?: number;
  readonly generatorSuffix?: string;
}

type MutableManifest = CompiledManifestV01 & {
  generator: string;
  renditions: Array<CompiledManifestV01["renditions"][number]>;
  staticFrames: Array<{
    id: string;
    offset: number;
    length: number;
    width: number;
    height: number;
    sha256: string;
  }>;
};

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((value, index) => value === right[index]);
}

/** Build a small canonical asset without depending on the M4 writer. */
export function canonicalAssetFixture(
  options: AssetFixtureOptions = {}
): AssetFixture {
  const manifest = validManifest() as MutableManifest;
  if (options.generatorSuffix !== undefined) {
    manifest.generator += options.generatorSuffix;
  }
  if (options.profile === "avc") {
    manifest.renditions[0] = {
      id: "reference",
      profile: "avc-annexb-opaque-v0",
      codec: "avc1.42E020",
      codedWidth: 16,
      codedHeight: 16,
      alphaLayout: { type: "opaque-v0", colorRect: [0, 0, 2, 2] },
      bitrate: { average: 1_000, peak: 2_000 },
      capabilities: ["webcodecs", "webgl2"]
    };
    const limits = manifest.limits as {
      decodedPixelBytes: number;
      runtimeWorkingSetBytes: number;
    };
    limits.decodedPixelBytes = 1_024;
    limits.runtimeWorkingSetBytes = 1_024;
  }

  const staticLength = options.staticLength ?? 68;
  const staticPayload = makeSizedTestPng(2, 2, staticLength);
  for (const frame of manifest.staticFrames) {
    frame.length = staticPayload.byteLength;
    frame.offset = 0;
  }

  const payloads: Uint8Array[] = [];
  let ordinal = 0;
  for (const rendition of manifest.renditions) {
    for (const unit of manifest.units) {
      for (let frameIndex = 0; frameIndex < unit.frameCount; frameIndex += 1) {
        if (rendition.profile === "reference-rgba-v0") {
          payloads.push(
            encodeReferenceFrame({
              width: 2,
              height: 2,
              frameIndex,
              rgba: new Uint8Array(16).fill(ordinal & 0xff)
            })
          );
        } else {
          const length = options.sampleLength?.(ordinal) ?? 40;
          payloads.push(new Uint8Array(length).fill(ordinal & 0xff));
        }
        ordinal += 1;
      }
    }
  }

  const indexLength =
    ACCESS_UNIT_INDEX_HEADER_LENGTH +
    payloads.length * ACCESS_UNIT_RECORD_LENGTH;
  let manifestBytes: Uint8Array = new Uint8Array();
  let records: AccessUnitRecord[] = [];
  let declaredFileLength = 0;

  for (let iteration = 0; iteration < 32; iteration += 1) {
    manifestBytes = serializeCanonicalJson(manifest);
    const indexOffset = align8(FORMAT_HEADER_LENGTH + manifestBytes.byteLength);
    let cursor = indexOffset + indexLength;
    records = [];
    ordinal = 0;
    for (
      let renditionIndex = 0;
      renditionIndex < manifest.renditions.length;
      renditionIndex += 1
    ) {
      for (let unitIndex = 0; unitIndex < manifest.units.length; unitIndex += 1) {
        const unit = manifest.units[unitIndex];
        if (unit === undefined) throw new Error("test fixture unit missing");
        cursor = align8(cursor);
        for (let frameIndex = 0; frameIndex < unit.frameCount; frameIndex += 1) {
          const payload = payloads[ordinal];
          if (payload === undefined) throw new Error("test payload missing");
          records.push({
            payloadOffset: cursor,
            payloadLength: payload.byteLength,
            unitIndex,
            renditionIndex,
            key: true,
            frameIndex
          });
          cursor += payload.byteLength;
          ordinal += 1;
        }
      }
    }
    for (const frame of manifest.staticFrames) {
      cursor = align8(cursor);
      frame.offset = cursor;
      cursor += staticPayload.byteLength;
    }
    declaredFileLength = cursor;
    const next = serializeCanonicalJson(manifest);
    if (equalBytes(next, manifestBytes)) {
      manifestBytes = next;
      break;
    }
    if (iteration === 31) throw new Error("test fixture did not converge");
  }

  const validatedManifest = validateCompiledManifestV01(manifest);
  const indexOffset = align8(FORMAT_HEADER_LENGTH + manifestBytes.byteLength);
  const header: FormatHeader = {
    major: 0,
    minor: 1,
    headerLength: 64,
    requiredFeatureFlags: 0,
    declaredFileLength,
    manifestOffset: 64,
    manifestLength: manifestBytes.byteLength,
    indexOffset,
    indexLength
  };
  const headerBytes = encodeHeader(header);
  const indexBytes = encodeAccessUnitIndex(records, validatedManifest);
  const bytes = new Uint8Array(declaredFileLength);
  bytes.set(headerBytes, 0);
  bytes.set(manifestBytes, FORMAT_HEADER_LENGTH);
  bytes.set(indexBytes, indexOffset);
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const payload = payloads[index];
    if (record === undefined || payload === undefined) {
      throw new Error("test fixture record missing");
    }
    bytes.set(payload, record.payloadOffset);
  }
  for (let index = 0; index < validatedManifest.staticFrames.length; index += 1) {
    const frame = validatedManifest.staticFrames[index];
    if (frame === undefined) throw new Error("test static frame missing");
    bytes.set(staticPayload, frame.offset);
  }

  return {
    bytes,
    manifest: validatedManifest,
    manifestBytes,
    records: Object.freeze(records.map((record) => Object.freeze(record))),
    payloads: Object.freeze(payloads)
  };
}
