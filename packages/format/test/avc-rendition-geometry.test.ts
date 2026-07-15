import { describe, expect, it } from "vitest";

import {
  avcQuantizationPolicyForRendition,
  deriveAvcRenditionGeometry,
  deriveAvcRenditionGeometryFromVisible,
  type AvcRenditionGeometryInput
} from "../src/avc/index.js";
import { FormatError } from "../src/errors.js";

const DIMENSIONS = [1, 2, 15, 16, 511, 512] as const;

describe("deriveAvcRenditionGeometry", () => {
  it("maps each exact production profile to its versioned quantization policy", () => {
    expect(avcQuantizationPolicyForRendition("avc-annexb-opaque-v0"))
      .toBe("fixed-qp26-v0");
    expect(avcQuantizationPolicyForRendition("avc-annexb-packed-alpha-v0"))
      .toBe("fixed-qp26-v0");
    expect(avcQuantizationPolicyForRendition("avc-annexb-opaque-v1"))
      .toBe("bounded-qp-v1");
    expect(avcQuantizationPolicyForRendition("avc-annexb-packed-alpha-v1"))
      .toBe("bounded-qp-v1");
    expectProfileInvalid(() => avcQuantizationPolicyForRendition(
      "avc-annexb-opaque-v2" as never
    ), "rendition.profile");
  });

  it("derives v1 geometry without changing the opaque or packed layout", () => {
    expect(deriveAvcRenditionGeometryFromVisible({
      canvasWidth: 16,
      canvasHeight: 16,
      profile: "avc-annexb-opaque-v1",
      visibleWidth: 16,
      visibleHeight: 16
    })).toMatchObject({
      profile: "avc-annexb-opaque-v1",
      decodedStorageRect: [0, 0, 16, 16]
    });
    expect(deriveAvcRenditionGeometryFromVisible({
      canvasWidth: 16,
      canvasHeight: 16,
      profile: "avc-annexb-packed-alpha-v1",
      visibleWidth: 16,
      visibleHeight: 16
    })).toMatchObject({
      profile: "avc-annexb-packed-alpha-v1",
      visibleAlphaRect: [0, 24, 16, 16],
      decodedStorageRect: [0, 0, 16, 40]
    });
  });
  it("preserves authored visible geometry above the former canvas ceiling", () => {
    expect(deriveAvcRenditionGeometryFromVisible({
      canvasWidth: 1_024,
      canvasHeight: 576,
      profile: "avc-annexb-opaque-v0",
      visibleWidth: 1_024,
      visibleHeight: 576
    })).toMatchObject({
      visibleColorRect: [0, 0, 1_024, 576],
      codedWidth: 1_024,
      codedHeight: 576,
      decodedRgbaBytes: 1_024 * 576 * 4
    });
  });

  it("derives compiler-ready manifest facts from visible dimensions alone", () => {
    expect(deriveAvcRenditionGeometryFromVisible({
      canvasWidth: 15,
      canvasHeight: 17,
      profile: "avc-annexb-packed-alpha-v0",
      visibleWidth: 15,
      visibleHeight: 17
    })).toEqual({
      profile: "avc-annexb-packed-alpha-v0",
      visibleColorRect: [0, 0, 15, 17],
      visibleAlphaRect: [0, 26, 15, 17],
      decodedStorageRect: [0, 0, 16, 44],
      codedWidth: 16,
      codedHeight: 48,
      visibleColorArea: 255,
      decodedRgbaBytes: 2_816,
      codedRgbaBytes: 3_072
    });
  });

  it("derives every odd/even opaque geometry combination exactly", () => {
    for (const width of DIMENSIONS) {
      for (const height of DIMENSIONS) {
        const paneWidth = even(width);
        const paneHeight = even(height);
        const codedWidth = align16(paneWidth);
        const codedHeight = align16(paneHeight);
        const geometry = deriveAvcRenditionGeometry(
          opaqueInput(width, height)
        );

        expect(geometry).toEqual({
          profile: "avc-annexb-opaque-v0",
          visibleColorRect: [0, 0, width, height],
          decodedStorageRect: [0, 0, paneWidth, paneHeight],
          codedWidth,
          codedHeight,
          visibleColorArea: width * height,
          decodedRgbaBytes: paneWidth * paneHeight * 4,
          codedRgbaBytes: codedWidth * codedHeight * 4
        });
        expectDeepFrozen(geometry);
      }
    }
  });

  it("derives every odd/even packed geometry combination with one fixed gutter", () => {
    for (const width of DIMENSIONS) {
      for (const height of DIMENSIONS) {
        const paneWidth = even(width);
        const paneHeight = even(height);
        const storageHeight = 2 * paneHeight + 8;
        const codedWidth = align16(paneWidth);
        const codedHeight = align16(storageHeight);
        const geometry = deriveAvcRenditionGeometry(
          packedInput(width, height)
        );

        expect(geometry).toEqual({
          profile: "avc-annexb-packed-alpha-v0",
          visibleColorRect: [0, 0, width, height],
          visibleAlphaRect: [0, paneHeight + 8, width, height],
          decodedStorageRect: [0, 0, paneWidth, storageHeight],
          codedWidth,
          codedHeight,
          visibleColorArea: width * height,
          decodedRgbaBytes: paneWidth * storageHeight * 4,
          codedRgbaBytes: codedWidth * codedHeight * 4
        });
        expectDeepFrozen(geometry);
      }
    }
  });

  it("requires the source pixel-grid aspect and canvas bounds exactly", () => {
    expectProfileInvalid(
      () =>
        deriveAvcRenditionGeometry({
          ...opaqueInput(16, 16),
          canvasWidth: 32,
          canvasHeight: 16
        }),
      "rendition.alphaLayout.colorRect"
    );
    expectProfileInvalid(
      () =>
        deriveAvcRenditionGeometry({
          ...opaqueInput(16, 16),
          canvasWidth: 15
        }),
      "rendition.alphaLayout.colorRect"
    );
  });

  it("rejects every alternate packed origin, pane size, gap, overlap, or coded size", () => {
    const valid = packedInput(15, 17);
    const invalid: readonly AvcRenditionGeometryInput[] = [
      { ...valid, colorRect: [1, 0, 15, 17] },
      { ...valid, colorRect: [0, 1, 15, 17] },
      { ...valid, colorRect: [0, 0, 14, 17] },
      { ...valid, alphaRect: [1, 26, 15, 17] },
      { ...valid, alphaRect: [0, 26, 14, 17] },
      { ...valid, alphaRect: [0, 25, 15, 17] },
      { ...valid, alphaRect: [0, 27, 15, 17] },
      { ...valid, codedWidth: 15 },
      { ...valid, codedWidth: 32 },
      { ...valid, codedHeight: 47 },
      { ...valid, codedHeight: 64 }
    ];

    for (const input of invalid) {
      expectProfileInvalid(() => deriveAvcRenditionGeometry(input));
    }
  });

  it("rejects alternate opaque storage padding and profile-incompatible alpha facts", () => {
    const valid = opaqueInput(15, 17);
    expectProfileInvalid(() =>
      deriveAvcRenditionGeometry({ ...valid, codedWidth: 32 })
    );
    expectProfileInvalid(() =>
      deriveAvcRenditionGeometry({
        ...valid,
        alphaRect: [0, 26, 15, 17]
      } as AvcRenditionGeometryInput)
    );
    expectProfileInvalid(() =>
      deriveAvcRenditionGeometry({
        ...packedInput(15, 17),
        alphaRect: undefined
      } as unknown as AvcRenditionGeometryInput)
    );
  });

  it("rejects unsafe and over-limit dimensions and products before deriving", () => {
    for (const input of [
      { ...opaqueInput(1, 1), canvasWidth: Number.MAX_SAFE_INTEGER },
      { ...opaqueInput(1, 1), codedWidth: Number.MAX_SAFE_INTEGER },
      { ...opaqueInput(1, 1), codedWidth: 2_048, codedHeight: 2_048 },
      { ...opaqueInput(1, 1), codedWidth: 2_048 },
      { ...opaqueInput(1, 1), codedHeight: 2_048 },
      { ...opaqueInput(1, 1), colorRect: [0, 0, Number.MAX_SAFE_INTEGER, 1] }
    ] as readonly AvcRenditionGeometryInput[]) {
      expectProfileInvalid(() => deriveAvcRenditionGeometry(input));
    }
  });
});

