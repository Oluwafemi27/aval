# M6 Transparency and Static Fallback Design

**Date:** 2026-07-12

**Status:** Approved implementation slice derived from the committed AVAL
design and the approved M4-M5.5 contracts

**Authority:**

- [AVAL Format Design](2026-07-11-aval-format-design.md)
- [AVAL Implementation Plan](../plans/2026-07-11-aval-implementation.md)
- [M4 Minimal Compiled Format Design](2026-07-11-m4-minimal-compiled-format-design.md)
- [M5 Opaque AVC Compiler and Dedicated Worker Design](2026-07-11-m5-opaque-avc-compiler-worker-design.md)
- [M5.5 Integrated Scheduler and Readiness Design](2026-07-12-m55-integrated-scheduler-readiness-design.md)

## 1. Outcome and Claim Boundary

M6 makes transparency and static behavior first-class parts of the existing
web runtime. It adds the portable stacked-alpha AVC profile, complete strict
PNG validation and decoding, a profile-neutral AVC compositor, shared
fit/device-pixel-ratio geometry, reliable animated-to-static recovery, and
live reduced-motion transitions in both directions.

M6 proves, for a completely resident local asset, that:

- opaque and packed-alpha renditions use the same worker, scheduler, cache,
  presentation clock, and renderer ownership model;
- color and alpha cannot drift because they occupy one decoded picture;
- packed-alpha geometry is exact for odd logical dimensions and lower
  renditions;
- compiler-decoded alpha satisfies the normative error limits on every frame
  and across the complete rendition;
- every state has a bounded, strictly validated RGBA PNG fallback;
- raw untrusted PNG bytes never reach a browser image decoder;
- static and animated planes use the same fit, pixel-aspect, resize, and DPR
  calculation;
- animation failure commits the newest accepted state to static pixels without
  an empty frame; and
- a reduced-motion session can return to full animation through a fresh
  readiness cycle without revealing unprepared pixels; an unfinished intro
  restarts at frame zero, while an intro that already joined its body is never
  replayed.

The milestone remains local, in-memory, and single-player. It does not add
network range loading or runtime digest enforcement, shared page-wide budgets,
the public custom element, automatic `matchMedia` wiring, authoring polish, or
named-device certification. Those remain M7-M9. The browser proof establishes
functional conformance on its recorded environment; it is not a broad device
performance claim.

## 2. Decisions and Alternatives

### 2.1 Keep compiled wire version 0.1

The compiled format remains version `0.1`. M4 already reserved the exact
`avc-annexb-packed-alpha-v0` union member, `colorRect`, `alphaRect`, coded
dimensions, capabilities, and strict static descriptors. M4 explicitly
deferred the packed profile's geometric relations and complete PNG validation
to M6. No new on-wire field is needed because every storage and visible
rectangle is derivable from the existing values.

A compiled wire `0.2` with another visible rectangle was considered. It would
make the same facts redundant, require a second schema/canonicalizer, and
fracture the M4 fixtures without adding expressive power. Separate color and
alpha videos were also rejected: they introduce decoder-clock drift, double
the decode and scheduling failure modes, and violate the one-active-decoder
contract.

M6 strengthens version-0.1 profile validation; it does not reinterpret a
previously invalid asset. Every asset emitted by the M5 compiler remains
valid: its opaque visible size was already 16-aligned, its color rectangle
covered the coded surface, and the new formula produces the same geometry.
All prior header, canonical JSON, range, AVC, graph, and resource checks remain
mandatory. An old file that failed any earlier check stays invalid. A
hand-written packed rendition that passed M4's deliberately shallow rectangle
envelope but violates the M6 profile is rejected rather than normalized.

### 2.2 Version the editable project independently

The editable source project advances to `projectVersion: "0.2"`. This is not a
container version. The compiler continues to accept the exact M5 source
project `0.1` schema and lowers it through an isolated compatibility adapter;
that schema remains explicit opaque AVC with 16-aligned `codedWidth` and
`codedHeight` fields.

