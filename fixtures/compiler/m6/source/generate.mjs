import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  encodeCanonicalRgbaPng
} from "../../../../packages/compiler/dist/compile/png.js";
import {
  FRAME_BACKGROUNDS,
  FRAME_HEIGHT,
  FRAME_WIDTH,
  taggedFrame
} from "./frame-fixtures.mjs";
import {
  PNG_SIGNATURE,
  chunk,
  chunkData,
  concatenate,
  conformancePixels,
  declaredChunkHeader,
  dynamicHeader,
  dynamicLeadingRepeat16,
  dynamicLengthsBlock,
  dynamicRepeatOverflow,
  filterRgba,
  findChunk,
  fixedBlock,
  fixedLengthDistanceBlock,
  fixedLiteralThenLengthBlock,
  mutateIdat,
  mutateIhdr,
  parseChunks,
  rawChunk,
  replaceZlibHeader,
  sparseLengths,
  storedBlockHeader,
  strictPng,
  strictPngFromChunks,
  strictPngFromFiltered,
  strictPngFromRawDeflate,
  strictPngFromZlib,
  validZlibFlag,
  writeUint32BE
} from "./png-fixture-helpers.mjs";
const MALFORMED_CONTRACTS = Object.freeze({
  contractVersion: "0.1",
  cases: Object.freeze([
    Object.freeze({
      id: "packed-geometry-overlapping-alpha-pane",
      owner: "format",
      operation: "deriveAvcRenditionGeometry",
      input: Object.freeze({
        profile: "avc-annexb-packed-alpha-v0",
        canvasWidth: 45,
        canvasHeight: 27,
        colorRect: Object.freeze([0, 0, 45, 27]),
        alphaRect: Object.freeze([0, 18, 45, 27]),
        codedWidth: 48,
        codedHeight: 64
      }),
      expected: Object.freeze({ name: "FormatError", code: "PROFILE_INVALID" })
    }),
    Object.freeze({
      id: "packed-sps-crop-mismatch",
      owner: "format",
      operation: "inspectAvcAnnexBRendition",
      asset: "packed-alpha-loop.rma",
      rendition: "packed.1x",
      expectedDecodedStorageRect: Object.freeze([0, 0, 46, 62]),
      expected: Object.freeze({ name: "FormatError", code: "PROFILE_INVALID" })
    }),
    Object.freeze({
      id: "packed-alpha-quality-over-limit",
      owner: "compiler",
      operation: "createAlphaQualityAccumulator.includeFrame",
      expectedAlpha: Object.freeze([0, 0, 0, 0]),
      decodedAlpha: Object.freeze([3, 3, 3, 3]),
      expected: Object.freeze({
        name: "CompilerError",
        code: "ALPHA_QUALITY_REJECTED",
        statistic: "mae"
      })
    }),
    Object.freeze({
      id: "strict-static-resource-cap-below-baseline",
      owner: "player-web",
      operation: "createStaticResourcePlan",
      asset: "packed-alpha-all-routes.rma",
      hostCapBytes: 1024,
      expected: Object.freeze({ name: "RangeError" })
    }),
    Object.freeze({
      id: "strict-png-active-byte-budget",
      owner: "format",
      operation: "validatePngProfile",
      asset: "../png/dynamic-filter2.png",
      expectedWidth: 32,
      expectedHeight: 16,
      maximumPngBytes: 100,
      expected: Object.freeze({ name: "FormatError", code: "BUDGET_EXCEEDED" })
    }),
    Object.freeze({
      id: "strict-png-combined-idat-limit",
      owner: "format",
      operation: "parseRestrictedPngChunksGenerated",
      expectedWidth: 32,
      expectedHeight: 16,
      idatLengths: Object.freeze([2 * 1024 * 1024, 1]),
      maximumPngBytes: 3 * 1024 * 1024,
      expected: Object.freeze({
        name: "FormatError",
        code: "PNG_ENVELOPE_INVALID"
      })
    }),
    Object.freeze({
      id: "strict-deflate-compressed-byte-limit",
      owner: "format",
      operation: "inflateDeflate",
      deflateBytes: 2 * 1024 * 1024 + 1,
      expectedOutputLength: 0,
      expected: Object.freeze({
        name: "FormatError",
        code: "PNG_DEFLATE_INVALID"
      })
    }),
    Object.freeze({
      id: "strict-deflate-output-byte-limit",
      owner: "format",
      operation: "inflateDeflate",
      deflate: Object.freeze([3]),
      expectedOutputLength: 512 * (1 + 512 * 4) + 1,
      expected: Object.freeze({
        name: "FormatError",
        code: "PNG_DEFLATE_INVALID"
      })
    }),
    Object.freeze({
      id: "strict-deflate-work-limit",
      owner: "format",
      operation: "inflateDeflateWithLimit",
      sourceUtf8: "bounded output",
      workLimit: 5,
      expected: Object.freeze({
        name: "FormatError",
        code: "PNG_DEFLATE_INVALID"
      })
    })
  ])
});

