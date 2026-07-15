import { describe, expect, it } from "vitest";

describe("element root", () => {
  it("imports without DOM globals or registration side effects", async () => {
    const before = Reflect.get(globalThis, "customElements");
    const module = await import("../src/index.js");
    expect(module.AVAL_TAG_NAME).toBe("aval-player");
    expect(Reflect.get(globalThis, "customElements")).toBe(before);
    expect(() => module.defineAvalElement()).toThrowError(
      expect.objectContaining({ name: "NotSupportedError" })
    );
  });
});
