# M6 Transparency and Static Fallback Implementation Plan

**Date:** 2026-07-12

**Design:** [M6 Transparency and Static Fallback Design](../specs/2026-07-12-m6-transparency-static-fallback-design.md)

## Outcome

Extend the committed M5.5 local web player from opaque AVC to one generalized
opaque/stacked-alpha AVC path. Add exact odd-dimension packed geometry,
asset-wide compiler alpha policy, deterministic dilation and BT.709 packing,
per-frame and aggregate alpha-quality rejection, complete restricted PNG
validation with native and pure bounded inflate, shared static/animated
fit-DPR geometry, static recovery, and live reduced-motion full/static
re-entry.

M5.5 must be gated and committed before implementation begins. M6 is one later
intentional milestone commit after its complete evidence gate passes.

## Engineering Rules

- Write a failing focused test before every production slice.
- Preserve the compiled wire version at `0.1`. Add profile relations; do not
  add a field, optional interpretation, or second canonicalizer.
- Parse source project 0.1 and 0.2 through separate closed schemas before
  normalizing them into one internal model.
- Keep format platform-free (`ES2023`, no ambient types), compiler Node-only,
  worker WebWorker-only, and browser composition free of Node imports.
- Keep one AVC inspector, one alpha-policy decision, one geometry derivation,
  one PNG grammar, one DEFLATE implementation, one rendition sort, one worker,
  one decode timeline, one scheduler, one renderer, and one motion-policy lane.
- Check dimensions, products, offsets, output counts, Huffman operations,
  quality sample counts, and bytes before traversal or allocation.
- A native PNG corruption never retries through the pure inflater. Pure inflate
  is chosen only by an unavailable-capability result made before decode.
- Close every frame, bitmap, stream reader, worker, decoder, texture, buffer,
  timer, animation callback, abort listener, and candidate on all terminal
  paths.
- Never clear or dispose the last animated plane until a strict static surface
  covers it.
- Do not introduce a second alpha video, alpha clock, seeking `<video>` path,
  unvalidated `createImageBitmap(Blob)`, or browser PNG parser.
- Do not add M7 network/shared-budget behavior, M8 custom-element/automatic
  `matchMedia` behavior, or M9 named-device certification.
- Keep production modules focused. Split parsing, inflate, unfilter, geometry,
  packing, quality measurement, rendering, and policy coordination by
  authority rather than collecting them in a new giant file.
- Preserve prior public prototype imports with thin deprecated aliases where
  inexpensive; never keep two implementations for compatibility.
- Do not commit generated `dist`, browser caches, FFmpeg temporary spools,
  absolute paths, raw timing traces, or unpacked fixture output.

## Execution Order

### 1. Freeze M6 types, errors, and package boundaries

Update:

```text
packages/format/src/errors.ts
packages/format/src/index.ts
packages/format/test/public-api.compile.ts

packages/compiler/src/diagnostics.ts
packages/compiler/src/model.ts
packages/compiler/src/index.ts
packages/compiler/test/public-api.compile.ts

packages/player-web/src/runtime/errors.ts
packages/player-web/src/runtime/model.ts
packages/player-web/src/runtime/public-api.compile.ts
packages/player-web/src/index.ts
```

Add compile-only contracts for:

- derived opaque/packed AVC geometry;
- source alpha policy and normalized source project version;
- alpha audit and quality summaries;
- strict PNG structure/decode results;
- profile-neutral AVC rendition/candidate/renderer names;
- presentation geometry and resize reports;
- `MotionPolicy`, effective motion mode, and static origin; and
- graph static-to-animated resume.

Keep `PROFILE_INVALID` for on-wire geometry. Keep the existing
`PNG_ENVELOPE_INVALID` code as the compatible structural PNG failure and add
separate stable format codes for DEFLATE and scanline failures. Add compiler
codes for explicit alpha-policy rejection and alpha-quality rejection; retain
`OPAQUE_ONLY_M5` only as a deprecated diagnostic mapping for source-project
0.1 callers. Generalize runtime error copy from “opaque profile” to “AVC
profile” and add structured fields needed for width, height, alpha statistic,
and policy phase without interpolating hostile asset IDs.

Change the static-reason values to include `reduced-motion` and
`no-avc-rendition`. Remove `no-opaque-rendition` from accepted runtime values
and update every caller; new readiness results always use the generalized
value.

Test exact frozen error unions, bounded messages/context, public type
immutability, and that platform-neutral declarations expose no Node, DOM, or
WebCodecs types.

Run:

```text
npx vitest run packages/player-web/src/runtime/model.test.ts
npm run typecheck
```

### 2. Implement the sole exact AVC rendition-geometry derivation

Add:

```text
packages/format/src/avc/rendition-geometry.ts
packages/format/test/avc-rendition-geometry.test.ts
```

Update:

```text
packages/format/src/manifest-rendition-schema.ts
packages/format/src/manifest-limits-schema.ts
packages/format/src/avc/index.ts
packages/format/src/avc/inspector.ts
packages/format/test/manifest-schema.test.ts
packages/format/test/avc-inspector.test.ts
packages/format/test/conformance.test.ts
```

Implement one pure exported function that validates and returns immutable:

```text
profile
visibleColorRect
optional visibleAlphaRect
decodedStorageRect
codedWidth/codedHeight
visibleColorArea
decoded/coded RGBA byte counts
```

