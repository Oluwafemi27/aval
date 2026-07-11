import { createHash } from "node:crypto";

import { encodeReferenceFrame } from "../src/reference-frame.js";
import { writeCanonicalAsset } from "../src/writer.js";
import type {
  AccessUnitInputV01,
  CanonicalAssetInputV01,
  CompiledManifestInputV01,
  CompiledManifestV01,
  StaticPayloadInputV01,
  UnitInputV01,
  UnitV01
} from "../src/model.js";
import { validManifest } from "./manifest-fixture.js";

const DECLARED_DIGEST = "0".repeat(64);

export interface GeneratedConformanceFixture {
  readonly fileName: "reference-loop.rma" | "reference-graph.rma";
  readonly description: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

function writeUint32BE(
  bytes: Uint8Array,
  offset: number,
  value: number
): void {
  bytes[offset] = Math.floor(value / 0x100_0000) & 0xff;
  bytes[offset + 1] = Math.floor(value / 0x1_0000) & 0xff;
  bytes[offset + 2] = Math.floor(value / 0x100) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

/** A deterministic, shallow-M4 PNG envelope with deliberately unchecked CRC. */
function staticPng(marker: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  writeUint32BE(bytes, 8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  writeUint32BE(bytes, 16, 2);
  writeUint32BE(bytes, 20, 2);
  bytes[24] = 8;
  bytes[25] = 6;
  // Bytes 29..32 are the IHDR CRC in a complete PNG. M4 intentionally does
  // not validate it, so the marker also makes that scope boundary explicit.
  bytes[32] = marker & 0xff;
  return bytes;
}

function referenceRgba(ordinal: number): Uint8Array {
  const rgba = new Uint8Array(16);
  for (let pixel = 0; pixel < 4; pixel += 1) {
    const offset = pixel * 4;
    rgba[offset] = (ordinal * 37 + pixel * 53) & 0xff;
    rgba[offset + 1] = (ordinal * 71 + pixel * 29) & 0xff;
    rgba[offset + 2] = (ordinal * 19 + pixel * 97) & 0xff;
    rgba[offset + 3] = 0xff - ((ordinal + pixel) % 4) * 0x20;
  }
  return rgba;
}

function referenceAccessUnits(
  manifest: CompiledManifestInputV01
): readonly AccessUnitInputV01[] {
  const result: AccessUnitInputV01[] = [];
  let ordinal = 0;
  for (const rendition of manifest.renditions) {
    for (const unit of manifest.units) {
      for (let frameIndex = 0; frameIndex < unit.frameCount; frameIndex += 1) {
        result.push(
          Object.freeze({
            rendition: rendition.id,
            unit: unit.id,
            frameIndex,
            key: true,
            bytes: encodeReferenceFrame({
              width: rendition.codedWidth,
              height: rendition.codedHeight,
              frameIndex,
              rgba: referenceRgba(ordinal)
            })
          })
        );
        ordinal += 1;
      }
    }
  }
  return Object.freeze(result);
}

function unitInput(unit: UnitV01): UnitInputV01 {
  const samples = Object.freeze(
    unit.samples.map(({ rendition, sha256 }) =>
      Object.freeze({ rendition, sha256 })
    )
  );
  switch (unit.kind) {
    case "body":
      return Object.freeze({
        id: unit.id,
        kind: unit.kind,
        frameCount: unit.frameCount,
        playback: unit.playback,
        ports: unit.ports,
        samples
      });
    case "bridge":
    case "one-shot":
      return Object.freeze({
        id: unit.id,
        kind: unit.kind,
        frameCount: unit.frameCount,
        samples
      });
    case "reversible":
      return Object.freeze({
        id: unit.id,
        kind: unit.kind,
        frameCount: unit.frameCount,
        residency: unit.residency,
        samples
      });
  }
}

function writerInputFromManifest(
  source: CompiledManifestV01
): CanonicalAssetInputV01 {
  const { units, staticFrames, ...rest } = source;
  const manifest: CompiledManifestInputV01 = {
    ...rest,
    units: Object.freeze(units.map(unitInput)),
    staticFrames: Object.freeze(
      staticFrames.map(({ id, width, height, sha256 }) =>
        Object.freeze({ id, width, height, sha256 })
      )
    )
  };
  const staticPayloads: readonly StaticPayloadInputV01[] = Object.freeze(
    manifest.staticFrames.map((frame, index) =>
      Object.freeze({
        staticFrame: frame.id,
        bytes: staticPng(index + 1)
      })
    )
  );
  return Object.freeze({
    manifest,
    accessUnits: referenceAccessUnits(manifest),
    staticPayloads
  });
}

function referenceLoopInput(): CanonicalAssetInputV01 {
  const manifest: CompiledManifestInputV01 = {
    formatVersion: "0.1",
    generator: "rendered-motion-m4-reference-loop",
    canvas: {
      width: 2,
      height: 2,
      fit: "contain",
      pixelAspect: [1, 1],
      colorSpace: "srgb"
    },
    frameRate: { numerator: 30, denominator: 1 },
    renditions: [
      {
        id: "reference",
        profile: "reference-rgba-v0",
        codec: "rma.reference-rgba",
        codedWidth: 2,
        codedHeight: 2,
        alphaLayout: { type: "straight-rgba-v0" },
        capabilities: []
      }
    ],
    units: [
      {
        id: "idle-body",
        kind: "body",
        playback: "loop",
        frameCount: 3,
        ports: [{ id: "default", entryFrame: 0, portalFrames: [0, 2] }],
        samples: [{ rendition: "reference", sha256: DECLARED_DIGEST }]
      }
    ],
    staticFrames: [
      {
        id: "idle-static",
        width: 2,
        height: 2,
        sha256: DECLARED_DIGEST
      }
    ],
    initialState: "idle",
    states: [
      { id: "idle", bodyUnit: "idle-body", staticFrame: "idle-static" }
    ],
    edges: [],
    bindings: [],
    readiness: {
      policy: "all-routes",
      bootstrapUnits: ["idle-body"],
      immediateEdges: []
    },
    fallback: {
      unsupported: "per-state-static",
      reducedMotion: "per-state-static"
    },
    limits: {
      maxCompiledBytes: 32 * 1024,
      maxRuntimeBytes: 64 * 1024,
      decodedPixelBytes: 16,
      persistentCacheBytes: 0,
      runtimeWorkingSetBytes: 16
    }
  };
  return Object.freeze({
    manifest,
    accessUnits: referenceAccessUnits(manifest),
    staticPayloads: Object.freeze([
      Object.freeze({ staticFrame: "idle-static", bytes: staticPng(0x4c) })
    ])
  });
}

export function generateReferenceLoopFixture(): Uint8Array {
  return writeCanonicalAsset(referenceLoopInput());
}

export function generateReferenceGraphFixture(): Uint8Array {
  return writeCanonicalAsset(writerInputFromManifest(validManifest()));
}

export function fixtureSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Generate both checked-in M4 fixtures and their whole-file provenance. */
export function generateConformanceFixtures(): readonly GeneratedConformanceFixture[] {
  const definitions = [
    {
      fileName: "reference-loop.rma" as const,
      description: "one-state, three-frame reference RGBA loop",
      bytes: generateReferenceLoopFixture()
    },
    {
      fileName: "reference-graph.rma" as const,
      description:
        "multi-state finite/held graph with portal, finish, cut, locked, and reversible routes",
      bytes: generateReferenceGraphFixture()
    }
  ];
  return Object.freeze(
    definitions.map((fixture) =>
      Object.freeze({
        ...fixture,
        sha256: fixtureSha256(fixture.bytes)
      })
    )
  );
}
