# M6 Transparency and Static Fallback Evidence

**Date:** 2026-07-12

**Milestone:** Exact opaque/stacked-alpha AVC geometry and compilation, strict
RGBA PNG statics, one profile-neutral browser compositor, shared presentation
geometry, static recovery, and live reduced/full motion transitions

**Status:** Complete. The checked provenance, strict hostile/conformance
matrix, complete repository gate, supported structured browser proof, three
consecutive final-shape Chromium repetitions, and two independent final
implementation audits passed.

## Result and Claim Boundary

M6 keeps compiled wire version `0.1` and extends the existing web-only runtime
with one opaque/packed AVC path. Packed color and alpha occupy one decoded
picture, so there is no second decoder, alpha clock, media seek, or boundary
flush. The compiler owns exact odd-size geometry, deterministic radius-four
hidden-RGB dilation, integer BT.709 limited-range YUV420 packing, complete
source-alpha classification, and decode-back alpha gates. The runtime owns one
strict PNG grammar and two bounded inflate implementations, one static surface
store, one fit/pixel-aspect/DPR calculation, one WebGL2 compositor, and one
serialized motion-policy lane.

The checked packed all-routes fixture reached animated readiness in the
recorded Chromium environment, exercised every route class, graded real
WebCodecs/WebGL output over transparent and composite reference pixels, moved
between animated and strict-static modes, recovered to the newest requested
static state, and disposed to zero live owners. The checked opaque fixtures
remain valid through the strengthened format/compiler/runtime path. The full
browser suite retains the M5.5 opaque all-routes regression alongside the new
packed proof; the M6 pixel-quality numbers below apply specifically to the
packed M6 asset.

This is a local, completely resident, in-memory, single-player claim. It does
not claim M7 URL/range loading, response or external-integrity enforcement,
shared page budgets, visibility eviction, or context rebuilding. It does not
claim the M8 public custom element, automatic DOM bindings, or automatic
`matchMedia` integration. It does not claim M9 named-device, headed-browser,
hardware, refresh-rate, long-run, or physical-display certification. Browser
timings prove the submission/presentation contract in the recorded test
environment, not compositor completion or physical scan-out continuity.

## Reviewed Revision and Captured Environment

The final implementation was reviewed against parent commit
`eb56437422bc23d9a1974ce8d7a44b5161fdbf8b` (`docs: design transparency and
static fallback`). The milestone commit is the commit containing this evidence;
the reviewed-parent identity is recorded instead of attempting a circular
self-reference to the containing commit or tree.

| Item | Captured value |
| --- | --- |
| OS | macOS 15.6, build 24G84; Darwin 24.6.0 arm64 |
| Node.js | 25.8.1 |
| npm | 11.11.0 |
| TypeScript | 7.0.2 |
| Vitest | 4.1.10 |
| Playwright | 1.61.1 |
| Chromium | Chrome for Testing 149.0.7827.55 |
| FFmpeg | 8.1.2 |
| FFprobe | 8.1.2 |

All final commands below ran after the last production, fixture, and test
change. The evidence-only refresh was then followed by the same complete gate,
so the containing tree and the recorded results agree.

## Deterministic Source, Toolchain, and Asset Provenance

`fixtures/compiler/m6/provenance.json` records every generated source frame,
source project, generator, license, runtime, and digest.
`fixtures/conformance/m6/provenance.json` records the complete compiler input,
toolchain fingerprints, manifests, blobs, strict AVC inspections, alpha audit,
quality reports, static validation, and conformance corpora. Both provenance
documents use repository-relative paths and contain no machine-local absolute
path.