Source project 0.2 uses rendition `width` and `height` to mean the visible
color-pane dimensions. The compiler derives storage and macroblock sizes. It
does not expose padding arithmetic to authors. The two source schemas are
parsed separately and normalize into one immutable internal project model;
there is no object shape that can be ambiguously accepted as both versions.

## 3. Exact Rendition Geometry

All rectangle arrays remain `[x, y, width, height]`. Define:

```text
even(n)    = n when n is even, otherwise n + 1
align16(n) = the least multiple of 16 greater than or equal to n
Vw, Vh     = visible rendition width and height
Pw, Ph     = even(Vw), even(Vh)
```

`Vw` and `Vh` are positive, at most the logical canvas dimensions, and retain
the canvas pixel-grid aspect exactly:

```text
Vw * canvas.height = Vh * canvas.width
```

This relation concerns source pixels. The manifest's `pixelAspect` affects
display geometry, not encoded scaling.

### 3.1 Opaque AVC

An opaque rendition has:

```text
alphaLayout.type       = "opaque-v0"
alphaLayout.colorRect  = [0, 0, Vw, Vh]
decoded storage rect   = [0, 0, Pw, Ph]
codedWidth             = align16(Pw)
codedHeight            = align16(Ph)
```

The AVC SPS coded dimensions equal `codedWidth` and `codedHeight`. Its crop and
the worker's decoded `VideoFrame.visibleRect` equal the decoded storage rect.
Pixels between the visible color rectangle and storage edge, and all
macroblock padding, are neutral black limited-range pixels. Existing M5 output
is the special case `Vw = Pw = codedWidth` and
`Vh = Ph = codedHeight`.

### 3.2 Stacked packed alpha

A packed rendition has:

```text
alphaLayout.type       = "stacked-v0"
alphaLayout.colorRect  = [0, 0, Vw, Vh]
gutter rect            = [0, Ph, Pw, 8]
alphaLayout.alphaRect  = [0, Ph + 8, Vw, Vh]
decoded storage rect   = [0, 0, Pw, 2 * Ph + 8]
codedWidth             = align16(Pw)
codedHeight            = align16(2 * Ph + 8)
```

The color and alpha rectangles have identical visible dimensions and even
origins. The eight-pixel gutter is fixed, not author configurable. The SPS
crop and `VideoFrame.visibleRect` equal the decoded storage rectangle, which
includes both panes and the gutter but excludes only macroblock padding.

The format validator derives these facts and rejects any alternate rectangle,
gap, overlap, crop, or coded size. The worker independently requires the same
SPS crop. The renderer validates every output frame against this one derived
geometry object before copying pixels.

All production AVC renditions in one manifest must use the same alpha class:
all opaque or all stacked-alpha. A conformance-only `reference-rgba-v0`
rendition may coexist, but an opaque AVC rendition cannot be advertised as a
fallback for a packed-alpha rendition because it cannot preserve equivalent
pixels. This matches the compiler's one asset-wide profile decision and
prevents capability fallback from silently discarding transparency.

### 3.3 Resource meaning

Decoder surfaces, staging buffers, persistent layers, streaming layers, and
manifest decoded-pixel limits are conservatively charged at
`codedWidth * codedHeight * 4`, including packed panes and macroblock padding.
The shader samples only the declared visible rectangles. No budget is based
only on the logical canvas or color rectangle for a packed rendition.

## 4. Source Alpha Policy

Source project 0.2 accepts exactly one of:

```ts
type SourceAvcProfileV02 =
  | "avc-annexb-auto-v0"
  | "avc-annexb-opaque-v0"
  | "avc-annexb-packed-alpha-v0";
```

Its M6-specific shape is:

