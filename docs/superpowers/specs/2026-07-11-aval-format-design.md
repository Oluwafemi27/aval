# AVAL Format Design

**Date:** 2026-07-11

**Status:** Proposed design awaiting user review

**Product name:** Intentionally undecided

## 1. Summary

This project defines and implements an open, web-only format for short, pre-rendered UI animations with user-defined visual states, seamless partial loops, and deterministic transitions.

The compiled asset is not an ordinary video with timestamps attached. It is a frame-addressable motion graph. Its media payload is divided into independently decodable animation units, while its manifest defines states, transition edges, loop behavior, readiness requirements, and interruption rules. A dedicated WebCodecs player decodes future frames into a rolling queue and presents them on one monotonic clock. It never seeks, flushes, or restarts the decoder at an authored loop or transition boundary.

The first implementation proves the playback contract in web browsers. It includes the format, compiler, reference player, custom element, conformance fixtures, and an interactive stress-test demo. Animated performance is initially certified only on named desktop profiles. Mobile and unlisted desktop browsers may animate when they pass the same runtime readiness checks, but that result is explicitly labeled best-effort; the per-state static fallback is the only guaranteed mobile behavior until mobile profiles are certified. A visual authoring application, native runtimes, marketplace, and custom pixel codec are explicitly outside this implementation cycle.

Documentation calls the output an **AVAL asset** and uses `.avl` as its public extension.

## 2. Product Promise

After the player reports `interactiveReady`, a conforming asset running visibly inside the workload and power conditions of a named, certified browser/device profile provides:

1. No deliberate seek, reconfiguration, or boundary-time drain at an authored loop or transition boundary.
2. No blank, uninitialized, or accidentally duplicated boundary frame.
3. Deterministic latest-request-wins behavior under rapid input.
4. Next-eligible-frame reversal while a resident short reversible unit is visibly active; entry from a stable body still follows its declared portal or finish policy.
5. Bounded transitions through author-declared handoff portals for other exact transitions.
6. Static fallback behavior when the required codec or performance profile is unavailable.

An unexpected browser, compositor, device, or operating-system stall can still miss a deadline. The runtime holds the last valid frame, emits `underflow`, and withdraws the smooth-session claim for that run instead of concealing the failure. The promise is therefore testable and bounded, not a hard-real-time claim about arbitrary host conditions.

This promise separates two concepts:

- **Presentation continuity** is an architectural guarantee against deliberate boundary-time discontinuities and a measured certification against missed display deadlines on a named device profile.
- **Visual continuity** is an asset property: poses and motion must match across a seam or be joined by an authored bridge.

The player cannot turn unrelated rendered frames into exact natural motion. The compiler validates visual seams and labels every transition's guarantee class; it never silently markets a hard cut or synthetic blend as exact.

## 3. Goals

- Import pre-rendered RGBA motion without requiring creators to rebuild it as vectors.
- Support arbitrary user-defined state names.
- Support exact loop subranges with intro, loop body, and exit motion.
- Support pointer, focus, activation, visibility, and application-controlled state changes.
- Preserve smooth playback by scheduling decoded frames rather than seeking a media cursor.
- Use browser-provided codecs through WebCodecs instead of shipping a mandatory WASM decoder.
- Package behavior, media, poster, fallback, and integrity metadata into one range-readable file.
- Keep the state machine deterministic, inspectable, and free of executable code.
- Make correctness measurable through an open conformance suite.

## 4. Non-goals for the First Implementation

- Native iOS, Android, React Native, Flutter, desktop, or game-engine runtimes.
- Animated mobile-web certification in the first milestone; mobile animation may run best-effort, with a guaranteed static web fallback.
- A visual timeline or graph editor.
- A marketplace, CDN, cloud encoder, collaboration, or analytics service.
- A new pixel-compression codec.
- Audio, captions, or lip synchronization.
- Runtime text, image substitution, recoloring, shaders supplied by assets, or nested compositions.
- Arbitrary scripts, network requests, DOM selectors, navigation, or business logic inside assets.
- Automatic exact transitions between unrelated arbitrary frames.
- Per-pixel or animated hit regions.
- Support for unlimited simultaneous animated assets.

### 4.1 Version 0 resource envelope

Version 0 intentionally targets compact UI motion:

- maximum logical canvas: 512×512 pixels;
- maximum coded dimension: 2,048 pixels and maximum coded area: 1,100,000 pixels;
- maximum frame rate: 60 frames per second;
- constant frame rate only;
- maximum unique advancing frames across all units: 900;
- maximum compiled file: 32 MiB, with a 4 MiB authoring target;
- maximum manifest: 1 MiB;
- maximum access-unit index: 4 MiB;
- maximum encoded chunk: 2 MiB;
- maximum states: 32;
- maximum edges: 64;
- maximum units: 96;
- maximum renditions and capability probes: 4;
- maximum static PNG blobs: 32;
- maximum input bindings: 32;
- maximum total declared blobs: 128;
- maximum portals in one unit: 16;
- identifiers must match `^[a-z][a-z0-9._-]{0,63}$`;
- maximum per-player tracked working set, including encoded caches, decoded surfaces, staging buffers, and GPU allocations: 64 MiB;
- maximum resident reversible bridge: 24 frames and 24 MiB, whichever limit is reached first;
- reversible endpoint restart runways: 6–12 frames per endpoint, with a maximum 48 MiB total resident cache for one reversible edge;
- maximum persistent interaction-cache layers per player: 128 after deduplicating reversible frames, body-port runways, and cut-target runways;
- maximum active decoders per player: one; and
- default page-wide budget: two active decoders and 192 MiB of tracked motion memory.

The original combined element/worker target below 75 KiB gzip was later recorded as a miss. The approved delivery gates measure the source-free bootstrap below 75 KiB, the complete loaded element/player graph at no more than 250 KiB, and the worker at no more than 20 KiB. There is no mandatory WASM. `visualReady` within 50 ms from warm-cache bytes being available and animated `interactiveReady` within 250 ms remain certification targets for a 256×256 60 fps reference asset on qualified devices, not implementation-checkpoint results. Cold-network time is reported separately.

Hosts may lower these limits. Raising them requires an explicit runtime policy and removes reference-profile certification.

### 4.2 Provisional licensing

Before accepting external contributions, the repository will use:

- Apache-2.0 for code and machine-readable conformance fixtures;
- CC BY 4.0 for prose specification text; and
- Developer Certificate of Origin sign-off for contributions.

This does not constitute a codec-patent grant. A standards-specific royalty-free patent policy requires legal review before the format is presented as a neutral industry standard.

## 5. Why Ordinary Video Is Insufficient

An `HTMLVideoElement` owns an opaque media cursor. Assigning `currentTime` initiates an asynchronous seek that may lower readiness, locate an earlier random-access frame, decode dependency frames, and refill browser presentation buffers. Native looping can restart the same path. `requestVideoFrameCallback()` can observe presentation but cannot remove seek behavior.

The precision player therefore does not use `HTMLVideoElement.currentTime` for authored interactions. It consumes indexed encoded access units with WebCodecs, maintains decoded frames ahead of the display clock, and submits the next loop iteration early enough that its first frame is decoded before the current iteration reaches its final displayed frame.

## 6. Conceptual Model

### 6.1 States

State identifiers are creator-defined portable identifiers, such as `idle`, `hovered`, `loading`, `success`, or `error`, and follow the version 0 identifier pattern.

A state points to a stable body:

- a looping animation unit;
- a one-shot animation unit followed by a held frame; or
- a held frame with no advancing motion.

Looping bodies wrap forever. Finite bodies advance once through frames `[0, frameCount)` and then hold frame `frameCount - 1`. A held body is the finite one-frame case. These body kinds have different portal-distance rules; finite bodies never wrap merely to satisfy a transition.

The initial state may also name one finite `initialUnit` that plays once before its body. This supports an imported intro followed by a partial loop without placing the intro inside the loop's dependency chain.

Every compiled state also references a required static PNG frame. A source project may omit it, in which case the compiler derives it from the body's canonical entry frame. Static and reduced-motion playback therefore represent the requested semantic state instead of showing one global idle poster.

