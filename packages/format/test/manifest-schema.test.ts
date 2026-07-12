import { describe, expect, it } from "vitest";

import { FormatError } from "../src/errors.js";
import { validateCompiledManifestV01 } from "../src/manifest-schema.js";
import type { CompiledManifestV01, FormatBudgets } from "../src/model.js";
import { limitManifest, validManifest } from "./manifest-fixture.js";

describe("validateCompiledManifestV01", () => {
  it("returns a detached recursively frozen 0.1 manifest", () => {
    const source = validManifest();
    const result = validateCompiledManifestV01(source);

    expect(result).not.toBe(source);
    expect(result.units).not.toBe(source.units);
    expect(result.units[0]).not.toBe(source.units[0]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.canvas.pixelAspect)).toBe(true);
    expect(Object.isFrozen(result.renditions[0]?.alphaLayout)).toBe(true);
    expect(Object.isFrozen(result.units[0]?.samples[0])).toBe(true);
    expect(Object.isFrozen(result.units[0]?.kind === "body" && result.units[0].ports[0]?.portalFrames)).toBe(true);
    expect(Object.isFrozen(result.edges[3]?.transition)).toBe(true);
    expect(Object.isFrozen(result.readiness.bootstrapUnits)).toBe(true);
  });

  it("accepts every closed rendition profile and validates its relationships", () => {
    const production = [
      {
        id: "b-opaque",
        profile: "avc-annexb-opaque-v0",
        codec: "avc1.42E020",
        codedWidth: 16,
        codedHeight: 16,
        alphaLayout: { type: "opaque-v0", colorRect: [0, 0, 2, 2] },
        bitrate: { average: 1_000, peak: 2_000 },
        capabilities: ["webcodecs", "webgl2"]
      },
      {
        id: "c-packed",
        profile: "avc-annexb-packed-alpha-v0",
        codec: "avc1.42E020",
        codedWidth: 16,
        codedHeight: 16,
        alphaLayout: {
          type: "stacked-v0",
          colorRect: [0, 0, 2, 2],
          alphaRect: [0, 10, 2, 2]
        },
        bitrate: { average: 2_000, peak: 2_000 },
        capabilities: ["webcodecs", "webgl2"]
      }
    ];

    for (const rendition of production) {
      const manifest = mutableManifest();
      manifest.renditions = [reference("a-reference"), rendition];
      rebuildSamples(manifest);
      manifest.limits.decodedPixelBytes = 1_024;
      manifest.limits.runtimeWorkingSetBytes = 1_024;
      expect(validateCompiledManifestV01(manifest).renditions).toHaveLength(2);
    }

    const mixed = mutableManifest();
    mixed.renditions = [reference("a-reference"), ...production];
    rebuildSamples(mixed);
    mixed.limits.decodedPixelBytes = 1_024;
    mixed.limits.runtimeWorkingSetBytes = 1_024;
    expectProfileInvalid(mixed, "renditions");

    const outside = mutableManifest();
    outside.renditions = [{
      ...reference("reference"),
      profile: "avc-annexb-opaque-v0",
      codec: "avc1.42E020",
      codedWidth: 4,
      codedHeight: 4,
      alphaLayout: { type: "opaque-v0", colorRect: [3, 0, 2, 2] },
      bitrate: { average: 1, peak: 1 },
      capabilities: ["webcodecs", "webgl2"]
    }];
    expectInvalid(outside, "renditions[0].alphaLayout.colorRect");
  });

  it("accepts lower rendition fallback only within one production alpha class", () => {
    for (const renditions of [
      [opaqueRendition("a-small", 8), opaqueRendition("b-large", 16)],
      [packedRendition("a-small", 8), packedRendition("b-large", 16)]
    ]) {
      const manifest = mutableManifest();
      manifest.canvas.width = 16;
      manifest.canvas.height = 16;
      for (const frame of manifest.staticFrames) {
        frame.width = 16;
        frame.height = 16;
      }
      manifest.renditions = renditions;
      rebuildSamples(manifest);
      manifest.limits.decodedPixelBytes = 3_072;
      manifest.limits.runtimeWorkingSetBytes = 3_072;

      expect(validateCompiledManifestV01(manifest).renditions.map(({ id }) => id))
        .toEqual(["a-small", "b-large"]);
    }
  });

  it("rejects every M4-shallow packed rectangle and coded-size alternative", () => {
    const mutations = [
      (rendition: any) => { rendition.alphaLayout.colorRect = [1, 0, 2, 2]; },
      (rendition: any) => { rendition.alphaLayout.colorRect = [0, 0, 1, 2]; },
      (rendition: any) => { rendition.alphaLayout.alphaRect = [1, 10, 2, 2]; },
      (rendition: any) => { rendition.alphaLayout.alphaRect = [0, 9, 2, 2]; },
      (rendition: any) => { rendition.alphaLayout.alphaRect = [0, 11, 2, 2]; },
      (rendition: any) => { rendition.alphaLayout.alphaRect = [0, 10, 1, 2]; },
      (rendition: any) => { rendition.codedWidth = 32; },
      (rendition: any) => { rendition.codedHeight = 32; }
    ] as const;

    for (const mutate of mutations) {
      const manifest = validPackedManifest();
      mutate(manifest.renditions[0]);
      expectProfileInvalid(manifest);
    }
  });

  it("charges packed decoded-pixel limits from the complete coded surface", () => {
    const manifest = validPackedManifest();
    manifest.limits.decodedPixelBytes = 1_023;
    expectInvalid(manifest, "limits.decodedPixelBytes");
  });

  it("validates canonical identity order, exact sample spans, and digest syntax", () => {
    const unordered = mutableManifest();
    unordered.states.reverse();
    expectInvalid(unordered, "states");

    const portalOrder = mutableManifest();
    bodyUnit(portalOrder, "body-a").ports[0]!.portalFrames = [2, 0];
    expectInvalid(portalOrder, "units[0].ports[0].portalFrames");

    const badStart = mutableManifest();
    bodyUnit(badStart, "body-b").samples[0]!.sampleStart = 3;
    expectInvalid(badStart, "units[1].samples[0].sampleStart");

    const badCount = mutableManifest();
    bodyUnit(badCount, "body-b").samples[0]!.sampleCount = 2;
    expectInvalid(badCount, "units[1].samples[0].sampleCount");

    const digest = mutableManifest();
    digest.staticFrames[0]!.sha256 = "A".repeat(64);
    expectInvalid(digest, "staticFrames[0].sha256");
  });

  it("validates typed references, exclusive unit use, and static sharing", () => {
    const wrongNamespace = mutableManifest();
    wrongNamespace.states[0]!.bodyUnit = "static-a";
    expectInvalid(wrongNamespace, "states[0].bodyUnit");

    const nonInitial = mutableManifest();
    nonInitial.states[1]!.initialUnit = "intro-a";
    expectInvalid(nonInitial, "states[1].initialUnit");

    const unusedStatic = mutableManifest();
    unusedStatic.staticFrames.push({
      id: "static-z",
      offset: 1_216,
      length: 68,
      width: 2,
      height: 2,
      sha256: "0".repeat(64)
    });
    expectInvalid(unusedStatic, "staticFrames");

    const sharedStatic = mutableManifest();
    sharedStatic.states[1]!.staticFrame = "static-a";
    sharedStatic.states[2]!.staticFrame = "static-a";
    sharedStatic.staticFrames = [sharedStatic.staticFrames[0]!];
    expect(() => validateCompiledManifestV01(sharedStatic)).not.toThrow();
  });

  it("validates reversible residency, inverse metadata, and cut runways", () => {
    const endpoint = mutableManifest();
    reversibleUnit(endpoint).residency.endpoints[0]!.port = "wrong";
    expectInvalid(endpoint, "edges[3].start.sourcePort");

    const reverseOf = mutableManifest();
    reversibleEdge(reverseOf, "edge-cb").transition.reverseOf = "edge-ab";
    expectInvalid(reverseOf, "edges[4].transition.reverseOf");

    const wrongDirection = mutableManifest();
    reversibleEdge(wrongDirection, "edge-cb").transition.direction = "forward";
    expectInvalid(wrongDirection, "edges");

    const runway = mutableManifest();
    cutEdge(runway).targetRunwayFrames = 5;
    expectInvalid(runway, "edges[1].targetRunwayFrames");
  });

  it("validates bindings, readiness closure, fallback, and declared estimates", () => {
    const binding = mutableManifest();
    binding.bindings[0]!.event = "unused";
    expectInvalid(binding, "bindings[0].event");

    const immediate = mutableManifest();
    immediate.readiness.immediateEdges = ["edge-ab"];
    expectInvalid(immediate, "readiness.immediateEdges");

    const bootstrap = mutableManifest();
    bootstrap.readiness.bootstrapUnits = bootstrap.readiness.bootstrapUnits.filter(
      (id: string) => id !== "bridge-ab"
    );
    expectInvalid(bootstrap, "readiness.bootstrapUnits");

    const fallback = mutableManifest();
    fallback.fallback.unsupported = "poster";
    expectInvalid(fallback, "fallback.unsupported");

    const decoded = mutableManifest();
    decoded.limits.decodedPixelBytes = 15;
    expectInvalid(decoded, "limits.decodedPixelBytes");
  });

  it("enforces every count/frame/blob schema budget before relation checks", () => {
    const cases: readonly [keyof FormatBudgets, number][] = [
      ["maxStates", 2],
      ["maxEdges", 4],
      ["maxUnits", 5],
      ["maxRenditions", 0],
      ["maxStaticFrames", 2],
      ["maxBindings", 1],
      ["maxBlobRanges", 8],
      ["maxTotalUnitFrames", 17],
      ["maxSampleRecords", 17],
      ["maxPortsPerBody", 0],
      ["maxReversibleFrames", 5]
    ];
    for (const [key, value] of cases) {
      expect(() =>
        validateCompiledManifestV01(validManifest(), {
          budgets: { [key]: value }
        })
      ).toThrow(FormatError);
    }
  });

  it("accepts the exact 32/64/96/32/900/128 ceilings and four renditions", () => {
    const limit = validateCompiledManifestV01(limitManifest());
    expect(limit.states).toHaveLength(32);
    expect(limit.edges).toHaveLength(64);
    expect(limit.units).toHaveLength(96);
    expect(limit.staticFrames).toHaveLength(32);
    expect(limit.units.reduce((sum, unit) => sum + unit.frameCount, 0)).toBe(900);
    expect(limit.units.length * limit.renditions.length + limit.staticFrames.length).toBe(128);

    const four = mutableManifest();
    four.renditions = Array.from({ length: 4 }, (_, index) =>
      reference(`r-${String(index)}`)
    );
    rebuildSamples(four);
    expect(validateCompiledManifestV01(four).renditions).toHaveLength(4);
  });

  it("rejects the normative count boundaries above 32/64/96/4/900/128", () => {
    const states = structuredClone(limitManifest()) as any;
    states.states.push(states.states[0]);
    expectInvalid(states, "states");

    const edges = structuredClone(limitManifest()) as any;
    edges.edges.push(edges.edges[0]);
    expectInvalid(edges, "edges");

    const units = structuredClone(limitManifest()) as any;
    units.units.push(units.units[0]);
    units.staticFrames.pop();
    expectInvalid(units, "units");

    const renditions = mutableManifest();
    renditions.renditions = Array.from({ length: 5 }, (_, index) =>
      reference(`r-${String(index)}`)
    );
    expectInvalid(renditions, "renditions");

    const frames = structuredClone(limitManifest()) as any;
    frames.units[0]!.frameCount = 2;
    expectInvalid(frames, "units");

    const blobs = structuredClone(limitManifest()) as any;
    blobs.staticFrames.push({ ...blobs.staticFrames[0], id: "static-32" });
    expectInvalid(blobs, "manifest");
  });
});

