import {
  adler32,
  crc32,
  maximumAvcDecodedRgbaBytes,
  validatePngProfile,
  type AccessUnitRecord,
  type CompiledManifestV01,
  type UnitV01
} from "@rendered-motion/format";
import { describe, expect, it } from "vitest";

import {
  installRuntimeAssetCatalog,
  type RuntimeCatalogAccessUnit
} from "./asset-catalog.js";
import { createOpaqueTestAsset } from "./asset-test-fixture.js";
import {
  MAX_PLAYER_RUNTIME_BYTES,
  checkedByteNumber,
  checkedByteProduct,
  checkedByteSum,
  roundedGpuAllocationBytes
} from "./checked-runtime-bytes.js";
import {
  createInteractionCachePlan,
  createInteractionCachePlanFromSemanticSequences
} from "./interaction-cache-plan.js";
import {
  RESOURCE_DECODE_SURFACE_COUNT,
  createStaticRuntimeResourcePlan,
  createRuntimeResourcePlan,
  maximumActualEncodedWindowBytes,
  type RuntimeResourceCatalogView
} from "./resource-plan.js";

const MEBIBYTE = 1024 * 1024;

describe("exact runtime resource plan", () => {
  it("admits the complete static-only peak before animation exists", () => {
    const catalog = fakeCatalog();
    const plan = createStaticRuntimeResourcePlan({ catalog });

    expect(plan.totalBytes).toBe(sumStaticAllocationSnapshot(
      plan.allocationSnapshot
    ));
    expect(plan.staticDecodePeakBytes).toBe(
      plan.largestStaticPngCopyBytes +
      plan.largestStaticZlibBytes +
      plan.staticDecodeWorkingPeakBytes
    );
    expect(() => createStaticRuntimeResourcePlan({
      catalog,
      hostMaxRuntimeBytes: plan.totalBytes - 1
    })).toThrow("static runtime resource total");
  });

  it("integrates the owned catalog and accounts every frozen term exactly", () => {
    const catalog = installRuntimeAssetCatalog(createOpaqueTestAsset());
    const cache = createInteractionCachePlan({
      manifest: catalog.manifest,
      rendition: "opaque",
      deviceLimits: { maxTextureSize: 4_096, maxArrayTextureLayers: 128 }
    });
    const plan = createRuntimeResourcePlan({
      catalog,
      rendition: "opaque",
      interactionCache: cache,
      ringCapacity: 6
    });

    const decodedPerSurface = maximumAvcDecodedRgbaBytes(64, 64);
    const streaming = 64 * 64 * 4 * 3;
    const staticRgba = 64 * 64 * 4;
    const staticSwap = staticRgba * 2;
    const staticPlans = catalog.manifest.staticFrames.map((frame) =>
      validatePngProfile({
        png: catalog.copyStaticPng(frame.id),
        expectedWidth: frame.width,
        expectedHeight: frame.height
      })
    );
    const staticPngCopy = Math.max(
      ...catalog.manifest.staticFrames.map(({ length }) => length)
    );
    const staticZlib = Math.max(...staticPlans.map(({ zlibByteLength }) =>
      zlibByteLength
    ));
    const filtered = 64 * (1 + 64 * 4);
    const staticWorkingRgba = staticRgba;
    const nativeWorking = Math.max(
      staticZlib + filtered * 2,
      filtered + staticWorkingRgba
    );
    const pureWorking = filtered + staticWorkingRgba;
    const canvasAllocation = Number(roundedGpuAllocationBytes(staticRgba));
    const expected = catalog.ownedByteLength +
      366 +
      366 +
      decodedPerSurface * RESOURCE_DECODE_SURFACE_COUNT +
      Number(roundedGpuAllocationBytes(streaming)) +
      staticRgba +
      staticPngCopy +
      staticZlib +
      nativeWorking +
      Number(roundedGpuAllocationBytes(staticSwap)) +
      canvasAllocation * 2;

    expect(plan).toMatchObject({
      ownedAssetBytes: catalog.ownedByteLength,
      maximumEncodedWindowBytes: 366,
      decoderEncodedWindowBytes: 366,
      decodedBytesPerSurface: decodedPerSurface,
      decodedSurfaceBytes:
        decodedPerSurface * RESOURCE_DECODE_SURFACE_COUNT,
      persistentLayerBytes: 0,
      persistentAllocationBytes: 0,
      streamingLayerBytes: streaming,
      streamingAllocationBytes: Number(roundedGpuAllocationBytes(streaming)),
      frameStagingBytes: 64 * 64 * 4,
      largestStaticPngCopyBytes: staticPngCopy,
      largestStaticZlibBytes: staticZlib,
      staticFilteredBytes: filtered,
      staticRgbaWorkingBytes: staticWorkingRgba,
      nativeStaticWorkingPeakBytes: nativeWorking,
      pureStaticWorkingPeakBytes: pureWorking,
      staticDecodeWorkingPeakBytes: nativeWorking,
      staticDecodePeakBytes: staticPngCopy + staticZlib + nativeWorking,
      staticRgbaBytesPerSurface: staticRgba,
      currentStaticSurfaceAllocationBytes:
        Number(roundedGpuAllocationBytes(staticRgba)),
      incomingStaticSurfaceAllocationBytes:
        Number(roundedGpuAllocationBytes(staticRgba)),
      staticSwapBytes: staticSwap,
      staticSwapAllocationBytes: Number(roundedGpuAllocationBytes(staticSwap)),
      canvasBackingWidth: 64,
      canvasBackingHeight: 64,
      canvasBackingBytesPerPlane: staticRgba,
      animatedCanvasBackingAllocationBytes: canvasAllocation,
      staticCanvasBackingAllocationBytes: canvasAllocation,
      ringAdditionalBytes: 0,
      totalBytes: expected
    });
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.allocationSnapshot)).toBe(true);
    expect(sumAllocationSnapshot(plan.allocationSnapshot)).toBe(plan.totalBytes);
  });

  it("accounts native stream, unfilter, RGBA, and bitmap peaks without JS copies", () => {
    const catalog = fakeCatalog();
    const plan = createRuntimeResourcePlan({
      catalog,
      rendition: "opaque",
      interactionCache: zeroCache(),
      ringCapacity: 6
    });

    expect(plan.nativeStaticWorkingPeakBytes).toBe(
      Math.max(
        plan.largestStaticZlibBytes + plan.staticFilteredBytes * 2,
        plan.staticFilteredBytes + plan.staticRgbaWorkingBytes
      )
    );
    expect(plan.pureStaticWorkingPeakBytes).toBe(
      plan.staticFilteredBytes + plan.staticRgbaWorkingBytes
    );
    expect(plan.staticDecodeWorkingPeakBytes).toBe(
      Math.max(
        plan.nativeStaticWorkingPeakBytes,
        plan.pureStaticWorkingPeakBytes
      )
    );
    expect(plan.staticDecodePeakBytes).toBe(
      plan.largestStaticPngCopyBytes +
      plan.largestStaticZlibBytes +
      plan.staticDecodeWorkingPeakBytes
    );
    expect(plan.allocationSnapshot.staticDecodePngCopyBytes).toBe(
      plan.largestStaticPngCopyBytes
    );
    expect(plan.allocationSnapshot.staticDecodeOwnedZlibBytes).toBe(
      plan.largestStaticZlibBytes
    );
    expect(plan.allocationSnapshot.staticDecodeWorkingPeakBytes).toBe(
      plan.staticDecodeWorkingPeakBytes
    );
    expect(plan.allocationSnapshot.currentStaticSurfaceAllocationBytes).toBe(
      Number(roundedGpuAllocationBytes(plan.staticRgbaBytesPerSurface))
    );
    expect(plan.allocationSnapshot.incomingStaticSurfaceAllocationBytes).toBe(
      Number(roundedGpuAllocationBytes(plan.staticRgbaBytesPerSurface))
    );
  });

  it("finds PNG-copy and concatenated-zlib maxima independently", () => {
    const compactLargeZlib = restrictedPng(16, 16, {
      rgbaSeed: 31,
      extraStoredBlocks: 3
    });
    const chunkHeavySmallZlib = restrictedPng(16, 16, {
      rgbaSeed: 0,
      emptyIdatChunks: 40
    });
    expect(chunkHeavySmallZlib.byteLength).toBeGreaterThan(
      compactLargeZlib.byteLength
    );
    const catalog = fakeCatalog({
      stateCount: 2,
      sharedStatic: false,
      staticPngs: [chunkHeavySmallZlib, compactLargeZlib]
    });
    const plans = [chunkHeavySmallZlib, compactLargeZlib].map((png) =>
      validatePngProfile({ png, expectedWidth: 16, expectedHeight: 16 })
    );
    const plan = createRuntimeResourcePlan({
      catalog,
      rendition: "opaque",
      interactionCache: zeroCache(),
      ringCapacity: 6
    });

    expect(plan.largestStaticPngCopyBytes).toBe(chunkHeavySmallZlib.byteLength);
    expect(plan.largestStaticZlibBytes).toBe(
      Math.max(...plans.map(({ zlibByteLength }) => zlibByteLength))
    );
    expect(plan.largestStaticZlibBytes).toBe(plans[1]!.zlibByteLength);
  });

  it("charges configurable current animated and static canvas backings", () => {
    const catalog = fakeCatalog();
    const baseline = createRuntimeResourcePlan({
      catalog,
      rendition: "opaque",
      interactionCache: zeroCache(),
      ringCapacity: 6
    });
    const resized = createRuntimeResourcePlan({
      catalog,
      rendition: "opaque",
      interactionCache: zeroCache(),
      ringCapacity: 6,
      canvasBacking: { width: 31, height: 17 }
    });
    const raw = 31 * 17 * 4;
    const allocation = Number(roundedGpuAllocationBytes(raw));

    expect(resized).toMatchObject({
      canvasBackingWidth: 31,
      canvasBackingHeight: 17,
      canvasBackingBytesPerPlane: raw,
      animatedCanvasBackingAllocationBytes: allocation,
      staticCanvasBackingAllocationBytes: allocation
    });
    expect(resized.totalBytes - baseline.totalBytes).toBe(
      allocation * 2 - baseline.animatedCanvasBackingAllocationBytes * 2
    );
    expect(sumAllocationSnapshot(resized.allocationSnapshot)).toBe(
      resized.totalBytes
    );
  });

  it("delegates every static byte sequence to the strict format authority", () => {
    const png = restrictedPng(16, 16);
    const corrupted = png.slice();
    corrupted[corrupted.length - 1] = corrupted[corrupted.length - 1]! ^ 1;
    expect(() => createRuntimeResourcePlan({
      catalog: fakeCatalog({ staticPngs: [corrupted] }),
      rendition: "opaque",
      interactionCache: zeroCache(),
      ringCapacity: 6
    })).toThrowError(expect.objectContaining({ code: "PNG_ENVELOPE_INVALID" }));
  });

  it("finds legal windows without combining impossible mid-unit samples", () => {
    const catalog = fakeCatalog({
      unitLengths: {
        alpha: [100, 1],
        beta: [90, 1]
      }
    });

    expect(maximumActualEncodedWindowBytes(catalog, "opaque", 1)).toBe(100);
    expect(maximumActualEncodedWindowBytes(catalog, "opaque", 2)).toBe(101);
    expect(maximumActualEncodedWindowBytes(catalog, "opaque", 3)).toBe(201);
    expect(maximumActualEncodedWindowBytes(catalog, "opaque", 12)).toBe(606);
  });

  it("uses actual sample windows rather than max-sample multiplication", () => {
    const catalog = fakeCatalog({
      unitLengths: { body: [1_000, 1, 1, 1] }
    });
    const actual = maximumActualEncodedWindowBytes(catalog, "opaque", 12);

    expect(actual).toBe(3_009);
    expect(actual).toBeLessThan(12_000);
  });

  it("charges twelve decoder surfaces once for every legal ring size", () => {
    const catalog = fakeCatalog();
    const cache = zeroCache();
    const six = createRuntimeResourcePlan({
      catalog,
      rendition: "opaque",
      interactionCache: cache,
      ringCapacity: 6
    });
    const twelve = createRuntimeResourcePlan({
      catalog,
      rendition: "opaque",
      interactionCache: cache,
      ringCapacity: 12
    });

    expect(six.decodedSurfaceBytes).toBe(twelve.decodedSurfaceBytes);
    expect(six.totalBytes).toBe(twelve.totalBytes);
    expect(six.ringAdditionalBytes).toBe(0);
    expect(twelve.ringAdditionalBytes).toBe(0);
    expect(six.outstandingFrameLimit).toBe(12);
  });

  it("charges packed-alpha coded storage through every decoder and texture term", () => {
    const catalog = fakeCatalog({ packed: true });
    const cache = createInteractionCachePlanFromSemanticSequences({
      rendition: "opaque",
      width: 16,
      height: 48,
      reversibleClips: [],
      cutRunways: [],
      deviceLimits: { maxTextureSize: 4_096, maxArrayTextureLayers: 128 }
    });
    const plan = createRuntimeResourcePlan({
      catalog,
      rendition: "opaque",
      interactionCache: cache,
      ringCapacity: 6
    });

    expect(plan.decodedBytesPerSurface).toBe(
      maximumAvcDecodedRgbaBytes(16, 48)
    );
    expect(plan.streamingLayerBytes).toBe(16 * 48 * 4 * 3);
    expect(plan.frameStagingBytes).toBe(16 * 48 * 4);
  });

  it("accepts the exact effective cap and rejects one byte below", () => {
    const catalog = fakeCatalog();
    const cache = zeroCache();
    const baseline = createRuntimeResourcePlan({
      catalog,
      rendition: "opaque",
      interactionCache: cache,
      ringCapacity: 6
    });
    const exact = createRuntimeResourcePlan({
      catalog,
      rendition: "opaque",
      interactionCache: cache,
      ringCapacity: 6,
      hostMaxRuntimeBytes: baseline.totalBytes
    });

    expect(exact.effectiveCapBytes).toBe(baseline.totalBytes);
    expect(exact.totalBytes).toBe(baseline.totalBytes);
    expect(() => createRuntimeResourcePlan({
      catalog,
      rendition: "opaque",
      interactionCache: cache,
      ringCapacity: 6,
      hostMaxRuntimeBytes: baseline.totalBytes - 1
    })).toThrow("exceeds effective cap");
  });

  it("uses the minimum of 64 MiB, manifest advisory cap, and host policy", () => {
    const cache = zeroCache();
    const baseline = createRuntimeResourcePlan({
      catalog: fakeCatalog(),
      rendition: "opaque",
      interactionCache: cache,
      ringCapacity: 6
    });
    const manifestCap = baseline.totalBytes + 100;
    const catalog = fakeCatalog({ manifestMaxRuntimeBytes: manifestCap });
    const manifestLimited = createRuntimeResourcePlan({
      catalog,
      rendition: "opaque",
      interactionCache: cache,
      ringCapacity: 6,
      hostMaxRuntimeBytes: manifestCap + 100
    });
    expect(manifestLimited.effectiveCapBytes).toBe(manifestCap);

    const hardLimited = createRuntimeResourcePlan({
      catalog: fakeCatalog({
        manifestMaxRuntimeBytes: Number.MAX_SAFE_INTEGER
      }),
      rendition: "opaque",
      interactionCache: cache,
      ringCapacity: 6,
      hostMaxRuntimeBytes: Number.MAX_SAFE_INTEGER
    });
    expect(hardLimited.effectiveCapBytes).toBe(MAX_PLAYER_RUNTIME_BYTES);
  });

  it("never treats manifest byte estimates as allocation authority", () => {
    const cache = zeroCache();
    const lowEstimates = createRuntimeResourcePlan({
      catalog: fakeCatalog({
        estimate: {
          decodedPixelBytes: 0,
          persistentCacheBytes: 0,
          runtimeWorkingSetBytes: 0
        }
      }),
      rendition: "opaque",
      interactionCache: cache,
      ringCapacity: 6
    });
    const highEstimates = createRuntimeResourcePlan({
      catalog: fakeCatalog({
        estimate: {
          decodedPixelBytes: Number.MAX_SAFE_INTEGER,
          persistentCacheBytes: Number.MAX_SAFE_INTEGER,
          runtimeWorkingSetBytes: Number.MAX_SAFE_INTEGER
        }
      }),
      rendition: "opaque",
      interactionCache: cache,
      ringCapacity: 6
    });
    expect(highEstimates.totalBytes).toBe(lowEstimates.totalBytes);

    expect(() => createRuntimeResourcePlan({
      catalog: fakeCatalog({
        ownedByteLength: MAX_PLAYER_RUNTIME_BYTES,
        manifestMaxRuntimeBytes: Number.MAX_SAFE_INTEGER
      }),
      rendition: "opaque",
      interactionCache: cache,
      ringCapacity: 6,
      hostMaxRuntimeBytes: Number.MAX_SAFE_INTEGER
    })).toThrow("exceeds effective cap 67108864");
  });

  it("counts only two logical static surfaces even when states share IDs", () => {
    const base = fakeCatalog();
    const shared = fakeCatalog({ stateCount: 12, sharedStatic: true });
    const distinct = fakeCatalog({ stateCount: 12, sharedStatic: false });
    const plans = [base, shared, distinct].map((catalog) =>
      createRuntimeResourcePlan({
        catalog,
        rendition: "opaque",
        interactionCache: zeroCache(),
        ringCapacity: 6
      })
    );

    expect(new Set(plans.map(({ staticSwapBytes }) => staticSwapBytes)))
      .toEqual(new Set([16 * 16 * 4 * 2]));
    expect(new Set(plans.map(({ totalBytes }) => totalBytes)).size).toBe(1);
  });

  it("rounds allocation overhead upward and rejects unsafe arithmetic", () => {
    expect([0, 1, 2, 3, 4, 5].map((bytes) =>
      Number(roundedGpuAllocationBytes(bytes))
    )).toEqual([0, 2, 3, 4, 5, 7]);
    expect(() => checkedByteNumber(
      checkedByteProduct(
        [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
        "hostile product"
      ),
      "hostile product"
    )).toThrow("safe-integer range");
    expect(() => checkedByteNumber(
      checkedByteSum([Number.MAX_SAFE_INTEGER, 1], "hostile sum"),
      "hostile sum"
    )).toThrow("safe-integer range");
  });

  it("rejects mismatched caches, invalid rings, and invalid host caps", () => {
    const catalog = fakeCatalog();
    const cache = zeroCache();
    expect(() => createRuntimeResourcePlan({
      catalog,
      rendition: "opaque",
      interactionCache: { ...cache, rendition: "other" },
      ringCapacity: 6
    })).toThrow("does not match the selected rendition");
    for (const ringCapacity of [5, 13, 6.5]) {
      expect(() => createRuntimeResourcePlan({
        catalog,
        rendition: "opaque",
        interactionCache: cache,
        ringCapacity
      })).toThrow(RangeError);
    }
    for (const hostMaxRuntimeBytes of [0, -1, 1.5, Number.NaN]) {
      expect(() => createRuntimeResourcePlan({
        catalog,
        rendition: "opaque",
        interactionCache: cache,
        ringCapacity: 6,
        hostMaxRuntimeBytes
      })).toThrow(RangeError);
    }
    for (const canvasBacking of [
      null,
      { width: 0, height: 16 },
      { width: 16, height: 1.5 },
      { width: Number.NaN, height: 16 }
    ]) {
      expect(() => createRuntimeResourcePlan({
        catalog,
        rendition: "opaque",
        interactionCache: cache,
        ringCapacity: 6,
        canvasBacking: canvasBacking as unknown as {
          width: number;
          height: number;
        }
      })).toThrow();
    }
  });
});