The runtime exposes `requestedState`, `visualState`, and `isTransitioning`. `requestedState` is the newest accepted destination. `visualState` is the semantic state represented by the currently displayed stable body or static frame; during an intro it remains the initial state, and during a bridge it remains the source until the target entry frame is drawn. `isTransitioning` is true whenever an edge is waiting or playing, or `requestedState !== visualState`. A request is settled only when its target is visually committed and no edge for that request remains; equality with the old `visualState` during an in-progress reversal does not settle it.

### 6.2 Animation units

An animation unit is a sequential, independently decodable sequence of frames. Unit types are:

- `body`: stable state motion, optionally looping;
- `bridge`: authored motion between two state ports;
- `reversible`: a short interaction clip intended for immediate forward/reverse response;
- `oneShot`: finite motion that holds its last frame or routes onward;
- `poster`: a static fallback frame.

Every advancing unit uses a half-open range `[start, end)`. The frame at `end` is not displayed as part of that unit. This prevents the common duplicate-first-frame pause at loop seams.

A body unit can declare named **ports**. A port contains one or more `portalFrames` at which its pose is safe to leave and one canonical `entryFrame` at which incoming motion joins the body. Version 0 requires every body `entryFrame` to be zero so the continuation begins at the unit's independent key frame. Multiple portal frames may share a port only when the author declares that they match the same bridge pose and the compiler checks every corresponding seam.

### 6.3 Edges own transitions

Transitions belong to graph edges rather than generic state entry or exit fields. The correct route from `loading` to `success` can differ from `loading` to `error`.

Each edge declares:

- source state and optional source port;
- target state and target port;
- triggering event or host state request;
- transition unit, if any;
- start policy;
- continuity class; and
- maximum response wait in frames when bounded.

Version 0 has no guards, expression language, or implicit pathfinding. At most one edge may connect a given `(fromState, toState)` pair, and at most one edge may use a given `(fromState, eventName)` trigger. Ambiguous duplicates are rejected. In a stable state, `setState(target)` and event bindings select one unique direct edge from that state. While an edge is pending or active, inverse intent is also resolved against that edge's prospective target as detailed in Section 6.5; this is what lets `hover.leave` cancel or reverse an `idle → hovered` edge before `hovered` becomes `visualState`. Manifest order is not used to hide ambiguity.

### 6.4 Start policies

The first implementation supports:

- `portal`: continue to the next declared safe marker, then play the bridge;
- `finish`: finish a finite active unit, then transition; invalid for an infinite looping body;
- `cut`: change on the next eligible content frame using a resident target-entry runway, without a visual-continuity guarantee.

For `portal`, the selected source `portalFrame` is the final displayed source-body frame. On the next content-frame tick, the bridge owns and displays frame zero. The bridge owns every frame in `[0, frameCount)`; its last frame is followed on the next tick by the target body's frame-zero `entryFrame`. With no bridge, the target entry frame directly follows the source portal frame. A `finish` edge uses the finite unit's final frame in place of the portal frame. A `cut` uses the last source frame that was actually displayed. The compiler checks source-boundary → bridge-frame-zero and bridge-final → target-entry seams independently, or source-boundary → target-entry when no bridge exists. It also detects identical repeated endpoint images so an author cannot accidentally buy a one-frame pause with a duplicated seam frame.

On a looping body, portal search is circular. On a finite body, it searches only forward and every port used by an outgoing portal edge must include the held final frame, guaranteeing a reachable boundary from every phase. If that body is already held, the final-frame portal remains displayed while the target sequence is prepared; the edge begins only when its consecutive-lead requirement is ready, and that measured preparation delay counts against `maxWaitFrames`. `finish` similarly waits through the remaining finite frames while the body advances, then may continue holding the final frame while preparation completes. On a one-frame held body, both a valid portal and `finish` use the current frame as their boundary and include this bounded preparation wait. None of these policies replays a finite body from frame zero.

Every `cut` target port has a persistent decoded 6–12-frame entry runway, shared by all cuts to that port. On a cut request, the next eligible tick displays target frame zero from that cache, marks the target as the visual state, and discards obsolete decoder output by generation while the sole decoder prepares the target continuation. Animated readiness fails if measured decoder recovery cannot finish before the runway ends or the persistent cache exceeds its limits. Thus a cut is immediate in time but explicitly unverified in pose/velocity continuity; it is never mislabeled as a seamless visual transition.

An edge may play a resident reversible unit in `forward` or `reverse` direction. When the inverse edge is requested while that unit is already active, latest-wins changes direction on the next eligible presentation frame. When requested from a stable state body, the edge still observes its declared `portal` or `finish` start policy before playing the unit.

Every certified reversible edge also retains a 6–12-frame decoded restart runway for the exact source and target body ports. A runway begins at that port's canonical `entryFrame` and follows body order, wrapping a loop when necessary. Forward completion presents the target runway while the decoder prepares its continuation; reversal presents the source runway. `interactiveReady` measures decoder recovery against both runways and refuses animated certification if either runway is insufficient within the memory cap.

Crossfades and optical-flow transitions are deferred. They can be future best-effort strategies but must never receive the same certification as authored exact motion.

All non-reversible bridges are locked in version 0: their visible frames finish in order. Latest-wins can replace the pending destination that follows the bridge, but cannot splice an un-authored interruption into it.

### 6.5 Rapid inputs

`latest-wins` is the mandatory default:

- A new request replaces any pending transition that has not started.
- While waiting for a portal, only the newest destination remains pending.
- If an active reversible edge is asked to return to its source, it reverses immediately.
- A locked bridge finishes, then routes toward the newest requested state.
- Stale intermediate state requests are not replayed.

Host requests and automatic events receive monotonically increasing sequence numbers. At each presentation boundary the graph processes queued requests in sequence order, coalesces them to the newest valid destination, and performs at most 64 routing operations. Zero-duration cycles, unreachable unit references, and routes that can exceed that bound are rejected at compile time.

While an edge is merely waiting for a portal, either `setState(source)` or the event carried by its declared inverse edge cancels the pending edge, supersedes its destination promise, and resolves as a no-op at the already displayed source. This special inverse lookup occurs before normal lookup from `visualState`. Once a reversible edge is visibly active, the same two forms of inverse intent use its declared inverse and reverse immediately. A non-inverse request during that clip is queued after its prospective target only when a direct edge exists from that target to the new destination. While a locked bridge is visibly active, requesting its own target cancels any later follow-on and waits for that bridge to finish; inverse intent or any other destination is accepted only when a direct edge exists from the locked bridge's target to the new target, and is queued after the bridge. Every other request rejects without changing `requestedState`.

During a bridge, `visualState` remains the source state. It changes to the target when the first target-body frame is presented. A finite one-shot either holds its last frame or names an explicit completion edge; it never chooses an implicit onward route.

### 6.6 State lifecycle and request settlement

The phase rules are normative:

| Phase | Exposed state | Request behavior | Completion behavior |
|---|---|---|---|
| Before `metadataReady` | State names are unknown. | `setState()` rejects `NotReadyError`; `send()` and `readyFor()` return `false`. | No transition events fire. |
| Preparing with a static frame | `visualState` is the displayed initial static state; `requestedState` is the newest valid queued destination. | Valid direct requests are coalesced without starting motion. | If preparation becomes static, the newest target static frame is committed; if animated, it becomes the first prepared route. |
| Playing `initialUnit` | `visualState` remains the initial state. `isTransitioning` is false while that is also the request. | The intro is locked. A different valid destination sets `isTransitioning` and queues latest-wins; another request for the initial state is an immediate semantic no-op. | The intro has no transition events. It joins exactly into initial body frame zero, then any queued edge starts. A request accepted before animated playback begins remains queued and never suppresses the intro. |

