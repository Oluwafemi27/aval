# M6 web packed-alpha conformance fixtures

This directory freezes the first web-only `projectVersion: 0.2` compiler
outputs. The source is a deterministic 45×27 grayscale animation with a
six-bit Gray-derived frame marker, authored alpha gradients and sharp edges,
a moving transparent patch, and intentionally hostile magenta/green RGB below
fully transparent pixels. The source artwork and PNG corpus are released under
CC0 in `fixtures/compiler/m6/source/ASSET-LICENSE.md`.

The three checked assets have separate jobs:

- `opaque-odd.rma` proves the opaque auto-policy and odd visible geometry;
- `packed-alpha-loop.rma` proves auto-selection of packed alpha and a clean
  partial-range loop; and
- `packed-alpha-all-routes.rma` proves explicit packed alpha at 15×9 and
  45×27, every route class, readiness/cache metadata, shared and distinct
  strict static PNGs, and deterministic alpha/composite quality evidence.

The high packed rendition has a 46×64 cropped decoder storage rectangle in a
48×64 coded surface. The low rendition has a 16×28 cropped storage rectangle
in a 16×32 coded surface. Alpha reconstruction is normatively gated at mean
absolute error ≤2/255 and p99 ≤5/255. Composite results are recorded against
black, white, and magenta; this fixture remains at or below 8/255 p99. Exact
frame-marker readback is certified only at full resolution. The 15×9 rendition
is intentionally a geometry and quality fixture, not an exact marker oracle.

The `png/` corpus covers DEFLATE stored, fixed-Huffman, and dynamic-Huffman
blocks plus PNG row filters 0–4. `malformed/corpus.json` inventories 59
class-unique checked PNGs spanning every reachable strict envelope, zlib,
stored/fixed/dynamic DEFLATE, Adler-32, and scanline rejection branch.
`malformed/contracts.json` adds executed in-memory sentinels for byte, combined
IDAT, output, and work limits that are impractical as checked files, plus the
packed-geometry, SPS-crop, alpha-quality, and resource failures.
`provenance.json` binds every source, asset, sample blob, static, strict
inspection, quality result, inventory, and corpus file to path-free hashes and
the reviewed FFmpeg/FFprobe pair.

Regenerate from the repository root:

```sh
npm run build
node fixtures/compiler/m6/source/generate.mjs
node fixtures/compiler/m6/update-provenance.mjs
node fixtures/conformance/m6/update-provenance.mjs
node fixtures/compiler/m6/update-provenance.mjs --check
node fixtures/conformance/m6/update-provenance.mjs --check
```

Regeneration is an intentional binary-review operation. The update script
compiles each source project through the production compiler. Its `--check`
mode rebuilds all three assets into a private temporary directory and compares
the complete normalized provenance object, including toolchain, strict AVC
inspections, alpha/composite quality, statics, continuity, and resource facts.

## Claim boundary

These files prove deterministic authoring, strict asset structure, packed
geometry, static decode, and compiler-side reconstruction metrics. They do not
alone prove browser codec availability, compositor scan-out continuity, or
device-specific GPU behavior; those claims belong to the real-browser gate.
