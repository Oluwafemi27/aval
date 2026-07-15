# M5 opaque AVC conformance fixtures

These checked-in `.avl` files are deterministic output from the M5 compiler
using tiny, procedurally generated, fully opaque PNG sequences. The source
license is recorded in `fixtures/compiler/m5/source/ASSET-LICENSE.md`.

`opaque-loop.avl` covers a two-frame loop. `opaque-path.avl` covers an initial
one-shot, two body loops, a locked bridge, and a user event.
`opaque-reversible.avl` adds a forward-authored reversible clip, its exact
inverse route, and finish and cut routes. `provenance.json` records exact
source, unit, and whole-file
digests; native probes and normalization; continuity; the reviewed toolchain;
and every executed FFmpeg/FFprobe argv with local paths redacted.

Regenerate from the repository root with the reviewed tool pair on `PATH`:

```sh
npm run build -w @pixel-point/aval-graph
npm run build -w @pixel-point/aval-format
npm run build -w @pixel-point/aval-compiler
node fixtures/compiler/m5/source/generate.mjs
node packages/compiler/dist/cli.js compile fixtures/compiler/m5/source/loop.json --out fixtures/conformance/m5/opaque-loop.avl --force
node packages/compiler/dist/cli.js compile fixtures/compiler/m5/source/path.json --out fixtures/conformance/m5/opaque-path.avl --force
node packages/compiler/dist/cli.js compile fixtures/compiler/m5/source/reversible.json --out fixtures/conformance/m5/opaque-reversible.avl --force
node fixtures/conformance/m5/update-provenance.mjs
```

Regeneration is an intentional review operation: the binary bytes and every
digest in `provenance.json` must be updated together, and all assets must pass
`avl validate`. Moving either source tree to another absolute path must still
produce byte-identical assets.

## Claim boundary

These fixtures prove the frozen M5 `avc-annexb-opaque-v0` compiler profile,
independent unit starts (including a reversible unit used as an ordinary
forward stream), motion-only canonical layout, and the dedicated worker's
sequential decode input. They do not claim packed alpha, runtime
range/digest loading, graph-to-decoder scheduling, active reversal, polished
authoring, or cross-browser certification; those remain later milestones.