const root = dirname(fileURLToPath(import.meta.url));
const opaqueRoot = resolve(root, "opaque-frames");
const packedRoot = resolve(root, "packed-frames");
const conformanceRoot = resolve(root, "../../../conformance/m6");
const pngRoot = resolve(conformanceRoot, "png");
const malformedRoot = resolve(conformanceRoot, "malformed");

await Promise.all([
  rm(opaqueRoot, { recursive: true, force: true }),
  rm(packedRoot, { recursive: true, force: true }),
  rm(pngRoot, { recursive: true, force: true }),
  rm(malformedRoot, { recursive: true, force: true })
]);
await Promise.all([
  mkdir(opaqueRoot, { recursive: true }),
  mkdir(packedRoot, { recursive: true }),
  mkdir(pngRoot, { recursive: true }),
  mkdir(malformedRoot, { recursive: true })
]);

await Promise.all(FRAME_BACKGROUNDS.map(async (background, frameIndex) => {
  const file = `frame-${String(frameIndex).padStart(4, "0")}.png`;
  await writeFile(
    resolve(packedRoot, file),
    encodeCanonicalRgbaPng({
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
      rgba: taggedFrame(background, frameIndex, true)
    })
  );
  await writeFile(
    resolve(opaqueRoot, file),
    encodeCanonicalRgbaPng({
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
      rgba: taggedFrame(background, frameIndex, false)
    })
  );
}));

const pngRgba = conformancePixels(32, 16);
const validPngs = [
  ["stored-filter0.png", 0, "stored"],
  ["fixed-filter1.png", 1, "fixed"],
  ["dynamic-filter2.png", 2, "dynamic"],
  ["dynamic-filter3.png", 3, "dynamic"],
  ["dynamic-filter4.png", 4, "dynamic"]
];
const generated = new Map();
for (const [name, filter, compression] of validPngs) {
  const png = strictPng({
    width: 32,
    height: 16,
    rgba: pngRgba,
    filter,
    compression
  });
  generated.set(name, png);
  await writeFile(resolve(pngRoot, name), png);
}

const literalOnlyFiltered = new Uint8Array(16 * (1 + 32 * 4));
const literalOnlyBody = Array.from(
  { length: literalOnlyFiltered.byteLength },
  () => [0, 1]
);
literalOnlyBody.push([1, 1]);
const literalOnlyPng = strictPngFromRawDeflate(
  32,
  16,
  dynamicLengthsBlock({
    literal: sparseLengths(257, [[0, 1], [256, 1]]),
    distance: [0],
    body: literalOnlyBody
  }),
  literalOnlyFiltered
);
generated.set("dynamic-literal-only-filter0.png", literalOnlyPng);
await writeFile(
  resolve(pngRoot, "dynamic-literal-only-filter0.png"),
  literalOnlyPng
);

const base = generated.get("dynamic-filter2.png");
if (base === undefined) throw new Error("valid PNG base was not generated");
const parts = parseChunks(base);
const idat = findChunk(base, "IDAT");
const baseZlib = base.slice(idat.dataOffset, idat.dataOffset + idat.length);
const ihdr = chunkData(base, "IHDR");
const expectedFiltered = filterRgba(pngRgba, 32, 16, 0);
const invalidFilter = expectedFiltered.slice();
invalidFilter[0] = 5;
const badSignature = base.slice();
badSignature[0] ^= 0xff;
const badCrc = base.slice();
badCrc[idat.dataOffset + 2] ^= 0x20;
const trailingPng = concatenate([base, Uint8Array.of(0xa5)]);
const missingIend = base.subarray(0, findChunk(base, "IEND").offset);
const nonzeroTerminalPad = fixedBlock([256]);
nonzeroTerminalPad[nonzeroTerminalPad.length - 1] |= 0x80;
const trailingDeflate = concatenate([fixedBlock([256]), Uint8Array.of(0)]);

