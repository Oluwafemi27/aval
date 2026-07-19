import { describe, expect, it } from "vitest";

import { validateExampleAssets } from "../validate-example-assets.mjs";

describe("checked-in browser example assets", () => {
  it("match their reports, generated source markup, graphs, and canonical fixture", async () => {
    await expect(validateExampleAssets()).resolves.toEqual({
      assetsInspected: 16,
      bundlesValidated: [
        "grass-rabbit",
        "grass-rabbit-codecs",
        "kinetic-orb",
        "end-user-playground"
      ],
      staticSourcePagesValidated: [
        "grass-rabbit",
        "kinetic-orb",
        "end-user-playground"
      ],
      dynamicSourcePagesValidated: ["grass-rabbit-codecs"],
      fixtureMirrorValidated: true
    });
  }, 120_000);
});
