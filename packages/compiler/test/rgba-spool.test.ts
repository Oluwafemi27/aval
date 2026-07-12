import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { readCanonicalRgbaRange } from "../src/compile/rgba-spool.js";
import {
  diagnosticFromError,
  formatDiagnostic
} from "../src/diagnostics.js";

describe("private canonical RGBA spool", () => {
  it("does not expose its scratch path through public diagnostics", async () => {
    const privatePath = join(
      tmpdir(),
      "customer-project-secret",
      "missing-normalized.rgba"
    );
    let error: unknown;
    try {
      await readCanonicalRgbaRange({
        source: {
          type: "raw-rgba",
          path: privatePath,
          width: 1,
          height: 1,
          frameRate: { numerator: 30, denominator: 1 }
        },
        frameCount: 1,
        startFrame: 0,
        endFrame: 1
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      code: "IO_FAILED",
      message: "Could not open canonical RGBA spool"
    });
    const diagnostic = diagnosticFromError(error);
    expect(diagnostic).not.toHaveProperty("path");
    for (const surface of [
      (error as Error).message,
      JSON.stringify(error),
      JSON.stringify(diagnostic),
      formatDiagnostic(diagnostic)
    ]) {
      expect(surface).not.toContain(privatePath);
      expect(surface).not.toContain("customer-project-secret");
    }
  });
});