```ts
interface MotionProjectV02 {
  readonly projectVersion: "0.2";
  readonly profile: SourceAvcProfileV02;
  readonly canvas: CanvasV01;
  readonly frameRate: RationalV01;
  readonly sources: readonly ProjectSourceV01[];
  readonly renditions: readonly {
    readonly id: Id;
    readonly width: number;
    readonly height: number;
    readonly bitrate: BitrateV01;
  }[];
  readonly units: readonly ProjectUnitV01[];
  readonly initialState: Id;
  readonly states: readonly ProjectStateV01[];
  readonly edges: readonly ProjectEdgeV01[];
  readonly bindings: readonly ProjectBindingV01[];
}
```

The referenced graph/source types retain the exact closed M5 meanings. Canvas
dimensions are 1-512. Pixel-aspect terms use the format range and must be a
reduced positive fraction. Source project 0.1 keeps its M5 minimum/16-alignment
and `[1,1]` constraints.

The policy is asset-wide:

- `auto` scans every unique canonical RGBA frame referenced by an animation
  unit or state poster. If every alpha byte is 255, it emits opaque AVC. If any
  alpha byte is below 255, it emits packed alpha.
- explicit `opaque` performs the same complete scan and rejects at the first
  nonopaque canonical pixel with the source, frame, x, and y in structured
  diagnostic context;
- explicit `packed-alpha` always emits the packed profile. A fully opaque
  input succeeds but records a nonfatal size warning.

The selection is made once before rendition encoding. A compiled asset never
switches profile by unit, frame, or rendition. `MediaProbe.hasAlpha` is
advisory and cannot replace the byte scan. Direct-input CLI compilation
defaults to `auto` and exposes an explicit `--alpha auto|opaque|packed`
override. Existing project 0.1 input retains explicit opaque behavior.

Classification occurs after timing normalization and canonical canvas RGBA
materialization. Thus it audits the exact pixels the compiler will use, not
unused source frames or container metadata.

## 5. Compiler Pixel Pipeline

The compiler extends the M5 stages without creating a second compiler:

```text
bounded source decode and timing normalization
                    |
                    v
canonical canvas RGBA spool and complete alpha audit
                    |
          asset-wide profile decision
                    |
                    v
frozen per-rendition RGBA scale to visible Vw x Vh
                    |
        deterministic four-pixel RGB dilation
                    |
                    v
compiler-owned opaque/stacked planar YUV420 packer
                    |
                    v
existing independently decodable libx264 unit encoder
                    |
           strict AVC inspection
                    |
                    v
complete decode-back alpha-quality gate
```

The existing frozen FFmpeg Lanczos RGBA scaling invocation remains the only
rendition scaler. M6 materializes its bounded RGBA result before packing so
alpha and color are evaluated together. The tool fingerprint and exact argv
remain part of compiler provenance.

### 5.1 Four-pixel RGB dilation

Dilation changes hidden color only; it never changes alpha or an RGB sample
whose alpha is nonzero.

For every visible rendition frame:

1. Preserve RGB for all pixels with `A > 0`.
2. Treat RGB at every `A = 0` pixel as zero, ignoring arbitrary hidden source
   color.
3. For each `A = 0` pixel, search source pixels with `A > 0` whose squared
   Euclidean distance is at most 16.
4. Choose the least squared distance. Break a tie by greater source alpha,
   then lower source y, then lower source x.
5. Copy the chosen source RGB and keep destination alpha zero. If there is no
   source within the radius, leave RGB zero.

Every lookup reads the original post-scale frame, not pixels filled earlier in
the pass. The result is therefore traversal-order independent. Search is
confined to the visible rectangle. Even, gutter, and macroblock padding never
become dilation sources or destinations.

### 5.2 Exact BT.709 limited-range conversion

Packing produces planar 8-bit `yuv420p` directly. FFmpeg receives already
packed planes and may not apply another scale, matrix, range, or pixel-format
conversion before libx264.

Let nonlinear 8-bit `R`, `G`, and `B` be integers from 0 through 255 and:

```text
L = 2126 * R + 7152 * G + 722 * B
```

The compiler treats the normalized sRGB bytes as the profile's nonlinear
BT.709 primaries for this fixed matrix; it does not perform an additional
transfer-function conversion. Luma is:

```text
Y = clamp(16, 235, 16 + round(219 * L / (255 * 10000)))
```

