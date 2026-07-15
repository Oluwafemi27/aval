import { describe, expect, it } from "vitest";

import { CompilerError } from "../src/diagnostics.js";
import { COMPILER_PROJECT_VERSION } from "../src/model.js";
import {
  normalizeSourceProject,
  parseNormalizedSourceProject
} from "../src/source-project-normalize.js";
import { validateSourceProjectV03 } from "../src/source-project-v03-schema.js";

describe("source project 0.3 schema", () => {
  it("normalizes a closed CRF rendition to the configurable AVC-v1 policy", () => {
    const validated = validateSourceProjectV03(projectV03());
    const normalized = normalizeSourceProject(validated);

    expect(COMPILER_PROJECT_VERSION).toBe("0.3");
    expect(normalized).toMatchObject({
      sourceProjectVersion: "0.3",
      alphaPolicy: "auto",
      alphaPolicyRejectionCode: "ALPHA_POLICY_REJECTED"
    });
    expect(normalized.renditions[0]).toEqual({
      id: "avc.1x",
      width: 1280,
      height: 720,
      avcProfileVersion: "v1",
      encoding: {
        codec: "h264",
        preset: "veryslow",
        legacyZeroLatency: false,
        rateControl: {
          mode: "crf",
          crf: 20,
          maxBitrate: 10_000_000
        }
      }
    });
    expect(Object.isFrozen(validated.renditions[0]?.encoding)).toBe(true);
    expect(Object.isFrozen(validated.renditions[0]?.encoding.rateControl))
      .toBe(true);
    expect(Object.isFrozen(normalized.renditions[0]?.encoding)).toBe(true);
  });

  it("accepts closed ABR encoding and requires average at or below maximum", () => {
    const value = projectV03();
    value.renditions[0].encoding = {
      codec: "h264",
      preset: "slow",
      rateControl: {
        mode: "abr",
        averageBitrate: 6_000_000,
        maxBitrate: 10_000_000
      }
    };

    expect(normalizeSourceProject(validateSourceProjectV03(value))
      .renditions[0]).toEqual({
      id: "avc.1x",
      width: 1280,
      height: 720,
      avcProfileVersion: "v1",
      encoding: {
        codec: "h264",
        preset: "slow",
        legacyZeroLatency: false,
        rateControl: {
          mode: "abr",
          averageBitrate: 6_000_000,
          maxBitrate: 10_000_000
        }
      }
    });

    value.renditions[0].encoding.rateControl.averageBitrate = 10_000_001;
    expect(() => validateSourceProjectV03(value)).toThrow(CompilerError);
  });

  it("rejects out-of-range CRF, unsupported presets, and incomplete policies", () => {
    const cases: ((value: any) => void)[] = [
      (value) => { value.renditions[0].encoding.rateControl.crf = 0; },
      (value) => { value.renditions[0].encoding.rateControl.crf = 52; },
      (value) => { value.renditions[0].encoding.preset = "placebo"; },
      (value) => { delete value.renditions[0].encoding.rateControl.maxBitrate; },
      (value) => {
        value.renditions[0].encoding.rateControl.averageBitrate = 1_000_000;
      },
      (value) => { value.renditions[0].encoding.unknown = true; },
      (value) => { value.renditions[0].encoding.codec = "hevc"; }
    ];
    for (const mutate of cases) {
      const value = projectV03();
      mutate(value);
      expect(() => validateSourceProjectV03(value)).toThrow(CompilerError);
    }
  });

  it("rejects wrong discriminated-union keys and unknown project fields", () => {
    const wrongAbr = projectV03();
    wrongAbr.renditions[0].encoding.rateControl = {
      mode: "abr",
      averageBitrate: 5_000_000,
      maxBitrate: 10_000_000,
      crf: 20
    };
    expect(() => validateSourceProjectV03(wrongAbr)).toThrow(CompilerError);

    const unknownMode = projectV03();
    unknownMode.renditions[0].encoding.rateControl = {
      mode: "cbr",
      maxBitrate: 10_000_000
    };
    expect(() => validateSourceProjectV03(unknownMode)).toThrow(CompilerError);

    const unknownProject = projectV03();
    unknownProject.unknown = true;
    expect(() => validateSourceProjectV03(unknownProject)).toThrow(CompilerError);
  });

  it("dispatches 0.3 strict JSON without weakening older version dispatch", () => {
    const normalized = parseNormalizedSourceProject(
      new TextEncoder().encode(JSON.stringify(projectV03()))
    );
    expect(normalized.sourceProjectVersion).toBe("0.3");

    const oldProfile = projectV03();
    oldProfile.profile = "avc-annexb-auto-v0";
    expect(() => validateSourceProjectV03(oldProfile)).toThrow(CompilerError);

    const unsupported = projectV03();
    unsupported.projectVersion = "0.4";
    expect(() => parseNormalizedSourceProject(
      new TextEncoder().encode(JSON.stringify(unsupported))
    )).toThrow(CompilerError);
  });
});

function projectV03(): any {
  return {
    projectVersion: "0.3",
    profile: "avc-annexb-auto-v1",
    canvas: {
      width: 1280,
      height: 720,
      fit: "contain",
      pixelAspect: [1, 1],
      colorSpace: "srgb"
    },
    frameRate: { numerator: 30, denominator: 1 },
    sources: [{
      id: "source",
      type: "video",
      path: "render.mov",
      timing: { mode: "exact" }
    }],
    renditions: [{
      id: "avc.1x",
      width: 1280,
      height: 720,
      encoding: {
        codec: "h264",
        preset: "veryslow",
        rateControl: {
          mode: "crf",
          crf: 20,
          maxBitrate: 10_000_000
        }
      }
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
