import { describe, expect, it } from "vitest";

import { FORMAT_DEFAULT_BUDGETS } from "../src/constants.js";
import { FormatError } from "../src/errors.js";
import { parseFrontIndex, validateCompleteAsset } from "../src/parser.js";
import type { CanonicalAssetInputV01 } from "../src/model.js";
import { writeCanonicalAsset } from "../src/writer.js";
import {
  avcWriterInput,
  byteIdentity,
  shuffledWriterInput,
  twoRenditionWriterInput,
  validWriterInput
} from "./writer-fixture.js";

function expectFormatError(
  operation: () => unknown,
  code?: FormatError["code"]
): FormatError {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(FormatError);
    if (code !== undefined) expect((error as FormatError).code).toBe(code);
    return error as FormatError;
  }
  throw new Error("expected a FormatError");
}

function snapshotInput(input: CanonicalAssetInputV01): string {
  return JSON.stringify({
    manifest: input.manifest,
    accessUnits: input.accessUnits.map(({ bytes, ...record }) => ({
      ...record,
      bytes: Array.from(bytes)
    })),
    staticPayloads: input.staticPayloads.map(({ bytes, ...record }) => ({
      ...record,
      bytes: Array.from(bytes)
    }))
  });
}

function replaceAccess(
  input: CanonicalAssetInputV01,
  accessUnits: CanonicalAssetInputV01["accessUnits"]
): CanonicalAssetInputV01 {
  return { ...input, accessUnits };
}

function replaceStatic(
  input: CanonicalAssetInputV01,
  staticPayloads: CanonicalAssetInputV01["staticPayloads"]
): CanonicalAssetInputV01 {
  return { ...input, staticPayloads };
}

function unreadHostileArray(length: number): {
  readonly value: unknown[];
  readonly elementReads: () => number;
} {
  const target: unknown[] = [];
  target.length = length;
  let reads = 0;
  const value = new Proxy(target, {
    get(array, property, receiver) {
      if (typeof property === "string" && /^(?:0|[1-9][0-9]*)$/.test(property)) {
        reads += 1;
      }
      return Reflect.get(array, property, receiver);
    }
  });
  return { value, elementReads: () => reads };
}

