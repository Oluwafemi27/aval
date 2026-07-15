import { describe, expect, it } from "vitest";

import {
  MAX_ENDPOINT_RUNWAY_FRAMES,
  MAX_RESIDENT_FRAME_BYTES,
  MAX_RESIDENT_FRAME_LAYERS,
  MAX_REVERSIBLE_CLIP_BYTES,
  MAX_REVERSIBLE_CLIP_FRAMES,
  MAX_TRACKED_PLAYER_BYTES,
  MIN_ENDPOINT_RUNWAY_FRAMES,
  MIN_REVERSIBLE_CLIP_FRAMES,
  STREAMING_SLOT_COUNT,
  createResidentFramePlan,
  type ResidentFrameKey,
  type ResidentFramePlanInput
} from "./resident-frame-plan.js";

const MEBIBYTE = 1024 * 1024;

describe("resident frame plan", () => {
  it("deduplicates semantic identities in stable first-occurrence order", () => {
    const mutableSourceZero = {
      rendition: "main",
      unit: "source",
      localFrame: 0
    };
    const input = validInput({
      sourceRunway: [
        mutableSourceZero,
        ...frames("source", 5, 1)
      ],
      clip: [
        frame("source", 5),
        frame("clip", 1),
        frame("clip", 2),
        frame("clip", 3)
      ],
      targetRunway: [
        ...frames("target", 5),
        frame("clip", 3)
      ]
    });

    const plan = createResidentFramePlan(input);

    expect(plan.layerCount).toBe(14);
    expect(plan.sourceRunwayLayers).toEqual([0, 1, 2, 3, 4, 5]);
    expect(plan.clipLayers).toEqual([5, 6, 7, 8]);
    expect(plan.targetRunwayLayers).toEqual([9, 10, 11, 12, 13, 8]);
    expect(
      plan.uniqueFrames.map(({ key, layer }) => [
        key.unit,
        key.localFrame,
        layer
      ])
    ).toEqual([
        ["source", 0, 0],
        ["source", 1, 1],
        ["source", 2, 2],
        ["source", 3, 3],
        ["source", 4, 4],
        ["source", 5, 5],
        ["clip", 1, 6],
        ["clip", 2, 7],
        ["clip", 3, 8],
        ["target", 0, 9],
        ["target", 1, 10],
        ["target", 2, 11],
        ["target", 3, 12],
        ["target", 4, 13]
      ]);
    expect(
      plan.layerFor({ rendition: "main", unit: "clip", localFrame: 3 })
    ).toBe(8);
    expect(
      plan.layerFor({ rendition: "main", unit: "missing", localFrame: 0 })
    ).toBeUndefined();

    mutableSourceZero.unit = "mutated-after-planning";
    expect(plan.uniqueFrames[0]?.key.unit).toBe("source");
    expect(plan.layerFor(frame("source", 0))).toBe(0);
  });

  it("keeps all public planning data immutable", () => {
    const plan = createResidentFramePlan(validInput());

    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.uniqueFrames)).toBe(true);
    expect(Object.isFrozen(plan.uniqueFrames[0])).toBe(true);
    expect(Object.isFrozen(plan.uniqueFrames[0]?.key)).toBe(true);
    expect(Object.isFrozen(plan.sourceRunwayLayers)).toBe(true);
    expect(Object.isFrozen(plan.clipLayers)).toBe(true);
    expect(Object.isFrozen(plan.targetRunwayLayers)).toBe(true);
  });

  it("tracks the resident array, three streaming layers, GPU overhead, and staging", () => {
    const plan = createResidentFramePlan(
      validInput({
        width: 256,
        height: 256,
        sourceRunway: frames("source", 8),
        clip: frames("clip", 12),
        targetRunway: frames("target", 8)
      })
    );

    expect(STREAMING_SLOT_COUNT).toBe(3);
    expect(plan.layerCount).toBe(28);
    expect(plan.bytesPerFrame).toBe(262_144);
    expect(plan.residentBytes).toBe(7_340_032);
    expect(plan.residentAllocationBytes).toBe(9_175_040);
    expect(plan.streamingBytes).toBe(786_432);
    expect(plan.streamingAllocationBytes).toBe(983_040);
    expect(plan.gpuAllocationBytes).toBe(10_158_080);
    expect(plan.stagingBytes).toBe(262_144);
    expect(plan.trackedBytes).toBe(10_420_224);
  });

  it("uses all three key fields and never pixel-like or object identity", () => {
    const source = frames("shared", 6);
    const plan = createResidentFramePlan(
      validInput({
        sourceRunway: source,
        clip: [
          { ...source[0]! },
          frame("shared", 0, "alternate"),
          frame("shared", 1),
          frame("different-unit", 0)
        ],
        targetRunway: frames("target", 6)
      })
    );

    expect(plan.clipLayers[0]).toBe(plan.sourceRunwayLayers[0]);
    expect(plan.clipLayers[1]).not.toBe(plan.sourceRunwayLayers[0]);
    expect(plan.clipLayers[2]).toBe(plan.sourceRunwayLayers[1]);
    expect(plan.clipLayers[3]).not.toBe(plan.sourceRunwayLayers[0]);
    expect(plan.clipBytes).toBe(plan.bytesPerFrame * 4);
  });

  it.each([
    [MIN_REVERSIBLE_CLIP_FRAMES, "minimum"],
    [25, "above the former maximum"]
  ])("accepts the %s-frame reversible clip %s", (count) => {
    expect(() =>
      createResidentFramePlan(validInput({ clip: frames("clip", count) }))
    ).not.toThrow();
  });

  it("rejects an empty reversible clip", () => {
    expect(() =>
      createResidentFramePlan(validInput({ clip: [] }))
    ).toThrow("reversible clip must contain at least 1 frame");
    expect(MAX_REVERSIBLE_CLIP_FRAMES).toBe(0xffff_ffff);
  });

  it.each([
    [MIN_ENDPOINT_RUNWAY_FRAMES, "minimum"],
    [MAX_ENDPOINT_RUNWAY_FRAMES, "maximum"]
  ])("accepts %s-frame endpoint runways at the %s", (count) => {
    expect(() =>
      createResidentFramePlan(
        validInput({
          sourceRunway: frames("source", count),
          targetRunway: frames("target", count)
        })
      )
    ).not.toThrow();
  });

  it.each([
    ["sourceRunway", MIN_ENDPOINT_RUNWAY_FRAMES - 1],
    ["sourceRunway", MAX_ENDPOINT_RUNWAY_FRAMES + 1],
    ["targetRunway", MIN_ENDPOINT_RUNWAY_FRAMES - 1],
    ["targetRunway", MAX_ENDPOINT_RUNWAY_FRAMES + 1]
  ] as const)("rejects %s with %s frames", (field, count) => {
    expect(() =>
      createResidentFramePlan(
        validInput({ [field]: frames(field, count) })
      )
    ).toThrow("endpoint runway must contain 6–12 frames");
  });

  it("accepts exact device dimensions and rejects one over", () => {
    expect(() =>
      createResidentFramePlan(
        validInput({
          width: 64,
          height: 64,
          deviceLimits: { maxArrayTextureLayers: 128, maxTextureSize: 64 }
        })
      )
    ).not.toThrow();

    expect(() =>
      createResidentFramePlan(
        validInput({
          width: 65,
          deviceLimits: { maxArrayTextureLayers: 128, maxTextureSize: 64 }
        })
      )
    ).toThrow("width exceeds MAX_TEXTURE_SIZE");
    expect(() =>
      createResidentFramePlan(
        validInput({
          height: 65,
          deviceLimits: { maxArrayTextureLayers: 128, maxTextureSize: 64 }
        })
      )
    ).toThrow("height exceeds MAX_TEXTURE_SIZE");
  });

  it("accepts the exact device layer count and rejects one over", () => {
    const input = validInput();
    const expectedLayers =
      input.sourceRunway.length + input.clip.length + input.targetRunway.length;

    expect(expectedLayers).toBeLessThan(MAX_RESIDENT_FRAME_LAYERS);
    expect(
      createResidentFramePlan({
        ...input,
        deviceLimits: {
          ...input.deviceLimits,
          maxArrayTextureLayers: expectedLayers
        }
      }).layerCount
    ).toBe(expectedLayers);
    expect(() =>
      createResidentFramePlan({
        ...input,
        deviceLimits: {
          ...input.deviceLimits,
          maxArrayTextureLayers: expectedLayers - 1
        }
      })
    ).toThrow(`exceeds layer limit ${expectedLayers - 1}`);
  });

  it("accepts deduplicated clip data above the former 24 MiB cap", () => {
    const plan = createResidentFramePlan(
      validInput({
        width: 513,
        height: 512,
        sourceRunway: repeated(frame("clip", 0), 6),
        clip: frames("clip", 24),
        targetRunway: repeated(frame("clip", 23), 6),
        deviceLimits: { maxArrayTextureLayers: 128, maxTextureSize: 513 }
      })
    );

    expect(plan.clipBytes).toBeGreaterThan(24 * MEBIBYTE);
    expect(plan.residentBytes).toBe(plan.clipBytes);
    expect(plan.trackedBytes).toBeGreaterThan(plan.residentBytes);
    expect(MAX_REVERSIBLE_CLIP_BYTES).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("accepts resident and tracked data above the former 48/64 MiB caps", () => {
    const target = frames("target", 12);
    const plan = createResidentFramePlan(
      validInput({
        width: 512,
        height: 512,
        sourceRunway: frames("source", 12),
        clip: frames("clip", 24),
        targetRunway: target
      })
    );

    expect(plan.layerCount).toBe(48);
    expect(plan.residentBytes).toBe(48 * MEBIBYTE);
    expect(plan.trackedBytes).toBeGreaterThan(64 * MEBIBYTE);
    expect(MAX_RESIDENT_FRAME_BYTES).toBe(Number.MAX_SAFE_INTEGER);
    expect(MAX_TRACKED_PLAYER_BYTES).toBe(Number.MAX_SAFE_INTEGER);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid dimensions and device limits: %s",
    (value) => {
      expect(() =>
        createResidentFramePlan(validInput({ width: value }))
      ).toThrow(RangeError);
      expect(() =>
        createResidentFramePlan(validInput({ height: value }))
      ).toThrow(RangeError);
      expect(() =>
        createResidentFramePlan(
          validInput({
            deviceLimits: {
              maxArrayTextureLayers: value,
              maxTextureSize: 4_096
            }
          })
        )
      ).toThrow(RangeError);
      expect(() =>
        createResidentFramePlan(
          validInput({
            deviceLimits: {
              maxArrayTextureLayers: 128,
              maxTextureSize: value
            }
          })
        )
      ).toThrow(RangeError);
    }
  );

  it("rejects malformed frame keys and non-array sequences", () => {
    for (const malformed of [
      { rendition: " ", unit: "clip", localFrame: 0 },
      { rendition: "main", unit: "", localFrame: 0 },
      { rendition: "main", unit: "clip", localFrame: -1 },
      { rendition: "main", unit: "clip", localFrame: 1.5 },
      {
        rendition: "main",
        unit: "clip",
        localFrame: Number.MAX_SAFE_INTEGER + 1
      }
    ]) {
      expect(() =>
        createResidentFramePlan(
          validInput({ clip: [malformed, ...frames("clip", 5)] })
        )
      ).toThrow("must have non-empty rendition and unit strings");
    }

    expect(() =>
      createResidentFramePlan(
        validInput({ clip: {} as readonly ResidentFrameKey[] })
      )
    ).toThrow("reversible clip must be an array");
  });

  it("rejects malformed top-level and device-limit objects", () => {
    expect(() =>
      createResidentFramePlan(null as unknown as ResidentFramePlanInput)
    ).toThrow("resident frame plan input must be an object");
    expect(() =>
      createResidentFramePlan(
        validInput({
          deviceLimits: null as unknown as ResidentFramePlanInput["deviceLimits"]
        })
      )
    ).toThrow("resident frame device limits must be an object");
  });

  it("uses checked integer arithmetic for adversarial safe dimensions", () => {
    const shared = frame("shared", 0);
    expect(() =>
      createResidentFramePlan(
        validInput({
          width: Number.MAX_SAFE_INTEGER,
          height: Number.MAX_SAFE_INTEGER,
          sourceRunway: repeated(shared, 6),
          clip: [shared],
          targetRunway: repeated(shared, 6),
          deviceLimits: {
            maxArrayTextureLayers: 128,
            maxTextureSize: Number.MAX_SAFE_INTEGER
          }
        })
      )
    ).toThrow("exceeds JavaScript's safe-integer range");
  });

  it("returns undefined rather than aliasing malformed lookup keys", () => {
    const plan = createResidentFramePlan(validInput());
    expect(plan.layerFor(null as unknown as ResidentFrameKey)).toBeUndefined();
    expect(
      plan.layerFor({
        rendition: "main",
        unit: "source",
        localFrame: -1
      })
    ).toBeUndefined();
  });
});

function validInput(
  overrides: Partial<ResidentFramePlanInput> = {}
): ResidentFramePlanInput {
  return {
    width: 64,
    height: 64,
    sourceRunway: frames("source", 6),
    clip: frames("clip", 4),
    targetRunway: frames("target", 6),
    deviceLimits: {
      maxArrayTextureLayers: MAX_RESIDENT_FRAME_LAYERS,
      maxTextureSize: 4_096
    },
    ...overrides
  };
}

function frame(
  unit: string,
  localFrame: number,
  rendition = "main"
): ResidentFrameKey {
  return { rendition, unit, localFrame };
}

function frames(
  unit: string,
  count: number,
  start = 0,
  rendition = "main"
): ResidentFrameKey[] {
  return Array.from({ length: count }, (_, index) =>
    frame(unit, start + index, rendition)
  );
}

function repeated(key: ResidentFrameKey, count: number): ResidentFrameKey[] {
  return Array.from({ length: count }, () => ({ ...key }));
}