The last rule applies while animated preparation is pending. If the runtime is
already in static mode, an explicit noninitial state commit atomically presents
that state and waives an otherwise pending intro. Visibility-driven automatic
inputs are gated until the animated activation lane is eligible, so ordinary
page-load hover cannot trigger this explicit bypass.
| Stable body or static mode | `requestedState === visualState`; `isTransitioning` is false. | Requesting the same state resolves in the next microtask. A valid direct edge begins or queues according to its policy. | No-op requests emit no state or transition events. |
| Waiting at a portal or playing a bridge | `requestedState` is the latest accepted destination; `visualState` remains the last committed state; `isTransitioning` is true. | Duplicate destination requests join the same completion. A different valid request supersedes pending work, reverses a reversible edge, or waits behind a locked bridge as defined in Section 6.5. | Superseded promises reject `AbortError`. The surviving promise remains pending until its target is committed. |
| Locked bridge reaches an intermediate target | `visualState` changes to that intermediate state. `requestedState` may already name a later destination. | The validated follow-on direct edge becomes eligible. | The intermediate edge emits its own end event, but only a request whose destination is that state settles. |
| Recoverable animation failure | The last frame is held until a validated PNG is ready. | Decoder resources close and the player enters static mode. The newest already-accepted destination is committed directly; this is recovery of a validated route, not new pathfinding. | In-flight requests whose target is committed resolve normally. `readinesschange` to static and `fallback` precede the usual visual-state/end events. |
| Source replacement, abort, disposal, or unusable static fallback | The old instance no longer progresses. | Work and resources are cancelled. | Pending promises reject `AbortError`, or `PlaybackFallbackError` when the requested static frame itself cannot be installed. |

For an accepted animated request, event order is: update `requestedState`, dispatch `requestedstatechange`, set `isTransitioning`, then dispatch `transitionstart` when the edge actually begins. On the content tick that draws the target entry frame, the player updates `visualState`, dispatches `visualstatechange`, recomputes `isTransitioning`, dispatches `transitionend`, and settles the surviving promise in the following microtask. Static-mode changes use the same order, with `transitionstart` immediately before drawing the target PNG. State getters already contain their new values while the corresponding event listener runs.

### 6.7 Complete graph example

The following source-project example is the normative shape of the version 0 graph fields. The compiler replaces source blob identifiers with validated compiled blob descriptors. Arrays are used for stable serialization, but identifiers are loaded into `Map` instances rather than ordinary JavaScript objects.

```json
{
  "formatVersion": "0.1",
  "generator": "reference-compiler/0.1",
  "canvas": {
    "width": 256,
    "height": 256,
    "fit": "contain",
    "pixelAspect": [1, 1],
    "colorSpace": "srgb"
  },
  "frameRate": { "numerator": 60, "denominator": 1 },
  "sources": [
    {
      "id": "favorite-render",
      "type": "png-sequence",
      "path": "renders/favorite-%04d.png",
      "firstFileNumber": 0
    }
  ],
  "initialState": "idle",
  "renditions": [
    {
      "id": "avc-packed-alpha",
      "codec": "avc1.42E020",
      "profile": "avc-annexb-packed-alpha-v0",
      "codedWidth": 256,
      "codedHeight": 528,
      "alphaLayout": {
        "type": "stacked-v0",
        "colorRect": [0, 0, 256, 256],
        "alphaRect": [0, 264, 256, 256]
      },
      "bitrate": { "average": 1200000, "peak": 2400000 },
      "capabilities": { "webCodecs": true, "webgl2": true }
    }
  ],
  "staticFrames": [
    {
      "id": "idle-static",
      "source": { "sourceId": "favorite-render", "frame": 0 }
    },
    {
      "id": "hover-static",
      "source": { "sourceId": "favorite-render", "frame": 78 }
    }
  ],
  "units": [
    {
      "id": "idle-body",
      "kind": "body",
      "source": { "sourceId": "favorite-render", "startFrame": 0, "endFrame": 60 },
      "frameCount": 60,
      "loop": { "startFrame": 0, "endFrame": 60 },
      "ports": [
        { "id": "idle-handoff", "entryFrame": 0, "portalFrames": [0, 15, 30, 45] }
      ]
    },
    {
      "id": "idle-hover",
      "kind": "reversible",
      "source": { "sourceId": "favorite-render", "startFrame": 60, "endFrame": 78 },
      "frameCount": 18,
      "residency": "required"
    },
    {
      "id": "hover-body",
      "kind": "body",
      "source": { "sourceId": "favorite-render", "startFrame": 78, "endFrame": 123 },
      "frameCount": 45,
      "loop": { "startFrame": 0, "endFrame": 45 },
      "ports": [
        { "id": "hover-handoff", "entryFrame": 0, "portalFrames": [0, 15, 30] }
      ]
    }
  ],
  "states": [
    { "id": "idle", "bodyUnit": "idle-body", "staticFrame": "idle-static" },
    { "id": "hovered", "bodyUnit": "hover-body", "staticFrame": "hover-static" }
  ],
  "edges": [
    {
      "id": "idle-to-hover",
      "from": "idle",
      "to": "hovered",
      "fromPort": "idle-handoff",
      "toPort": "hover-handoff",
      "trigger": { "type": "event", "name": "hover.enter" },
      "start": { "type": "portal", "maxWaitFrames": 15 },
      "unit": "idle-hover",
      "continuity": "exact-authored"
    },
    {
      "id": "hover-to-idle",
      "from": "hovered",
      "to": "idle",
      "fromPort": "hover-handoff",
      "toPort": "idle-handoff",
      "trigger": { "type": "event", "name": "hover.leave" },
      "start": { "type": "portal", "maxWaitFrames": 15 },
      "unit": "idle-hover",
      "direction": "reverse",
      "reverseOf": "idle-to-hover",
      "continuity": "exact-reverse"
    }
  ],
  "bindings": [
    { "source": "engagement.on", "event": "hover.enter" },
    { "source": "engagement.off", "event": "hover.leave" }
  ],
  "readiness": { "policy": "all-routes" },
  "fallback": {
    "unsupported": "per-state-static",
    "reducedMotion": "per-state-static"
  },
  "limits": {
    "maxCompiledBytes": 33554432,
    "maxRuntimeBytes": 67108864
  }
}
```

`setState(target)` may use the same edge even when it also declares an automatic event trigger. Static mode validates the same direct edge, then swaps the target static frame and updates both state properties synchronously; portal timing does not delay a non-animated fallback.

In the compiled manifest, every unit source range is replaced by a `samples` array containing `{ rendition, sampleStart, sampleCount, sha256 }`, and each static frame is replaced by `{ offset, length, width, height, sha256 }`. Reversible units additionally name the source-port and target-port decoded runway requirements that preparation must satisfy. Those offsets follow the canonical blob ordering in Section 7.2. Source paths never appear in a compiled asset. Exact source-project and compiled-manifest JSON Schemas are versioned implementation artifacts generated from one set of TypeScript schema definitions; examples are not accepted as a substitute for schema validation.

### 6.8 Graph validation rules

- All IDs are unique within and across their referenced namespace.
- Every compiled state has exactly one valid body unit and one static frame; an omitted source static frame is generated from the body's canonical entry frame.
- Every edge references existing source and target states.
- Event names and IDs use the version 0 identifier pattern.
- Frame counts are positive integers.
- Loop ranges satisfy `0 <= startFrame < endFrame <= frameCount`.
- In a compiled asset, every looping unit satisfies `startFrame = 0` and `endFrame = frameCount`, and frame zero is a key chunk. A source-project partial range is compiled into separate intro, closed loop, and outgoing bridge units.
- Port IDs are unique inside a body. Their `portalFrames` are sorted, unique integer frame indices inside the unit, and each version 0 `entryFrame` is zero.
- A portal edge names one port on its source body and one on its target body. For a loop, `maxWaitFrames` equals or exceeds the greatest circular distance from any source-body frame to a portal frame in that source port. For a finite body, portal frames are searched without wrapping, the port contains its held final frame, and `maxWaitFrames` covers the greatest forward distance. The compiler verifies these geometric lower bounds and every declared source/bridge/target seam; `interactiveReady` additionally verifies the device-dependent decode-lead bound in Section 9.5.
- An edge with `reverseOf` references one reversible edge, uses the same resident unit in the opposite direction, and declares its own valid start policy for transitions beginning from the stable target body.
- A `finish` edge cannot originate from an infinite loop; on a finite body its `maxWaitFrames` covers the greatest remaining distance to the held final frame.
- A `cut` has no bridge unit, must declare continuity `cut`, `maxWaitFrames: 1`, name a target port, and have a resident target-entry runway that passes decoder-recovery measurement.
- A frame-rate numerator and denominator are positive safe integers, the denominator is at most 1,001, and their quotient is at most 60.
- All advancing units in one asset share the same rational frame rate in version 0.
- An `initialUnit` is finite, belongs only to the initial state, and has a compiler-validated final-frame → body-frame-zero seam.

