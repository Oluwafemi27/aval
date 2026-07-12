import { describe, expect, it } from "vitest";

import {
  auditCanonicalAlphaFrames,
  mergeCanonicalAlphaAudits,
  resolveAlphaPolicy
} from "../src/compile/alpha-policy.js";
import {
  CompilerError,
  diagnosticFromError
} from "../src/diagnostics.js";

describe("asset-wide canonical alpha policy", () => {
  it("maps unknown failures to a stable path-free diagnostic", () => {
    const privatePath = "/Users/example/private-project/secret.mov";
    expect(diagnosticFromError(new Error(`failed to read ${privatePath}`))).toEqual({
      severity: "error",
      code: "IO_FAILED",
      message: "Unexpected compiler failure"
    });
  });

  it("selects opaque or packed once from every unique canonical reference", () => {
    const opaque = auditCanonicalAlphaFrames([
      frame("source-b", 4, [255, 255]),
      frame("source-a", 2, [255, 255]),
      frame("source-a", 2, [255, 255])
    ]);
    expect(opaque).toEqual({
      uniqueReferencedFrames: 2,
      minimumAlpha: 255,
      allOpaque: true,
      firstNonopaque: null
    });
    expect(resolveAlphaPolicy("auto", opaque)).toEqual({
      requested: "auto",
      selected: "opaque",
      audit: opaque,
      warnings: []
    });

    const transparent = auditCanonicalAlphaFrames([
      frame("source-b", 4, [255, 7]),
      frame("source-a", 9, [254, 255]),
      frame("source-a", 1, [255, 0])
    ]);
    expect(transparent).toEqual({
      uniqueReferencedFrames: 3,
      minimumAlpha: 0,
      allOpaque: false,
      firstNonopaque: {
        source: "source-a",
        frame: 1,
        x: 1,
        y: 0,
        alpha: 0
      }
    });
    expect(resolveAlphaPolicy("auto", transparent).selected).toBe("packed");
  });

  it("includes poster-only alpha and excludes unreferenced frames supplied by no caller", () => {
    const audit = auditCanonicalAlphaFrames([
      frame("animation", 0, [255, 255], "unit"),
      frame("poster", 17, [255, 99], "poster")
    ]);
    expect(audit.uniqueReferencedFrames).toBe(2);
    expect(audit.firstNonopaque).toMatchObject({
      source: "poster",
      frame: 17,
      x: 1,
      alpha: 99
    });
  });

  it("merges independently streamed sources into one deterministic asset audit", () => {
    const left = auditCanonicalAlphaFrames([
      frame("source-a", 0, [255, 255])
    ]);
    const right = auditCanonicalAlphaFrames([
      frame("source-b", 4, [255, 12])
    ]);
    expect(mergeCanonicalAlphaAudits([right, left])).toEqual({
      uniqueReferencedFrames: 2,
      minimumAlpha: 12,
      allOpaque: false,
      firstNonopaque: {
        source: "source-b",
        frame: 4,
        x: 1,
        y: 0,
        alpha: 12
      }
    });
  });

  it("rejects explicit opaque with stable structured coordinates", () => {
    const audit = auditCanonicalAlphaFrames([
      frame("source-a", 8, [255, 126])
    ]);
    try {
      resolveAlphaPolicy("opaque", audit);
      throw new Error("expected explicit opaque rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(CompilerError);
      expect(error).toMatchObject({
        code: "ALPHA_POLICY_REJECTED",
        source: "source-a",
        frame: 8,
        x: 1,
        y: 0,
        alpha: 126,
        policy: "opaque",
        phase: "classification"
      });
      expect((error as Error).message).not.toContain("source-a");
      expect(diagnosticFromError(error)).toMatchObject({
        source: "source-a",
        frame: 8,
        alpha: 126,
        policy: "opaque",
        phase: "classification"
      });
    }
  });

  it("retains the deprecated 0.1 opaque diagnostic mapping without a second policy", () => {
    const audit = auditCanonicalAlphaFrames([
      frame("legacy", 0, [255, 1])
    ]);
    expect(() => resolveAlphaPolicy("opaque", audit, {
      rejectionCode: "OPAQUE_ONLY_M5"
    })).toThrow(expect.objectContaining({
      code: "OPAQUE_ONLY_M5",
      phase: "classification"
    }));
  });

  it("warns only once when explicit packed is unnecessary", () => {
    const audit = auditCanonicalAlphaFrames([
      frame("source", 0, [255, 255])
    ]);
    expect(resolveAlphaPolicy("packed", audit)).toEqual({
      requested: "packed",
      selected: "packed",
      audit,
      warnings: ["Packed alpha was requested for fully opaque canonical pixels"]
    });
  });

  it("is input-order independent and keeps caller bytes immutable", () => {
    const first = frame("z", 2, [200, 5]);
    const second = frame("a", 7, [255, 200]);
    const before = first.rgba.slice();
    expect(auditCanonicalAlphaFrames([first, second])).toEqual(
      auditCanonicalAlphaFrames([second, first])
    );
    expect(first.rgba).toEqual(before);
  });

  it("rejects invalid geometry, hostile counts, and cancellation", () => {
    expect(() => auditCanonicalAlphaFrames([{
      source: "source",
      frame: 0,
      role: "unit",
      width: 2,
      height: 1,
      rgba: Uint8Array.of(0, 0, 0, 255)
    }])).toThrow(CompilerError);

    const tooMany = Array.from({ length: 934 }, (_, index) =>
      frame("source", index, [255, 255])
    );
    expect(() => auditCanonicalAlphaFrames(tooMany)).toThrow(CompilerError);

    const controller = new AbortController();
    controller.abort("test");
    expect(() => auditCanonicalAlphaFrames([
      frame("source", 0, [255, 255])
    ], controller.signal)).toThrow(expect.objectContaining({ code: "CANCELLED" }));
  });
});

function frame(
  source: string,
  frameIndex: number,
  alpha: readonly [number, number],
  role: "unit" | "poster" = "unit"
) {
  return {
    source,
    frame: frameIndex,
    role,
    width: 2,
    height: 1,
    rgba: Uint8Array.of(10, 20, 30, alpha[0], 40, 50, 60, alpha[1])
  } as const;
}
