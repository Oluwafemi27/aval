import { encodeReferenceFrame } from "../src/reference-frame.js";
import type {
  CanonicalAssetInputV01,
  CompiledManifestInputV01,
  CompiledManifestV01,
  ParsedFrontIndex
} from "../src/model.js";
import { validManifest } from "./manifest-fixture.js";

const PNG_SIGNATURE = Object.freeze([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
] as const);

function writeUint32BE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = Math.floor(value / 0x100_0000) & 0xff;
  bytes[offset + 1] = Math.floor(value / 0x1_0000) & 0xff;
  bytes[offset + 2] = Math.floor(value / 0x100) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

/** Build the shallow PNG profile intentionally accepted by M4. */
export function shallowPng(
  width: number,
  height: number,
  length = 33,
  marker = 0
): Uint8Array {
  if (!Number.isSafeInteger(length) || length < 33) {
    throw new Error("test PNG length must be at least 33");
  }
  const bytes = new Uint8Array(length);
  bytes.set(PNG_SIGNATURE, 0);
  writeUint32BE(bytes, 8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  writeUint32BE(bytes, 16, width);
  writeUint32BE(bytes, 20, height);
  bytes.set([8, 6, 0, 0, 0], 24);
  bytes.set([0xde, 0xad, 0xbe, 0xef], 29);
  if (length > 33) bytes[length - 1] = marker & 0xff;
  return bytes;
}

function manifestInputFromCompiled(
  manifest: CompiledManifestV01
): CompiledManifestInputV01 {
  const { units, staticFrames, ...rest } = manifest;
  return {
    ...rest,
    units: units.map((unit) => {
      const { samples, ...fields } = unit;
      return {
        ...fields,
        samples: samples.map(({ rendition, sha256 }) => ({ rendition, sha256 }))
      };
    }),
    staticFrames: staticFrames.map(({ id, width, height, sha256 }) => ({
      id,
      width,
      height,
      sha256
    }))
  } as CompiledManifestInputV01;
}

export interface WriterFixtureOptions {
  readonly generatorSuffix?: string;
  readonly staticLength?: number | ((index: number) => number);
}

/** A fresh valid writer input with real RMRF samples and shallow PNG payloads. */
export function validWriterInput(
  options: WriterFixtureOptions = {}
): CanonicalAssetInputV01 {
  const compiled = validManifest();
  const baseManifest = manifestInputFromCompiled(compiled);
  const manifest: CompiledManifestInputV01 = {
    ...baseManifest,
    generator: baseManifest.generator + (options.generatorSuffix ?? "")
  };

  let ordinal = 0;
  const accessUnits = compiled.renditions.flatMap((rendition) =>
    compiled.units.flatMap((unit) =>
      Array.from({ length: unit.frameCount }, (_, frameIndex) => {
        const bytes = encodeReferenceFrame({
          width: rendition.codedWidth,
          height: rendition.codedHeight,
          frameIndex,
          rgba: new Uint8Array(
            rendition.codedWidth * rendition.codedHeight * 4
          ).fill(ordinal++ & 0xff)
        });
        return {
          rendition: rendition.id,
          unit: unit.id,
          frameIndex,
          key: true,
          bytes
        };
      })
    )
  );
  const staticPayloads = compiled.staticFrames.map((frame, index) => ({
    staticFrame: frame.id,
    bytes: shallowPng(
      frame.width,
      frame.height,
      typeof options.staticLength === "function"
        ? options.staticLength(index)
        : (options.staticLength ?? 33 + index),
      index + 1
    )
  }));

  return { manifest, accessUnits, staticPayloads };
}

/** Extend the compact fixture to exercise rendition-major canonicalization. */
export function twoRenditionWriterInput(): CanonicalAssetInputV01 {
  const input = validWriterInput();
  const original = input.manifest.renditions[0]!;
  if (original.profile !== "reference-rgba-v0") {
    throw new Error("writer fixture expects its reference rendition first");
  }
  const alternate = { ...original, id: "alternate" };
  const units = input.manifest.units.map((unit) => ({
    ...unit,
    samples: [
      { rendition: alternate.id, sha256: unit.samples[0]!.sha256 },
      ...unit.samples
    ]
  })) as CompiledManifestInputV01["units"];
  return {
    ...input,
    manifest: {
      ...input.manifest,
      renditions: [alternate, original],
      units
    },
    accessUnits: [
      ...input.accessUnits.map((sample) => ({
        ...sample,
        rendition: alternate.id,
        bytes: sample.bytes.slice()
      })),
      ...input.accessUnits
    ]
  };
}

/** Build unchecked AVC payload lengths for large fixed-point offset boundaries. */
export function avcWriterInput(extraPayloadBytes: number): CanonicalAssetInputV01 {
  if (!Number.isSafeInteger(extraPayloadBytes) || extraPayloadBytes < 0) {
    throw new Error("extra payload bytes must be a nonnegative safe integer");
  }
  const input = validWriterInput();
  let remaining = extraPayloadBytes;
  const accessUnits = input.accessUnits.map((sample, ordinal) => {
    const extra = Math.min(remaining, 2 * 1024 * 1024 - 1);
    remaining -= extra;
    return {
      ...sample,
      bytes: new Uint8Array(1 + extra).fill(ordinal & 0xff)
    };
  });
  if (remaining !== 0) throw new Error("test payload capacity was exceeded");
  return {
    ...input,
    manifest: {
      ...input.manifest,
      renditions: [{
        id: "reference",
        profile: "avc-annexb-opaque-v0",
        codec: "avc1.42E020",
        codedWidth: 2,
        codedHeight: 2,
        alphaLayout: { type: "opaque-v0", colorRect: [0, 0, 2, 2] },
        bitrate: { average: 1_000, peak: 2_000 },
        capabilities: ["webcodecs", "webgl2"]
      }],
      limits: {
        ...input.manifest.limits,
        maxCompiledBytes: 32 * 1024 * 1024
      }
    },
    accessUnits
  };
}

/** Rebuild writer metadata from parsed values while reusing caller payloads. */
export function writerInputFromParsed(
  front: ParsedFrontIndex,
  payloads: Pick<CanonicalAssetInputV01, "accessUnits" | "staticPayloads">
): CanonicalAssetInputV01 {
  return {
    manifest: manifestInputFromCompiled(front.manifest),
    accessUnits: payloads.accessUnits,
    staticPayloads: payloads.staticPayloads
  };
}

/** Reverse all semantically unordered input arrays without changing meaning. */
export function shuffledWriterInput(
  input: CanonicalAssetInputV01
): CanonicalAssetInputV01 {
  return {
    manifest: {
      ...input.manifest,
      renditions: [...input.manifest.renditions].reverse(),
      units: [...input.manifest.units].reverse().map((unit) => {
        if (unit.kind === "body") {
          return {
            ...unit,
            samples: [...unit.samples].reverse(),
            ports: [...unit.ports].reverse().map((port) => ({
              ...port,
              portalFrames: [...port.portalFrames].reverse()
            }))
          };
        }
        if (unit.kind === "reversible") {
          return {
            ...unit,
            samples: [...unit.samples].reverse(),
            residency: {
              endpoints: [...unit.residency.endpoints].reverse() as [
                typeof unit.residency.endpoints[0],
                typeof unit.residency.endpoints[1]
              ]
            }
          };
        }
        return { ...unit, samples: [...unit.samples].reverse() };
      }),
      staticFrames: [...input.manifest.staticFrames].reverse(),
      states: [...input.manifest.states].reverse(),
      edges: [...input.manifest.edges].reverse(),
      bindings: [...input.manifest.bindings].reverse(),
      readiness: {
        ...input.manifest.readiness,
        bootstrapUnits: [...input.manifest.readiness.bootstrapUnits].reverse(),
        immediateEdges: [...input.manifest.readiness.immediateEdges].reverse()
      }
    },
    accessUnits: [...input.accessUnits].reverse(),
    staticPayloads: [...input.staticPayloads].reverse()
  };
}

export function byteIdentity(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index]);
}