| Provenance/tool item | SHA-256 |
| --- | --- |
| compiler-source provenance | `b3af8e748cceab1be9227b5960ed6ff4696e25f570f7f61cb4553f382d004246` |
| complete conformance provenance | `40ba4f3701463025ad54ff191618ba3c17b42f08dd6c93df320d232ec263c8f3` |
| source generator | `8b2d9bf103c7f55e484c55d484b4ab313080aaa68b2ac541bed29693068eaf99` |
| frame-fixture generator module | `787035e0cebc92cb1cc5fdedddd150926efaa0f244e11d700a0d99fb31d30c5e` |
| PNG-fixture generator module | `a1d1315dd956bec7a78ff84b6b9dc15a58b1f857a9d9d4d1aba8c8f92f3d346d` |
| source license | `e4158d55b4d5af7012f2c2534f368e97c94e76ae6835c841dbfa68faddc4d183` |
| FFmpeg executable | `329fa7360b28a067a0cd7281474bb18cd868932d5173646a674466bcb56d6e93` |
| FFmpeg version output | `98f2da65e4b3e39aa6ac74848582be422751d8f52176cf810eceb94bbcaa78d1` |
| FFmpeg configuration | `8470f6e5d1c91c01f1228e91aa8827bea05a7e8a39c8dedefdb778716bdc1aec` |
| FFmpeg encoder list | `38b11441f5ffe17fd32539030ba9290b81e730878bb0cffe1af5084e2b7b8879` |
| effective packed-YUV calibration | `2187478d0b9baaa2e44dc458abcdcbc7c9242c360bb233cff2d5229004a6911c` |
| FFprobe executable | `841ab2259a55e5c44c5851890867d48750ff1e7cfa92b5fbed91445a493128` |
| FFprobe version output | `8316221740e891c1f9d08d30a9a45059af9f1ec96741423eee3ae0c7721d9cec` |

The three M6 source projects and compiled assets are:

| Fixture | Source-project SHA-256 | Asset bytes | Asset SHA-256 | Manifest SHA-256 |
| --- | --- | ---: | --- | --- |
| `opaque-odd.avl` | `6a7965c9674a47009c456b385b088c45b7c8ec8b5f3ca05ebff6f0dd47292fd3` | 9,344 | `47ee7c6b23323e89def9f1073057b7465c98b62a4dbe63f2dc038b565d72478f` | `433dadd9d2cbef304505ca742e76ba35f5cb5836b2a0d73dea289d3c4d3460f7` |
| `packed-alpha-loop.avl` | `9d3d2d74cce19601e030708ac2621d7690601de0231ba5e1950ba11000b0dc22` | 9,064 | `98966b2b0ea32e66edb431d6d741e7abaf64b6cbeb1bf617133c4d5739d2c7ed` | `e0d8a05bd8b7dd136671ee5bdf0c23e78fe45c3b9d7f76e3d39434b0c52a7843` |
| `packed-alpha-all-routes.avl` | `5d82ef90b04be6c52e06fc8fc0eb7fb215e16706d44dda11034f838bab17346f` | 37,968 | `aa66fbca787138b692e7fed691cbabec58dd9f9576b63b13d4ed9c69269d9a0f` | `37e526bda7a4e0f049d1d6f7ba1e50e45d25a8f4fea8e0b4b4ada355f82cae12` |

The all-routes asset contains 14,503 encoded bytes and 14,904 strict-static
bytes. A real compiler invocation, CLI validation, and CLI inspection produced
the same `aa66fbca...a0f` asset digest. Complete regeneration checks rebuilt all
three assets into private temporary storage and compared normalized provenance,
not just selected hashes.

## Source Alpha Policy

Classification scans each unique canonical referenced RGBA frame exactly once
after normalization. Probe metadata is not acceptance evidence.

| Fixture | Requested | Selected | Unique audited frames | Minimum alpha | First nonopaque canonical pixel |
| --- | --- | --- | ---: | ---: | --- |
| opaque odd | `auto` | `opaque` | 8 | 255 | none |
| packed loop | `auto` | `packed` | 8 | 0 | source `frames`, frame 3, x 0, y 0, alpha 0 |
| packed all-routes | `packed` | `packed` | 29 | 0 | source `frames`, frame 0, x 0, y 0, alpha 0 |

All three decisions emitted no warning. The all-routes source contains 30
generated frames; source ordinal 29 is deliberately unused and therefore is
not included in the 29-frame semantic audit. Poster-only references are part
of the audit contract, while wholly unused frames are not.

## Exact Rendition Geometry and AVC Inspection

All logical canvases are 45×27 with square pixels. Rectangle notation is
`[x, y, width, height]`. The decoded storage rectangle is the exact SPS crop
and `VideoFrame.visibleRect`; coded RGBA bytes include macroblock padding.