function mutableManifest(): any {
  return structuredClone(validManifest());
}

function expectProfileInvalid(value: unknown, path?: string): void {
  try {
    validateCompiledManifestV01(value);
    throw new Error("expected manifest profile validation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(FormatError);
    expect((error as FormatError).code).toBe("PROFILE_INVALID");
    if (path !== undefined) {
      expect((error as FormatError).path).toBe(path);
    }
  }
}

function reference(id: string): any {
  return {
    id,
    profile: "reference-rgba-v0",
    codec: "rma.reference-rgba",
    codedWidth: 2,
    codedHeight: 2,
    alphaLayout: { type: "straight-rgba-v0" },
    capabilities: []
  };
}

function opaqueRendition(id: string, size: number): any {
  return {
    id,
    profile: "avc-annexb-opaque-v0",
    codec: "avc1.42E020",
    codedWidth: 16,
    codedHeight: 16,
    alphaLayout: { type: "opaque-v0", colorRect: [0, 0, size, size] },
    bitrate: { average: 1_000, peak: 2_000 },
    capabilities: ["webcodecs", "webgl2"]
  };
}

function packedRendition(id: string, size: number): any {
  const pane = size % 2 === 0 ? size : size + 1;
  const storageHeight = 2 * pane + 8;
  return {
    id,
    profile: "avc-annexb-packed-alpha-v0",
    codec: "avc1.42E020",
    codedWidth: 16,
    codedHeight: Math.ceil(storageHeight / 16) * 16,
    alphaLayout: {
      type: "stacked-v0",
      colorRect: [0, 0, size, size],
      alphaRect: [0, pane + 8, size, size]
    },
    bitrate: { average: 1_000, peak: 2_000 },
    capabilities: ["webcodecs", "webgl2"]
  };
}

function validPackedManifest(): any {
  const manifest = mutableManifest();
  manifest.renditions = [{ ...packedRendition("reference", 2) }];
  manifest.limits.decodedPixelBytes = 1_024;
  manifest.limits.runtimeWorkingSetBytes = 1_024;
  return manifest;
}

function rebuildSamples(manifest: any): void {
  const total = manifest.units.reduce((sum: number, unit: any) => sum + unit.frameCount, 0);
  let preceding = 0;
  for (const unit of manifest.units) {
    unit.samples = manifest.renditions.map((rendition: any, index: number) => ({
      rendition: rendition.id,
      sampleStart: index * total + preceding,
      sampleCount: unit.frameCount,
      sha256: "0".repeat(64)
    }));
    preceding += unit.frameCount;
  }
}

function bodyUnit(manifest: any, id: string): any {
  return manifest.units.find((unit: any) => unit.id === id);
}

function reversibleUnit(manifest: any): any {
  return manifest.units.find((unit: any) => unit.kind === "reversible");
}

function reversibleEdge(manifest: any, id: string): any {
  return manifest.edges.find((edge: any) => edge.id === id);
}

function cutEdge(manifest: any): any {
  return manifest.edges.find((edge: any) => edge.start.type === "cut");
}

function expectInvalid(value: unknown, path: string): void {
  try {
    validateCompiledManifestV01(value);
    throw new Error("expected manifest validation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(FormatError);
    expect((error as FormatError).code).toBe("MANIFEST_INVALID");
    expect((error as FormatError).path).toBe(path);
  }
}