## 7. Compiled File Layout

The `.avl` prototype file is a front-indexed binary container, not ZIP and not MP4.

```text
fixed header
UTF-8 manifest JSON
fixed-record access-unit index
aligned encoded payload blobs
PNG static-frame payloads
```

All fixed-width integers are little-endian. The prototype header is 64 bytes:

| Offset | Field | Type |
|---:|---|---|
| 0 | Magic `AVLF\r\n\x1a\n` | 8 bytes |
| 8 | Format major version | `uint16` |
| 10 | Format minor version | `uint16` |
| 12 | Header length, initially `64` | `uint32` |
| 16 | Required-feature flags | `uint32` |
| 20 | Reserved, must be zero | `uint32` |
| 24 | Declared total file length | `uint64` |
| 32 | Manifest offset | `uint64` |
| 40 | Manifest byte length | `uint64` |
| 48 | Access-unit index offset | `uint64` |
| 56 | Access-unit index byte length | `uint64` |

The web parser rejects any value above `Number.MAX_SAFE_INTEGER` even though the container fields are 64-bit. Version 0 assets are also subject to the much smaller resource limits declared by the reference player.

For canonical version 0 files, required-feature flags are exactly zero, `manifestOffset` equals `headerLength`, and `indexOffset` is the next eight-byte boundary after the manifest. Version 0 record size is exactly 32; other sizes are rejected. Payload unit blobs are ordered by rendition index and then unit index. The first access unit of each unit blob is eight-byte aligned; later access units in that unit are contiguous with no padding and need not be aligned. Zero padding between unit blobs aligns the next unit. Static PNG blobs follow video unit blobs in `staticFrames` array order, including shared frames only once, and every PNG blob starts at an eight-byte boundary. The declared file length ends with the final declared blob. Nonzero padding, gaps outside these canonical alignment positions, overlaps, aliases, or trailing bytes are rejected.

The manifest and access-unit index appear before media payloads so a player can discover the graph and request only required byte ranges. If a server does not support HTTP Range, the loader may fetch the complete file within the hard byte cap.

All offsets and lengths are unsigned integers validated against the declared and actual file size. Alignment applies only to the start of each video unit blob and each PNG blob; access units after a unit's first sample remain byte-contiguous. Each unit blob and PNG blob has a SHA-256 digest. Video payload bytes are already compressed and receive no second archive-compression layer.

### 7.1 Manifest sections

The manifest contains:

- `formatVersion`;
- `generator`;
- `canvas`: logical width, height, pixel aspect, fit, and color metadata;
- `frameRate`: a constant rational rate with positive integer numerator and denominator and an effective rate no greater than 60 fps;
- `renditions`: codec, dimensions, alpha layout, bitrate, and capability requirements;
- `units`: unit type, integer frame count, named ports with portal and entry frames, loop policy, and per-rendition sample ranges;
- `staticFrames`: required per-state PNG blob offsets, lengths, dimensions, and internal-consistency hashes;
- `initialState`: the state requested after preparation unless the host overrides it before `interactiveReady`;
- `states`: arbitrary state identifiers and their body units;
- `edges`: ordered transition definitions;
- `bindings`: portable interaction-to-event defaults;
- `readiness`: bootstrap units and immediate-edge working set;
- `fallback`: unsupported and reduced-motion policies; and
- `limits`: declared decoded-pixel and memory estimates.

Unknown optional minor-version fields are ignored. Unknown required features cause rejection. Major-version mismatches cause rejection. UTF-8 decoding is fatal, duplicate JSON keys are rejected, and all identifiers must match the version 0 ASCII pattern.

### 7.2 Access-unit tables

The access-unit index begins with a 16-byte header:

| Offset | Field | Type |
|---:|---|---|
| 0 | Magic `AVLI` | 4 bytes |
| 4 | Record size, initially `32` | `uint16` |
| 6 | Reserved, must be zero | `uint16` |
| 8 | Sample count | `uint32` |
| 12 | Reserved, must be zero | `uint32` |

Every following 32-byte sample record contains:

| Offset | Field | Type |
|---:|---|---|
| 0 | Absolute payload byte offset | `uint64` |
| 8 | Payload byte length | `uint32` |
| 12 | Unit array index | `uint32` |
| 16 | Rendition array index | `uint16` |
| 18 | Flags: bit 0 is `key`; all other version 0 bits are zero | `uint16` |
| 20 | Unit-local frame index | `uint32` |
| 24 | Reserved, must be zero | 8 bytes |

Records are sorted by rendition index, unit index, then unit-local frame index. Each rendition/unit pair must contain exactly one record for every frame from zero through `frameCount - 1`. Payload ranges cannot overlap or alias. The manifest stores one SHA-256 internal-consistency digest for the concatenated access-unit bytes of each rendition/unit pair and separate descriptors for PNG static blobs.

The player converts each record into one `EncodedVideoChunk`. WebCodecs uses integer microseconds, while the format preserves the original rational frame clock. For virtual frame number `n`, the chunk timestamp is:

```text
round(n × 1,000,000 × frameRate.denominator / frameRate.numerator)
```

Its duration is the next timestamp minus the current timestamp. The scheduler carries the exact rational frame number, not accumulated rounded microseconds, so rates such as 60 fps do not drift. Encoded timestamps must be strictly increasing. Repeated loop iterations reuse the same compressed bytes with later virtual frame numbers.

## 8. Media Profile

### 8.1 Initial codec profile

The first compressed profile uses the fully qualified codec string `avc1.42E020` (Constrained Baseline, level 3.2) and AVC/H.264 Annex B access units. `VideoDecoderConfig.description` is absent. Runtime support is always confirmed with `VideoDecoder.isConfigSupported()`; the specification never assumes a codec is present merely from browser identity.

The initial encoder profile is:

- silent video;
- constant frame rate;
- 8-bit output;
- `VideoDecoderConfig.optimizeForLatency: true`;
- exactly one primary coded picture per `EncodedVideoChunk`;
- low-delay I/P-only coding with at most one reference picture;
- a closed GOP per independently decodable unit;
- no reference frames crossing unit boundaries;
- an IDR frame at frame zero of every unit;
- every `key` Annex B chunk contains that IDR plus all required SPS and PPS parameter sets;
- stable coded dimensions, cropping, profile, level, parameter sets, and color configuration across all units in one rendition;
- no B-frames, reordering, open GOPs, incompatible parameter changes, or cross-unit references; and
- no boundary-time decoder flush on the presentation-critical path.

Every rendition also satisfies AVC Level 3.2 limits independently of the general container envelope:

```text
macroblocksPerFrame = ceil(codedWidth / 16) × ceil(codedHeight / 16) <= 5120
macroblocksPerFrame × effectiveFrameRate <= 216000
max_num_ref_frames = 1
max_dec_frame_buffering <= min(4, floor(20480 / macroblocksPerFrame))
average and peak bitrate <= 8,000,000 bits/second
VBV/CPB buffer <= 8,000,000 bits
```

The only permitted version 0 Annex B NAL unit types are access-unit delimiter, SPS, PPS, IDR slice, and non-IDR slice. All others are rejected before WebCodecs. If a future rendition needs a different AVC level, it uses a different fully qualified codec string and profile specification rather than weakening these rules.

The compiler parses the emitted SPS, PPS, access-unit delimiters, picture types, and reference behavior and rejects output that violates this profile; manifest flags are not trusted as proof. A finite terminal one-shot with no sequential successor is flushed immediately after full submission while its already decoded frames provide presentation lead; that drain must finish before the final frame deadline. A bridge or finite unit with a sequential successor is followed directly by the successor's key chunk and is not flushed between units. Loops are continuously submitted and are not flushed at their seams.

In version 0, reverse playback is valid only for a short reversible unit whose complete decoded frame set fits both the 24-frame and 24 MiB bridge caps and is resident before the edge is certified ready. Its two port-specific endpoint runways must also fit the 48 MiB edge-cache cap. Cut-target runways use the same persistent-cache mechanism and share layers with matching body-port runways.