| Asset / rendition | Profile | Color rect | Alpha rect | Decoded storage | Coded | Decoded RGBA | Coded RGBA | AUs / encoded bytes |
| --- | --- | --- | --- | --- | --- | ---: | ---: | ---: |
| opaque odd / `opaque.1x` | opaque | `[0,0,45,27]` | none | `[0,0,46,28]` | 48×32 | 5,152 | 6,144 | 8 / 2,704 |
| packed loop / `packed.1x` | stacked | `[0,0,45,27]` | `[0,36,45,27]` | `[0,0,46,64]` | 48×64 | 11,776 | 12,288 | 8 / 2,384 |
| all-routes / `packed.0.333x` | stacked | `[0,0,15,9]` | `[0,18,15,9]` | `[0,0,16,28]` | 16×32 | 1,792 | 2,048 | 30 / 4,566 |
| all-routes / `packed.1x` | stacked | `[0,0,45,27]` | `[0,36,45,27]` | `[0,0,46,64]` | 48×64 | 11,776 | 12,288 | 30 / 9,937 |

Strict SPS inspection found Baseline profile (`profile_idc` 66), constraint-set
2, level 3.2, one reference frame, no reorder, no HRD, fixed frame rate,
square samples, limited-range BT.709, and the exact derived crops:

| Geometry | SPS crop offsets `(left,right,top,bottom)` | Crop size |
| --- | --- | --- |
| opaque 48×32 | `(0,2,0,4)` | 46×28 |
| packed 16×32 | `(0,0,0,4)` | 16×28 |
| packed 48×64 | `(0,2,0,0)` | 46×64 |

The fixed eight-pixel gutter lies between the even-height color pane and alpha
pane. Shader sampling is inset to the two visible rectangles, so it never
samples the gutter or coded padding. Manifest validation rejects an alternate
origin, gap, overlap, pane size, decoded crop, coded size, unsafe product, or
mixed opaque/packed production rendition set.

## Compiler Alpha and Composite Quality

The normative alpha gate compares each decoded red-channel alpha byte against
the canonical scaled alpha. Both every frame and the complete rendition must
have MAE at most `2/255` and nearest-rank p99 at most `8/255`.

| Fixture / rendition | Frames / samples | Aggregate MAE | Aggregate p99 | Worst unit/frame | Worst-frame MAE | Worst-frame p99 | Decoded alpha range |
| --- | ---: | ---: | ---: | --- | ---: | ---: | --- |
| packed loop / `packed.1x` | 8 / 9,720 | 0.007694666343903817 | 0.0196078431372549 | `body` / 0 | 0.007694666343903817 | 0.0196078431372549 | 0–251 |
| all-routes / `packed.0.333x` | 30 / 4,050 | 0.005911401597676107 | 0.01568627450980392 | `hover-body` / 1 | 0.0059840232389252 | 0.01568627450980392 | aggregate 0–254; worst 0–253 |
| all-routes / `packed.1x` | 30 / 36,450 | 0.0076972484467037845 | 0.0196078431372549 | `done-body` / 0 | 0.007707576857903655 | 0.0196078431372549 | 0–252 |

Every recorded frame passed independently; the table reports the mandated
worst-frame identity rather than hiding it in the aggregate. Opaque output has
no alpha-loss gate because its alpha is defined as one.

Compiler composite metrics are report-only and do not create a second compiler
acceptance threshold:

| Rendition | Background | RGB samples | Mean absolute error | p99 absolute error |
| --- | --- | ---: | ---: | ---: |
| packed loop 1× | black | 29,160 | 0.007958524973775518 | 0.03137254901960784 |
| packed loop 1× | white | 29,160 | 0.0022910782968880283 | 0.01568627450980392 |
| packed loop 1× | magenta | 29,160 | 0.004031576965491272 | 0.0196078431372549 |
| all-routes 0.333× | black | 12,150 | 0.004349229403695634 | 0.0196078431372549 |
| all-routes 0.333× | white | 12,150 | 0.00340321149035746 | 0.01568627450980392 |
| all-routes 0.333× | magenta | 12,150 | 0.0033021867183087228 | 0.01568627450980392 |
| all-routes 1× | black | 109,350 | 0.00798275011879466 | 0.03137254901960784 |
| all-routes 1× | white | 109,350 | 0.002201493674744704 | 0.01568627450980392 |
| all-routes 1× | magenta | 109,350 | 0.003984363933044639 | 0.0196078431372549 |