Apply the design's exact `even`/`align16` formulas. For packed alpha require
the fixed eight-pixel gutter, equal visible pane dimensions, exact alpha y
origin, exact storage height, exact macroblock dimensions, and area/dimension
limits. For opaque allow odd visible sizes through the exact derived even crop.
Require source pixel-grid aspect against the logical canvas with checked
cross-products.

Add a manifest relation requiring every production AVC rendition to use the
same opaque or packed alpha class. Permit the reference RGBA conformance
profile to coexist. Reject an opaque/packed AVC mixture so rendition fallback
cannot discard transparency.

Make manifest schema validation invoke this function after structural cloning.
Make the AVC inspector accept an expected decoded storage crop and reject a
different SPS crop. Do not create geometry logic in compiler or player.

Test:

- every odd/even combination at 1, 2, 15, 16, 511, and 512;
- exact packed examples, gutter, pane origins, and macroblock padding;
- coded dimension/area limits and checked cross-product overflow;
- wrong origin, size, overlap, gap, gutter, crop, or aspect;
- all valid M5 opaque fixtures unchanged;
- mixed opaque/packed AVC renditions rejected; and
- every M4-shallow but M6-invalid packed shape rejected.

Include a regression that starts from each checked-in M5 conformance asset,
validates it under M6, and compares its parsed rendition facts byte-for-byte.
Also retain prior rejection fixtures to prove M6 never makes an invalid old
asset valid.

Run:

```text
npx vitest run packages/format/test/avc-rendition-geometry.test.ts packages/format/test/manifest-schema.test.ts packages/format/test/avc-inspector.test.ts packages/format/test/conformance.test.ts
```

### 3. Add source project 0.2 and deterministic alpha classification

Add or split:

```text
packages/compiler/src/source-project-v01-schema.ts
packages/compiler/src/source-project-v02-schema.ts
packages/compiler/src/source-project-normalize.ts
packages/compiler/src/compile/alpha-policy.ts
packages/compiler/test/source-project-v02-schema.test.ts
packages/compiler/test/alpha-policy.test.ts
```

Keep the current source-project 0.1 schema exact and explicit opaque. Define
source-project 0.2 with the same graph/source/state semantics, the three exact
profile strings, and rendition `{ id, width, height, bitrate }`. Permit visible
dimensions 1-512, require they do not exceed canvas dimensions, and require
the exact source pixel-grid aspect. Reject compiled-only geometry and padding
fields at the authoring boundary.

Source-project 0.2 also admits canvas dimensions 1-512 and the format's full
positive pixel-aspect range. Require the pixel-aspect fraction to be reduced;
project 0.1 retains its exact M5 16-aligned canvas and `[1,1]` rules.

Normalize both versions into one internal project type containing visible
rendition dimensions and `alphaPolicy: auto|opaque|packed`. The 0.1 adapter
maps its already 16-aligned dimensions and explicit opaque policy without
changing behavior. Never branch on source version after normalization.

Refactor canonical RGBA materialization so it reports, while streaming:

- unique referenced frame count;
- minimum alpha;
- whether all alpha is 255;
- first nonopaque source/frame/x/y; and
- exact frames included by units and explicit posters.

Audit every unique canonical referenced frame exactly once. Do not trust
probe pixel-format metadata. Resolve the one compiled profile before spawning
any rendition encoder. Test auto opaque, auto packed, explicit opaque failure,
explicit packed opaque warning, multiple sources, duplicated references,
poster-only alpha, unused transparent frames, abort, and hostile counts.

Update CLI argument parsing and direct compilation so `--alpha` accepts exactly
`auto|opaque|packed`, defaults to auto, and conflicts deterministically with an
explicit project policy rather than silently overriding it.

Run:

```text
npx vitest run packages/compiler/test/source-project-schema.test.ts packages/compiler/test/source-project-v02-schema.test.ts packages/compiler/test/alpha-policy.test.ts packages/compiler/test/cli-args.test.ts
```

### 4. Build deterministic RGBA dilation and packed YUV420 primitives

Add:

```text
packages/compiler/src/compile/rgba-dilation.ts
packages/compiler/src/compile/bt709-limited.ts
packages/compiler/src/compile/packed-yuv420.ts
packages/compiler/test/rgba-dilation.test.ts
packages/compiler/test/bt709-limited.test.ts
packages/compiler/test/packed-yuv420.test.ts
```

Implement the design's exact radius-four nearest-source dilation. Make it
return a fresh frame, preserve all `A>0` pixels byte-for-byte, preserve every
alpha byte, zero unfilled hidden RGB, and read only the original input during
selection. Test traversal-order independence, distance before alpha tie-break,
y/x tie-breaks, radius edge 4 versus outside, all-transparent frames, odd
dimensions, caller mutation, and bounded allocation failure.

Implement the frozen integer BT.709 limited-range equations and signed
rounding as small pure functions. Test black, white, primaries, grays, exact
half rounding, clamp boundaries, 2x2 chroma averaging, and an independent
BigInt oracle over exhaustive or fixed-seed RGB samples.

Implement one planar-yuv frame packer for opaque and packed geometry. It must:

- require exact visible RGBA bytes;
- produce Y then Cb then Cr planes of the exact coded dimensions;
- use diluted RGB only for the visible color pane;
- use original scaled alpha for `Yalpha`;
- fill even, gutter, and macroblock padding with `16/128/128`;
- prove no 2x2 chroma block crosses a semantic pane boundary; and
- expose exact plane offsets/lengths for the raw-yuv encoder.