function zeroCache() {
  return createInteractionCachePlanFromSemanticSequences({
    rendition: "opaque",
    width: 16,
    height: 16,
    reversibleClips: [],
    cutRunways: [],
    deviceLimits: { maxTextureSize: 4_096, maxArrayTextureLayers: 128 }
  });
}

interface FakeCatalogOptions {
  readonly unitLengths?: Readonly<Record<string, readonly number[]>>;
  readonly ownedByteLength?: number;
  readonly manifestMaxRuntimeBytes?: number;
  readonly estimate?: {
    readonly decodedPixelBytes: number;
    readonly persistentCacheBytes: number;
    readonly runtimeWorkingSetBytes: number;
  };
  readonly stateCount?: number;
  readonly sharedStatic?: boolean;
  readonly packed?: boolean;
  readonly staticPngs?: readonly Uint8Array[];
}

function fakeCatalog(
  options: FakeCatalogOptions = {}
): RuntimeResourceCatalogView {
  const unitLengths = options.unitLengths ?? { body: [100, 1] };
  const units: UnitV01[] = [];
  const records = new Map<string, RuntimeCatalogAccessUnit>();
  let ordinal = 0;
  let offset = 1;
  for (const [unit, lengths] of Object.entries(unitLengths).sort()) {
    units.push({
      id: unit,
      kind: "body",
      playback: "loop",
      frameCount: lengths.length,
      ports: [{ id: "default", entryFrame: 0, portalFrames: [0] }],
      samples: [{
        rendition: "opaque",
        sampleStart: ordinal,
        sampleCount: lengths.length,
        sha256: "0".repeat(64)
      }]
    });
    for (let localFrame = 0; localFrame < lengths.length; localFrame += 1) {
      const length = lengths[localFrame]!;
      const record = {
        renditionIndex: 0,
        unitIndex: units.length - 1,
        frameIndex: localFrame,
        key: localFrame === 0,
        payloadOffset: offset,
        payloadLength: length
      } as AccessUnitRecord;
      records.set(`${unit}:${String(localFrame)}`, {
        rendition: "opaque",
        unit,
        localFrame,
        ordinal,
        record,
        range: { offset, length }
      });
      ordinal += 1;
      offset += length;
    }
  }

  const stateCount = options.stateCount ?? 1;
  const sharedStatic = options.sharedStatic ?? true;
  const manifest = fakeManifest({
    units,
    stateCount,
    sharedStatic,
    maxRuntimeBytes:
      options.manifestMaxRuntimeBytes ?? MAX_PLAYER_RUNTIME_BYTES,
    estimate: options.estimate,
    packed: options.packed ?? false,
    staticPngs: options.staticPngs
  });
  const staticPngs = new Map(
    manifest.staticFrames.map((frame, index) => [
      frame.id,
      options.staticPngs?.[index] ?? restrictedPng(frame.width, frame.height)
    ])
  );
  const staticEntries = manifest.staticFrames.map((frame) => {
    const bytes = staticPngs.get(frame.id);
    if (bytes === undefined) throw new Error("missing static PNG");
    const png = validatePngProfile({
      png: bytes,
      expectedWidth: frame.width,
      expectedHeight: frame.height
    });
    return Object.freeze({
      frame,
      range: Object.freeze({
        staticFrame: frame.id,
        offset: frame.offset,
        length: frame.length,
        sha256: frame.sha256
      }),
      png: Object.freeze({
        width: png.width,
        height: png.height,
        byteRange: png.byteRange,
        zlibByteLength: png.zlibByteLength,
        expectedFilteredBytes: png.expectedFilteredBytes,
        expectedRgbaBytes: png.expectedRgbaBytes
      })
    });
  });
  return {
    ownedByteLength: options.ownedByteLength ?? 1_000,
    manifest,
    staticFrames: {
      values() {
        return staticEntries;
      }
    },
    records: {
      require(rendition, unit, localFrame) {
        if (rendition !== "opaque") throw new Error("missing rendition");
        const record = records.get(`${unit}:${String(localFrame)}`);
        if (record === undefined) throw new Error("missing record");
        return record;
      }
    }
  };
}

