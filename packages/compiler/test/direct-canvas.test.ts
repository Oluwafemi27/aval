import { describe, expect, it } from "vitest";

import { resolveDirectCanvas } from "../src/compile/direct-canvas.js";
import { CompilerError } from "../src/diagnostics.js";

describe("direct canvas selection", () => {
  it("preserves exact native source geometry when no canvas is requested", () => {
    expect(resolveDirectCanvas({ width: 1920, height: 1080 })).toEqual({
      width: 1920,
      height: 1080
    });
    expect(resolveDirectCanvas({ width: 32, height: 32 })).toEqual({
      width: 32,
      height: 32
    });
  });

  it("uses native PNG geometry and validates an explicit author resize", () => {
    expect(resolveDirectCanvas(
      { width: 64, height: 32 },
      undefined,
      true
    )).toEqual({ width: 64, height: 32 });
    expect(resolveDirectCanvas(
      { width: 64, height: 32 },
      [32, 16],
      true
    )).toEqual({ width: 32, height: 16 });
    expect(() => resolveDirectCanvas(
      { width: 64, height: 32 },
      [32, 32]
    )).toThrow(CompilerError);
    expect(resolveDirectCanvas(
      { width: 2048, height: 1024 },
      [1024, 512]
    )).toEqual({ width: 1024, height: 512 });
  });
});
