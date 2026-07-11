import type { CompiledManifestV01 } from "../src/model.js";

const DIGEST = "0".repeat(64);

/** A fresh compact manifest covering every graph-bearing 0.1 unit kind. */
export function validManifest(): CompiledManifestV01 {
  return {
    formatVersion: "0.1",
    generator: "rendered-motion-tests",
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
      body("body-a", "loop", 4, [0, 2], 0),
      body("body-b", "finite", 3, [2], 4),
      body("body-c", "finite", 1, [0], 7),
      basicUnit("bridge-ab", "bridge", 2, 8),
      basicUnit("intro-a", "one-shot", 2, 10),
      {
        id: "rev-bc",
        kind: "reversible",
        frameCount: 6,
        residency: {
          endpoints: [
            { state: "a-b", port: "default", frames: 6 },
            { state: "a-c", port: "default", frames: 6 }
          ]
        },
        samples: [sample(12, 6)]
      }
    ],
    staticFrames: [
      staticFrame("static-a", 1_000),
      staticFrame("static-b", 1_072),
      staticFrame("static-c", 1_144)
    ],
    initialState: "a-a",
    states: [
      {
        id: "a-a",
        bodyUnit: "body-a",
        staticFrame: "static-a",
        initialUnit: "intro-a"
      },
      { id: "a-b", bodyUnit: "body-b", staticFrame: "static-b" },
      { id: "a-c", bodyUnit: "body-c", staticFrame: "static-c" }
    ],
    edges: [
      {
        id: "edge-ab",
        from: "a-a",
        to: "a-b",
        trigger: { type: "event", name: "go-b" },
        start: {
          type: "portal",
          sourcePort: "default",
          targetPort: "default",
          maxWaitFrames: 1
        },
        transition: { kind: "locked", unit: "bridge-ab" },
        continuity: "exact-authored"
      },
      {
        id: "edge-ac",
        from: "a-a",
        to: "a-c",
        trigger: { type: "event", name: "go-c" },
        start: { type: "cut", targetPort: "default", maxWaitFrames: 1 },
        continuity: "cut",
        targetRunwayFrames: 6
      },
      {
        id: "edge-ba",
        from: "a-b",
        to: "a-a",
        trigger: { type: "completion" },
        start: { type: "finish", targetPort: "default", maxWaitFrames: 2 },
        continuity: "exact-authored"
      },
      {
        id: "edge-bc",
        from: "a-b",
        to: "a-c",
        trigger: { type: "event", name: "go-c" },
        start: {
          type: "portal",
          sourcePort: "default",
          targetPort: "default",
          maxWaitFrames: 2
        },
        transition: {
          kind: "reversible",
          unit: "rev-bc",
          direction: "forward"
        },
        continuity: "exact-authored"
      },
      {
        id: "edge-cb",
        from: "a-c",
        to: "a-b",
        trigger: { type: "event", name: "go-b" },
        start: {
          type: "portal",
          sourcePort: "default",
          targetPort: "default",
          maxWaitFrames: 0
        },
        transition: {
          kind: "reversible",
          unit: "rev-bc",
          direction: "reverse",
          reverseOf: "edge-bc"
        },
        continuity: "exact-reverse"
      }
    ],
    bindings: [
      { source: "activate", event: "go-c" },
      { source: "pointer.enter", event: "go-b" }
    ],
    readiness: {
      policy: "all-routes",
      bootstrapUnits: [
        "body-a",
        "body-b",
        "body-c",
        "bridge-ab",
        "intro-a"
      ],
      immediateEdges: ["edge-ab", "edge-ac"]
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
}

/** A valid manifest exactly at the state/edge/unit/static/blob/frame ceilings. */
export function limitManifest(): CompiledManifestV01 {
  const bodyUnits = Array.from({ length: 32 }, (_, index) => ({
    id: numbered("body", index),
    kind: "body" as const,
    playback: "finite" as const,
    frameCount: 1,
    ports: [{ id: "default", entryFrame: 0 as const, portalFrames: [0] }],
    samples: [] as {
      rendition: string;
      sampleStart: number;
      sampleCount: number;
      sha256: string;
    }[]
  }));
  const bridgeUnits = Array.from({ length: 64 }, (_, index) => ({
    id: numbered("bridge", index),
    kind: "bridge" as const,
    frameCount: index < 36 ? 14 : 13,
    samples: [] as {
      rendition: string;
      sampleStart: number;
      sampleCount: number;
      sha256: string;
    }[]
  }));
  const units = [...bodyUnits, ...bridgeUnits];
  let sampleStart = 0;
  for (const unit of units) {
    unit.samples.push({
      rendition: "reference",
      sampleStart,
      sampleCount: unit.frameCount,
      sha256: DIGEST
    });
    sampleStart += unit.frameCount;
  }

  const states = Array.from({ length: 32 }, (_, index) => ({
    id: numbered("state", index),
    bodyUnit: numbered("body", index),
    staticFrame: numbered("static", index)
  }));
  const edges = Array.from({ length: 64 }, (_, index) => {
    const from = index % 32;
    const targetStep = index < 32 ? 1 : 2;
    return {
      id: numbered("edge", index),
      from: numbered("state", from),
      to: numbered("state", (from + targetStep) % 32),
      start: {
        type: "portal" as const,
        sourcePort: "default",
        targetPort: "default",
        maxWaitFrames: 0
      },
      transition: {
        kind: "locked" as const,
        unit: numbered("bridge", index)
      },
      continuity: "exact-authored" as const
    };
  });

  return {
    formatVersion: "0.1",
    generator: "rendered-motion-limit-tests",
    canvas: {
      width: 2,
      height: 2,
      fit: "contain",
      pixelAspect: [1, 1],
      colorSpace: "srgb"
    },
    frameRate: { numerator: 60, denominator: 1 },
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
    units,
    staticFrames: Array.from({ length: 32 }, (_, index) => ({
      id: numbered("static", index),
      offset: 4_096 + index * 8,
      length: 1,
      width: 2,
      height: 2,
      sha256: DIGEST
    })),
    initialState: "state-00",
    states,
    edges,
    bindings: [],
    readiness: {
      policy: "all-routes",
      bootstrapUnits: [
        "body-00",
        "body-01",
        "body-02",
        "bridge-00",
        "bridge-32"
      ],
      immediateEdges: ["edge-00", "edge-32"]
    },
    fallback: {
      unsupported: "per-state-static",
      reducedMotion: "per-state-static"
    },
    limits: {
      maxCompiledBytes: 32 * 1024 * 1024,
      maxRuntimeBytes: 64 * 1024 * 1024,
      decodedPixelBytes: 16,
      persistentCacheBytes: 0,
      runtimeWorkingSetBytes: 16
    }
  };
}

function numbered(prefix: string, index: number): string {
  return `${prefix}-${String(index).padStart(2, "0")}`;
}

function body(
  id: string,
  playback: "loop" | "finite",
  frameCount: number,
  portalFrames: readonly number[],
  sampleStart: number
): Extract<CompiledManifestV01["units"][number], { readonly kind: "body" }> {
  return {
    id,
    kind: "body",
    playback,
    frameCount,
    ports: [{ id: "default", entryFrame: 0, portalFrames }],
    samples: [sample(sampleStart, frameCount)]
  };
}

function basicUnit(
  id: string,
  kind: "bridge" | "one-shot",
  frameCount: number,
  sampleStart: number
): Extract<CompiledManifestV01["units"][number], { readonly kind: typeof kind }> {
  return { id, kind, frameCount, samples: [sample(sampleStart, frameCount)] };
}

function sample(sampleStart: number, sampleCount: number) {
  return { rendition: "reference", sampleStart, sampleCount, sha256: DIGEST };
}

function staticFrame(id: string, offset: number) {
  return { id, offset, length: 68, width: 2, height: 2, sha256: DIGEST };
}
