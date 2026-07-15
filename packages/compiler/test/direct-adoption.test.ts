import { describe, expect, it } from "vitest";

import {
  createCompileAdoptionSummary,
  formatCompileAdoptionSummary
} from "../src/adoption-summary.js";
import type { CompileResult } from "../src/model.js";

describe("direct compile adoption summary", () => {
  it("emits deterministic frame-canonical facts and copyable snippets", () => {
    const result = {
      outputPath: "/private/output/orbit.avl",
      bytes: 1234,
      sha256: "ab".repeat(32),
      buildDetails: {
        mode: "direct-video",
        manifest: {
          frameRate: { numerator: 30, denominator: 1 },
          canvas: { width: 64, height: 48 },
          units: [
            { id: "intro.default", kind: "one-shot", frameCount: 12 },
            { id: "body.default", kind: "body", frameCount: 24 }
          ],
          limits: {
            maxCompiledBytes: 1,
            maxRuntimeBytes: 2,
            decodedPixelBytes: 3,
            persistentCacheBytes: 4,
            runtimeWorkingSetBytes: 5
          }
        },
        renditions: [{ codedWidth: 64, codedHeight: 64 }],
        alphaPolicy: {
          selected: "opaque",
          audit: { uniqueReferencedFrames: 36 }
        },
        continuity: [{ status: "pass" }]
      }
    } as unknown as CompileResult;
    const summary = createCompileAdoptionSummary(result);
    expect(summary.units).toEqual([
      expect.objectContaining({ kind: "intro", frameRange: [0, 12] }),
      expect.objectContaining({ kind: "body", frameRange: [12, 36] })
    ]);
    expect(summary.snippets.html).toContain("orbit.avl");
    expect(summary.snippets.html).toContain("author-owned static fallback");
    expect(summary.snippets.html).not.toContain("fallback.png");
    expect(summary.snippets.npm).toBe("npm install @pixel-point/aval-element@1.0.0");
    expect(formatCompileAdoptionSummary(summary)).toContain("body body.default");
    expect(JSON.stringify(summary)).not.toContain("/private/output");
  });
});