Tests reconstruct tiny expected planes by hand, including 1x1, odd sizes,
gutter rows, alpha gradients, transparent colored edges, macroblock padding,
and maximum checked dimensions. No FFmpeg is used in these unit tests.

Run:

```text
npx vitest run packages/compiler/test/rgba-dilation.test.ts packages/compiler/test/bt709-limited.test.ts packages/compiler/test/packed-yuv420.test.ts
```

### 5. Replace shallow PNG validation with the strict chunk/zlib envelope

Add:

```text
packages/format/src/png/profile.ts
packages/format/src/png/chunks.ts
packages/format/src/png/crc32.ts
packages/format/src/png/zlib-envelope.ts
packages/format/test/png-profile.test.ts
packages/format/test/png-profile-mutation.test.ts
```

Update or reduce to compatibility facades:

```text
packages/format/src/png-envelope.ts
packages/format/test/png-envelope.test.ts
packages/format/src/parser.ts
packages/format/src/index.ts
```

Move compiler's CRC implementation behind the public platform-free format
owner or make the compiler call it; do not leave two CRC algorithms. Parse
chunks with checked cursor arithmetic before slicing. Enforce the exact
signature/IHDR/optional canonical sRGB/consecutive IDAT/terminal IEND grammar,
chunk and total limits, CRC on every chunk, no unknown chunk, and no trailing
byte. Validate zlib CM/CINFO/FCHECK/FDICT and locate the exact Adler trailer.

Return an immutable decode plan containing dimensions, expected filtered and
RGBA lengths, bounded IDAT segments or an owned concatenation, DEFLATE range,
and declared Adler. It must retain no caller-mutable view. Decide the lowest
peak representation and cover that exact ownership in tests/resource
accounting.

Make complete-asset validation run this strict structural phase for every
static payload. Update M4 fixtures that intentionally used only an IHDR tail
to use a valid restricted PNG; preserve separate malformed fixtures for each
former shallow acceptance.

Test every truncation byte, chunk length overflow, chunk count, duplicate or
misordered chunk, split consecutive IDAT, bad CRC, bad FCHECK, dictionary bit,
missing trailer, dimensions, color type, interlace, sRGB intent, IEND payload,
and trailing byte. Fixed-seed mutation tests assert bounded allocation and only
stable `FormatError` codes.

Run:

```text
npx vitest run packages/format/test/png-envelope.test.ts packages/format/test/png-profile.test.ts packages/format/test/png-profile-mutation.test.ts packages/format/test/conformance.test.ts
```

### 6. Implement pure bounded DEFLATE and PNG scanline reconstruction

Add:

```text
packages/format/src/png/deflate-bit-reader.ts
packages/format/src/png/deflate-huffman.ts
packages/format/src/png/deflate.ts
packages/format/src/png/unfilter.ts
packages/format/src/png/decode.ts
packages/format/test/deflate.test.ts
packages/format/test/deflate-mutation.test.ts
packages/format/test/png-unfilter.test.ts
packages/format/test/png-decode.test.ts
```

Implement the exact stored/fixed/dynamic RFC 1951 subset described by the
design. Build canonical Huffman tables only after checking bit-length counts
for oversubscription/incompleteness and the permitted single-symbol case.
Validate code-length repeat symbols and bounds, literal/length and distance
reserved codes, distance history, output cap, final block, zero terminal pad
bits, exact DEFLATE end, exact filtered length, and Adler-32.

Increment the frozen work counter for bit reads, decoded symbols, and output
copies. Test the operation cap with small compressed bombs and ensure no loop
can make zero progress. All allocations are derived from the already checked
expected output length, never an encoded length or distance claim.

Implement filters 0-4 with byte modulo arithmetic, `bpp=4`, exact prior-row
ownership, floored Average, and the PNG Paeth tie rules. Transfer the unfiltered
RGBA buffer as the decode result rather than cloning it again.

Test:

- compiler stored blocks;
- independently generated fixed and dynamic blocks;
- each filter and mixed-filter images;
- zero/maximum byte arithmetic and Paeth ties;
- empty/invalid trees, missing EOB, repeat overflow, reserved symbols;
- invalid LEN/NLEN, distance zero/past history/over 32 KiB;
- early/late final block, nonzero pad bits, trailing DEFLATE bytes;
- short/long output and Adler mismatch;
- lower budgets and fixed-seed mutations; and
- exact cleanup/no retained caller views after failure.

Use an independent Node `zlib` oracle only in tests. Production format code
must have no dependency and no Node/platform imports.

Run:

```text
npx vitest run packages/format/test/deflate.test.ts packages/format/test/deflate-mutation.test.ts packages/format/test/png-unfilter.test.ts packages/format/test/png-decode.test.ts
npm run typecheck -w @pixel-point/aval-format
```

### 7. Add the browser native-inflate adapter and strict static surfaces

Add:

```text
packages/player-web/src/runtime/png-inflate-browser.ts
packages/player-web/src/runtime/png-inflate-browser.test.ts
packages/player-web/src/runtime/strict-static-decoder.ts
packages/player-web/src/runtime/strict-static-decoder.test.ts
```

Update:

```text
packages/player-web/src/runtime/static-surfaces.ts
packages/player-web/src/runtime/static-surfaces.test.ts
packages/player-web/src/runtime/integrated-player-static-preparation.ts
```

Create an injectable capability boundary that returns supported/unsupported
before decode. The supported production adapter uses
`DecompressionStream("deflate")`, a reader loop with exact output byte cap,
the existing abort/watchdog pattern, and no unbounded `Response.arrayBuffer()`.
It consumes only the structurally validated zlib member.