## Strict PNG, Inflate Paths, and Static Surfaces

Every compiler-emitted static is `strict-rgba-png-v0` and is fully decoded
during compiler self-validation. The all-routes asset has three unique PNGs;
`done` and `loading` share `static.00`, `hover` uses `static.01`, and `idle`
uses `static.02`. Each is 4,968 bytes and decodes at 45×27 to these exact
peaks:

| Owner | Bytes |
| --- | ---: |
| copied PNG | 4,968 |
| concatenated zlib member | 4,898 |
| filtered scanlines | 4,887 |
| RGBA output | 4,860 |

The valid conformance corpus separately covers stored, fixed-Huffman, and
dynamic-Huffman DEFLATE plus PNG filters 0 through 4:

| Sample | PNG / zlib bytes | Filter / first block | SHA-256 |
| --- | ---: | --- | --- |
| `stored-filter0.png` | 2,145 / 2,075 | 0 / stored | `2239a8a41adb5228e75be9bfd0fb1157d1c3b95f615f0dfef7093a2e3db0ef7c` |
| `fixed-filter1.png` | 194 / 124 | 1 / fixed | `fa5c01bd0177a2637c3fcde21c51673ec8a20c01931b8c08c47323c769d62127` |
| `dynamic-filter2.png` | 850 / 780 | 2 / dynamic | `95b595b5b44da5c2b9e3ace7f27c3f76d2c559396e062e9649aecfb0e6d76633` |
| `dynamic-filter3.png` | 910 / 840 | 3 / dynamic | `44c010c600fb76d2bf987ca0ebd041ecdecb9b266a137d23dec460184e417340` |
| `dynamic-filter4.png` | 770 / 700 | 4 / dynamic | `9f413cf97d3279e298751a7d128316ddaafa25028f3223de6c0f0f1f9582b37f` |
| `dynamic-literal-only-filter0.png` | 376 / 306 | 0 / dynamic | `0d763c1d21016d08246ff6a6a9bc6d1659709ef41a9eb5910a4703638ef7bf77` |

The grammar checks signature; one first 13-byte `IHDR`; descriptor dimensions;
8-bit RGBA, compression/filter method zero, no interlace; optional constrained
`sRGB`; consecutive `IDAT`; one empty terminal `IEND`; restricted chunk set;
chunk and aggregate caps; CRC-32; zlib method/window/FCHECK/FDICT; exact
DEFLATE finality, tree and distance rules; exact output; Adler-32; and scanline
filters. The pure inflater additionally applies the frozen operation budget.

The deterministic malformed corpus is generated, bounded, and checked through
stable `PNG_ENVELOPE_INVALID`, `PNG_DEFLATE_INVALID`, and
`PNG_SCANLINE_INVALID` codes. Its 59 files have 59 unique rejection classes:
29 envelope, 29 DEFLATE, and one scanline failure. This includes the positive
RFC 1951 literal-only dynamic case above and the paired rejection where a
length symbol attempts to use the deliberately empty distance alphabet. The
final corpus manifest is 12,105 bytes with SHA-256
`64039534c5e8bb8bd6b7350ac0e1ff2abbf9bb4be4e28bb2cee3ff1b8f05b0dd`;
the separately executed limit/geometry/quality contracts are 3,334 bytes with
SHA-256
`8d291fbbd6ef74dd5bcec2db10954974c39dc307c6c84b0a10bb1925bc5a6002`.

Raw PNG bytes are never passed to `createImageBitmap(Blob)`, `<img>`, or another
browser PNG decoder. Only independently validated and reconstructed RGBA enters
`ImageData`/bitmap creation. A native decode failure is corruption and does not
retry through pure inflate; pure inflate is selected only when native capability
is unavailable before decode.

The packed browser proof recorded five native attempts and five native
successes, no pure success in that main path, and the exact byte peaks above.
Four bitmaps had closed at the intermediate native snapshot; the retained final
surface subsequently closed, and the static store ended at five decoded and
five closed surfaces. The forced pure-path proof recorded zero native attempts,
one pure attempt, one pure success, one bitmap close, and the same bounded byte
peaks.

