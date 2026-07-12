import type { GraphEdgeDefinition } from "@rendered-motion/graph";
import { describe, expect, it } from "vitest";

// @ts-expect-error Vite exposes the checked-in binary as a data URL in tests.
import fixtureDataUrl from "../../../../fixtures/conformance/m6/packed-alpha-all-routes.rma?url&inline";
// @ts-expect-error Vite exposes the checked malformed contract as source text.
import malformedContractsText from "../../../../fixtures/conformance/m6/malformed/contracts.json?raw";

import { installRuntimeAssetCatalog } from "./asset-catalog.js";
import {
  createAvcRenditionCandidates,
  inspectAvcRenditionCandidate
} from "./avc-rendition-selection.js";
import { createInteractionCachePlan } from "./interaction-cache-plan.js";
import { buildPreparations } from "./interaction-cache-preparation-planning.js";
import {
  createRuntimeResourcePlan,
  createStaticRuntimeResourcePlan
} from "./resource-plan.js";
import { BrowserStaticSurfaceDecoder } from "./strict-static-decoder.js";

describe("M6 checked-in packed-alpha runtime fixture", () => {
  it("executes the checked strict-static resource rejection contract", () => {
    const contracts = JSON.parse(malformedContractsText);
    const hostile = contracts.cases.find(
      (entry: any) => entry.id === "strict-static-resource-cap-below-baseline"
    );
    expect(hostile.asset).toBe("packed-alpha-all-routes.rma");
    expect(() => createStaticRuntimeResourcePlan({
      catalog: installFixture(),
      hostMaxRuntimeBytes: hostile.hostCapBytes
    })).toThrow(expect.objectContaining(hostile.expected));
  });

  it("installs one owned catalog and strictly inspects candidates in visible-area order", () => {
    const catalog = installFixture();
    const candidates = createAvcRenditionCandidates(
      catalog.renditions.values(),
      catalog.manifest.canvas
    );

    expect(catalog.manifest.canvas).toEqual({
      width: 45,
      height: 27,
      fit: "contain",
      pixelAspect: [1, 1],
      colorSpace: "srgb"
    });
    expect(catalog.records.size).toBe(60);
    expect(candidates.map(({ rank, visibleColorArea, codedArea, rendition }) => ({
      rank,
      visibleColorArea,
      codedArea,
      rendition: rendition.id
    }))).toEqual([
      {
        rank: 0,
        visibleColorArea: 1_215,
        codedArea: 3_072,
        rendition: "packed.1x"
      },
      {
        rank: 1,
        visibleColorArea: 135,
        codedArea: 512,
        rendition: "packed.0.333x"
      }
    ]);
    expect(candidates.map(({ geometry }) => ({
      color: geometry.visibleColorRect,
      alpha: geometry.visibleAlphaRect,
      storage: geometry.decodedStorageRect,
      coded: [geometry.codedWidth, geometry.codedHeight]
    }))).toEqual([
      {
        color: [0, 0, 45, 27],
        alpha: [0, 36, 45, 27],
        storage: [0, 0, 46, 64],
        coded: [48, 64]
      },
      {
        color: [0, 0, 15, 9],
        alpha: [0, 18, 15, 9],
        storage: [0, 0, 16, 28],
        coded: [16, 32]
      }
    ]);

    const inspected = candidates.map((candidate) =>
      inspectAvcRenditionCandidate(catalog, candidate)
    );
    expect(inspected.every(({ ok }) => ok)).toBe(true);
    expect(inspected.map((result) => {
      if (!result.ok) throw new Error("M6 checked-in rendition was rejected");
      return {
        rendition: result.candidate.rendition.id,
        crop: result.inspection.parameterSet.crop,
        units: result.inspection.units.map(({ id, frames }) => [
          id,
          frames.length
        ])
      };
    })).toEqual([
      {
        rendition: "packed.1x",
        crop: {
          left: 0,
          right: 2,
          top: 0,
          bottom: 0,
          visibleWidth: 46,
          visibleHeight: 64
        },
        units: EXPECTED_UNITS
      },
      {
        rendition: "packed.0.333x",
        crop: {
          left: 0,
          right: 0,
          top: 0,
          bottom: 4,
          visibleWidth: 16,
          visibleHeight: 28
        },
        units: EXPECTED_UNITS
      }
    ]);
  });

  it("preserves authored state mappings and every route class in the validated graph", () => {
    const catalog = installFixture();
    const definition = catalog.graph.definition;

    expect(definition.initialState).toBe("idle");
    expect(definition.states.map((state) => ({
      id: state.id,
      body: [state.body.unitId, state.body.kind, state.body.frameCount],
      staticFrame: state.staticFrameId,
      initial: state.initialUnit?.unitId ?? null
    }))).toEqual([
      {
        id: "done",
        body: ["done-body", "held", 1],
        staticFrame: "static.00",
        initial: null
      },
      {
        id: "hover",
        body: ["hover-body", "loop", 8],
        staticFrame: "static.01",
        initial: null
      },
      {
        id: "idle",
        body: ["idle-body", "loop", 8],
        staticFrame: "static.02",
        initial: "intro"
      },
      {
        id: "loading",
        body: ["loading-body", "finite", 3],
        staticFrame: "static.00",
        initial: null
      }
    ]);
    expect(definition.edges.map((edge) => ({
      id: edge.id,
      route: `${edge.from}->${edge.to}`,
      class: routeClass(edge),
      unit: edge.transition?.unitId ?? null,
      trigger: edge.trigger?.type === "event"
        ? edge.trigger.name
        : edge.trigger?.type ?? null
    }))).toEqual([
      {
        id: "done-idle",
        route: "done->idle",
        class: "portal",
        unit: null,
        trigger: "reset"
      },
      {
        id: "hover-idle",
        route: "hover->idle",
        class: "reversible-reverse",
        unit: "hover-shift",
        trigger: "hover-off"
      },
      {
        id: "idle-hover",
        route: "idle->hover",
        class: "reversible-forward",
        unit: "hover-shift",
        trigger: "hover-on"
      },
      {
        id: "idle-loading",
        route: "idle->loading",
        class: "locked",
        unit: "loading-bridge",
        trigger: "activate-loading"
      },
      {
        id: "loading-done",
        route: "loading->done",
        class: "finish",
        unit: null,
        trigger: "completion"
      },
      {
        id: "loading-idle",
        route: "loading->idle",
        class: "cut",
        unit: null,
        trigger: "cancel-loading"
      }
    ]);
    expect(catalog.manifest.bindings.map(({ source, event }) => [source, event]))
      .toEqual([
        ["activate", "activate-loading"],
        ["engagement.off", "reset"],
        ["focus.out", "cancel-loading"],
        ["pointer.enter", "hover-on"],
        ["pointer.leave", "hover-off"]
      ]);
  });

  it("expands all-routes readiness into the exact resident cache and a bounded resource plan", () => {
    const catalog = installFixture();

    expect(catalog.manifest.readiness).toEqual({
      policy: "all-routes",
      bootstrapUnits: [
        "hover-body",
        "hover-shift",
        "idle-body",
        "intro",
        "loading-body",
        "loading-bridge"
      ],
      immediateEdges: ["idle-hover", "idle-loading"]
    });

    const cache = createInteractionCachePlan({
      manifest: catalog.manifest,
      rendition: "packed.1x",
      deviceLimits: {
        maxTextureSize: 4_096,
        maxArrayTextureLayers: 128
      }
    });
    expect(cache).toMatchObject({
      rendition: "packed.1x",
      width: 48,
      height: 64,
      bytesPerFrame: 12_288,
      layerCount: 18,
      semanticFrameCount: 24,
      persistentBytes: 221_184
    });
    expect(cache.reversibleClips.map((clip) => ({
      unit: clip.unit,
      source: [clip.sourceEndpoint.state, clip.sourceEndpoint.port],
      sourceFrames: clip.sourceEndpoint.frames.map(({ localFrame }) =>
        localFrame
      ),
      clipFrames: clip.clip.frames.map(({ localFrame }) => localFrame),
      target: [clip.targetEndpoint.state, clip.targetEndpoint.port],
      targetFrames: clip.targetEndpoint.frames.map(({ localFrame }) =>
        localFrame
      )
    }))).toEqual([{
      unit: "hover-shift",
      source: ["idle", "default"],
      sourceFrames: [0, 1, 2, 3, 4, 5],
      clipFrames: [0, 1, 2, 3, 4, 5],
      target: ["hover", "default"],
      targetFrames: [0, 1, 2, 3, 4, 5]
    }]);
    expect(cache.cutRunways.map((runway) => ({
      edge: runway.edge,
      state: runway.state,
      port: runway.port,
      frames: runway.frames.map(({ localFrame }) => localFrame)
    }))).toEqual([{
      edge: "loading-idle",
      state: "idle",
      port: "default",
      frames: [0, 1, 2, 3, 4, 5]
    }]);
    expect(buildPreparations(cache, catalog).map((preparation) => ({
      unit: preparation.unitId,
      frames: preparation.frameCount,
      residentFrames: [...preparation.layerByFrame.keys()]
    }))).toEqual([
      {
        unit: "idle-body",
        frames: 8,
        residentFrames: [0, 1, 2, 3, 4, 5]
      },
      {
        unit: "hover-shift",
        frames: 6,
        residentFrames: [0, 1, 2, 3, 4, 5]
      },
      {
        unit: "hover-body",
        frames: 8,
        residentFrames: [0, 1, 2, 3, 4, 5]
      }
    ]);

    const resources = createRuntimeResourcePlan({
      catalog,
      rendition: "packed.1x",
      interactionCache: cache,
      ringCapacity: 6
    });
    expect(resources).toMatchObject({
      rendition: "packed.1x",
      ringCapacity: 6,
      outstandingFrameLimit: 12,
      decodedBytesPerSurface: 30_720,
      persistentLayerBytes: 221_184,
      largestStaticPngCopyBytes: 4_968,
      largestStaticZlibBytes: 4_898,
      staticFilteredBytes: 4_887
    });
    expect(resources.totalBytes).toBeLessThanOrEqual(
      resources.effectiveCapBytes
    );
    expect(resources.allocationSnapshot.totalBytes).toBe(resources.totalBytes);
  });

  it("decodes every catalog static through the strict pure path and retains deduplication", async () => {
    const catalog = installFixture();
    let bitmapCloses = 0;
    const decoder = new BrowserStaticSurfaceDecoder({
      nativeInflater: null,
      async createBitmap(rgba, width, height) {
        expect(rgba).toHaveLength(45 * 27 * 4);
        return {
          width,
          height,
          close() {
            bitmapCloses += 1;
          }
        } as ImageBitmap;
      }
    });

    expect(catalog.states.require("done").staticFrame).toBe("static.00");
    expect(catalog.states.require("loading").staticFrame).toBe("static.00");
    expect(catalog.staticFrames.keys()).toEqual([
      "static.00",
      "static.01",
      "static.02"
    ]);

    const firstCopy = catalog.copyStaticPng("static.00");
    const secondCopy = catalog.copyStaticPng("static.00");
    firstCopy.fill(0);
    expect(secondCopy.slice(0, 8)).toEqual(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );

    for (const staticFrame of catalog.staticFrames.values()) {
      const surface = await decoder.decode(
        catalog.copyStaticPng(staticFrame.frame.id),
        {
          signal: new AbortController().signal,
          expectedWidth: staticFrame.frame.width,
          expectedHeight: staticFrame.frame.height
        }
      );
      expect(surface).toMatchObject({
        width: 45,
        height: 27,
        inflatePath: "pure"
      });
      surface.close();
    }

    expect(decoder.snapshot()).toMatchObject({
      nativeAttempts: 0,
      pureAttempts: 3,
      pureSuccesses: 3,
      errors: 0,
      peakPngCopyBytes: 4_968,
      peakZlibBytes: 4_898,
      peakFilteredBytes: 4_887,
      peakRgbaBytes: 4_860,
      bitmapCloses: 3
    });
    expect(bitmapCloses).toBe(3);
  });
});

const EXPECTED_UNITS = [
  ["done-body", 1],
  ["hover-body", 8],
  ["hover-shift", 6],
  ["idle-body", 8],
  ["intro", 3],
  ["loading-body", 3],
  ["loading-bridge", 1]
] as const;

function installFixture() {
  const separator = fixtureDataUrl.indexOf(",");
  if (
    !fixtureDataUrl.startsWith("data:") ||
    !fixtureDataUrl.slice(0, separator).endsWith(";base64")
  ) {
    throw new Error("Vite did not inline the M6 fixture as base64");
  }
  const binary = atob(fixtureDataUrl.slice(separator + 1));
  return installRuntimeAssetCatalog(
    Uint8Array.from(binary, (character) => character.charCodeAt(0))
  );
}

function routeClass(edge: Readonly<GraphEdgeDefinition>): string {
  if (edge.start.type === "cut" || edge.start.type === "finish") {
    return edge.start.type;
  }
  if (edge.transition?.kind === "locked") return "locked";
  if (edge.transition?.kind === "reversible") {
    return `reversible-${edge.transition.direction}`;
  }
  return "portal";
}