function fakeManifest(input: {
  readonly units: readonly UnitV01[];
  readonly stateCount: number;
  readonly sharedStatic: boolean;
  readonly maxRuntimeBytes: number;
  readonly estimate: FakeCatalogOptions["estimate"];
  readonly packed: boolean;
  readonly staticPngs: readonly Uint8Array[] | undefined;
}): CompiledManifestV01 {
  const firstUnit = input.units[0]!;
  const staticFrames = Array.from(
    { length: input.sharedStatic ? 1 : input.stateCount },
    (_, index) => ({
      id: `static-${String(index)}`,
      offset: 1 + index,
      length: input.staticPngs?.[index]?.byteLength ??
        restrictedPng(16, 16).byteLength,
      width: 16,
      height: 16,
      sha256: "0".repeat(64)
    })
  );
  return {
    formatVersion: "0.1",
    generator: "resource-test",
    canvas: {
      width: 16,
      height: 16,
      fit: "contain",
      pixelAspect: [1, 1],
      colorSpace: "srgb"
    },
    frameRate: { numerator: 30, denominator: 1 },
    renditions: [input.packed
      ? {
          id: "opaque",
          profile: "avc-annexb-packed-alpha-v0",
          codec: "avc1.42E020",
          codedWidth: 16,
          codedHeight: 48,
          alphaLayout: {
            type: "stacked-v0",
            colorRect: [0, 0, 16, 16],
            alphaRect: [0, 24, 16, 16]
          },
          bitrate: { average: 100_000, peak: 200_000 },
          capabilities: ["webcodecs", "webgl2"]
        }
      : {
          id: "opaque",
          profile: "avc-annexb-opaque-v0",
          codec: "avc1.42E020",
          codedWidth: 16,
          codedHeight: 16,
          alphaLayout: { type: "opaque-v0", colorRect: [0, 0, 16, 16] },
          bitrate: { average: 100_000, peak: 200_000 },
          capabilities: ["webcodecs", "webgl2"]
        }],
    units: input.units,
    staticFrames,
    initialState: "state-0",
    states: Array.from({ length: input.stateCount }, (_, index) => ({
      id: `state-${String(index)}`,
      bodyUnit: firstUnit.id,
      staticFrame: input.sharedStatic ? "static-0" : `static-${String(index)}`
    })),
    edges: [],
    bindings: [],
    readiness: {
      policy: "all-routes",
      bootstrapUnits: [firstUnit.id],
      immediateEdges: []
    },
    fallback: {
      unsupported: "per-state-static",
      reducedMotion: "per-state-static"
    },
    limits: {
      maxCompiledBytes: 32 * MEBIBYTE,
      maxRuntimeBytes: input.maxRuntimeBytes,
      decodedPixelBytes: input.estimate?.decodedPixelBytes ?? 0,
      persistentCacheBytes: input.estimate?.persistentCacheBytes ?? 0,
      runtimeWorkingSetBytes: input.estimate?.runtimeWorkingSetBytes ?? 0
    }
  };
}