After native success, independently check exact length, Adler, filter bytes,
and unfilter. A native throw or corrupt result becomes one static-decode
failure and never invokes pure inflate. When the initial capability result is
unsupported, invoke format's pure inflater and the same unfilter owner.

Replace `createImageBitmap(new Blob([png]))` with conversion from validated
owned RGBA to `ImageData` and then an abort-bounded
`createImageBitmap(ImageData)`. Raw PNG bytes may appear only at the strict
decoder input. Close a late bitmap when abort/timeout wins.

Keep the static store's serialized latest-wins operation lane, current plus
incoming surface cap, validate-all behavior, exact-once close, and cover/reveal
contract. Add snapshot counters for native/pure path, compressed scratch,
filtered bytes, RGBA bytes, and bitmap closes without exposing untrusted data.

Test unsupported-native fallback, supported-native success, native throw,
native short/long output, bad Adler/filter, pure rejection, timeout, abort at
every await, supersession, late bitmap, all-state validation, shared statics,
and disposal. Assert the pure spy remains untouched for every supported-native
corruption.

Run:

```text
npx vitest run packages/player-web/src/runtime/png-inflate-browser.test.ts packages/player-web/src/runtime/strict-static-decoder.test.ts packages/player-web/src/runtime/static-surfaces.test.ts
```

### 8. Add raw-yuv AVC encoding and complete decode-back quality measurement

Add:

```text
packages/compiler/src/compile/yuv-spool.ts
packages/compiler/src/compile/alpha-quality.ts
packages/compiler/src/ffmpeg/decode-unit.ts
packages/compiler/test/yuv-spool.test.ts
packages/compiler/test/alpha-quality.test.ts
packages/compiler/test/decode-unit-argv.test.ts
```

Update:

```text
packages/compiler/src/ffmpeg/encode-unit.ts
packages/compiler/src/process-runner.ts
packages/compiler/test/encode-argv.test.ts
packages/compiler/test/process-runner.test.ts
```

Add a raw `yuv420p` input type with exact coded dimensions, frame rate, frame
byte count, file offset, and length. The encoder argv must read the exact
private spool range and perform no `-vf`, scale, range, matrix, or format
conversion. Preserve every other M5 low-delay/profile/dependency flag and
color tag. Reuse the existing bounded stdin-file offset/length owner; do not
introduce a shell or pipe producer with unbounded backpressure.

Add one bounded decoder invocation per encoded unit that returns exact
BT.709-limited RGBA at the SPS decoded storage dimensions. Require exact frame
count/bytes and no secondary scale. Keep invocation provenance and cleanup.

Implement alpha error accumulation without retaining every sample:

- per frame: sum, sample count, and a 256-bin absolute-byte-error histogram;
- aggregate rendition: checked sums/count and merged histogram;
- nearest-rank p99 derived from the histogram;
- worst frame ordered by mean, then p99, then unit/local frame for stable
  reporting; and
- hard rejection if either mean or p99 exceeds its limit per frame or in the
  aggregate.

Store sums as checked integers or BigInt so 900 * 512 * 512 samples cannot
overflow. Test exact threshold equality and one-unit-above failures, small-N
p99, per-frame fail with aggregate pass, aggregate fail with individual pass,
worst-frame ties, mutation, cancellation, partial decoder output, and cleanup.

Run:

```text
npx vitest run packages/compiler/test/yuv-spool.test.ts packages/compiler/test/alpha-quality.test.ts packages/compiler/test/decode-unit-argv.test.ts packages/compiler/test/encode-argv.test.ts packages/compiler/test/process-runner.test.ts
```

### 9. Integrate packed compilation, strict statics, and build reports

Update or split:

```text
packages/compiler/src/compile/project-compiler.ts
packages/compiler/src/compile/direct-compiler.ts
packages/compiler/src/compile/rgba-spool.ts
packages/compiler/src/compile/png.ts
packages/compiler/src/compile/resource-estimate.ts
packages/compiler/src/compile/output-validation.ts
packages/compiler/src/commands/asset-validation.ts
packages/compiler/src/cli.ts
packages/compiler/test/project-compiler-integration.test.ts
packages/compiler/test/direct-compiler.test.ts
packages/compiler/test/ffmpeg-integration.test.ts
packages/compiler/test/static-plan.test.ts
packages/compiler/test/resource-readiness.test.ts
packages/compiler/test/cli.test.ts
```

Keep `project-compiler.ts` an orchestration root. Extract alpha classification,
rendition RGBA materialization, per-unit YUV spooling/encoding, decode-back,
posters, and report construction into focused owners rather than adding nested
profile conditionals to the current file.

For every rendition:

1. derive geometry through format's public owner;
2. materialize the frozen scaled RGBA frames needed by each unit;
3. dilate and pack them to bounded private YUV storage;
4. encode independent units and run strict AVC inspection;
5. decode back every packed unit and apply per-frame plus aggregate alpha
   gates; and
6. discard rendition scratch before the next candidate where possible.

Opaque compilation goes through the same geometry/YUV encoder but skips alpha
pane and alpha quality. Compare an M5 source project compiled before/after M6:
semantic graph, static PNG bytes, frame ordering, and AVC profile facts must
remain compatible. The approved direct-YUV conversion changes encoded bytes;
regenerate their hashes intentionally and record the change in fixture
provenance and milestone evidence.