## Candidate Order and Resource Accounting

Candidate preference uses visible color area, then peak bitrate, then canonical
ID. Packed coded area is not a quality key because it includes the alpha pane.

| Asset | Rank | Candidate | Visible area | Coded area | Peak bitrate | Browser outcome |
| --- | ---: | --- | ---: | ---: | ---: | --- |
| M6 packed all-routes | 0 | `packed.1x` | 1,215 | 3,072 | 8,000,000 | selected |
| M6 packed all-routes | 1 | `packed.0.333x` | 135 | 512 | 4,000,000 | supported fallback; not prepared after rank 0 passed |
| M6 opaque odd | 0 | `opaque.1x` | 1,215 | 1,536 | 800,000 | strict fixture inspection passed |

The full browser suite also retains the current opaque M5.5 all-routes
regression (`opaque.1x`, then `opaque.0.5x`) through the same neutral candidate,
worker, scheduler, and renderer implementations. M6 does not claim that the
single-state opaque-odd fixture itself has an authored all-routes graph.

For the two all-routes browser fixtures under the final M6 resource formula,
authored-key deduplication produces 18 persistent layers from 24 semantic
frames and a ring of six with 12 outstanding decoded surfaces:

| Plan | Opaque all-routes 1× | Packed all-routes 1× |
| --- | ---: | ---: |
| bytes per cached frame | 4,096 | 12,288 |
| persistent logical bytes | 73,728 | 221,184 |
| persistent allocation | 92,160 | 276,480 |
| static-only admitted total | 77,016 | 86,806 |
| full runtime admitted total | 390,784 | 802,900 |
| effective cap | 67,108,864 | 67,108,864 |

The selected packed allocation snapshot is fully additive:

| Packed selected term | Bytes |
| --- | ---: |
| owned asset | 37,968 |
| greatest transferred encoded window | 6,303 |
| decoder-owned encoded window | 6,303 |
| 12 decoded surfaces | 368,640 |
| 18 persistent layers with allocation overhead | 276,480 |
| three streaming layers with allocation overhead | 46,080 |
| coded RGBA staging | 12,288 |
| static PNG copy | 4,968 |
| static zlib member | 4,898 |
| strict-static working peak | 14,672 |
| current static allocation | 6,075 |
| incoming static allocation | 6,075 |
| animated canvas allocation | 6,075 |
| static canvas allocation | 6,075 |
| **total** | **802,900** |

The static baseline total of 86,806 bytes contains the asset, PNG copy, zlib
member, 14,672-byte native/pure maximum working peak, and four 6,075-byte
surface/canvas allocations. Ring additional bytes are zero because the ring
leases already charged decoder surfaces. Manifest limits for the packed
all-routes asset record 12,288 decoded-pixel bytes, 294,912 persistent-cache
bytes, 457,165 advisory working-set bytes, and a 67,108,864-byte runtime cap;
the exact runtime plan, not the advisory working-set number, controls admission.

## Real-Browser Readiness, Routes, and Cadence

The public proof used the real checked asset, module worker, exact
`avc1.42E020` WebCodecs configuration, one `VideoDecoder`, `VideoFrame.copyTo`,
the strict static decoder, one WebGL2 backend, the production graph/scheduler,
readiness rehearsal, and motion-policy coordinator. It did not substitute VP8,
`<video>`, seeking, fake frames, or a Canvas-only animated path.

The final supported packed all-routes report recorded:

| Readiness/cadence fact | Value |
| --- | ---: |
| selected candidate | `packed.1x` |
| readiness policy | `all-routes` |
| warmup outputs | 24 |
| authored rate | 30 fps |
| measured upload-inclusive throughput | 15,000.000055879354 fps |
| decode lead / ring capacity | 2 / 6 frames |
| direct edges / loop checks / endpoints | 6 / 2 / 2 |
| realtime content draws / advancing frames | 43 / 43 |
| realtime loop seams / display callbacks | 5 / 88 |
| realtime underflows | 0 |
| manual cadence ticks / underflows / burst debt | 103 / 0 / 0 |

The same run's bounded timing diagnostics were:

