import { describe, expect, it } from "vitest";

import { CompilerError } from "../src/diagnostics.js";
import {
  normalizeSourceProject,
  parseNormalizedSourceProject
} from "../src/source-project-normalize.js";
import { validateSourceProjectV01 } from "../src/source-project-v01-schema.js";
import { validateSourceProjectV02 } from "../src/source-project-v02-schema.js";

describe("source project 0.2 schema", () => {
  it.each([
    ["avc-annexb-auto-v0", "auto"],
    ["avc-annexb-opaque-v0", "opaque"],
    ["avc-annexb-packed-alpha-v0", "packed"]
  ] as const)("normalizes %s to one %s policy model", (profile, alphaPolicy) => {
    const value = projectV02(profile);
    const parsed = validateSourceProjectV02(value);
    const normalized = normalizeSourceProject(parsed);

    expect(parsed).toMatchObject({ projectVersion: "0.2", profile });
    expect(normalized).toMatchObject({
      sourceProjectVersion: "0.2",
      alphaPolicy,
      canvas: { width: 33, height: 21, pixelAspect: [4, 3] },
      renditions: [{ id: "full", width: 33, height: 21 }]
    });
    expect(normalized.renditions[0]).not.toHaveProperty("codedWidth");
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized.renditions)).toBe(true);
  });

  it("parses strict JSON and preserves the separate 0.1 compatibility adapter", () => {
    const modern = parseNormalizedSourceProject(
      new TextEncoder().encode(JSON.stringify(projectV02()))
    );
    const legacy = normalizeSourceProject(validateSourceProjectV01(projectV01()));

    expect(modern.sourceProjectVersion).toBe("0.2");
    expect(legacy).toMatchObject({
      sourceProjectVersion: "0.1",
      alphaPolicy: "opaque",
      renditions: [{ id: "opaque", width: 32, height: 32 }]
    });
    expect(legacy.renditions[0]).not.toHaveProperty("codedWidth");
  });

  it("accepts reduced visible renditions that preserve the source pixel-grid aspect", () => {
    const value = projectV02();
    value.canvas = {
      ...value.canvas,
      width: 48,
      height: 32,
      pixelAspect: [10_000, 9_999]
    };
    value.renditions[0] = {
      ...value.renditions[0],
      width: 3,
      height: 2
    };

    expect(validateSourceProjectV02(value).renditions[0]).toMatchObject({
      width: 3,
      height: 2
    });
  });

  it("rejects author-controlled compiled geometry, ambiguity, and invalid ratios", () => {
    const cases: ((value: any) => void)[] = [
      (value) => { value.unknown = true; },
      (value) => { value.renditions[0].codedWidth = 48; },
      (value) => { value.renditions[0].alphaRect = [0, 40, 33, 21]; },
      (value) => { value.renditions[0].width = 34; },
      (value) => { value.renditions[0].width = 32; },
      (value) => { value.canvas.pixelAspect = [2, 2]; },
      (value) => { value.canvas.pixelAspect = [10_001, 1]; },
      (value) => { value.canvas.width = 0; },
      (value) => { value.canvas.height = 513; },
      (value) => { value.profile = "avc-annexb-packed-v0"; }
    ];
    for (const mutate of cases) {
      const value = projectV02();
      mutate(value);
      expect(() => validateSourceProjectV02(value)).toThrow(CompilerError);
    }

    const legacyShapeWithModernVersion = projectV01();
    legacyShapeWithModernVersion.projectVersion = "0.2";
    expect(() => validateSourceProjectV02(legacyShapeWithModernVersion))
      .toThrow(CompilerError);

    const modernShapeWithLegacyVersion = projectV02();
    modernShapeWithLegacyVersion.projectVersion = "0.1";
    expect(() => validateSourceProjectV01(modernShapeWithLegacyVersion))
      .toThrow(CompilerError);
  });

  it("dispatches only on an own, exact projectVersion field", () => {
    expect(() => parseNormalizedSourceProject(new TextEncoder().encode(
      JSON.stringify({ ...projectV02(), projectVersion: "0.3" })
    ))).toThrow(CompilerError);
    expect(() => parseNormalizedSourceProject(new TextEncoder().encode(
      JSON.stringify({ ...projectV02(), projectVersion: 0.2 })
    ))).toThrow(CompilerError);
  });
});

function projectV02(
  profile = "avc-annexb-auto-v0"
): any {
  return {
    projectVersion: "0.2",
    profile,
    canvas: {
      width: 33,
      height: 21,
      fit: "contain",
      pixelAspect: [4, 3],
      colorSpace: "srgb"
    },
    frameRate: { numerator: 30, denominator: 1 },
    sources: [{
      id: "source",
      type: "video",
      path: "render.mp4",
      timing: { mode: "exact" }
    }],
    renditions: [{
      id: "full",
      width: 33,
      height: 21,
      bitrate: { average: 300_000, peak: 600_000 }
    }],
    units: [{
      id: "idle-loop",
      kind: "body",
      source: "source",
      range: [0, 12],
      playback: "loop",
      ports: []
    }],
    initialState: "idle",
    states: [{ id: "idle", bodyUnit: "idle-loop" }],
    edges: [],
    bindings: []
  };
}

function projectV01(): any {
  return {
    ...projectV02("avc-annexb-opaque-v0"),
    projectVersion: "0.1",
    canvas: {
      width: 32,
      height: 32,
      fit: "contain",
      pixelAspect: [1, 1],
      colorSpace: "srgb"
    },
    renditions: [{
      id: "opaque",
      codedWidth: 32,
      codedHeight: 32,
      bitrate: { average: 300_000, peak: 600_000 }
    }]
  };
}
