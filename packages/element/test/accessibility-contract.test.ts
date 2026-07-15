import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("accessibility contract", () => {
  it("does not inject control semantics or keyboard activation", async () => {
    const source = await readFile(
      resolve(process.cwd(), "packages/element/src/aval-element.ts"),
      "utf8"
    );
    for (const prohibited of [
      "keydown",
      "keyup",
      "preventDefault",
      "stopPropagation",
      "setPointerCapture",
      ".click()",
      "setAttribute(\"role\"",
      "setAttribute(\"tabindex\""
    ]) expect(source).not.toContain(prohibited);
  });
});