| Realtime measurement | Milliseconds |
| --- | ---: |
| minimum content-draw interval | 31.80000001192093 |
| maximum content-draw interval | 34.80000001192093 |
| p95 content-draw interval | 34.60000002384186 |
| average content-draw interval | 33.33571428557237 |
| maximum display-callback interval | 16.799999999999955 |
| p95 display-callback interval | 16.700000000000045 |
| maximum draw-submission latency | 2.799999988079094 |
| start-to-final-draw elapsed | 1,440.5 |
| first-to-final content span | 1,400.0999999940395 |

| Manual cadence measurement | Milliseconds |
| --- | ---: |
| maximum lateness | 5.06666667262698 |
| minimum interval | 33.5 |
| maximum interval | 38.400000005960464 |
| p95 interval | 35.80000001192093 |
| average interval | 35.25728155339806 |
| elapsed | 3,631.5 |

These values are diagnostic observations from one final-shape supported
report, not frozen performance promises. The literal cadence limits remain the
M5.5 limits:
content minimum 0.45×, maximum 1.75×, p95 1.65×, average 1.25×; callback
maximum 1.75× and p95 1.65×; content elapsed/span bounds; manual interval,
elapsed, lateness, and zero-burst-debt bounds. All passed in this report.

The route proof covered six direct edges, two loop seams, both reversible
endpoints, locked, finish, cut, held, intro, resident and streaming ownership,
and newest-request recovery to `hover`. Ordinals 0 through 28 were observed;
29 was intentionally unused. It recorded 30 distinct presentation identities,
both reversible directions `[0,1,2,3,4,5]`, ten graded seams, 60 graded draws,
and zero realtime or manual underflow.

## Browser Pixel and Composite Evidence

Browser errors are expressed in byte units. Frozen limits are alpha MAE 2,
alpha p99 8, and each background's composite RGB MAE 4 and p99 16.

| Metric | Samples | MAE | p99 | Maximum |
| --- | ---: | ---: | ---: | ---: |
| aggregate alpha | 72,900 | 1.0472427983539094 | 3 | 4 |
| aggregate black composite | 218,700 | 0.9469135802469136 | 4 | 6 |
| aggregate white composite | 218,700 | 0.4807681755829904 | 2 | 4 |
| aggregate magenta composite | 218,700 | 0.5072519433013261 | 2 | 4 |

Across individual graded frames, maximum alpha MAE was
1.0502057613168725 and maximum alpha p99 was 3. The greatest per-frame
composite MAE was 1.2499314 over black, 0.569273 over white, and 0.666118 over
magenta; the corresponding greatest p99 values were 5, 3, and 3. Transparent
edge maximum alpha and premultiplied RGB were both zero, providing direct
gutter/pane-bleed evidence for this fixture.

These browser thresholds certify the known reference fixture and shader in the
recorded environment. They are not general color-quality acceptance limits for
arbitrary authored content.

## Shared Fit, Resize, Pixel Aspect, and DPR

One presentation calculation supplied both static Canvas2D and animated WebGL
planes. The proof changed fit, odd CSS sizes, resize, and DPR without resetting
graph or media state. No tested case required a backing-resolution clamp.

| Fit | Backing size | Graph trace | Content ordinal | Presentation |
| --- | --- | --- | --- | --- |
| contain | 114×92 | unchanged | `2` unchanged | `idle-body:0` unchanged |
| cover | 110×137 | unchanged | `2` unchanged | `idle-body:0` unchanged |
| fill | 174×106 | unchanged | `2` unchanged | `idle-body:0` unchanged |
| none | 55×34 | unchanged | `2` unchanged | `idle-body:0` unchanged |

An equivalent geometry update was a no-op. Runtime geometry also accepts the
format's valid non-unit reduced pixel-aspect fractions and applies them to
display geometry without changing source-pixel rendition aspect.

## Reduced Motion, Re-entry, and Settlement Order

The browser trace established these M6 transitions:

- A precommit full-to-reduced cancellation entered reduction, then returned to
  full while retaining the same `candidate-1`, `worker-1`, and last-draw
  candidate identity.
- Committed reduction presented `hover` through strict static pixels.
- Reduced-to-full re-entry began at `hover-body:0`; it did not replay the intro.
- A state request during re-entry superseded stale work, disposed at least two
  stale candidates, and finished in `idle`.