function sumAllocationSnapshot(snapshot: {
  readonly ownedAssetBytes: number;
  readonly maximumEncodedWindowBytes: number;
  readonly decoderEncodedWindowBytes: number;
  readonly decodedSurfaceBytes: number;
  readonly persistentAllocationBytes: number;
  readonly streamingAllocationBytes: number;
  readonly frameStagingBytes: number;
  readonly staticDecodePngCopyBytes: number;
  readonly staticDecodeOwnedZlibBytes: number;
  readonly staticDecodeWorkingPeakBytes: number;
  readonly currentStaticSurfaceAllocationBytes: number;
  readonly incomingStaticSurfaceAllocationBytes: number;
  readonly animatedCanvasBackingAllocationBytes: number;
  readonly staticCanvasBackingAllocationBytes: number;
}): number {
  return snapshot.ownedAssetBytes +
    snapshot.maximumEncodedWindowBytes +
    snapshot.decoderEncodedWindowBytes +
    snapshot.decodedSurfaceBytes +
    snapshot.persistentAllocationBytes +
    snapshot.streamingAllocationBytes +
    snapshot.frameStagingBytes +
    snapshot.staticDecodePngCopyBytes +
    snapshot.staticDecodeOwnedZlibBytes +
    snapshot.staticDecodeWorkingPeakBytes +
    snapshot.currentStaticSurfaceAllocationBytes +
    snapshot.incomingStaticSurfaceAllocationBytes +
    snapshot.animatedCanvasBackingAllocationBytes +
    snapshot.staticCanvasBackingAllocationBytes;
}