For one even-aligned 2x2 color block, let `sum` cover its four pixels:

```text
Cb = clamp(16, 240,
     128 + roundSigned(224 * sum(10000 * B - L) /
                       (4 * 255 * 18556)))

Cr = clamp(16, 240,
     128 + roundSigned(224 * sum(10000 * R - L) /
                       (4 * 255 * 15748)))
```

Positive division rounds to nearest with a half rounded upward.
`roundSigned` applies the same rule to the magnitude and restores the sign, so
negative exact halves round away from zero. All numerators use checked safe
integer arithmetic.

Color-pane pixels outside `[0, 0, Vw, Vh]`, the gutter, and macroblock padding
are `Y=16, Cb=128, Cr=128`. In the alpha pane:

```text
Yalpha = 16 + round(219 * A / 255)
Cb = Cr = 128
```

The alpha pane uses post-scale alpha but not dilated RGB. Pane and gutter
boundaries are even, so no 4:2:0 chroma block crosses between semantic regions.
Opaque encoding uses the same color conversion and neutral padding without an
alpha pane.

### 5.3 Encoder and decoder geometry

Each unit remains an independently decodable low-delay Annex B sequence with
the exact M5 keyframe and dependency rules. A new raw-yuv input owner streams
only the exact unit byte range to FFmpeg. The encoder invocation retains the
M5 `libx264` profile, level, single reference, no B-frames, deterministic
threading, bitrate, color tags, and Annex B output constraints, but omits all
pixel transforms.

The public format AVC inspector remains the only SPS/PPS/slice authority. It
must prove the macroblock coded dimensions, derived storage crop, BT.709
limited-range tags, and stable parameter sets across every unit in a
rendition.

## 6. Alpha Quality Gate

The compiler decodes every emitted unit in every packed rendition back to
tagged BT.709-limited RGBA using the recorded FFmpeg toolchain. It requires the
exact frame count and derived decoded storage geometry, then reads the red
channel in `alphaRect`, exactly as the WebGL shader does.

For each logical alpha sample, error is:

```text
abs(decodedRedByte - canonicalScaledAlphaByte) / 255
```

The 99th percentile is nearest-rank: after sorting `N` byte errors ascending,
use zero-based index `ceil(0.99 * N) - 1`.

Both limits apply independently to every decoded frame and to the aggregate
of every logical alpha sample in the rendition:

```text
mean absolute error <= 2 / 255
99th-percentile absolute error <= 8 / 255
```

One bad frame rejects the rendition even if the aggregate passes. Aggregate
failure also rejects when every individual frame happens to pass. The report
records aggregate values plus the worst frame's rendition, unit, local frame,
mean, and p99. It also records minimum and maximum decoded alpha and the
encoded/decode-back invocation identities.

The compiler additionally reports, but does not accept or reject on, decoded
composite RGB error over frozen black `#000000`, white `#ffffff`, and saturated
magenta `#ff00ff` backgrounds. M6 does not invent a second normative lossy
color threshold. The browser fixture has its own frozen conformance tolerances
for these known pixels: aggregate RGB MAE at most `4/255` and RGB p99 at most
`16/255` on each background. Those fixture limits test the reference shader
and browser conversion; they are not general compiler acceptance criteria.

## 7. Static PNG Profile and Decoder

### 7.1 One strict platform-free grammar owner

`@pixel-point/aval-format` replaces the M4 shallow envelope check with one
restricted RGBA PNG profile owner. It validates in checked order:

- the standard eight-byte signature;
- exactly one first `IHDR`, length 13;
- descriptor-matching canvas dimensions, bit depth 8, color type 6, standard
  compression/filter methods, and no interlace;
- zero or one `sRGB` chunk immediately after `IHDR`, with length 1 and
  rendering intent 0;
- one or more consecutive `IDAT` chunks;
- exactly one empty terminal `IEND`;
- no other critical or ancillary chunk and no bytes after `IEND`;
- at most 256 chunks, at most 2 MiB total PNG bytes, at most 2 MiB in one
  chunk, and a checked bounded sum of IDAT bytes; and