Require an explicit poster to match the canonical body-entry RGBA byte for
byte. Derive omitted posters as before. Encode canonical restricted PNG,
decode it through format's strict pure path during compiler self-validation,
and compare RGBA byte-for-byte before writing the M4 asset.

Extend the deterministic build report with:

- requested and selected alpha policy;
- per-source alpha audit;
- visible/storage/coded geometry per rendition;
- dilation radius/algorithm version;
- packed YUV profile identity;
- per-frame/aggregate alpha results and worst frame;
- black/white/magenta composite metrics marked report-only;
- strict static PNG validation facts; and
- exact encode/decode-back provenance.

Update resource estimates to use coded packed dimensions. Test multi-rendition
auto selection, explicit modes, odd dimensions, all unit kinds, duplicate
source frames, poster match/mismatch, alpha quality failure, process failure,
abort at every phase, deterministic report, output atomicity, and complete
revalidation.

Run:

```text
npx vitest run packages/compiler/test/project-compiler-integration.test.ts packages/compiler/test/direct-compiler.test.ts packages/compiler/test/ffmpeg-integration.test.ts packages/compiler/test/static-plan.test.ts packages/compiler/test/resource-readiness.test.ts packages/compiler/test/cli.test.ts
```

### 10. Generalize opaque candidate selection and playback into one AVC path

Mechanically rename or replace with neutral owners after the M5.5 tree is
stable:

```text
packages/player-web/src/runtime/rendition-selection.ts
packages/player-web/src/runtime/opaque-candidate-*.ts
packages/player-web/src/runtime/browser-opaque-candidate-*.ts
packages/player-web/src/runtime/browser-opaque-playback-session.ts
packages/player-web/src/runtime/opaque-frame-renderer*.ts
```

Preferred neutral destinations are:

```text
packages/player-web/src/runtime/avc-rendition-selection.ts
packages/player-web/src/runtime/avc-candidate-*.ts
packages/player-web/src/runtime/browser-avc-candidate-*.ts
packages/player-web/src/runtime/browser-avc-playback-session.ts
packages/player-web/src/runtime/frame-renderer*.ts
```

Keep old filenames only as thin deprecated re-exports where required by
public/experimental compile tests. Search for `opaque` after the change and
classify every remaining occurrence as a real profile check, compatibility
name, fixture, or defect.

Candidate eligibility accepts only exact opaque or packed AVC profiles with
WebCodecs+WebGL2 and format-derived geometry. Rank by visible color area, peak
bitrate, then ID. The worker setup uses coded dimensions for config/limits and
derived decoded storage crop for expected output. Use the same public AVC
inspector for both profiles.

Generalize resource/cache planners and readiness inputs to accept the profile
geometry while retaining coded-dimension charging and all M5.5 generation,
runway, horizon, and route-phase behavior. Do not alter graph semantics or
worker protocol unless the existing expected-output structure cannot express
the storage crop; if extended, keep it profile-neutral.

Tests cover opaque and packed manifest input order independently, equal visible
area with different packed coded area, lower rendition fallback within each
profile, format rejection of an opaque/packed mixture, wrong packed crop, no
AVC candidate, all M5.5 path/phase suites under opaque, and a packed fake frame
through every resource owner.

Run:

```text
npx vitest run packages/player-web/src/runtime/rendition-selection.test.ts packages/player-web/src/runtime/resource-plan.test.ts packages/player-web/src/runtime/interaction-cache-plan.test.ts packages/player-web/src/runtime/browser-phase-ownership.test.ts
npm run typecheck -w @pixel-point/aval-player-web
```

### 11. Implement the one opaque/packed WebGL2 compositor and full accounting

Add or replace:

```text
packages/player-web/src/runtime/frame-geometry.ts
packages/player-web/src/runtime/frame-renderer.ts
packages/player-web/src/runtime/frame-renderer-validation.ts
packages/player-web/src/runtime/frame-renderer-browser.ts
packages/player-web/src/runtime/frame-renderer.test.ts
packages/player-web/src/runtime/frame-renderer-browser.test.ts
packages/player-web/src/runtime/checked-runtime-bytes.test.ts
```

Build one immutable renderer layout from format geometry, logical canvas, and
resident layer count. Validate `VideoFrame` coded/display/visible rectangles
before copy. Retain one coded-size staging buffer and coded-size RGBA8 resident
and streaming arrays so resource charging and upload dimensions match.

Replace the opaque fragment shader with the design's single color/optional
alpha shader. Derive inset texel-center transforms on CPU and upload uniforms;
do not concatenate manifest numbers into shader source. Use an alpha-enabled
premultiplied context and exact blend factors. Clear to transparent before
draw, keep filter sampling inside each rectangle, and preserve the M5.5 fast
path defaults (`preserveDrawingBuffer: false`, no per-draw `getError`).

Extend deterministic fake-backend tests and browser-context tests for:

- opaque alpha exactly one;
- packed alpha 0, fractional, and 1;
- color/alpha rect mapping with odd sizes;
- no gutter/padding bleed under linear filtering;
- premultiplied output and blend state;
- resident/streaming handles and stale generations;
- `copyTo` layout/stride and timeout;
- context loss and allocation failure; and
- exact frame close on every path.

Update `resource-plan.ts` with checked static PNG copy, validator-owned and
native-copied zlib, native output/chunk, pure filtered output, unfiltered RGBA,
current/incoming bitmap, and two rounded canvas backing allocations. Use the
larger native/pure simultaneous working peak. Charge coded renderer staging
alongside recovery decode and charge transferred-sample plus decoder-owned
encoded windows separately. Retain coded dimensions for decoder/texture/
staging terms. Admit a static-only baseline before decode and add a snapshot
that reconciles every live allocation with the plan.