const malformedPngCases = Object.freeze([
  malformedCase("truncated-signature.png", "signature-range", base.subarray(0, 4)),
  malformedCase("bad-signature.png", "signature-value", badSignature),
  malformedCase(
    "truncated-chunk-header.png",
    "chunk-header-range",
    concatenate([PNG_SIGNATURE, Uint8Array.of(0, 0, 0, 13)])
  ),
  malformedCase(
    "oversized-chunk-payload.png",
    "per-chunk-payload-limit",
    concatenate([
      PNG_SIGNATURE,
      declaredChunkHeader("IHDR", 2 * 1024 * 1024 + 1)
    ])
  ),
  malformedCase(
    "truncated-chunk-payload.png",
    "chunk-payload-crc-range",
    concatenate([PNG_SIGNATURE, declaredChunkHeader("IHDR", 13)])
  ),
  malformedCase("bad-crc.png", "chunk-crc", badCrc),
  malformedCase(
    "non-ascii-chunk-type.png",
    "chunk-type-ascii",
    concatenate([
      PNG_SIGNATURE,
      rawChunk(Uint8Array.of(0x49, 0x48, 0x44, 0), ihdr)
    ])
  ),
  malformedCase(
    "first-chunk-not-ihdr.png",
    "ihdr-first",
    concatenate([PNG_SIGNATURE, chunk("sRGB", Uint8Array.of(0))])
  ),
  malformedCase(
    "bad-ihdr-length.png",
    "ihdr-length",
    strictPngFromChunks([chunk("IHDR", ihdr.subarray(0, 12))])
  ),
  malformedCase(
    "zero-dimension.png",
    "dimensions-positive",
    mutateIhdr(base, (data) => writeUint32BE(data, 0, 0))
  ),
  malformedCase(
    "descriptor-dimension-mismatch.png",
    "descriptor-dimensions",
    mutateIhdr(base, (data) => writeUint32BE(data, 0, 31))
  ),
  malformedCase(
    "bad-bit-depth.png",
    "ihdr-bit-depth",
    mutateIhdr(base, (data) => { data[8] = 16; })
  ),
  malformedCase(
    "bad-color-type.png",
    "ihdr-color-type",
    mutateIhdr(base, (data) => { data[9] = 2; })
  ),
  malformedCase(
    "bad-compression-method.png",
    "ihdr-compression-method",
    mutateIhdr(base, (data) => { data[10] = 1; })
  ),
  malformedCase(
    "bad-filter-method.png",
    "ihdr-filter-method",
    mutateIhdr(base, (data) => { data[11] = 1; })
  ),
  malformedCase(
    "interlaced.png",
    "ihdr-interlace",
    mutateIhdr(base, (data) => { data[12] = 1; })
  ),
  malformedCase(
    "misplaced-srgb.png",
    "srgb-placement-or-duplication",
    strictPngFromChunks([
      parts.get("IHDR"),
      parts.get("IDAT"),
      chunk("sRGB", Uint8Array.of(0))
    ])
  ),
  malformedCase(
    "bad-srgb-intent.png",
    "srgb-payload",
    strictPngFromChunks([
      parts.get("IHDR"),
      chunk("sRGB", Uint8Array.of(1))
    ])
  ),
  malformedCase(
    "iend-before-idat.png",
    "iend-requires-idat",
    strictPngFromChunks([
      parts.get("IHDR"),
      parts.get("sRGB"),
      parts.get("IEND")
    ])
  ),
  malformedCase(
    "nonempty-iend.png",
    "iend-empty-payload",
    strictPngFromChunks([
      parts.get("IHDR"),
      parts.get("sRGB"),
      parts.get("IDAT"),
      chunk("IEND", Uint8Array.of(0))
    ])
  ),
  malformedCase(
    "unknown-chunk.png",
    "restricted-chunk-grammar",
    strictPngFromChunks([
      parts.get("IHDR"),
      parts.get("sRGB"),
      chunk("tEXt", Uint8Array.of(0x78))
    ])
  ),
  malformedCase(
    "too-many-chunks.png",
    "chunk-count-limit",
    strictPngFromChunks([
      parts.get("IHDR"),
      ...Array.from({ length: 256 }, () => chunk("IDAT", new Uint8Array()))
    ])
  ),
  malformedCase("trailing-byte.png", "terminal-iend", trailingPng),
  malformedCase("missing-iend.png", "missing-terminal-iend", missingIend),
  malformedCase(
    "short-zlib-member.png",
    "zlib-minimum-length",
    strictPngFromZlib(32, 16, Uint8Array.of(0x78, 0x01, 0, 0, 0, 0))
  ),
  malformedCase(
    "bad-zlib-method.png",
    "zlib-compression-method",
    strictPngFromZlib(32, 16, replaceZlibHeader(
      baseZlib,
      0x79,
      validZlibFlag(0x79, false)
    ))
  ),
  malformedCase(
    "bad-zlib-window.png",
    "zlib-window-size",
    strictPngFromZlib(32, 16, replaceZlibHeader(
      baseZlib,
      0x88,
      validZlibFlag(0x88, false)
    ))
  ),
  malformedCase(
    "bad-zlib-fcheck.png",
    "zlib-fcheck",
    strictPngFromZlib(32, 16, replaceZlibHeader(
      baseZlib,
      baseZlib[0],
      baseZlib[1] ^ 1
    ))
  ),
  malformedCase(
    "zlib-preset-dictionary.png",
    "zlib-preset-dictionary",
    strictPngFromZlib(32, 16, replaceZlibHeader(
      baseZlib,
      0x78,
      validZlibFlag(0x78, true)
    ))
  ),
  deflateCase("reserved-block-type.png", "deflate-reserved-block", Uint8Array.of(0x07)),
  deflateCase(
    "stored-nonzero-padding.png",
    "deflate-stored-padding",
    Uint8Array.of(0x09, 3, 0, 0xfc, 0xff, 1, 2, 3)
  ),
  deflateCase(
    "stored-len-nlen-mismatch.png",
    "deflate-stored-complement",
    Uint8Array.of(1, 3, 0, 0xfd, 0xff, 1, 2, 3)
  ),
  deflateCase(
    "stored-output-overrun.png",
    "deflate-stored-output-overrun",
    storedBlockHeader(2065)
  ),
  deflateCase(
    "stored-truncated-byte.png",
    "deflate-stored-byte-range",
    Uint8Array.of(1, 1, 0, 0xfe, 0xff)
  ),
  deflateCase(
    "fixed-literal-overrun.png",
    "deflate-literal-output-overrun",
    fixedBlock(Array.from({ length: 2065 }, () => 65))
  ),
  deflateCase(
    "fixed-reserved-literal.png",
    "deflate-reserved-literal",
    fixedBlock([286, 256])
  ),
  deflateCase(
    "fixed-reserved-distance.png",
    "deflate-reserved-distance",
    fixedLengthDistanceBlock(257, 30)
  ),
  deflateCase(
    "fixed-missing-history.png",
    "deflate-distance-history",
    fixedLengthDistanceBlock(257, 0)
  ),
  deflateCase(
    "fixed-copy-overrun.png",
    "deflate-copy-output-overrun",
    fixedLiteralThenLengthBlock(2062, 257, 0)
  ),
  deflateCase(
    "dynamic-empty-code-length-tree.png",
    "deflate-code-length-tree-empty",
    dynamicHeader([0, 0, 0, 0])
  ),
  deflateCase(
    "dynamic-oversubscribed-code-length-tree.png",
    "deflate-code-length-tree-oversubscribed",
    dynamicHeader([1, 1, 1, 1])
  ),
  deflateCase(
    "dynamic-incomplete-code-length-tree.png",
    "deflate-code-length-tree-incomplete",
    dynamicHeader([2, 2, 0, 0])
  ),
  deflateCase(
    "dynamic-leading-repeat16.png",
    "deflate-repeat16-without-previous",
    dynamicLeadingRepeat16()
  ),
  deflateCase(
    "dynamic-repeat-overflow.png",
    "deflate-code-length-repeat-overflow",
    dynamicRepeatOverflow()
  ),
  deflateCase(
    "dynamic-missing-eob-symbol.png",
    "deflate-literal-tree-missing-eob",
    dynamicLengthsBlock({ literal: new Array(257).fill(0), distance: [0] })
  ),
  deflateCase(
    "dynamic-reserved-distance-tree.png",
    "deflate-dynamic-reserved-distance",
    dynamicLengthsBlock({
      literal: sparseLengths(257, [[256, 1]]),
      distance: sparseLengths(32, [[30, 1]])
    })
  ),
  deflateCase(
    "dynamic-oversubscribed-literal-tree.png",
    "deflate-literal-tree-oversubscribed",
    dynamicLengthsBlock({
      literal: sparseLengths(257, [[0, 1], [1, 1], [256, 1]]),
      distance: [1]
    })
  ),
  deflateCase(
    "dynamic-incomplete-literal-tree.png",
    "deflate-literal-tree-incomplete",
    dynamicLengthsBlock({
      literal: sparseLengths(257, [[0, 2], [256, 2]]),
      distance: [1]
    })
  ),
  deflateCase(
    "dynamic-empty-distance-tree-used.png",
    "deflate-empty-distance-tree-used-by-length",
    dynamicLengthsBlock({
      literal: sparseLengths(258, [[256, 1], [257, 1]]),
      distance: [0],
      body: [[1, 1]]
    })
  ),
  deflateCase(
    "dynamic-oversubscribed-distance-tree.png",
    "deflate-distance-tree-oversubscribed",
    dynamicLengthsBlock({
      literal: sparseLengths(257, [[256, 1]]),
      distance: [1, 1, 1]
    })
  ),
  deflateCase(
    "dynamic-incomplete-distance-tree.png",
    "deflate-distance-tree-incomplete",
    dynamicLengthsBlock({
      literal: sparseLengths(257, [[256, 1]]),
      distance: [2, 2]
    })
  ),
  deflateCase(
    "dynamic-unmatched-huffman-code.png",
    "deflate-huffman-code-unmatched",
    dynamicLengthsBlock({
      literal: sparseLengths(257, [[256, 1]]),
      distance: [1],
      body: [[1, 1]]
    })
  ),
  deflateCase(
    "missing-eob.png",
    "deflate-missing-eob",
    fixedBlock([65], false)
  ),
  deflateCase(
    "missing-final-block.png",
    "deflate-missing-final-block",
    Uint8Array.of(0, 0, 0, 0xff, 0xff)
  ),
  deflateCase(
    "nonzero-terminal-padding.png",
    "deflate-terminal-padding",
    nonzeroTerminalPad
  ),
  deflateCase(
    "trailing-deflate-byte.png",
    "deflate-trailing-byte",
    trailingDeflate
  ),
  deflateCase(
    "short-deflate-output.png",
    "deflate-output-length",
    fixedBlock([256])
  ),
  malformedCase(
    "bad-adler.png",
    "adler32",
    mutateIdat(base, (zlib) => { zlib[zlib.length - 1] ^= 1; }),
    "PNG_DEFLATE_INVALID"
  ),
  malformedCase(
    "bad-filter.png",
    "scanline-filter",
    strictPngFromFiltered(32, 16, invalidFilter, "fixed", false),
    "PNG_SCANLINE_INVALID"
  )
]);