During preparation, the reference renderer calls `VideoFrame.copyTo()` into one bounded RGBA staging buffer, uploads each packed coded frame into an `RGBA8` WebGL2 texture-array layer, reuses the staging buffer, and closes the source frame. Shared body-port runway frames reuse one layer. Reversal and cut presentation select persistent layers by index; neither asks the codec to decode backward nor depends on an already closed frame. `MAX_ARRAY_TEXTURE_LAYERS`, logical `codedWidth × codedHeight × 4 × layerCount` bytes, the staging buffer, a conservative 25% GPU-allocation overhead, and upload latency are checked before readiness; allocation failure still causes fallback because browser GPU memory is not directly observable. If persistent clip or runway residency cannot be established inside the layer, per-player, and page-wide budgets, the asset enters static mode.

The implementation must isolate the codec adapter. VP9, AV1, or later alpha-capable WebCodecs profiles can be added without changing graph semantics or the public player API.

### 8.2 Transparency profile

The portable initial alpha profile uses one packed decoded frame so color and alpha cannot drift across two decoders. Rectangle arrays use `[x, y, width, height]`. Its normative layout is:

- logical width and height are padded to even values for encoding while the manifest retains the unpadded visible rectangle;
- color uses rectangle `[0, 0, paddedWidth, paddedHeight]`;
- an eight-pixel neutral gutter occupies `0 <= x < paddedWidth` and `paddedHeight <= y < paddedHeight + 8`;
- grayscale alpha uses rectangle `[0, paddedHeight + 8, paddedWidth, paddedHeight]`;
- final coded width and height are padded to 16-pixel macroblock boundaries;
- padding and gutter pixels use alpha zero and neutral chroma;
- color is converted from sRGB to 8-bit BT.709 limited-range 4:2:0 YUV;
- straight linear alpha `a` is encoded in the alpha region's luma as `round(16 + 219 × a)`, with chroma fixed at 128; and
- manifest rectangles are even-aligned and validated against the actual decoded coded dimensions.

After browser YUV-to-RGB conversion, the shader samples the alpha region's red channel, clamps it to `[0, 1]`, multiplies the color-region RGB by that value, and renders into a premultiplied-alpha WebGL2 context using `ONE, ONE_MINUS_SRC_ALPHA` blending. The compiler dilates RGB edge colors by four pixels beneath transparent areas to reduce compression halos.

The reference encoder decodes its own output and rejects a rendition whose alpha mean absolute error exceeds `2/255` or whose 99th-percentile absolute error exceeds `8/255`. It also validates seams over light, dark, and saturated backgrounds. Runtime resource accounting uses the packed coded dimensions, not logical dimensions.

Opaque assets use the same media pipeline without the alpha region.

### 8.3 Static PNG profile

Every per-state static frame is a non-interlaced PNG with the standard signature, exactly one IHDR, 8-bit RGBA color type 6, one or more bounded consecutive IDAT chunks, and one IEND. Width and height must equal the logical canvas and remain within the 512×512 limit. The parser bounds total PNG bytes to 2 MiB, chunks to 256, any one chunk to 2 MiB, and inflated filtered scanline bytes to exactly `height × (1 + width × 4)` before invoking a browser decoder. The resulting decoded RGBA surface is exactly `width × height × 4` bytes.

APNG chunks, palettes, embedded ICC profiles, text, executable metadata, unknown critical chunks, and ancillary chunks other than a single canonical `sRGB` declaration are rejected. PNG decoded surfaces count toward the page-wide memory budget. The compiler emits this restricted profile; the runtime validates signature, IHDR, chunk lengths/order, CRCs, expected decompressed size, and terminal IEND before display.

## 9. Web Runtime Architecture

The runtime is split into independently testable modules:

```text
range loader and integrity verifier
              ↓
format parser and schema validator
              ↓
deterministic motion-graph engine
              ↓
compressed-unit scheduler and cache
              ↓
WebCodecs decoder worker
              ↓
decoded presentation ring
              ↓
WebGL compositor and display clock
              ↓
framework-neutral custom element
```

### 9.1 Loader

The loader fetches the header and front index first, validates lengths before allocation, displays the current state's static frame as soon as available, and range-fetches bootstrap units. A range response must be `206` with an exact `Content-Range` whose total matches the header, the expected byte count, and a `Content-Encoding` that is either absent or case-insensitive `identity`; every other content encoding is rejected. Combining partial responses requires one unchanged strong `ETag`, and subsequent ranges send it with `If-Range`. If a strong validator is unavailable, the loader falls back to one bounded full fetch. Ranges from different entity versions are never combined. Redirects, stalls, and all response bodies are bounded and abortable.

If a server returns `200`, the loader accepts the full response only when its declared and observed bytes remain within the file cap. It cancels stale requests on `src` replacement, element disconnect, abort, or superseded loading. Each rendition/unit digest is checked before those bytes reach the decoder. Because the digest is stored in the same untrusted asset, it is an internal-corruption check, not proof of publisher authenticity.

If a host supplies `integrity: "sha256-…"`, version 0 disables range startup, performs a bounded full fetch, verifies the whole file against that externally trusted digest, and only then parses or decodes it. Version 0 does not claim authenticated early range playback; signed manifests, trusted per-unit hashes, and Merkle proofs are deferred.

### 9.2 Decoder

Decoding runs in a dedicated worker. Version 0 uses one active `VideoDecoder` per playing asset and a shared page-wide resource manager. Speculative compressed branches may be cached, but only the selected sequential path is submitted to the decoder. Reversible edges use their fully resident decoded cache. A decoder-per-state or standby-branch-decoder design is prohibited in version 0.

Before `interactiveReady`, preparation may decode and retain required reversible units, reset the decoder, and then prepare the initial active path. Those setup operations are allowed because no advancing motion is yet promised. After readiness, cached reversible presentation does not disturb the active decoder's reference chain.

`decodeQueueSize` is used only as input backpressure; readiness is based on actual output callbacks, ring occupancy, and measured submit-to-output latency. Every emitted `VideoFrame` is treated as untrusted. Before upload, the worker validates its coded and display dimensions, visible rectangle, color metadata, timestamp, expected output ordinal, per-unit output count, and cumulative decoded bytes. Unexpected frames are closed and the session fails. A two-second default decode watchdog, bounded output count, worker-error handler, and `QuotaExceededError` handling prevent indefinite resource retention.

Decoded `VideoFrame` objects are closed immediately after upload or after their pixels have been copied into an explicitly persistent cache. The default rolling ring is six frames and may grow to twelve within the independently calculated 64 MiB working-set limit. Runtime accounting includes decoder outputs, all texture-array layers for reversible units, endpoint runways, and cut targets, streaming textures, encoded caches, static surfaces, and all player instances; asset-supplied estimates are advisory only. Persistent arrays are reclaimed on static fallback, `src` replacement, disposal, page-budget eviction, or context loss. Hiding a player may reclaim them, but then `resume()` must rebuild `interactiveReady` before logical time advances. Scheduler generations tag submitted and decoded work so frames from a superseded path can be discarded safely.

Submission never advances past the earliest unresolved branch portal by more than the bounded presentation ring. A portal is eligible for a newly selected edge only if no source access unit after that portal has already been submitted and the portal lies beyond the measured decode horizon. If either condition fails, the scheduler chooses a later portal and counts that delay against `maxWaitFrames`. This prevents uncancellable source work from occupying the sole decoder ahead of a selected bridge. Graph events are coalesced to at most 32 inputs per presentation frame.

When a non-resident portal/finish edge becomes eligible, the scheduler submits every bridge chunk and then target-body chunks sequentially behind the final selected source-body frame, all with one compatible decoder configuration and future virtual timestamps. It may leave the source only when its presentation ring contains the edge-specific required consecutive lead: at least two frames, enough to cover the entire bridge plus target frame zero when that sequence fits the ring, or a full ring when it does not. The scheduler then maintains that lead through the bridge. If the requirement is not met at a looping portal, it chooses a later portal; at a held finite boundary, it keeps displaying that authored hold. Either delay counts against `maxWaitFrames`.