Run:

```text
npx vitest run packages/player-web/src/runtime/frame-renderer.test.ts packages/player-web/src/runtime/frame-renderer-browser.test.ts packages/player-web/src/runtime/resource-plan.test.ts packages/player-web/src/runtime/checked-runtime-bytes.test.ts
```

### 12. Add one fit/pixel-aspect/DPR geometry owner for both planes

Add:

```text
packages/player-web/src/runtime/presentation-geometry.ts
packages/player-web/src/runtime/presentation-geometry.test.ts
packages/player-web/src/runtime/browser-presentation-planes.ts
packages/player-web/src/runtime/browser-presentation-planes.test.ts
```

Implement pure contain, cover, fill, and none calculations with the exact
pixel-aspect display ratio. Return immutable CSS destination, physical backing
dimensions, animated/static destination rectangles, source crop, effective
DPR, resolution scale, clamp reasons, and byte terms. Validate all finite
inputs and use checked multiplication before ceiling/rounding.

Apply one uniform clamp against device viewport limits, version-0 coded
dimension ceiling, and remaining resource bytes. Keep CSS geometry unchanged.
Equivalent inputs return equivalent values and produce no resize side effect.

Make WebGL and static Canvas2D/ImageBitmap planes consume the same geometry.
Both canvases receive identical backing dimensions. Resize redraws the current
handle/surface without touching decoder, scheduler, graph, or content clock.
Serialize resize with draw so it cannot present half-updated planes.

Test landscape/portrait/square, non-square pixel aspect, fractional CSS/DPR,
odd dimensions, centering, contain letterbox, cover crop, fill stretch, none
clip, device cap, byte cap, DPR-only change, zero/NaN/infinity rejection,
equivalent no-op, resize during static/animated draw, and alternating resize
stress without resource growth.

Run:

```text
npx vitest run packages/player-web/src/runtime/presentation-geometry.test.ts packages/player-web/src/runtime/browser-presentation-planes.test.ts
```

### 13. Add graph static-to-animated resume without replaying intro

Update:

```text
packages/graph/src/model.ts
packages/graph/src/engine.ts
packages/graph/src/operation-journal.ts
packages/graph/src/index.ts
packages/graph/test/engine-golden.test.ts
packages/graph/test/engine-transitions.test.ts
packages/graph/test/engine-failure-retention.test.ts
```

Add one explicit `resumeAnimated()` operation. It is valid only from static
readiness/phase with a static presentation, equal requested/visual state, no
route, and no pending request settlement. It changes readiness to animated,
sets the current state's body frame zero, and enters stable phase. It emits
only the readiness change. It never selects or replays `initialUnit`, invents
an edge, dispatches transition effects, or clears a failure.

The graph remains policy-neutral and does not decide whether resume is allowed
for a given static reason. Test host-enforced assumptions separately in
player-web.

Add golden tests for initial/noninitial states, looping/finite/held bodies,
initial state with intro, repeated resume, wrong phase, mismatched requested
state, pending route/request, disposed/error, recovery-origin snapshots, effect
order, and fuzz-model operation coverage.

Run:

```text
npx vitest run packages/graph/test/engine-golden.test.ts packages/graph/test/engine-transitions.test.ts packages/graph/test/engine-failure-retention.test.ts packages/graph/test/engine-fuzz.test.ts
```

### 14. Implement the serialized reduced-motion policy coordinator

Add:

```text
packages/player-web/src/runtime/motion-policy.ts
packages/player-web/src/runtime/motion-policy.test.ts
packages/player-web/src/runtime/integrated-player-motion.ts
packages/player-web/src/runtime/integrated-player-motion.test.ts
```

Update:

```text
packages/player-web/src/runtime/integrated-player-contracts.ts
packages/player-web/src/runtime/integrated-player.ts
packages/player-web/src/runtime/integrated-player-realtime.test.ts
packages/player-web/src/runtime/request-promises.test.ts
packages/player-web/src/runtime/effect-host.test.ts
```

Create one policy state machine for public `auto|reduce|full`, injected host
reduced boolean, effective desired mode, actual mode, static origin, monotonically
increasing policy generation, and one serialized transition lane. Do not call
`matchMedia`; expose an idempotent host-signal setter for M8.

Initial reduced preparation must skip candidate/worker/GL construction,
validate all statics, and call graph `beginStatic("reduced-motion")`.

For full-to-reduced:

- stop realtime scheduling before awaiting PNG;
- keep the active candidate and last draw alive;
- present the latest requested static behind the animated plane;
- restart on a newer accepted request;
- if full returns before commit, abort static and resume the same candidate;
- otherwise cover, apply graph recovery/effects/settlements, then dispose the
  candidate; and
- record static origin exactly `reduced-motion`.

For reduced-to-full:

- reject automatic attempt unless origin is reduced-motion and animation has
  never terminally failed;
- attempt the normal candidate order/readiness under a fresh deadline while
  static remains visible;
- derive current body frame zero as activation presentation;
- restage if static state changes during async preparation;
- draw behind static, call graph `resumeAnimated()`, apply readiness, and reveal
  in one barrier; and
- abort/dispose stale candidates on policy change or disposal.

If re-entry exhausts candidates, stay on the same static surface, update the
ready report to the deterministic failure reason, mark origin sticky failure,
and do not retry on another policy flip. An animation-failure/PNG-failure
origin is sticky from the start.