function opaqueInput(
  width: number,
  height: number
): Extract<
  AvcRenditionGeometryInput,
  { readonly profile: "avc-annexb-opaque-v0" }
> {
  return {
    canvasWidth: width,
    canvasHeight: height,
    profile: "avc-annexb-opaque-v0",
    codedWidth: align16(even(width)),
    codedHeight: align16(even(height)),
    colorRect: [0, 0, width, height]
  };
}

function packedInput(
  width: number,
  height: number
): Extract<
  AvcRenditionGeometryInput,
  { readonly profile: "avc-annexb-packed-alpha-v0" }
> {
  const paneWidth = even(width);
  const paneHeight = even(height);
  return {
    canvasWidth: width,
    canvasHeight: height,
    profile: "avc-annexb-packed-alpha-v0",
    codedWidth: align16(paneWidth),
    codedHeight: align16(2 * paneHeight + 8),
    colorRect: [0, 0, width, height],
    alphaRect: [0, paneHeight + 8, width, height]
  };
}

function even(value: number): number {
  return value % 2 === 0 ? value : value + 1;
}

function align16(value: number): number {
  return Math.ceil(value / 16) * 16;
}

function expectProfileInvalid(
  action: () => unknown,
  path?: string
): FormatError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(FormatError);
    expect(error).toMatchObject({
      code: "PROFILE_INVALID",
      ...(path === undefined ? {} : { path })
    });
    return error as FormatError;
  }
  throw new Error("expected PROFILE_INVALID");
}

function expectDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const key of Reflect.ownKeys(value)) {
    expectDeepFrozen((value as Record<PropertyKey, unknown>)[key], seen);
  }
}