Preparation dry-runs every non-resident `portal` or `finish` edge's complete bridge followed by a 6–12-frame target-body runway. It records per-frame output deadlines, rolling minimum lead, p99 latency, and throughput under the rendition's rational clock. The edge reaches `interactiveReady` only if this full sequence—not merely bridge frame zero—stays deadline-safe with the required margin and fits the working-set limit. If a runtime sample later misses that measured envelope, the normal underflow/fallback rules apply.

If the edge is reversible, presentation instead reads its resident bridge and target restart runway while the active decoder prepares the target continuation. If intent reverses, the cache changes direction and then presents the resident source restart runway while obsolete decoder outputs are discarded by generation and the source continuation is prepared. If measured recovery cannot complete within either resident runway, that edge cannot reach `interactiveReady`.

### 9.3 Loop scheduling

Every compiled loop is independently decodable and spans unit-local range `[0, B)`. A source partial loop `[sourceA, sourceB)` has already been extracted and renumbered to `[0, sourceB - sourceA)` by the compiler. The scheduler submits the next iteration's frame-zero key chunk and following samples early enough that frame zero is output before the current iteration reaches `B`. It assigns monotonically increasing virtual timestamps. At the seam, frame zero is already the next item in the presentation ring. The scheduler does not call `seek`, `reset`, `configure`, end-of-stream, or a boundary-time `flush`.

For a short loop whose full decoded cycle fits the budget, readiness may retain the cycle. For a longer loop, readiness requires the initial decoded ring, all encoded loop bytes resident, and a headed warm-up measurement showing at least 1.5× real-time decode throughput with enough lead to submit the next IDR before its deadline. It does not claim the entire next iteration is already decoded.

### 9.4 Rendering

The renderer uses the rational frame clock plus display refresh callbacks. Streaming playback uploads decoded frames to at most three reusable textures; reversible units, endpoint runways, and cut-target runways use the separately bounded persistent texture arrays described above. Both paths use the same packed-alpha compositor. Repeated refresh callbacks for one lower-rate content frame are expected and are not duplicate content frames. Offscreen or worker rendering may be added after profiling, but the renderer interface must not depend on main-thread ownership.

If an eligible content-frame deadline is unexpectedly missed, the renderer holds the last valid frame rather than clearing or showing an incorrect frame, emits an `underflow` diagnostic, and records that the session no longer meets the named device-profile certification. This is an observable missed deadline, not a hidden continuation of the guarantee.

### 9.5 Readiness

The public readiness levels are:

- `metadataReady`: graph and poster metadata are valid;
- `visualReady`: the current state's static frame is displayed;
- `interactiveReady`: all encoded unit bytes are resident and internally verified, the initial presentation ring is filled, every reversible bridge, reversible endpoint runway, and cut-target runway is resident, every non-resident portal/finish edge's complete bridge-plus-target-runway dry run passes, every direct graph edge passes its start-policy/decode-horizon bound, and measured decode headroom is sufficient; and
- `staticReady`: animation is unavailable or reduced, but every state has a validated static representation.

`prepare({ signal, timeoutMs = 5000 })` resolves with `{ mode: "animated", assurance: "best-effort" }` at `interactiveReady` or `{ mode: "static", reason }` at `staticReady`; it never remains pending forever because animation is unsupported. A normal web page cannot reliably identify every hardware, compositor, and power property, so certification remains an external report about a controlled profile rather than a runtime label. `player.assurance` is therefore `"best-effort"` in animated mode and `null` in static mode. Abort rejects with `AbortError`. Before resolution, the current state's static frame remains visible. If decoding does not demonstrate the required headroom, the runtime tries a lower rendition and otherwise resolves in static mode.

During warm-up the runtime measures p99 submit-to-output latency and converts it to `decodeLeadFrames`. For each looping portal edge it calculates the greatest wait from any request phase to a portal beyond both the submitted-source horizon and the edge-specific consecutive-lead requirement. Finite portal and `finish` edges add their greatest remaining authored-frame wait to the measured target-sequence preparation delay; once held, only that preparation delay remains. A cut has a one-content-frame response bound because its target runway is resident. Each result must fit the edge's `maxWaitFrames`. Because version 0 uses `readiness.policy: "all-routes"`, failure of any declared direct edge prevents animated `interactiveReady`; the player resolves in static mode rather than exposing a partially smooth graph.

Automatic bindings are enabled at `metadataReady`; at that moment the element samples current hover, focus, and visibility so an interaction that began during loading is not lost. Bindings received after `metadataReady` but before `interactiveReady` update `requestedState` using latest-wins semantics without starting unprepared motion. When readiness is reached, the graph routes directly toward the newest valid requested state.

### 9.6 Visibility

When the document or asset becomes non-visible, logical time freezes and decode work is reduced. On return, the player rebuilds its readiness window before resuming. It does not fast-forward through missed animation.

On abort, `src` change, disconnect, or disposal, the player closes frames and decoders, terminates workers, deletes textures and buffers, rejects pending promises with `AbortError`, and cancels requests. Page-budget eviction, decoder/worker failure, or WebGL context loss first attempts the recoverable static commit in Section 6.6. Context restoration performs a fresh `prepare()` while retaining the currently committed semantic state; repeated animation failure stays in static mode.

## 10. Public Web API

The base integration is a custom element with a small imperative API. The element name remains internal until product naming is decided.

