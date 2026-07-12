import { describe, expect, it } from "vitest";

import { createOpaqueTestAsset } from "./asset-test-fixture.js";
import { installRuntimeAssetCatalog } from "./asset-catalog.js";
import {
  collectProductionStrictStaticEvidence,
  createProductionProfileEvidence,
  rehearseProductionMotionPolicy
} from "./browser-production-readiness-m6-evidence.js";
import { assertRehearsalActive } from "./browser-readiness-rehearsal-driver.js";
import { BrowserStaticSurfaceDecoder } from "./strict-static-decoder.js";

describe("browser production readiness boundary", () => {
  it("rejects an abort before publishing production evidence", () => {
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));

    expect(() => assertRehearsalActive({
      signal: controller.signal,
      clock: { now: () => 1 },
      deadlineMs: 10
    })).toThrowError(expect.objectContaining({ name: "AbortError" }));
  });

  it("rejects an expired production rehearsal deadline", () => {
    expect(() => assertRehearsalActive({
      signal: new AbortController().signal,
      clock: { now: () => 10 },
      deadlineMs: 10
    })).toThrowError(expect.objectContaining({ name: "TimeoutError" }));
  });

  it.each([
    {
      profile: "avc-annexb-opaque-v0" as const,
      alpha: null,
      alphaPaneAvailable: false
    },
    {
      profile: "avc-annexb-packed-alpha-v0" as const,
      alpha: [0, 72, 64, 64] as const,
      alphaPaneAvailable: true
    }
  ])("attests $profile geometry and real renderer counters without a pixel claim", ({
    profile,
    alpha,
    alphaPaneAvailable
  }) => {
    const evidence = createProductionProfileEvidence({
      context: {
        candidate: {
          rendition: { profile },
          geometry: {
            visibleColorRect: [0, 0, 64, 64],
            visibleAlphaRect: alpha,
            decodedStorageRect: alpha === null
              ? [0, 0, 64, 64]
              : [0, 0, 64, 136],
            codedWidth: 64,
            codedHeight: alpha === null ? 64 : 144
          }
        }
      },
      interactionCache: { layerCount: 3 },
      renderer: {
        snapshot: () => ({
          state: "active",
          allocatedLayers: 3,
          uploadedResidentLayers: 3,
          residentUploads: 3,
          streamingUploads: 8,
          draws: 9,
          errors: 0
        })
      }
    } as never);

    expect(evidence).toMatchObject({
      profile,
      alphaPaneAvailable,
      uploadReady: true,
      pixelEvidence: "not-claimed-by-readiness-rehearsal",
      passed: true
    });
    expect(Object.isFrozen(evidence.visibleColorRect)).toBe(true);
    if (evidence.visibleAlphaRect !== null) {
      expect(Object.isFrozen(evidence.visibleAlphaRect)).toBe(true);
    }
  });

  it("records the strict pure PNG path and exact decoder cleanup facts", async () => {
    const catalog = installRuntimeAssetCatalog(createOpaqueTestAsset());
    const decoder = new BrowserStaticSurfaceDecoder({
      nativeInflater: null,
      createBitmap: async (_rgba, width, height) => ({
        width,
        height,
        close() {}
      } as ImageBitmap)
    });

    const evidence = await collectProductionStrictStaticEvidence({
      context: { catalog },
      signal: new AbortController().signal
    } as never, decoder);

    expect(evidence).toMatchObject({
      passed: true,
      uniqueStaticFrames: 1,
      decodedStaticFrames: 1,
      inflatePaths: ["pure"],
      browserPngDecoderUsed: false,
      pixelEvidence: "not-claimed-by-readiness-rehearsal",
      decode: {
        nativeAttempts: 0,
        pureAttempts: 1,
        pureSuccesses: 1,
        errors: 0,
        bitmapCloses: 1
      }
    });
    catalog.dispose();
  });

  it("rehearses reduced, restored, superseded, sticky, and disposed phases", () => {
    const evidence = rehearseProductionMotionPolicy();

    expect(evidence).toMatchObject({
      passed: true,
      staleTransitionRejected: true,
      stickyFailureRejectedReentry: true
    });
    expect(evidence.phases.map(({ phase }) => phase)).toEqual([
      "animated-installed",
      "reducing",
      "reduced",
      "restoring",
      "restored",
      "superseded-reduction",
      "sticky-failure",
      "disposed"
    ]);
    expect(evidence.phases.at(-2)).toMatchObject({
      actualMode: "static",
      staticOrigin: "animation-failure",
      stickyFailure: true
    });
  });
});