- Rapid policy flips began while work was in flight, converged to static for
  the newest reduction, and subsequently returned to final animated mode.
- Realtime presentation ordinals were `3 -> 3 -> 3 -> 4` before reduction,
  while reduced, after re-entry, and after the next frame: no repeated-body
  activation ordinal, no underflow, and a smooth session.
- Reduce-before-prepare installed no animated plane, recorded origin
  `reduced-motion`, then re-entered animated mode at `idle-body:0`; its cleanup
  completed.
- Intro draw count remained exactly one.
- Animation-failure static origin remained sticky and policy flips did not
  create another worker or automatic retry.

The effect/promise owner retains the verified ordering:

```text
request
< transitionstart
< first transition draw
< target body-frame-zero draw
< visualstatechange
< transitionend
< surviving request-promise settlement
```

Static recovery retains:

```text
recovery request
< fallback event
< newest requested strict-static draw/cover
< visualstatechange
< transitionend
< surviving request-promise settlement
< animated candidate disposal
```

Superseded requests reject with `AbortError`; listener-originated reentrant
requests are FIFO-deferred through the one operation gate. The final context
failure proof retained the stronger causal assertion `cover event <
candidate-dispose-start < candidate-dispose-end < terminal cleanup`, with
nontransparent static pixels present at cover.

## Forced Fallback, Context Failure, and Cleanup

The browser proof separately forced these four preparation seams:

| Seam | Required result |
| --- | --- |
| worker unavailable | `staticReady`, strict static visible, nontransparent pixels, complete cleanup |
| codec unavailable | `staticReady`, strict static visible, nontransparent pixels, complete cleanup |
| renderer allocation | `staticReady`, strict static visible, nontransparent pixels, complete cleanup |
| renderer upload | `staticReady`, strict static visible, nontransparent pixels, complete cleanup |

The final hardened report recorded the required static/readiness/pixel/cleanup
result for all four names. Each result was caused by a live production attempt
reaching and failing at its named seam, rather than a synthetic preflight
return. Every path covered 540 nontransparent static pixels before candidate
cleanup, used event order `initial cover 1 < failure cover 3 < cleanup start 4
< cleanup end 5`, recovered the newest requested/visual state `hover`, and
disposed its four decoded statics four-for-four.

The final supported context-failure report recorded static readiness, origin
`animation-failure`, sticky failure, visible nontransparent cover, no retry
worker, and complete terminal cleanup. Its distinct ordinals were cover 3,
candidate cleanup start 4, candidate cleanup end 5, and terminal cleanup 6.
The cleanup snapshot moved from one live worker and 12,288 renderer staging
bytes at start to zero workers, frames, renderers, GL resources, staging bytes,
source copies, and pending operations at end.

The packed all-routes session's terminal worker/renderer report recorded:

| Counter | Terminal value |
| --- | ---: |
| worker configure / reset / flush / boundary flush | 1 / 0 / 0 / 0 |
| worker output / delivered / released | 702 / 702 / 702 |
| terminal release gap | 0 |
| renderer uploads / stale uploads / closed source frames | 484 / 0 / 484 |
| pending samples / submitted frames / leased frames | 0 / 0 / 0 |
| leased decoded bytes / decode queue / client-open frames | 0 / 0 / 0 |
| worker operations / waiters | 0 / 0 |
| renderer and GL live resources | 0 |
| callbacks / promises | 0 / 0 |
| bounded integrated trace | 117 records |

The independent M6 pixel/motion session ended with workers alive 0, open
frames 0, renderers alive 0, GL resources 0, renderer staging bytes 0,
uncancellable source copies in flight 0, pending operations 0, static surfaces
retained 0, and decoded statics equal to closed statics (5/5). Every forced
fallback and reduce-before-prepare sub-session separately reported complete
cleanup.

## Authority, Hostile Input, and Maintainability

The implementation keeps one authority for each critical operation:

- `deriveAvcRenditionGeometry` for opaque/packed geometry;
- `inspectAvcAnnexBRendition` for complete AVC inspection;
- the format PNG chunk/CRC/zlib owner plus one pure DEFLATE owner;
- one source-project normalization boundary and one asset-wide alpha decision;
- one deterministic BT.709 packer and one alpha-quality owner;
- one neutral AVC candidate order, worker, timeline, scheduler, renderer, and
  resource formula;
