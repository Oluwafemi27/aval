import {
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { writeUint16LE, writeUint32LE, writeUint64LE } from "../src/checked-integer.js";
import { FormatError } from "../src/errors.js";
import { deriveCanonicalAssetLayout } from "../src/layout.js";
import { parseFrontIndex, validateCompleteAsset } from "../src/parser.js";
import type { ValidatedAssetLayout } from "../src/model.js";
import { canonicalAssetFixture } from "./asset-fixture.js";
import {
  generateConformanceFixtures,
  generateReferenceGraphFixture
} from "./fixture-generator.js";

const FIXTURE_DIRECTORY = fileURLToPath(
  new URL("../../../fixtures/conformance/m4/", import.meta.url)
);
const MALFORMED_README = fileURLToPath(
  new URL(
    "../../../fixtures/conformance/m4/malformed/README.md",
    import.meta.url
  )
);

function expectDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const key of Reflect.ownKeys(value)) {
    expectDeepFrozen((value as Record<PropertyKey, unknown>)[key], seen);
  }
}

function expectFormatError(action: () => unknown): FormatError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(FormatError);
    expect(Object.isFrozen(error)).toBe(true);
    expect(typeof (error as FormatError).code).toBe("string");
    return error as FormatError;
  }
  throw new Error("expected a FormatError");
}

function replaceAscii(
  source: Uint8Array,
  from: string,
  to: string
): Uint8Array {
  expect(to.length).toBe(from.length);
  const bytes = source.slice();
  const needle = new TextEncoder().encode(from);
  const replacement = new TextEncoder().encode(to);
  let found = -1;
  for (let offset = 0; offset <= bytes.byteLength - needle.byteLength; offset += 1) {
    if (needle.every((value, index) => bytes[offset + index] === value)) {
      found = offset;
      break;
    }
  }
  expect(found).toBeGreaterThanOrEqual(0);
  bytes.set(replacement, found);
  return bytes;
}

function manifestWithPadding(minimum: number): Uint8Array {
  for (let suffixLength = 0; suffixLength < 16; suffixLength += 1) {
    const fixture = canonicalAssetFixture({
      generatorSuffix: "x".repeat(suffixLength)
    });
    const front = parseFrontIndex(fixture.bytes);
    const end = front.header.manifestOffset + front.header.manifestLength;
    if (front.header.indexOffset - end >= minimum) return fixture.bytes;
  }
  throw new Error("could not produce a fixture with enough manifest padding");
}

function replaceManifestToken(
  source: Uint8Array,
  from: string,
  to: string
): Uint8Array {
  const front = parseFrontIndex(source);
  const header = front.header;
  const text = new TextDecoder().decode(
    source.subarray(
      header.manifestOffset,
      header.manifestOffset + header.manifestLength
    )
  );
  const replaced = text.replace(from, to);
  expect(replaced).not.toBe(text);
  const manifest = new TextEncoder().encode(replaced);
  expect(header.manifestOffset + manifest.byteLength).toBeLessThanOrEqual(
    header.indexOffset
  );
  const bytes = source.slice();
  bytes.fill(0, header.manifestOffset, header.indexOffset);
  bytes.set(manifest, header.manifestOffset);
  writeUint64LE(bytes, 40, manifest.byteLength, "HEADER_INVALID", "manifest length");
  return bytes;
}

function firstPaddingMutation(source: Uint8Array): Uint8Array {
  const front = parseFrontIndex(source);
  const layout = deriveCanonicalAssetLayout(
    front.header,
    front.manifest,
    front.records
  );
  const range = layout.paddingRanges.find(({ length }) => length > 0);
  if (range === undefined) throw new Error("fixture has no padding to mutate");
  const bytes = source.slice();
  bytes[range.offset] = 1;
  return bytes;
}

function extend(source: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(source.byteLength + 1);
  bytes.set(source);
  bytes[bytes.byteLength - 1] = 0xa5;
  return bytes;
}

beforeAll(() => {
  if (process.env.AVL_UPDATE_CONFORMANCE_FIXTURES !== "1") return;
  mkdirSync(FIXTURE_DIRECTORY, { recursive: true });
  for (const fixture of generateConformanceFixtures()) {
    writeFileSync(`${FIXTURE_DIRECTORY}${fixture.fileName}`, fixture.bytes);
  }
});