function sumStaticAllocationSnapshot(snapshot: {
  readonly ownedAssetBytes: number;
  readonly staticDecodePngCopyBytes: number;
  readonly staticDecodeOwnedZlibBytes: number;
  readonly staticDecodeWorkingPeakBytes: number;
  readonly currentStaticSurfaceAllocationBytes: number;
  readonly incomingStaticSurfaceAllocationBytes: number;
  readonly animatedCanvasBackingAllocationBytes: number;
  readonly staticCanvasBackingAllocationBytes: number;
}): number {
  return snapshot.ownedAssetBytes +
    snapshot.staticDecodePngCopyBytes +
    snapshot.staticDecodeOwnedZlibBytes +
    snapshot.staticDecodeWorkingPeakBytes +
    snapshot.currentStaticSurfaceAllocationBytes +
    snapshot.incomingStaticSurfaceAllocationBytes +
    snapshot.animatedCanvasBackingAllocationBytes +
    snapshot.staticCanvasBackingAllocationBytes;
}

function restrictedPng(
  width: number,
  height: number,
  options: Readonly<{
    readonly rgbaSeed?: number;
    readonly emptyIdatChunks?: number;
    readonly extraStoredBlocks?: number;
  }> = {}
): Uint8Array {
  const stride = width * 4;
  const filtered = new Uint8Array(height * (stride + 1));
  let value = options.rgbaSeed ?? 0;
  for (let row = 0; row < height; row += 1) {
    const start = row * (stride + 1);
    for (let column = 0; column < stride; column += 1) {
      value = (value * 33 + 17) & 0xff;
      filtered[start + 1 + column] = value;
    }
  }
  const zlib = storedZlib(filtered, options.extraStoredBlocks ?? 0);
  const ihdr = new Uint8Array(13);
  writeUint32Be(ihdr, 0, width);
  writeUint32Be(ihdr, 4, height);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return concatenateBytes([
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    pngChunk("IHDR", ihdr),
    ...Array.from(
      { length: options.emptyIdatChunks ?? 0 },
      () => pngChunk("IDAT", new Uint8Array())
    ),
    pngChunk("IDAT", zlib),
    pngChunk("IEND", new Uint8Array())
  ]);
}