- one presentation geometry calculation shared by both planes; and
- one motion-policy state machine and one static-recovery coordinator.

Hostile suites cover packed rectangles and SPS crops, checked arithmetic,
source 0.1/0.2 ambiguity, alpha scans, dilation/YUV properties, PNG truncation
and mutations, DEFLATE trees/back-references/budgets, Adler/filter failures,
quality histograms, worker/renderer/context faults, resize storms, policy
generation/reentrancy, stale candidates, abort, and exact cleanup. Public
decoder-worker `ErrorEvent` details and compiler process-runner scratch paths
are normalized to bounded stable diagnostics rather than copied into public
errors.

The final format/compiler audit, renderer/presentation/realtime audit, overall
player lifecycle audit, and independent release audit all reported no remaining
P0/P1 implementation blocker. The independent strategic sweep passed 64 files
and 794 tests across player/public/conformance seams; the complete unit gate
below is broader. Hostile cleanup includes getter-changing hosts and leases,
uncancellable frame copies, synchronous callback re-entry, direct and
async-immediate disposal self-reentry, source-generation races, and cleanup
continuation after injected failure.

Authority searches found no raw browser PNG decode, seeking video path, second
DEFLATE/CRC/geometry implementation, or parallel opaque runtime. The only
production `flush()` match remains an older experimental decoder outside the
M6 production path. Every M6 production file is below 1,000 lines. The
1,447-line `browser-phase-ownership.test.ts` is a pre-existing compatibility
suite that shrank during M6; the 2,399-line M5.5 proof is an explicit legacy
browser-evidence composition with new M6 work extracted into focused modules.

## Completed Final Verification

The final gate ran on the reviewed implementation and again after this
evidence-only refresh:

| Command/check | Recorded result |
| --- | --- |
| `npm run typecheck` | passed |
| `npm run test:unit` | 149 files, 1,453 tests passed |
| `npm run build` | passed |
| `npm run test:browser` | 14 of 14 passed |
| focused M6 Chromium proof | three consecutive runs, 2 of 2 passed each |
| `npm audit --audit-level=high` | 0 vulnerabilities |
| compiler provenance check | passed |
| conformance provenance check | passed |
| real compile / validate / inspect | passed; all-routes SHA-256 matched |
| complete malformed PNG corpus | 59 of 59 unique rejection classes passed |
| hostile/authority/maintainability audits | no remaining P0/P1 blocker or duplicate critical authority |
| `git diff --check` | passed |

The final dry-run package inspections reported:

| Package | Tarball bytes | Unpacked bytes | Files |
| --- | ---: | ---: | ---: |
| `@pixel-point/aval-graph` | 44,159 | 248,987 | 27 |
| `@pixel-point/aval-format` | 135,099 | 617,900 | 93 |
| `@pixel-point/aval-compiler` | 320,000 | 1,560,757 | 357 |
| `@pixel-point/aval-player-web` | 453,548 | 2,350,023 | 216 |

Package inspection found no browser cache, FFmpeg scratch spool, absolute path,
raw timing trace, source fixture, or unpacked asset introduced as an unintended
publication artifact. Compiler `dist/` is the package's expected declared CLI
output; the other inspected packages contain their intended source/declaration
surfaces. M9 still owns the final public publication and release-packaging
claim.

The real compiler rebuilt `packed-alpha-all-routes.avl` to 37,968 bytes with
SHA-256 `aa66fbca787138b692e7fed691cbabec58dd9f9576b63b13d4ed9c69269d9a0f`;
byte comparison against the checked fixture, CLI validation of all 60 access
units/14 unit blobs/three strict statics, and CLI inspection all passed. Both
complete provenance regeneration checks passed without changing recorded
bytes. The three final Chromium repetitions each passed both M6 tests, and the
quiet complete browser gate retained all earlier milestone regressions at
14/14.

## Legal and Deployment Boundary

H.264/AVC deployment and source or derived media may carry patent,
codec-license, content-license, and distribution obligations. A
caller-installed encoder and a technically conforming container do not remove
those obligations; product-specific legal review remains required before
release.