describe("M4 checked-in conformance fixtures", () => {
  it("are byte-identical to deterministic writer output with recorded provenance", () => {
    const readme = readFileSync(MALFORMED_README, "utf8");
    for (const generated of generateConformanceFixtures()) {
      const checkedIn = new Uint8Array(
        readFileSync(`${FIXTURE_DIRECTORY}${generated.fileName}`)
      );
      expect(Array.from(checkedIn)).toEqual(Array.from(generated.bytes));
      expect(readme).toContain(generated.fileName);
      expect(readme).toContain(generated.sha256);
      expect(readme).toContain(`${String(generated.bytes.byteLength)} bytes`);

      const layout = validateCompleteAsset({ bytes: checkedIn });
      expect(layout.fileRange).toEqual({
        offset: 0,
        length: checkedIn.byteLength
      });
      expectDeepFrozen(layout);
    }
  });

  it("keeps the tiny fixture to one looping state", () => {
    const fixture = generateConformanceFixtures()[0]!;
    const parsed = parseFrontIndex(fixture.bytes);

    expect(parsed.manifest.states.map(({ id }) => id)).toEqual(["idle"]);
    expect(parsed.manifest.units).toHaveLength(1);
    expect(parsed.manifest.units[0]).toMatchObject({
      id: "idle-body",
      kind: "body",
      playback: "loop",
      frameCount: 3
    });
    expect(parsed.graph.definition.states[0]?.body.kind).toBe("loop");
    expect(parsed.graph.definition.edges).toEqual([]);
  });

  it("covers finite, held, portal, finish, cut, locked, and reversible metadata", () => {
    const parsed = parseFrontIndex(generateReferenceGraphFixture());
    const bodyKinds = new Set(
      parsed.graph.definition.states.map(({ body }) => body.kind)
    );
    const startKinds = new Set(
      parsed.graph.definition.edges.map(({ start }) => start.type)
    );
    const transitionKinds = new Set(
      parsed.graph.definition.edges.flatMap(({ transition }) =>
        transition === undefined ? [] : [transition.kind]
      )
    );

    expect(bodyKinds).toEqual(new Set(["loop", "finite", "held"]));
    expect(startKinds).toEqual(new Set(["portal", "finish", "cut"]));
    expect(transitionKinds).toEqual(new Set(["locked", "reversible"]));
    expect(
      parsed.graph.definition.edges.filter(
        ({ transition }) => transition?.kind === "reversible"
      )
    ).toHaveLength(2);
  });

  it(
    "maps every proper whole-file truncation to FormatError",
    () => {
      for (const fixture of generateConformanceFixtures()) {
        for (let boundary = 0; boundary < fixture.bytes.byteLength; boundary += 1) {
          expectFormatError(() =>
            validateCompleteAsset({ bytes: fixture.bytes.subarray(0, boundary) })
          );
        }
      }
    },
    30_000
  );

  it("defers sample digest and decoded-content verification", () => {
    const source = generateReferenceGraphFixture();
    const parsed = parseFrontIndex(source);
    const bytes = source.slice();
    const firstSample = parsed.records[0]!;
    bytes[firstSample.payloadOffset + 24] =
      (bytes[firstSample.payloadOffset + 24] ?? 0) ^ 0xff;
    const layout = validateCompleteAsset({ bytes });
    expect(layout.fileRange.length).toBe(bytes.byteLength);
    expectDeepFrozen(layout);
  });
});

describe("M4 programmatic malformed fixtures", () => {
  const source = generateReferenceGraphFixture();
  const front = parseFrontIndex(source);
  const firstRecord = front.header.indexOffset + 16;
  const secondRecord = firstRecord + 32;

  const malformed: readonly [name: string, create: () => Uint8Array][] = [
    [
      "duplicate escaped JSON key",
      () =>
        replaceManifestToken(
          manifestWithPadding(5),
          '"readiness"',
          '"\\u0067enerator"'
        )
    ],
    [
      "dangerous JSON key",
      () => replaceAscii(source, '"generator"', '"__proto__"')
    ],
    [
      "unsafe uint64",
      () => {
        const bytes = source.slice();
        writeUint64LE(bytes, 24, 1n << 53n, "HEADER_INVALID", "file length");
        return bytes;
      }
    ],
    [
      "extreme sample count",
      () => {
        const bytes = source.slice();
        writeUint32LE(
          bytes,
          front.header.indexOffset + 8,
          0xffff_ffff,
          "INDEX_INVALID",
          "sample count"
        );
        return bytes;
      }
    ],
    [
      "false index length",
      () => {
        const bytes = source.slice();
        writeUint64LE(
          bytes,
          56,
          front.header.indexLength + 1,
          "HEADER_INVALID",
          "index length"
        );
        return bytes;
      }
    ],
    [
      "record ordering",
      () => {
        const bytes = source.slice();
        writeUint32LE(bytes, firstRecord + 12, 1, "INDEX_INVALID", "unit index");
        return bytes;
      }
    ],
    [
      "zero sample size",
      () => {
        const bytes = source.slice();
        writeUint32LE(bytes, firstRecord + 8, 0, "INDEX_INVALID", "sample length");
        return bytes;
      }
    ],
    [
      "huge sample size",
      () => {
        const bytes = source.slice();
        writeUint32LE(
          bytes,
          firstRecord + 8,
          0xffff_ffff,
          "INDEX_INVALID",
          "sample length"
        );
        return bytes;
      }
    ],
    ["nonzero padding", () => firstPaddingMutation(manifestWithPadding(1))],
    [
      "payload gap",
      () => {
        const bytes = source.slice();
        writeUint64LE(
          bytes,
          secondRecord,
          front.records[1]!.payloadOffset + 1,
          "INDEX_INVALID",
          "payload offset"
        );
        return bytes;
      }
    ],
    [
      "payload overlap",
      () => {
        const bytes = source.slice();
        writeUint64LE(
          bytes,
          secondRecord,
          front.records[1]!.payloadOffset - 1,
          "INDEX_INVALID",
          "payload offset"
        );
        return bytes;
      }
    ],
    [
      "payload alias",
      () => {
        const bytes = source.slice();
        writeUint64LE(
          bytes,
          secondRecord,
          front.records[0]!.payloadOffset,
          "INDEX_INVALID",
          "payload offset"
        );
        return bytes;
      }
    ],
    ["trailing bytes", () => extend(source)],
    [
      "profile mismatch",
      () => replaceAscii(source, "reference-rgba-v0", "reference-rgbx-v0")
    ],
    [
      "false reference key flag",
      () => {
        const bytes = source.slice();
        writeUint16LE(bytes, firstRecord + 18, 0, "INDEX_INVALID", "flags");
        return bytes;
      }
    ],
    [
      "malformed reference frame",
      () => {
        const bytes = source.slice();
        const offset = front.records[0]!.payloadOffset;
        bytes[offset] = (bytes[offset] ?? 0) ^ 0xff;
        return bytes;
      }
    ]
  ];

  for (const [name, create] of malformed) {
    it(`rejects ${name} with FormatError`, () => {
      expectFormatError(() => validateCompleteAsset({ bytes: create() }));
    });
  }
});
