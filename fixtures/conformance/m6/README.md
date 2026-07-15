# M6 web packed-alpha conformance fixtures

This directory freezes the first web-only `projectVersion: 0.2` compiler
outputs. The source is a deterministic 45×27 grayscale animation with a
six-bit Gray-derived frame marker, authored alpha gradients and sharp edges,
a moving transparent patch, and intentionally hostile magenta/green RGB below
fully transparent pixels. The source artwork is released under
CC0 in `fixtures/compiler/m6/source/ASSET-LICENSE.md`.

The three checked assets have separate jobs:

- `opaque-odd.avl` proves the opaque auto-policy and odd visible geometry;
- `packed-alpha-loop.avl` proves auto-selection of packed alpha and a clean
  partial-range loop; and
- `packed-alpha-all-routes.avl` proves explicit packed alpha at 15×9 and
  45×27, every route class, readiness/cache metadata, and deterministic
  alpha/composite quality evidence.

The high packed rendition has a 46×64 cropped decoder storage rectangle in a
48×64 coded surface. The low rendition has a 16×28 cropped storage rectangle
in a 16×32 coded surface. Alpha reconstruction is normatively gated at mean
absolute error ≤2/255 and p99 ≤5/255. Composite results are recorded against
black, white, and magenta; this fixture remains at or below 8/255 p99. Exact
frame-marker readback is certified only at full resolution. The 15×9 rendition
is intentionally a geometry and quality fixture, not an exact marker oracle.

`reviewed-motion/reviewed-avc.bin` retains the deduplicated, reviewed motion
sample blobs with no image payloads. `reviewed-motion/recipe.json` binds their
access-unit boundaries, poster-free manifests, quality evidence, and original
FFmpeg/FFprobe fingerprint. `provenance.json` then binds those inputs to the
current canonical containers and source projects with path-free hashes.

Regenerate from the repository root:

```sh
npm run build
node fixtures/compiler/m6/source/generate.mjs
node fixtures/compiler/m6/update-provenance.mjs
node fixtures/conformance/m6/update-provenance.mjs
node fixtures/compiler/m6/update-provenance.mjs --check
node fixtures/conformance/m6/update-provenance.mjs --check
```

Container regeneration is tool-free: the update script copies every reviewed
AVC access unit byte-for-byte through the current format writer, then recomputes
the complete asset, front-index, unit, inspection, and provenance hashes. Its
`--check` mode performs the same assembly in memory and compares all three
files exactly. Re-encoding the reviewed samples is a separate binary-review
operation; it must produce new quality evidence and a new reviewed-motion
recipe instead of silently replacing this toolchain record.

## Claim boundary

These files prove reviewed encoded samples, strict asset structure, packed
geometry, tool-free poster-free container assembly, and recorded compiler-side
reconstruction metrics. Current encoder-argument behavior is tested separately;
these preserved samples are not claimed as byte output of the current encoder.
They do not
alone prove browser codec availability, compositor scan-out continuity, or
device-specific GPU behavior; those claims belong to the real-browser gate.