Tests use controlled promises at every boundary and assert no blank/reveal:

- auto/reduce/full truth table;
- reduce before and during prepare;
- reduce while stable, waiting, locked, reversible, cut runway, and recovery;
- newer state during hidden static decode;
- full cancellation before static commit reuses the candidate;
- full after commit creates a fresh candidate;
- state changes during re-entry restage body zero;
- intro never replays;
- candidate rejection remains static and sticky;
- rapid reduce/full/reduce and host signal storms are latest-wins;
- listener-originated reentrant state/policy calls use the operation gate;
- pending request resolution/rejection order; and
- exact disposal of stale timers, frames, candidates, surfaces, and promises.

Run:

```text
npx vitest run packages/player-web/src/runtime/motion-policy.test.ts packages/player-web/src/runtime/integrated-player-motion.test.ts packages/player-web/src/runtime/integrated-player-realtime.test.ts packages/player-web/src/runtime/request-promises.test.ts packages/player-web/src/runtime/effect-host.test.ts
```

### 15. Rehearse packed all-routes readiness and static recovery

Update:

```text
packages/player-web/src/runtime/browser-production-readiness-rehearsal.ts
packages/player-web/src/runtime/browser-production-readiness-evidence.ts
packages/player-web/src/runtime/browser-readiness-rehearsal-driver.test.ts
packages/player-web/src/runtime/integrated-player-recovery.ts
packages/player-web/src/runtime/integrated-player-recovery.test.ts
packages/player-web/src/runtime/integrated-player-fuzz-*.ts
```

Run the existing production rehearsal through both exact profiles using the
same graph/scheduler/worker/renderer transactions. Add profile geometry,
packed upload, alpha-pane availability, static strictness, and motion-policy
phase evidence. Do not let synthetic arrays certify alpha, PNG, resize, or
re-entry; pass only facts emitted by the real owners.

Recovery must use the strict decoder, shared presentation geometry, and the
new actual/static-origin state. Cover before candidate cleanup. Preserve the
M5.5 newest-request loop and route settlement. A static failure remains
terminal and cannot be changed into a reduced-origin resume.

Extend fixed-seed fuzzing with profile, policy flip, resize/DPR, native/pure
static decoder selection, renderer failure, and abort actions. The oracle
asserts one semantic graph, one actual plane, bounded generations, no stale
reveal, sticky failures, and exact terminal cleanup.

Run:

```text
npx vitest run packages/player-web/src/runtime/browser-readiness-rehearsal-driver.test.ts packages/player-web/src/runtime/integrated-player-recovery.test.ts packages/player-web/src/runtime/integrated-player-fuzz.test.ts
```

### 16. Create deterministic M6 compiler and conformance fixtures

Add:

```text
fixtures/compiler/m6/source/
fixtures/compiler/m6/provenance.json
fixtures/compiler/m6/update-provenance.mjs

fixtures/conformance/m6/opaque-odd.avl
fixtures/conformance/m6/packed-alpha-loop.avl
fixtures/conformance/m6/packed-alpha-all-routes.avl
fixtures/conformance/m6/png/
fixtures/conformance/m6/malformed/
fixtures/conformance/m6/provenance.json
fixtures/conformance/m6/update-provenance.mjs

packages/compiler/test/m6-fixture.test.ts
packages/format/test/m6-conformance.test.ts
packages/player-web/src/runtime/m6-fixture.test.ts
```

Generate licensed deterministic RGBA frames containing:

- odd visible dimensions;
- transparent pixels with deliberately hostile hidden RGB;
- 0, fractional, gradient, sharp-edge, and 255 alpha;
- moving transparent edges across loop and transition seams;
- distinct per-state body-entry statics;
- loop, finite, held, portal, finish, cut, locked, and reversible routes; and
- an initial intro used to prove re-entry does not replay it.

Generate valid PNG samples for stored/fixed/dynamic DEFLATE and filters 0-4,
plus one minimal malformed file for every strict rejection class. Malformed
fixtures must be bounded and generated deterministically; do not check in a
compression bomb.

Compile with the recorded FFmpeg fingerprint/configuration and canonical
options. Record asset SHA-256, all source/tool hashes, encoded profile facts,
geometry, per-frame/aggregate alpha metrics, report-only background metrics,
static PNG facts, and deterministic regeneration commands. Tests must fail on
fixture drift and ensure no local absolute path enters provenance.

Run:

```text
npx vitest run packages/compiler/test/m6-fixture.test.ts packages/format/test/m6-conformance.test.ts packages/player-web/src/runtime/m6-fixture.test.ts
node fixtures/conformance/m6/update-provenance.mjs --check
```

### 17. Add the real browser transparency/static/motion proof

Add:

```text
apps/playground/src/m6-transparency-static-proof.ts
tests/browser/m6-transparency-static.spec.ts
```

Update the playground only through `@pixel-point/aval-player-web`'s public
browser composition. Do not import runtime-private modules. Use the real M6
asset, module worker, `VideoDecoder`, `VideoFrame.copyTo`, strict PNG decoder,
WebGL2 backend, static plane, scheduler, readiness rehearsal, and motion-policy
coordinator.

The proof must:

1. Capability-probe the exact AVC configuration and report unsupported rather
   than substituting VP8, `<video>`, fake frames, or Canvas-only animation.
2. Reach animated readiness with real packed geometry and all route classes.
3. Run the strict M5.5 realtime cadence proof without awaiting per frame.
4. Read premultiplied output and independently composite the known fixture
   pixels over black, white, and magenta.