- the CRC-32 of every chunk over its type and payload.

The zlib member formed by concatenated IDAT data must have compression method
8, `CINFO <= 7`, a header divisible by 31, no preset dictionary, at least one
DEFLATE block, and a four-byte Adler-32 trailer. The exact expected inflated
length is:

```text
height * (1 + width * 4)
```

The existing `validatePngEnvelope` public entry point becomes a compatibility
name over this strict implementation; it is not left as an independent
shallow validator.

### 7.2 Native inflate and pure fallback

The browser static decoder first validates the complete PNG/chunk/zlib
envelope itself. If an injected capability probe confirms
`DecompressionStream("deflate")`, it may use that implementation for inflate.
Native success is accepted only after the runtime independently verifies:

- the previously checked zlib method/window/dictionary fields;
- no output beyond the exact expected size and an exact final byte count;
- the trailer Adler-32 against the returned bytes;
- every scanline filter byte; and
- complete stream settlement inside the timeout and abort boundary.

Any native rejection, extra/short output, Adler mismatch, or invalid scanline
is a corrupt PNG failure. It never falls through to the pure inflater. The
fallback is selected only when the capability probe says native deflate is
unavailable before decode starts.

The platform-free pure RFC 1950/1951 inflater supports stored, fixed-Huffman,
and dynamic-Huffman blocks. It validates stored complements, canonical code
trees, repeat codes, end-of-block symbols, reserved symbols and block types,
the 32 KiB window, distances no greater than produced output, exact final
block/padding, exact output length, and Adler-32. All reads and output copies
are pre-bounded. A work counter capped at
`32 * (compressedBytes + expectedInflatedBytes) + 4096` counts bit reads,
decoded symbols, and copied output bytes; exceeding it rejects. No loop can
continue without consuming input, producing bounded output, or failing.

### 7.3 Scanline reconstruction and browser surface

Filter bytes 0 through 4 implement None, Sub, Up, Average with floored mean,
and the PNG Paeth predictor at four bytes per pixel. Any other filter rejects.
Reconstruction uses byte-modulo-256 arithmetic and produces exactly
`width * height * 4` owned bytes.

Only validated RGBA may be passed to `ImageData`/`createImageBitmap`. Raw PNG
bytes are never given to `createImageBitmap`, `<img>`, canvas image loading, or
another browser image parser. The current and one incoming static surface are
the only retained decoded surfaces. Every bitmap and buffer closes or releases
on success, supersession, abort, failure, source replacement, and disposal.

The compiler's canonical PNG encoder may retain its deterministic filter-0,
stored-DEFLATE form, but every emitted PNG is decoded through the same strict
profile during compiler self-validation.

## 8. Static Frame Semantics and Recovery

Every state still references one static frame. An omitted source poster is the
canonical body-entry RGBA frame. An explicit source poster is permitted only
when its canonical canvas RGBA is byte-for-byte equal to that body-entry
frame. A mismatch is a compile error. This preserves a semantic state image
and prevents an authored pose jump when full animation re-enters at body frame
zero. Lossy AVC differences remain measured by the browser conformance proof.

Preparation installs the initial static surface, validates every unique
referenced PNG sequentially, and retains only the current surface. Animated
`interactiveReady` is impossible unless all state statics passed the strict
profile. Static preparation likewise reaches `staticReady` only after all
state statics validate.

On a recoverable worker, decoder, scheduler, upload, WebGL, or underflow
failure, the runtime:

1. freezes logical content time and holds the last valid animated frame;
2. snapshots the newest accepted `requestedState`;
3. decodes/presents that state's strict PNG on the hidden static plane,
   restarting if a newer accepted target supersedes it;
4. atomically covers the animated plane;
5. applies the graph's static recovery effects and settles the surviving
   request; and
6. disposes every animated owner.

The animated plane is never cleared before static coverage. Failure to install
the required PNG retains the last usable visual surface where possible,
terminalizes graph playback, and rejects the surviving request with
`PlaybackFallbackError`.