Animated mode requires a secure browser context (`https:` or the browser's localhost development exception), WebCodecs in a dedicated worker, and WebGL2. It does not require cross-origin isolation or `SharedArrayBuffer`. Missing capabilities select the static/light-DOM fallback rather than a seeking-based `<video>` substitute.

```html
<aval-player
  src="/assets/favorite.avl"
  motion="auto"
  autoplay="visible"
>
  <img slot="fallback" src="/assets/favorite-idle.png" alt="">
</aval-player>
```

```ts
const result = await player.prepare({ signal });
await player.setState("hovered");
player.send("activate");
player.pause();
player.resume();
player.dispose();

player.requestedState;
player.visualState;
player.isTransitioning;
player.readiness;
player.assurance;
player.readyFor("success");
```

`setState(name)` returns `Promise<void>` and follows the settlement table in Section 6.6. Requesting the already stable state resolves in the next microtask without starting an edge. Repeating the current in-flight destination joins that request's completion instead of superseding it. If a different newer request supersedes it first, it rejects with `AbortError`. A missing state or direct route rejects with `RouteError` without changing `requestedState`. A recoverable animation failure commits the already-requested target's static frame and resolves that request; `PlaybackFallbackError` is reserved for failure to install the required static frame. `send(event)` synchronously returns whether the current graph accepted the event and may initiate the same asynchronous transition behavior. `readyFor(state)` returns `true` only when animated resources required by the valid direct route to that state are prepared.

Before `metadataReady`, `setState()` rejects with `NotReadyError`, `send()` returns `false`, and `readyFor()` returns `false`. Between `metadataReady` and completion of `prepare()`, valid state requests are accepted and coalesced by the same latest-wins rules but do not start motion. If preparation resolves in animated mode, the newest request becomes the first prepared route; if it resolves in static mode, the newest requested state's static frame is installed before `prepare()` resolves. This makes pre-hover during loading deterministic without claiming unprepared animation.

Changing `src` aborts the old asset, rejects its pending operations with `AbortError`, disposes its resources, and begins a new load. `pause()` freezes logical time on the current valid frame. `resume()` rebuilds the working window before advancing. `dispose()` is idempotent and final for that player instance.

Events include:

- `readinesschange`;
- `requestedstatechange`;
- `visualstatechange`;
- `transitionstart`;
- `transitionend`;
- `underflow`;
- `fallback`; and
- `error`.

Built-in bindings can emit `pointer.enter`, `pointer.leave`, `focus.in`, `focus.out`, `engagement.on`, `engagement.off`, `activate`, `visible`, and `hidden`. `engagement` is the recommended hover/focus signal: it is on while either the pointer is over the host or focus is within the host, and turns off only when both are false. This prevents a pointer leave from cancelling the focused state. Host code may disable all automatic bindings and drive states directly. The animation never gives itself button semantics, `tabindex`, keyboard activation, or an ARIA role; the host DOM owns labels, focusability, semantic status, and business actions. A native button wrapper is the documented pattern for controls. Animation is never the sole announcement of loading, success, or error.

`motion="auto|reduce|full"` defaults to `auto`, follows live `prefers-reduced-motion` changes, and uses per-state static frames in reduced mode. Reduced mode never starts an infinite loop. `autoplay="visible|manual"` defaults to `visible`; `manual` requires `resume()`. The player exposes visible pause/resume integration guidance for nonessential motion lasting more than five seconds and the compiler warns about high-frequency flashing.

The element reserves the manifest's intrinsic aspect ratio before animation loads, supports CSS width/height with `contain`, `cover`, or `fill`, responds to device-pixel-ratio and resize changes without changing logical state, and always keeps the author-owned light-DOM fallback usable when JavaScript, CORS, CSP, WebCodecs, or WebGL2 is unavailable. Enhanced initial and per-state statics come only from the verified asset.

## 11. Compiler and Source Project

The editable source is a JSON project plus rendered input media. It is distinct from the compiled binary delivery asset.

The first compiler accepts:

- a PNG RGBA frame sequence; and
- a local rendered video that the approved FFmpeg invocation decodes to bounded RGBA frames; a source with no decoded alpha is treated as opaque.

Constant-frame-rate input is required for the default path. Variable-frame-rate sources are rejected with a timestamp report unless the author explicitly requests normalization to one rational `--fps`; normalization selects source frames deterministically and reports every duplicate or dropped frame. Version 0 does not synthesize interpolated frames, and a normalized source with an accidental duplicate at a certified seam fails the same continuity checks as any other input.

The prototype invokes a user-installed FFmpeg executable and records its version and build configuration; it does not redistribute FFmpeg or `libx264`. Invocation uses an explicit local-file protocol and demuxer allowlist, disables network protocols, applies process time/memory/output limits, caps source dimensions to 4,096×4,096, caps source duration to 30 seconds and 1,800 frames, confines temporary output to a bounded working directory, rejects path traversal, and supports cancellation. Public distribution of any bundled encoder requires a separate license, build-flag, SBOM, and patent review.

The source project declares frame ranges, states, edges, portals, and input bindings. The compiler:

1. validates the graph and all ranges;
2. normalizes color and alpha;
3. removes accidental duplicate endpoint frames when explicitly allowed;
4. splits source intros, partial loops, outros, and bridges into independently decodable units whose compiled loops begin at unit frame zero;
5. ensures random-access and dependency rules;
6. creates the alpha-packed rendition;
7. emits sample tables, per-state static frames, hashes, reversible endpoint and cut-target runway descriptors, and independently computed memory estimates;
8. runs seam analysis; and
9. writes the front-indexed compiled file.

The compiler independently enforces the version 0 output limits. It does not trust source-project estimates or manifest-provided keyframe claims.

Initial CLI operations are:

```text
init <directory>
compile <input.mov|input.mp4|frames-pattern> --loop <start:end> --out <asset.avl>
compile <project.json> --out <asset.avl>
inspect <asset.avl>
validate <asset.avl>
unpack <asset.avl> --out <directory>
dev <project.json>
```

The direct-input command is the zero-config entry path for the common “intro plus partial loop” case. Frame range `start:end` becomes an optional intro `[0, start)` followed by a closed body loop `[start, end)`; the first loop frame becomes the static fallback, and unused trailing source frames produce a warning. It outputs a one-state asset that can be dropped into the custom element immediately. Frame indices, not floating-point seconds, are canonical; `inspect` prints the source frame rate and a frame/time table.

`init` is the next step up: it creates a documented idle/hover project with licensed sample frames, a reversible edge, static fallbacks, and a runnable web example. `dev` watches local inputs, recompiles deterministically, and serves the stress-test playground with a frame ruler, current graph state, queue depth, underflow count, and continuity report. It does not upload source media or require an account. Diagnostics use stable codes, file/field context, human-readable remediation, and nonzero exit status on invalid output. The compiler is deterministic for identical inputs, tool versions, and options.

## 12. Visual-Continuity Validation

For each loop seam and exact transition edge, the compiler performs deterministic analysis in linear-light premultiplied RGBA and reports:

- duplicate endpoint detection;
- pixel-difference heatmap score;
- alpha-edge discontinuity;
- neighboring-frame versus boundary-frame RMS change.

Let `boundaryRms` be the RMS difference across the seam and `neighborP95` be the 95th percentile RMS difference between adjacent frames within four frames on both sides. Version 0's automatic visual check passes when:

```text
boundaryRms <= 1.5 × max(neighborP95, 1/255)
```

The same calculation runs independently on alpha. This metric is a warning and certification aid, not proof of semantic naturalness; author declaration remains required. Optical-flow and velocity analysis are deferred rather than conditionally changing version 0 behavior.

The report classifies edges as:

- `exact-authored`;
- `exact-reverse`;
- `exact-portal` with maximum wait;
- `cut`; or
- `unverified`.

Export may proceed with cuts or unverified edges only when they are explicitly declared. They do not receive a seamless-visual certification.

## 13. Error Handling and Fallbacks

- Invalid headers, lengths, hashes, graph references, timestamps, or sample dependencies reject the asset before decoder allocation.
- Unsupported codecs select another declared rendition; if none is supported, the newest accepted requested state's static frame is committed, `prepare()` resolves in static mode, and `fallback` fires.
- Decode failure holds the last valid frame, releases decoder resources, commits the newest accepted target's validated static frame, resolves that state request, and leaves later static-mode state changes usable. Failure to install the required PNG rejects with `PlaybackFallbackError` and leaves the light-DOM fallback visible.
- Buffer underflow holds the last valid frame and emits diagnostics; it never displays an empty canvas.
- A missing state request rejects with a typed error and leaves the current requested state unchanged.
- A transition without a valid route rejects deterministically rather than inventing a cut.
- Reduced-motion defaults to per-state static frames unless the asset declares an explicitly enabled finite reduced-motion unit.
- Load, range, hash, decoder, worker, context-loss, and timeout errors include stable machine-readable codes and never expose untrusted asset strings as HTML.

## 14. Security and Resource Limits

The parser treats every asset and decoder output as untrusted. Before allocation it validates:

- maximum file and payload sizes;
- maximum canvas dimensions and total decoded pixels;
- maximum frame, state, edge, portal, and rendition counts;
- all integer arithmetic for overflow;
- every byte range against the file boundary;
- every sample dependency and monotonic timestamp;
- digests before persistent caching; and
- codec signatures against declared types.

It also rejects duplicate JSON keys; identifiers outside the version 0 ASCII pattern; `__proto__`-style key hazards; zero or negative frame counts; unsafe integers; non-exact index lengths; header, index, manifest, or payload overlap; `offset + length` overflow; unexpected trailing bytes; aliased ranges; zero-length advancing samples; false key flags; incompatible SPS/PPS; B-frames; cross-unit references; zero-duration graph cycles; ambiguous edges; unreachable references; and routes exceeding the per-frame step limit.

The runtime computes its own worst-case working set from actual coded dimensions, bytes per decoded surface, ring occupancy, resident reversible frames and cut-target runways, encoded caches, and GPU textures. It probes `MAX_TEXTURE_SIZE` and `MAX_ARRAY_TEXTURE_LAYERS`, tracks page-wide usage, and falls back instead of retrying resource allocation indefinitely. Every decoded output is bounded and validated before texture upload.

Assets cannot contain external URLs, scripts, WebAssembly, CSS, DOM commands, network actions, or analytics. The host controls CORS, Content Security Policy, caching, and telemetry adapters.

Internal SHA-256 values detect inconsistent or corrupted units only. In version 0, publisher authenticity requires a host-provided whole-file digest whose trust root is outside the asset and therefore gates playback on a verified bounded full fetch.

## 15. Testing and Certification

### 15.1 Unit tests

- Header and manifest parsing.
- Bounds and overflow validation.
- State graph routing.
- Latest-wins event ordering.
- Pending inverse-event cancellation and active reversal.
- Half-open loop semantics.
- Looping, finite, and held-body portal/finish calculations.
- Full non-resident portal/finish-edge lead, including a one-frame bridge followed by target frame zero.
- Virtual timestamp generation.
- Rendition selection and fallback.

### 15.2 Conformance fixtures

Golden assets include:

- opaque and alpha loops;
- a reversible hover edge;
- repeated reversal from persistent layers after source `VideoFrame` closure;
- portal-based loading-to-success and loading-to-error edges;
- finite one-shot and already-held transition origins;
- rapid alternating requests;
- malformed headers and sample tables;
- unsupported codec fallback; and
- reduced-motion fallback.

The conformance suite includes a small independently encoded reference-frame profile that does not depend on system H.264 availability. It validates graph, scheduling, loop ordering, alpha compositing, and parser behavior. H.264 profile tests run only after `VideoDecoder.isConfigSupported()` succeeds and are required for a browser/device to receive production-profile certification.

Timed event traces assert `requestedState`, `visualState`, active unit, phase, and next presentation timestamp at each step.

### 15.3 Browser integration tests

Playwright runs deterministic graph, content-frame ordering, parser, lifecycle, and rendering-correctness tests in its Chromium, Firefox, and WebKit engines. Playwright WebKit is not treated as Safari performance certification. Synthetic frames contain error-tolerant machine-readable frame identifiers; GPU readback is used only in correctness tests and is disabled during timing benchmarks. These tests prove which frame the runtime drew into its canvas, not which refresh the operating-system compositor actually scanned out to the display.

Initial production-profile certification is desktop web only and runs headed in visible documents on:

- macOS 26 on Apple Silicon M1 or later: shipping Safari 26, current stable Chrome, and current stable Firefox;
- Windows 11 with Intel UHD 620-class graphics or better: current stable Chrome and Firefox; and
- both 60 Hz and 120 Hz display modes where the platform supports them.

The certification report records exact browser, OS, hardware, codec support result, hardware/software decode status when observable, refresh rate, power state, rendition, resolution, and frame rate. Mobile and unlisted desktop profiles may animate with `assurance: "best-effort"` when readiness passes, and otherwise receive the static fallback; neither outcome is reported as certified until a matching profile is published.

Certification has two explicitly named layers. **Runtime scheduling conformance** uses decoder callbacks, animation-frame callbacks, GPU fences, and canvas readback to verify output order, deadlines, and underflow inside the browser. **Observed-display continuity** additionally uses browser/OS compositor tracing where that trace exposes scan-out evidence, or a synchronized external high-speed capture at no less than four times the tested refresh rate. A report may claim only the first layer when display evidence is unavailable; it must not translate canvas submission timestamps into claims about actual scan-out.

For runtime scheduling, an **eligible content-frame deadline** is the first animation-frame callback at or after that frame's rational presentation time for which the event and prepared frame were available before the measured canvas-submission cutoff. For observed-display continuity, the corresponding deadline is the first independently observed display refresh after that cutoff. Expected repetition of a 24/30 fps content frame across a 60/120 Hz display is not a duplicate content frame. A **seam gap** is measured between distinct content-frame appearances across a unit boundary in the relevant measurement layer. Reference certification after `interactiveReady` requires:

- zero `underflow` events during the measured run;
- exact consecutive content-frame identifier order across 1,000 loop or transition boundaries;
- no seam gap greater than the larger of 1.5 ideal content-frame intervals or the non-seam p99 interval plus half one content-frame interval;
- zero black, transparent-uninitialized, or missing frames;
- zero accidental duplicate seam frames;
- reversal of a visibly active resident reversible unit on the next eligible content frame;
- portal transitions within their declared maximum wait;
- deterministic convergence to the newest requested state in rapid-input fuzz tests; and
- at least 1.5x real-time output throughput, measured from actual decoder output callbacks over at least 300 post-warm-up frames.

The ordering, route, throughput, and underflow requirements apply to runtime scheduling conformance. Black/missing frames, accidental displayed duplicates, and display seam-gap claims require observed-display evidence. Visual-continuity scores are reported separately from both layers because visual matching depends on authored content.

### 15.4 Adversarial and lifecycle tests

Property and mutation fuzzing covers duplicate manifest keys, unsafe integers, extreme counts, overlaps, timestamp overflow, false key flags, hostile SPS dimensions, oversized NAL units, B-frames, cross-unit references, unexpected decoder output, graph cycles, and identifier hazards. Network tests cover truncated, compressed, stalled, ignored, mismatched, and entity-changing range responses. Lifecycle tests cover abort during every phase, rapid `src` replacement, disconnect/reconnect, hide/show, budget eviction, worker crash, decoder reclamation, WebGL context loss, resize/DPR changes, and multiple competing players. Every rejection test asserts bounded allocation and complete resource cleanup.

## 16. Repository Boundaries for the First Implementation

```text
packages/
  format/            binary format, schema, parser, validator
  graph/             deterministic state and transition engine
  compiler/          source project to compiled asset
  player-web/        loader, worker decoder, scheduler, renderer
  element/           framework-neutral custom element
apps/
  playground/        interactive demo and diagnostics
fixtures/
  conformance/       golden and malicious assets
docs/
  format/            public format and API documentation
```

Modules depend inward on explicit interfaces. `graph` knows nothing about video or the DOM. `format` knows nothing about rendering. `player-web` composes the parser, graph, decoder, scheduler, and renderer. Framework wrappers are not part of the initial implementation.

## 17. Implementation Sequence

1. Build an in-memory, opaque, single-loop WebCodecs spike with rational timestamps and machine-readable frame identifiers. Prove continuous repeated-IDR scheduling before freezing the container.
2. Add one fully resident reversible hover transition and rapid enter/leave stress tests. Prove persistent-cache memory and next-eligible-frame reversal while the clip is active.
3. Build the deterministic graph engine, portal routing, latest-wins behavior, and event-trace tests.
4. Freeze the minimal binary header, graph manifest, access-unit index, parser, and reference-frame profile only after the scheduling experiments pass.
5. Add the user-installed-FFmpeg H.264 compiler profile, Annex B inspector, and WebCodecs worker decoder.
6. Add per-state static fallback, packed-alpha encoding, and the WebGL2 compositor.
7. Implement the hardened range loader, internal-consistency hashes, shared budgets, lifecycle cleanup, and hostile-input tests.
8. Add the custom element and headed stress-test playground.
9. Run ordering tests in Playwright and performance certification on named real-browser device profiles; publish the complete results, including failures.

The first public milestone is not “the file opens.” It is a reproducible demo that completes the 1,000-boundary stress test without a format-induced stop.

## 18. Risks and Mitigations

- **Codec support differs by browser/device.** Probe exact configurations and retain a static fallback. Every alternative codec and encoder profile requires its own interoperability, license, and freedom-to-operate review.
- **H.264 licensing may affect more than distribution.** Encoding tools, SDK/software distribution, generated assets, and commercial uses may create obligations depending on jurisdiction and use. Browser decoding does not license the project encoder or customer content. The prototype invokes but does not bundle FFmpeg; production release requires counsel and a reviewed encoder distribution model.
- **Airbnb patent exposure.** Published US applications US20250324068A1 and US20250324132A1 describe related encoding and decoding techniques and may have continuations or foreign counterparts. Avoiding one described implementation is not a legal design-around. Preserve independent-design records and obtain a counsel-led freedom-to-operate review of the complete system before commercial release or patent-safety claims.
- **Browser/OS scheduling stalls.** Decode in a worker, keep renderer boundaries abstract, certify named device profiles, report underflow honestly, and never claim hard real-time behavior under arbitrary system load.
- **Decoder exhaustion with many assets.** Use a shared decoder budget, visibility suspension, and one active decoder per playing asset.
- **Decoded-frame memory growth.** Enforce declared pixel budgets, adaptive short rings, immediate `VideoFrame.close()`, and lower renditions.
- **Bad source seams.** Separate runtime continuity certification from visual-continuity reports and require explicit cut declarations.
- **Graph explosion.** Prefer reversible edges, shared neutral ports, and bounded portals over pairwise transitions between every frame and state.

## 19. Deferred Follow-up Specifications

After the web playback contract is proven, separate design cycles may cover:

1. Visual Studio authoring and recipes.
2. Alternative VP9/AV1 and native-alpha media profiles.
3. React, Vue, Svelte, and design-system integrations.
4. Hosted optimization, registry, and marketplace.
5. Native runtimes.
6. Product naming, MIME registration, neutral governance, and a standards patent policy.