5. Assert alpha per-frame and aggregate MAE `<=2/255`, p99 `<=8/255`, and each
   background's RGB MAE `<=4/255`, p99 `<=16/255`.
6. Check transparent edge/gutter pixels for pane bleed.
7. Exercise contain, cover, fill, none, odd CSS sizes, resize, and DPR changes
   while motion advances, asserting no graph/timeline reset.
8. Force native PNG capability unavailable and prove pure fallback; separately
   run the native path when the browser supports it.
9. Force codec, worker, renderer, upload, and context failures and verify the
   newest requested strict static state covers before animated cleanup.
10. Exercise reduce-before-prepare, full-to-reduced, precommit cancellation,
    reduced-to-full, state change during re-entry, rapid policy flips, and
    sticky failure-origin static.
11. Assert re-entry starts at current body frame zero and intro count remains
    unchanged.
12. Dispose and report zero live client frames, worker leases/submissions,
    ring entries, GL layers, bitmaps, inflater buffers, callbacks, timers, and
    pending promises.

Use exact callback/content-tick timestamps and the same cadence thresholds as
M5.5. Keep background/alpha tolerances literal and visible in the test; do not
calibrate them from the result under test.

Run the full proof at least three consecutive times after all debug polling is
disabled:

```text
npx playwright test tests/browser/m6-transparency-static.spec.ts --project=chromium
npx playwright test tests/browser/m6-transparency-static.spec.ts --project=chromium
npx playwright test tests/browser/m6-transparency-static.spec.ts --project=chromium
```

### 18. Complete hostile-input, lifecycle, API, and claim audits

Expand relevant suites for:

- packed rectangle/coded/crop mutations and unsafe geometry products;
- source 0.1/0.2 ambiguity, unknown fields, alpha scan limits, and cancellation;
- dilation/YUV deterministic properties and input immutability;
- PNG truncation at every byte, CRC/chunk/zlib/DEFLATE/filter mutations, lower
  budgets, and operation caps;
- native decoder late settlements and pure-fallback selection invariants;
- quality histogram overflow and exact thresholds;
- shader uniform/rectangle hostility and context/resource failures;
- resize/DPR storms and backing allocation clamps;
- policy/re-entry reentrancy, abort, source replacement, and disposal; and
- packed all-route rapid input under the existing scheduler phase matrix.

Run compile-only tests proving:

- format still has no platform ambient dependency;
- compiler public APIs have no DOM/WebCodecs types;
- worker code has no Window/Node types;
- browser public composition exposes neutral AVC, geometry, static, and motion
  contracts but not mutable internals; and
- deprecated opaque aliases resolve to the same implementation types.

Run a strict maintainability review before the final gate. Specifically reject:

- a giant project compiler with embedded pixel/quality algorithms;
- a giant renderer containing geometry, GL, resource, and motion policy;
- parallel opaque and alpha candidates/schedulers;
- duplicate CRC, inflate, geometry, rendition-order, or resource calculations;
- source-version checks below normalization;
- condition growth around static origins instead of one policy state machine;
- raw PNG passed to a browser decoder anywhere; and
- an unbounded pure inflater or native stream accumulation.

Searches used by the audit should include:

```text
rg -n "createImageBitmap\(.*Blob|new Blob\(\[.*png|HTMLVideoElement|currentTime|seek|flush|reset" packages/player-web/src
rg -n "opaque" packages/player-web/src/runtime
rg -n "crc32|inflate|deflate|align16|colorRect|alphaRect" packages
```

Every match must be either the one authority, an intentional profile check, a
compatibility facade, test text, or removed.

## Final M6 Gate

Run from a cleanly understood worktree:

```text
npm run typecheck
npm run test:unit
npm run build
npm run test:browser
npm audit --audit-level=high
npm pack --dry-run -w @pixel-point/aval-graph
npm pack --dry-run -w @pixel-point/aval-format
npm pack --dry-run -w @pixel-point/aval-compiler
npm pack --dry-run -w @pixel-point/aval-player-web
git diff --check
```

Also run a real deterministic M6 compiler invocation with the recorded FFmpeg
toolchain, validate/inspect the result through the CLI, compare regenerated
fixture hashes, and run the M6 Chromium proof three consecutive times in the
final production configuration.

Write:

```text
docs/evidence/2026-07-12-m6-transparency-static-fallback.md
```

The evidence must record:

- exact commit/tree and tool/browser/OS versions;
- source, compiler, toolchain, and asset digests;
- source alpha policy decision and complete audit count;
- visible/storage/coded geometry for every rendition;
- per-frame and aggregate alpha MAE/p99 plus worst frame/unit;
- report-only compiler composite metrics and frozen browser background results;
- strict PNG chunk, inflate-path, scanline, static-surface, and byte peaks;
- candidate order, resource plans, all-route readiness, cadence, underflow, and
  fallback counts for opaque and packed fixtures;
- fit/DPR cases and any resolution clamps;
- reduce/full transition traces, intro count, sticky failure evidence, and
  request/effect settlement order;
- native and pure PNG path coverage;
- exact terminal cleanup counters;
- unit/browser pass counts, audit result, and package contents; and
- explicit claim boundaries: local/in-memory/single-player, no M7 network or
  shared budgets, no M8 automatic DOM/media-query integration, and no M9
  named-device certification.

Do not mark M6 complete or commit it until every gate is green, the evidence
has no absolute local path or unsupported claim, and the maintainability audit
finds one authority for each critical operation.