describe("writeCanonicalAsset", () => {
  it("writes deterministic valid bytes repeatedly and from shuffled semantic input", () => {
    const input = twoRenditionWriterInput();
    const first = writeCanonicalAsset(input);
    const second = writeCanonicalAsset(input);
    const shuffled = writeCanonicalAsset(shuffledWriterInput(input));

    expect(byteIdentity(first, second)).toBe(true);
    expect(byteIdentity(first, shuffled)).toBe(true);
    expect(validateCompleteAsset({ bytes: first }).fileRange).toEqual({
      offset: 0,
      length: first.byteLength
    });
  });

  it("does not mutate metadata, arrays, records, or caller payload bytes", () => {
    const input = validWriterInput();
    const before = snapshotInput(input);
    const bytes = writeCanonicalAsset(input);

    expect(snapshotInput(input)).toBe(before);
    bytes.fill(0);
    expect(snapshotInput(input)).toBe(before);
  });

  it("observes payload changes only on a later synchronous call", () => {
    const input = validWriterInput();
    const first = writeCanonicalAsset(input);
    const original = input.accessUnits[0]!.bytes[24] ?? 0;
    input.accessUnits[0]!.bytes[24] = original ^ 0xff;
    const second = writeCanonicalAsset(input);

    expect(byteIdentity(first, second)).toBe(false);
    expect(validateCompleteAsset({ bytes: second }).fileRange.length).toBe(
      second.byteLength
    );
  });

  it("rejects missing, duplicate, unknown, empty, and oversized access-unit payloads", () => {
    const missing = validWriterInput();
    expectFormatError(
      () => writeCanonicalAsset(replaceAccess(missing, missing.accessUnits.slice(1))),
      "WRITER_INVALID"
    );

    const duplicate = validWriterInput();
    expectFormatError(
      () => writeCanonicalAsset(replaceAccess(duplicate, [
        ...duplicate.accessUnits,
        duplicate.accessUnits[0]!
      ])),
      "WRITER_INVALID"
    );

    const extra = validWriterInput();
    expectFormatError(
      () => writeCanonicalAsset(replaceAccess(extra, [
        ...extra.accessUnits,
        { ...extra.accessUnits[0]!, unit: "unknown" }
      ])),
      "WRITER_INVALID"
    );

    const empty = validWriterInput();
    expectFormatError(
      () => writeCanonicalAsset(replaceAccess(empty, [
        { ...empty.accessUnits[0]!, bytes: new Uint8Array() },
        ...empty.accessUnits.slice(1)
      ])),
      "WRITER_INVALID"
    );

    const oversized = validWriterInput();
    expectFormatError(
      () => writeCanonicalAsset(replaceAccess(oversized, [
        {
          ...oversized.accessUnits[0]!,
          bytes: new Uint8Array(FORMAT_DEFAULT_BUDGETS.maxSampleBytes + 1)
        },
        ...oversized.accessUnits.slice(1)
      ])),
      "BUDGET_EXCEEDED"
    );
  });

  it("rejects missing, duplicate, unknown, empty, and oversized static payloads", () => {
    const missing = validWriterInput();
    expectFormatError(
      () => writeCanonicalAsset(replaceStatic(missing, missing.staticPayloads.slice(1))),
      "WRITER_INVALID"
    );

    const duplicate = validWriterInput();
    expectFormatError(
      () => writeCanonicalAsset(replaceStatic(duplicate, [
        ...duplicate.staticPayloads,
        duplicate.staticPayloads[0]!
      ])),
      "WRITER_INVALID"
    );

    const extra = validWriterInput();
    expectFormatError(
      () => writeCanonicalAsset(replaceStatic(extra, [
        ...extra.staticPayloads,
        { staticFrame: "unknown", bytes: extra.staticPayloads[0]!.bytes }
      ])),
      "WRITER_INVALID"
    );

    const empty = validWriterInput();
    expectFormatError(
      () => writeCanonicalAsset(replaceStatic(empty, [
        { ...empty.staticPayloads[0]!, bytes: new Uint8Array() },
        ...empty.staticPayloads.slice(1)
      ])),
      "WRITER_INVALID"
    );

    const oversized = validWriterInput();
    expectFormatError(
      () => writeCanonicalAsset(replaceStatic(oversized, [
        {
          ...oversized.staticPayloads[0]!,
          bytes: new Uint8Array(FORMAT_DEFAULT_BUDGETS.maxStaticPngBytes + 1)
        },
        ...oversized.staticPayloads.slice(1)
      ])),
      "BUDGET_EXCEEDED"
    );
  });

  it("enforces frame-zero and reference-rendition key rules", () => {
    const frameZero = validWriterInput();
    expectFormatError(
      () => writeCanonicalAsset(replaceAccess(frameZero, [
        { ...frameZero.accessUnits[0]!, key: false },
        ...frameZero.accessUnits.slice(1)
      ])),
      "WRITER_INVALID"
    );

    const referenceDelta = validWriterInput();
    expectFormatError(
      () => writeCanonicalAsset(replaceAccess(referenceDelta, [
        referenceDelta.accessUnits[0]!,
        { ...referenceDelta.accessUnits[1]!, key: false },
        ...referenceDelta.accessUnits.slice(2)
      ])),
      "WRITER_INVALID"
    );
  });

  it("self-validates reference sample identity and shallow PNG metadata", () => {
    const badReference = validWriterInput();
    const referenceBytes = badReference.accessUnits[0]!.bytes.slice();
    referenceBytes[0] = 0;
    expectFormatError(
      () => writeCanonicalAsset(replaceAccess(badReference, [
        { ...badReference.accessUnits[0]!, bytes: referenceBytes },
        ...badReference.accessUnits.slice(1)
      ])),
      "REFERENCE_FRAME_INVALID"
    );

    const badPng = validWriterInput();
    const pngBytes = badPng.staticPayloads[0]!.bytes.slice();
    pngBytes[0] = 0;
    expectFormatError(
      () => writeCanonicalAsset(replaceStatic(badPng, [
        { ...badPng.staticPayloads[0]!, bytes: pngBytes },
        ...badPng.staticPayloads.slice(1)
      ])),
      "PNG_ENVELOPE_INVALID"
    );
  });

  it("converges across every eight-byte alignment residue", () => {
    const seenManifestResidues = new Set<number>();
    for (let suffixLength = 0; suffixLength < 16; suffixLength += 1) {
      const bytes = writeCanonicalAsset(
        validWriterInput({ generatorSuffix: "x".repeat(suffixLength) })
      );
      const front = parseFrontIndex(bytes);
      seenManifestResidues.add(
        (front.header.manifestOffset + front.header.manifestLength) % 8
      );
      expect(front.header.indexOffset % 8).toBe(0);
      expect(front.records.every((record) => record.payloadOffset % 8 === 0 || record.frameIndex > 0)).toBe(true);
    }
    expect([...seenManifestResidues].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("converges when a derived static offset crosses a decimal digit boundary", () => {
    const below = parseFrontIndex(
      writeCanonicalAsset(validWriterInput({ staticLength: (index) => index === 0 ? 3_000 : 33 }))
    );
    const above = parseFrontIndex(
      writeCanonicalAsset(validWriterInput({ staticLength: (index) => index === 0 ? 8_000 : 33 }))
    );

    expect(below.manifest.staticFrames[1]!.offset).toBeLessThan(10_000);
    expect(above.manifest.staticFrames[1]!.offset).toBeGreaterThanOrEqual(10_000);
    for (const front of [below, above]) {
      for (let index = 1; index < front.manifest.staticFrames.length; index += 1) {
        expect(front.manifest.staticFrames[index]!.offset % 8).toBe(0);
      }
    }
  });

  it("converges at every larger decimal offset-width transition below 32 MiB", () => {
    const baseOffset = parseFrontIndex(
      writeCanonicalAsset(avcWriterInput(0))
    ).manifest.staticFrames[0]!.offset;
    for (const threshold of [100_000, 1_000_000, 10_000_000]) {
      const belowExtra = Math.max(0, threshold - baseOffset - 512);
      const aboveExtra = threshold - baseOffset + 512;
      const belowOffset = parseFrontIndex(
        writeCanonicalAsset(avcWriterInput(belowExtra))
      ).manifest.staticFrames[0]!.offset;
      const aboveOffset = parseFrontIndex(
        writeCanonicalAsset(avcWriterInput(aboveExtra))
      ).manifest.staticFrames[0]!.offset;

      expect(belowOffset).toBeLessThan(threshold);
      expect(aboveOffset).toBeGreaterThanOrEqual(threshold);
      expect(belowOffset % 8).toBe(0);
      expect(aboveOffset % 8).toBe(0);
    }
  });

  it("honors lower file, manifest, index, sample, static, and count budgets", () => {
    const input = validWriterInput();
    const bytes = writeCanonicalAsset(input);
    const front = parseFrontIndex(bytes);
    const fileLimited: CanonicalAssetInputV01 = {
      ...input,
      manifest: {
        ...input.manifest,
        limits: { ...input.manifest.limits, maxCompiledBytes: 4_096 }
      }
    };
    expectFormatError(
      () => writeCanonicalAsset(fileLimited, { budgets: { maxFileBytes: 4_096 } }),
      "BUDGET_EXCEEDED"
    );
    const cases = [
      ["manifest", { maxManifestBytes: front.header.manifestLength - 1 }],
      ["index", { maxIndexBytes: front.header.indexLength - 1 }],
      ["sample", { maxSampleBytes: input.accessUnits[0]!.bytes.byteLength - 1 }],
      ["static", { maxStaticPngBytes: input.staticPayloads[0]!.bytes.byteLength - 1 }],
      ["record count", { maxSampleRecords: input.accessUnits.length - 1 }],
      ["unit count", { maxUnits: input.manifest.units.length - 1 }],
      ["static count", { maxStaticFrames: input.manifest.staticFrames.length - 1 }]
    ] as const;
    for (const [label, budgets] of cases) {
      const error = expectFormatError(() => writeCanonicalAsset(input, { budgets }));
      expect(error.code, `${label}: ${error.message}`).toBe("BUDGET_EXCEEDED");
    }
  });

  it("rejects every bounded writer array before traversing hostile elements", () => {
    type MutableInput = ReturnType<typeof validWriterInput> & {
      manifest: any;
    };
    const cases: readonly [
      string,
      number,
      (input: MutableInput, value: unknown[]) => void
    ][] = [
      ["states", FORMAT_DEFAULT_BUDGETS.maxStates + 1, (input, value) => {
        input.manifest.states = value;
      }],
      ["edges", FORMAT_DEFAULT_BUDGETS.maxEdges + 1, (input, value) => {
        input.manifest.edges = value;
      }],
      ["bindings", FORMAT_DEFAULT_BUDGETS.maxBindings + 1, (input, value) => {
        input.manifest.bindings = value;
      }],
      ["unit samples", 2, (input, value) => {
        input.manifest.units[0].samples = value;
      }],
      ["body ports", FORMAT_DEFAULT_BUDGETS.maxPortsPerBody + 1, (input, value) => {
        input.manifest.units.find((unit: any) => unit.kind === "body").ports = value;
      }],
      ["portal frames", 7, (input, value) => {
        input.manifest.units.find((unit: any) => unit.kind === "body").ports[0].portalFrames = value;
      }],
      ["residency endpoints", 3, (input, value) => {
        input.manifest.units.find((unit: any) => unit.kind === "reversible")
          .residency.endpoints = value;
      }],
      ["rendition capabilities", 3, (input, value) => {
        input.manifest.renditions[0].capabilities = value;
      }],
      ["bootstrap units", FORMAT_DEFAULT_BUDGETS.maxUnits + 1, (input, value) => {
        input.manifest.readiness.bootstrapUnits = value;
      }],
      ["immediate edges", FORMAT_DEFAULT_BUDGETS.maxEdges + 1, (input, value) => {
        input.manifest.readiness.immediateEdges = value;
      }]
    ];

    for (const [label, length, install] of cases) {
      const input = validWriterInput() as MutableInput;
      const hostile = unreadHostileArray(length);
      install(input, hostile.value);
      expectFormatError(() => writeCanonicalAsset(input));
      expect(hostile.elementReads(), label).toBe(0);
    }
  });

  it("validates sortable and keyed strings before comparison or key construction", () => {
    type MutableInput = ReturnType<typeof validWriterInput> & {
      manifest: any;
      accessUnits: any;
    };
    const oversized = "x".repeat(
      FORMAT_DEFAULT_BUDGETS.maxJsonStringBytes + 1
    );
    const cases: readonly [string, (input: MutableInput) => void][] = [
      ["state ID", (input) => {
        input.manifest.states[0].id = oversized;
      }],
      ["rendition capability", (input) => {
        input.manifest.renditions[0].capabilities = [oversized];
      }],
      ["readiness ID", (input) => {
        input.manifest.readiness.bootstrapUnits[0] = oversized;
      }],
      ["residency endpoint", (input) => {
        input.manifest.units.find((unit: any) => unit.kind === "reversible")
          .residency.endpoints[0].state = oversized;
      }],
      ["access-unit rendition", (input) => {
        input.accessUnits[0].rendition = oversized;
      }]
    ];

    for (const [label, mutate] of cases) {
      const input = validWriterInput() as MutableInput;
      mutate(input);
      const error = expectFormatError(
        () => writeCanonicalAsset(input),
        "WRITER_INVALID"
      );
      expect(error.message, label).not.toContain("could not be normalized");
    }
  });

  it("contains hostile input failures behind the stable FormatError surface", () => {
    const hostile: unknown[] = [
      null,
      undefined,
      1,
      "asset",
      {},
      { manifest: {}, accessUnits: [], staticPayloads: [] },
      { ...validWriterInput(), extra: true },
      new Proxy(validWriterInput(), {
        ownKeys() { throw new RangeError("hostile ownKeys trap"); }
      })
    ];
    for (const value of hostile) {
      expectFormatError(
        () => writeCanonicalAsset(value as CanonicalAssetInputV01)
      );
    }
  });
});