await Promise.all(malformedPngCases.map(({ name, bytes }) =>
  writeFile(resolve(malformedRoot, name), bytes)
));
const malformedCorpusManifest = Object.freeze({
  corpusVersion: "0.1",
  expectedWidth: 32,
  expectedHeight: 16,
  cases: malformedPngCases.map(({ name, rejectionClass, code }) => ({
    name,
    rejectionClass,
    expected: { name: "FormatError", code }
  }))
});
await writeFile(
  resolve(malformedRoot, "corpus.json"),
  `${JSON.stringify(malformedCorpusManifest, null, 2)}\n`
);
await writeFile(
  resolve(malformedRoot, "contracts.json"),
  `${JSON.stringify(MALFORMED_CONTRACTS, null, 2)}\n`
);
await writeFile(
  resolve(malformedRoot, "README.md"),
  malformedReadme(malformedPngCases)
);

function malformedReadme(cases) {
  const rows = cases.map(({ name, rejectionClass, code }) =>
    `| \`${name}\` | \`${rejectionClass}\` | \`${code}\` |`
  ).join("\n");
  return `# M6 malformed strict-PNG corpus

Every file is derived deterministically by
\`fixtures/compiler/m6/source/generate.mjs\`. \`corpus.json\` is the canonical,
class-unique inventory; hashes and observed failures are frozen again in
\`../provenance.json\`.

| File | Rejection class | Expected code |
| --- | --- | --- |
${rows}

\`contracts.json\` freezes executable malformed packed-geometry, SPS-crop,
alpha-quality, runtime-resource, PNG-budget, combined-IDAT, and DEFLATE-limit
cases. Those limit-only cases are generated in memory and executed by the
owning format test because encoding multi-megabyte limit sentinels as corpus
files would add no parser coverage. The format, compiler, and web-player fixture
tests execute the case owned by their layer; provenance binds both inventories.

Malformed files must never be passed to a native image decoder before the
strict pure-code envelope and DEFLATE validation completes.
`;
}

function malformedCase(
  name,
  rejectionClass,
  bytes,
  code = "PNG_ENVELOPE_INVALID"
) {
  return Object.freeze({ name, rejectionClass, code, bytes });
}

function deflateCase(name, rejectionClass, raw) {
  return malformedCase(
    name,
    rejectionClass,
    strictPngFromRawDeflate(32, 16, raw, expectedFiltered),
    "PNG_DEFLATE_INVALID"
  );
}