function storedZlib(filtered: Uint8Array, extraEmptyBlocks: number): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (let index = 0; index < extraEmptyBlocks; index += 1) {
    blocks.push(Uint8Array.of(0, 0, 0, 0xff, 0xff));
  }
  const block = new Uint8Array(5 + filtered.byteLength);
  block[0] = 1;
  block[1] = filtered.byteLength & 0xff;
  block[2] = filtered.byteLength >>> 8;
  const complement = filtered.byteLength ^ 0xffff;
  block[3] = complement & 0xff;
  block[4] = complement >>> 8;
  block.set(filtered, 5);
  blocks.push(block);
  const body = concatenateBytes(blocks);
  const result = new Uint8Array(2 + body.byteLength + 4);
  result.set([0x78, 0x01], 0);
  result.set(body, 2);
  writeUint32Be(result, result.byteLength - 4, adler32(filtered));
  return result;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const result = new Uint8Array(12 + data.byteLength);
  writeUint32Be(result, 0, data.byteLength);
  const typeBytes = Uint8Array.from(type, (value) => value.charCodeAt(0));
  result.set(typeBytes, 4);
  result.set(data, 8);
  writeUint32Be(
    result,
    8 + data.byteLength,
    crc32(result.subarray(4, 8 + data.byteLength))
  );
  return result;
}

function writeUint32Be(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value >>> 24;
  bytes[offset + 1] = value >>> 16;
  bytes[offset + 2] = value >>> 8;
  bytes[offset + 3] = value;
}

function concatenateBytes(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce(
    (length, part) => length + part.byteLength,
    0
  ));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}