## 9. One Generalized AVC Runtime

M6 generalizes the M5.5 opaque implementation; it does not add an alpha fork.
Internal `Opaque*` candidate, renderer, layout, backend, and resource names
become profile-neutral `Avc*`/`Frame*` names. Already exported prototype
`Opaque*` names remain only as deprecated type/value aliases that delegate to
the same neutral implementation; private opaque implementations are removed.

The rendition candidate set accepts exact opaque and packed-alpha AVC profile
members. Preference is:

1. descending visible color area `colorRect.width * colorRect.height`;
2. descending peak bitrate; and
3. canonical rendition ID ascending.

Packed coded area is deliberately not the quality key because it includes the
alpha pane. Format validation has already required one AVC alpha class across
the asset, so every candidate in this order preserves the same transparency
semantics.

The existing format inspector, one dedicated worker, decode timeline, sample
factory, path scheduler, presentation ring, interaction-cache plan, readiness
rehearsal, recovery coordinator, and graph/effect/promise owners remain shared.
Every persistent or streaming handle has the same generation rules regardless
of alpha. There is no alpha decoder, secondary clock, alpha ring, or
profile-specific graph behavior.

## 10. WebGL2 Compositor

The frame renderer accepts one immutable derived profile geometry containing
coded size, decoded storage rectangle, color rectangle, optional alpha
rectangle, logical canvas, and persistent layer count. `VideoFrame.copyTo()`
copies its exact decoded visible rectangle into the single coded-size RGBA
staging buffer with coded stride. The backend uploads one coded-size RGBA8
texture-array layer.

One shader program handles both profiles. It maps destination UV to texel
centers inside `colorRect`. For packed alpha it maps the same logical UV to
texel centers inside `alphaRect`, takes the red component, and clamps it to
`[0,1]`. Opaque alpha is exactly one. Output is:

```glsl
vec4(color.rgb * alpha, alpha)
```

The WebGL2 context uses `alpha: true`, `premultipliedAlpha: true`, no depth or
antialiasing, and blending `ONE, ONE_MINUS_SRC_ALPHA`. Texture coordinates
never sample gutter or macroblock padding. Linear filtering is allowed only
inside inset rectangle coordinates, so filtering cannot bleed between panes.
`UNPACK_ALIGNMENT` is one. The renderer keeps the M5.5 upload watchdog,
generation validation, exact-once frame close, context-loss terminalization,
and readback test seam.

## 11. Shared Fit, Pixel Aspect, Resize, and DPR

One pure `PresentationGeometry` function is the authority for both the static
canvas and animated WebGL plane. Its inputs are:

- logical canvas width/height and rational pixel aspect;
- manifest or host-selected `contain|cover|fill|none`;
- finite positive CSS content-box width/height;
- finite positive device pixel ratio; and
- device dimension and remaining runtime-byte caps.

The display aspect is:

```text
(canvas.width * pixelAspect.numerator) /
(canvas.height * pixelAspect.denominator)
```

`contain` chooses the greatest centered uniform destination inside the box.
`cover` fills the box and returns a centered source crop. `fill` uses the whole
source and destination with independent x/y scale. `none` uses the intrinsic
display size in CSS pixels, centers it, and clips overflow. Rounding occurs
only when producing physical backing pixels; geometric ratios remain rational
or double precision until that boundary.

Desired backing dimensions are `ceil(cssSize * DPR)`. A uniform resolution
scale clamps them to WebGL viewport/texture limits, the version-0 coded
dimension ceiling, and the resource plan's remaining bytes. The CSS size and
fit result do not change. A clamp emits a diagnostic with desired and actual
dimensions; it does not change graph state or readiness.

Both overlaid canvases receive the same backing size and destination/source
mapping. A resize, fit change, or DPR change redraws the current frame/static
surface but does not reset, flush, seek, reconfigure, advance logical time, or
change `requestedState`/`visualState`. Repeated equivalent geometry is a no-op.

