import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  RuntimePlaybackError,
  normalizeRuntimeFailure
} from "@pixel-point/aval-player-web";

import { normalizePublicFailure } from "../src/public-failure.js";

describe("element trust boundary", () => {
  it("never copies raw thrown text or secret transport data", () => {
    const secret = "https://user:password@example.test/private.avl?token=SECRET";
    const failure = normalizePublicFailure(new Error(secret));
    expect(JSON.stringify(failure)).not.toContain("SECRET");
    expect(JSON.stringify(failure)).not.toContain("password");
    expect(Object.isFrozen(failure)).toBe(true);
  });

  it("preserves a thrown runtime failure code without copying its cause", () => {
    const runtime = new RuntimePlaybackError(normalizeRuntimeFailure(
      "load-failure",
      new Error("https://example.test/private.avl?token=SECRET"),
      { operation: "open-asset" }
    ));
    expect(normalizePublicFailure(runtime)).toEqual({
      code: "load-failure",
      message: "AVAL operation failed (load-failure)",
      operation: "open-asset"
    });
  });

  it("does not use generated markup, dynamic code, video seeking, or console hooks", async () => {
    const root = resolve(process.cwd(), "packages/element/src");
    const files = [
      "aval-element.ts",
      "shadow-layers.ts",
      "browser-runtime-factory.ts"
    ];
    const source = (await Promise.all(files.map((file) =>
      readFile(resolve(root, file), "utf8")
    ))).join("\n");
    for (const prohibited of [
      "innerHTML",
      "insertAdjacentHTML",
      "eval(",
      "new Function",
      "new Blob",
      "console.",
      "currentTime",
      "HTMLVideoElement"
    ]) expect(source).not.toContain(prohibited);
  });
});