## 12. Resource Accounting

The M5.5 candidate plan remains the base and adds checked terms for:

```text
largest copied static PNG
+ largest concatenated IDAT/zlib member
+ exact filtered scanline output
+ current and incoming logical RGBA/static bitmap allocations
+ animated canvas backing allocation
+ static canvas backing allocation
```

The unfiltered RGBA buffer is passed to `ImageData` through a zero-copy clamped
view, but browser bitmap creation is not a transferable-buffer API. The plan
therefore charges the RGBA working buffer while the incoming bitmap allocation
is also live. Native and pure working peaks are calculated separately. Native
streaming charges the copied zlib member, the fixed filtered output, and one
browser-returned chunk as simultaneous owners; pure inflate charges filtered
output plus unfiltered RGBA. The larger peak is used. The owned asset bytes
already include the compressed PNG payload and are not counted again except
for the explicit decode-time copy and the validator-owned concatenated zlib
member.

The persistent coded renderer staging buffer remains additive during static
recovery. Transferred encoded samples and decoder-owned `EncodedVideoChunk`
copies are likewise separate windows; submitted metadata never retains the
transferred sample buffer after chunk construction.

Canvas backing allocations use the same conservative GPU rounding as texture
allocations. A static-only baseline plan is admitted before any PNG copy,
decode, bitmap, or animated owner is created. Static and animated resource
leases expose the remaining rounded two-plane budget to the shared presentation
owner. Every resize uniformly clamps before allocation, and releasing an
animated lease restores only the still-live static constraint. Candidate
selection, preparation, reduced-mode entry, and re-entry fail safely to the
already installed static plane when their complete peak cannot fit the
effective per-player cap.

## 13. Reduced-Motion Policy and Re-entry

M6 adds a framework-neutral motion-policy coordinator with public policy
`auto|reduce|full` and an injected current host reduced-motion boolean. The
effective mode is static for explicit `reduce` or for `auto` plus host reduce;
explicit `full` overrides the host signal. M8 later connects the injected
signal to live `matchMedia` and the custom element attribute.

The runtime static-reason union adds `reduced-motion` and replaces
`no-opaque-rendition` with `no-avc-rendition`; every other M5.5 reason keeps its
meaning. The old string is removed rather than accepted as an alternate
runtime value, so no valid packed asset can be described as lacking an opaque
rendition.

### 13.1 Initial reduced preparation

When effective mode is reduced before preparation, the player installs and
validates all static frames but does not create WebGL, a decoder worker, or an
infinite loop. The graph begins static with tracked origin `reduced-motion`.
This origin remains eligible for a later full readiness attempt.

### 13.2 Full to reduced

On an effective full-to-reduced change:

1. stop scheduling new realtime ticks immediately and hold the last drawn
   frame;
2. keep the animated candidate alive while the latest accepted state's hidden
   static surface is prepared;
3. coalesce newer accepted state or policy inputs by generation;
4. atomically cover static pixels and invoke graph static recovery with reason
   `reduced-motion`;
5. settle the newest state through the existing effect/promise ordering; and
6. dispose the animated candidate after coverage.

If policy returns to full before static commit, the in-flight static decode is
aborted and the still-owned animated candidate resumes without a graph mode
round trip. Once static has committed, re-entry uses a fresh candidate.

### 13.3 Reduced to full

Only a tracked reduced-motion static origin may initiate automatic re-entry.
Static mode caused by codec/resource/readiness/animation/PNG failure is sticky
for the installed session and cannot be cleared by toggling policy. A future
explicit retry API is outside M6.

For eligible re-entry:

1. keep current state static pixels visible and graph readiness static;
2. run the normal deterministic candidate order, resource plan, resident
   preparation, all-routes rehearsal, and activation deadline;
3. restage activation if static requests change the committed semantic state
   while preparation is asynchronous;
4. upload and draw the selected first presentation behind the static plane;
5. call the graph's new `resumeAnimated()` operation; and
6. apply its readiness effect and reveal the animated plane atomically.

`resumeAnimated()` is valid only from graph static phase with
`requestedState === visualState`, no active/pending route, and a static
presentation. It changes readiness to animated. A fresh source with no prior
animated content presents its initial-unit frame zero; after that unit has
reached the body, re-entry presents the current state's body frame zero. It
emits no transition, request, or fallback effect, and never replays a consumed
intro.
The graph operation itself is policy-neutral; the host coordinator enforces
the reduced-origin rule.

Failed or superseded re-entry disposes the staged candidate and leaves the
same strict static pixels and state committed. Rapid policy flips use one
serialized, generation-tagged lane; stale static decodes, candidates,
callbacks, and promises cannot reveal or retain resources.

## 14. Errors and Diagnostics

Stable M6 failure context distinguishes:

- invalid packed geometry or decoded crop;
- explicit opaque input containing alpha;
- packed-plane conversion or spool bounds;
- per-frame versus aggregate alpha-quality failure;
- PNG chunk/order/CRC/zlib/DEFLATE/filter/Adler failure;
- native inflate unavailable versus native inflate corrupt;
- static surface creation or presentation failure;
- compositor allocation, shader, upload, or context loss;
- backing-resolution clamp;
- reduced-motion entry/re-entry supersession; and
- sticky animation failure refusing automatic re-entry.

Untrusted identifiers remain bounded structured context. Raw tool stderr,
paths, PNG text, and browser exception messages are not copied into public
diagnostics. Abort and disposal retain their existing `AbortError` semantics.

## 15. Verification and Conformance Assets

M6 adds deterministic checked-in fixtures for:

- an opaque odd-visible-dimension rendition;
- a packed-alpha loop with transparent, semitransparent, and opaque pixels;
- a packed-alpha all-routes graph exercising resident, cut, locked, loop,
  finite, and held paths through the M5.5 scheduler;
- shared and distinct per-state strict PNGs;
- stored, fixed, and dynamic DEFLATE PNGs using filters 0 through 4; and
- malformed PNG, packed geometry, SPS crop, alpha-quality, and resource cases.

The real browser proof uses the public browser composition with no fake
renderer or worker. It asserts:

- exact packed decoded/copy/upload geometry;
- the same all-route ordering and cadence gates as M5.5;
- alpha readback error within the normative per-frame and aggregate limits;
- composite RGB MAE `<=4/255` and p99 `<=16/255` independently over black,
  white, and magenta fixture backgrounds;
- no pane/gutter bleed at transparent edges;
- contain, cover, fill, none, odd sizes, resize, and DPR changes on both planes;
- unsupported codec/WebGL/worker and injected runtime failure select the
  newest state's strict static surface;
- reduce-before-prepare creates no animated resources;
- full-to-reduced, precommit cancellation, reduced-to-full re-entry, rapid
  policy flips, and sticky failure-origin static behavior;
- first animated re-entry honors an unconsumed intro, while later re-entry
  begins at current body frame zero and never replays it; and
- exact cleanup of frames, workers, GL objects, bitmaps, decode buffers,
  callbacks, timers, and request promises.

Mutation/property tests cover every byte boundary, chunk length, CRC, zlib and
Huffman tree, back-reference, filter byte, geometry product, shader rectangle,
policy generation, and resize arithmetic. The proof records exact fixture and
toolchain digests and makes no unsupported browser/device certification claim.

## 16. Non-goals

M6 does not add:

- a second media decoder or native-alpha codec;
- per-unit alpha policy;
- arbitrary packed layouts, configurable gutters, HDR, wide gamut, or color
  profiles other than the frozen sRGB/BT.709 contract;
- a general-purpose PNG/APNG decoder or acceptance of metadata chunks;
- crossfades between mismatched posters and body entries;
- animated reduced-motion units;
- automatic retry after animation failure;
- URL loading, range requests, entity validation, or SHA-256 enforcement;
- page-wide eviction or decoder sharing;
- the custom element, DOM event bindings, or automatic media-query listeners;
  or
- named-device performance certification.
