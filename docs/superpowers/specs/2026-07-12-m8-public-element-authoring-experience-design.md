# M8 Public Element and Authoring Experience Design

**Date:** 2026-07-12

**Status:** Approved implementation slice derived from the committed AVAL
design and the approved M4-M7 contracts

**Authority:**

- [AVAL Format Design](2026-07-11-aval-format-design.md)
- [AVAL Implementation Plan](../plans/2026-07-11-aval-implementation.md)
- [M5.5 Integrated Scheduler and Readiness Design](2026-07-12-m55-integrated-scheduler-readiness-design.md)
- [M6 Transparency and Static Fallback Design](2026-07-12-m6-transparency-static-fallback-design.md)
- [M7 Loader, Integrity, and Resource Manager Design](2026-07-12-m7-loader-integrity-resource-manager-design.md)

## 1. Outcome and Claim Boundary

M8 turns the internal web runtime into an adoption-quality browser component.
The simplest successful use is one compiled asset, one module import, and one
HTML element. A one-state direct compile loops without application code. A
multi-state asset uses its own author-defined state names and binding table, so
the same element can represent `idle`/`hovered`, `loading`/`success`/`error`, or
any other valid graph without a format-specific list of states in JavaScript.

M8 proves that:

- the package root can be imported safely during server rendering and custom
  element registration is explicit, idempotent, and collision-safe;
- the opt-in browser auto entry supports a script-plus-markup CDN path;
- connected markup starts bounded preparation automatically while still
  exposing the complete typed imperative API;
- arbitrary authored states can be requested through `state`, `setState()`,
  authored events, and deterministic automatic bindings;
- pointer, focus, native click/keyboard activation, engagement, document
  visibility, and viewport visibility are aggregated without inventing button
  semantics;
- live `prefers-reduced-motion` changes use the M6 serialized motion-policy
  path and reduced mode never advances an infinite loop;
- visible autoplay, manual pause/resume, hiding, budget reclamation, and resume
  rebuild preserve logical time and the newest semantic intent;
- the static, animated, and light-DOM layers never reveal an
  uninitialized or stale generation;
- one resize/DPR authority keeps static and animated pixels geometrically
  identical under `contain`, `cover`, `fill`, and `none`;
- DOM events, promises, attributes, properties, and diagnostics expose one
  staged public state in deterministic order;
- source replacement, disconnection, reconnection, and final disposal retire
  every M7 resource and suppress stale callbacks; and
- the compiler quick path, starter project, watch playground, integration
  examples, and failure messages form one coherent first-use experience.

The compiled wire format remains exactly `0.1`. The package name
`@pixel-point/aval-element`, tag name `aval-player`, and `.avl` extension are
prototype identifiers until product naming is complete. M8 does not claim a
permanent name, framework-specific wrapper, mobile animation certification,
or named-device smoothness. M9 owns CI publication and certification evidence.

## 2. Decisions and Alternatives

### 2.1 Use a markup-first element over a framework wrapper

The selected adoption surface is a framework-neutral custom element with
declarative defaults and a typed imperative API. It works in plain HTML, can
be controlled through a ref in React and other frameworks, and keeps the
runtime implementation in one package.

Three approaches were considered:

1. A JavaScript-only `new Player(canvas, options)` API would be easy to expose,
   but every adopter would need to recreate fallback layering, resize/DPR,
   visibility, reduced motion, input aggregation, and cleanup.
2. Framework-specific components would feel familiar inside one ecosystem but
   split behavior and evidence across React, Vue, Svelte, and future wrappers.
3. A custom element centralizes browser behavior while retaining direct
   methods for applications that need explicit control.

The third approach is selected. Framework wrappers can later be thin adapters
over this contract; they must not create a second player implementation.

### 2.2 Keep authored behavior in the asset and host behavior in the page

The element does not know that a state is called `hovered`, `success`, or
anything else. It exposes the manifest's state and event identifiers, routes
automatic DOM sources through the manifest's existing `bindings`, and lets the
host call `setState()` or `send()` directly. No on-wire field changes.

Runtime JSON attributes, expression languages, DOM selectors inside an asset,
and asset-supplied scripts were considered and rejected. They would blur the
security boundary and make identical assets behave differently across hosts.
The fixed version-0.1 binding-source union remains the only automatic bridge.

### 2.3 Provide explicit registration plus an opt-in auto entry

The package root has no registration side effect and is safe to import in an
SSR process. It exports `defineAvalElement()` and public types.
Calling the function in a browser registers the prototype tag. A
separate `@pixel-point/aval-element/auto` entry registers it immediately for a
CDN or simple client-only module import.

Automatic root registration was rejected because it makes SSR imports fail,
creates duplicate-bundle collisions, and prevents applications from choosing
when browser globals are touched. Requiring every user to subclass or manually
wire the runtime was also rejected as needless ceremony.

The definition helper registers only the fixed prototype tag
`aval-player`. A repeated definition made by this package returns the
existing constructor. A tag already owned by unrelated code fails with a
bounded `NotSupportedError`; it is never silently replaced. Product naming and
any future migration or alias policy require their own release decision rather
than making every integration choose a tag name now.

### 2.4 Use one open shadow root with layered progressive enhancement

The element owns an open shadow root containing, back to front:

1. a named light-DOM fallback slot;
2. the strict per-state static canvas; and
3. the animated WebGL canvas.

Only an already drawn layer can cover the layer below it. A new source first
returns to the fallback layer, then atomically covers it with the new
initial static, and reveals animation only after the first prepared draw.
Fatal static failure reveals the light-DOM fallback again. There is no external
image request; initial and per-state enhancement pixels are verified asset
statics.

A closed shadow root was rejected because it makes diagnosis and integration
testing needlessly opaque. Rendering directly into arbitrary host light DOM
was rejected because applications could accidentally delete or restyle an
owned canvas and invalidate resource accounting.

### 2.5 Keep the first public API intentionally small

M8 exposes source/configuration properties, staged read-only state, five core
operations (`prepare`, `setState`, `send`, `pause`/`resume`, and `dispose`), and
one bounded diagnostic snapshot. It does not add timelines, frame seeking,
arbitrary playback speed, CSS state reflection, a JSON behavior attribute, or
runtime graph editing.

This surface is sufficient for zero-code loops, authored bindings, controlled
application states, accessibility wrappers, and diagnostics without making
the element another authoring language.

## 3. Package Authority and Internal Layers

M8 adds `packages/element`. It depends on `@pixel-point/aval-player-web`; no
lower-level package depends on it.

```text
@pixel-point/aval-format       compiled 0.1 schema and binding sources
@pixel-point/aval-graph        deterministic state/request semantics
@pixel-point/aval-player-web   M6/M7 loader, player, policy, resource owners
             ↑
@pixel-point/aval-element
  registration and SSR-safe entries
  attribute/property configuration
  asset-generation lifecycle
  shadow fallback/presentation layers
  automatic input binding aggregation
  visibility/autoplay/motion preference
  resize and DPR observation
  DOM event and diagnostic bridge
             ↑
page or framework host        semantics, business actions, application state
```

Production files remain divided by authority. The HTMLElement subclass is a
thin adapter over controllers; it does not become a second loader, graph,
scheduler, or resource manager. Controllers receive injectable browser seams
so unit tests do not require network, codecs, or WebGL.

One `ElementAssetGeneration` owns one M7 asset session/player composition, its
abort controller, presentation planes, and event bridge. `src`, `integrity`,
or credential-policy replacement creates a new generation only after the old
one is terminal. Generation checks guard every promise continuation, observer
callback, image event, and DOM event.

## 4. Registration, Upgrade, and Connection

The root module performs no read of `window`, `document`, `HTMLElement`,
`customElements`, `matchMedia`, or canvas at evaluation time. The definition
function checks browser capabilities only when called. The `/auto` entry is
explicitly browser-only.

The element constructor attaches its shadow tree and creates inert layer DOM.
It performs no fetch, worker creation, decoder reservation, media-query
subscription, intersection observation, or resize allocation. Those begin in
`connectedCallback`.

The adapter upgrades own properties assigned before custom-element definition
using the standard delete-and-reassign pattern. At minimum this covers `src`,
`integrity`, `crossOrigin`, `motion`, `autoplay`, `fit`, `bindings`, `state`,
`interactionFor`, `interactionTarget`, `width`, and `height`. Frameworks
therefore receive the same setters whether they render before or after
registration.

Attribute changes in one JavaScript task are coalesced into one configuration
microtask. A framework render that changes `src`, `integrity`, and
`crossorigin` together creates one source generation, not three. Repeated
`state` updates in that task preserve only the newest declarative intent.
If another retrieval identity arrives while old-generation cleanup is still
running, intermediate identities never start resources; only the newest
pending identity may start after cleanup.

On disconnect, disposal is scheduled for the next microtask. A same-task DOM
move that reconnects the exact element cancels that disposal. A genuinely
detached element aborts and disposes its active generation and removes every
observer/listener. A later reconnect creates a fresh generation from current
attributes; it never revives an old worker, range entity, decoder, or frame.
The declarative `state` intent remains available for the new generation.

A cross-document or cross-root reconnect is also a realm boundary. It clears
an object-only interaction target from the old realm, synchronously
unpublishes the old event bridge, rebinds constructed styles and observers,
and starts no successor until the old source has a completed cleanup receipt.
An incomplete receipt blocks publication; a later completed receipt may
recover on a subsequent serialized lifecycle operation. A same-root same-task
move remains the preservation case above.

Calling public `dispose()` is different from ordinary disconnection: it is
idempotent and final for that element instance. A disposed element can remain
in DOM as progressive fallback, but no later attribute or reconnect starts
work. Applications create a new element to play again.

## 5. Declarative Markup Contract

The default zero-configuration path is:

```html
<script type="module">
  import { defineAvalElement } from "@pixel-point/aval-element";
  defineAvalElement();
</script>

<aval-player src="/assets/orbit.avl">
  <img slot="fallback" src="/assets/orbit.png" alt="">
</aval-player>
```

Connection starts metadata/static preparation automatically. If the asset is
a one-state looping direct compile, visible autoplay begins once animated
readiness succeeds. No `prepare()`, `loop`, or frame-range attribute is needed;
the compiled graph owns its intro and body loop.

### 5.1 Attributes and reflected properties

| Attribute | Property | Values and default | Effect |
|---|---|---|---|
| `src` | `src` | URL string, default empty | Starts a new generation when connected. Empty means no asset and `unready`. |
| `integrity` | `integrity` | empty or one M7 `sha256-...` token | External authenticity gate; a non-empty value selects bounded full fetch. |
| `crossorigin` | `crossOrigin` | `anonymous` or `use-credentials`; absent/empty means `anonymous` | Selects M7 fetch credentials. Cross-origin opaque responses are never accepted. |
| `motion` | `motion` | `auto`, `reduce`, `full`; default `auto` | Selects the M6 motion-policy lane. |
| `autoplay` | `autoplay` | `visible`, `manual`; default `visible` | Selects initial play intent; visibility still suspends both modes. |
| `fit` | `fit` | `contain`, `cover`, `fill`, `none`; default manifest fit, normally `contain` | Changes shared M6 presentation geometry without changing graph state. |
| `bindings` | `bindings` | `auto`, `none`; default `auto` | Enables or disables manifest-backed automatic DOM sources. |
| `state` | `state` | valid authored identifier or absent | Stores declarative destination intent and applies it after metadata. |
| `interaction-for` | `interactionFor` | same-root element ID or empty | Chooses the semantic interaction target; empty uses the motion host. |
| `width` | `width` | positive integer CSS pixels or absent | Supplies an early/intrinsic width hint. |
| `height` | `height` | positive integer CSS pixels or absent | Supplies an early/intrinsic height hint. |

`src`, `integrity`, and `crossorigin` are one retrieval identity. Changing any
of them aborts pending work, rejects old public waits with `AbortError`, closes
the old generation, and starts one new generation after the coalescing
microtask. Changing motion, autoplay, fit, bindings, interaction target, state,
or size uses the current generation.

The property setters accept only their declared closed values. Invalid enum,
integer, integrity, identifier, and target inputs throw synchronously without
changing the previous property value. Invalid values written through HTML
attributes cannot throw to the parser: the controller uses the documented
default, records one bounded `invalid-configuration` failure, and emits one
nonfatal `error` event after connection.

`src` configuration strings are capped at 4,096 UTF-16 code units before URL
resolution, `interaction-for` at 256, and numeric size hints at `1..16,384`
CSS pixels. Author CSS can size a host beyond the hint cap, but the actual
canvas backing remains governed by M6/M7 geometry and byte limits.

The `state` getter returns the reflected declarative intent, not the current
visual state. `requestedState` and `visualState` are the authoritative runtime
properties. An absent state intent uses the manifest initial state. A state
attribute present before metadata is retained and applied as soon as state
names are known. This is intentionally more markup-friendly than
`setState()`, which retains the master API rule and rejects before metadata.

### 5.2 Credential behavior

`anonymous` uses CORS with `credentials: "same-origin"`; cross-origin cookies
or authorization are not sent. `use-credentials` uses CORS with
`credentials: "include"` and therefore requires an explicitly credentialed
CORS response. The element never uses `no-cors`, never accepts an opaque
response, and never derives credentials from the asset.

URLs are resolved against the document base when a generation starts. URL,
redirect, ETag, header, integrity-token, and response-body text never appear
in DOM event details or diagnostic snapshots.

## 6. Public TypeScript API

The public package exports types equivalent to:

```ts
type AvalAutoplay = "visible" | "manual";
type AvalBindings = "auto" | "none";
type AvalCrossOrigin = "anonymous" | "use-credentials";
type AvalFit = "contain" | "cover" | "fill" | "none";

interface AvalElement extends HTMLElement {
  src: string;
  integrity: string;
  crossOrigin: AvalCrossOrigin;
  motion: "auto" | "reduce" | "full";
  autoplay: AvalAutoplay;
  fit: AvalFit | null;
  bindings: AvalBindings;
  state: string | null;
  interactionFor: string;
  interactionTarget: Element | null;
  width: number | null;
  height: number | null;

  readonly readiness: RuntimeReadiness;
  readonly mode: "animated" | "static" | null;
  readonly assurance: "best-effort" | null;
  readonly staticReason: StaticReason | null;
  readonly requestedState: string | null;
  readonly visualState: string | null;
  readonly isTransitioning: boolean;
  readonly paused: boolean;
  readonly effectivelyVisible: boolean;
  readonly stateNames: readonly string[];
  readonly eventNames: readonly string[];
  readonly inputBindings: readonly Readonly<BindingV01>[];

  prepare(options?: { signal?: AbortSignal; timeoutMs?: number }):
    Promise<RuntimeReadinessResult>;
  setState(name: string): Promise<void>;
  send(event: string): boolean;
  readyFor(state: string): boolean;
  pause(): void;
  resume(): Promise<void>;
  getDiagnostics(options?: { trace?: boolean }):
    Readonly<AvalDiagnostics>;
  dispose(): Promise<void>;
}
```

`stateNames`, `eventNames`, and `inputBindings` are empty before metadata and
immutable copies afterward. Event names are the unique authored host-event
triggers, excluding internal completion edges. State/event discovery order is
canonical and stable. State and event identifiers are data only; the
element never converts them to method names, event types, CSS selectors,
classes, HTML, or code.

`interactionTarget` is a non-reflected object override. When non-null it wins
over `interaction-for`. Assigning `null` returns to the reflected ID/default
resolution. The resolved target must be an `Element` in the same root tree as
the motion element. Cross-document and cross-shadow-root targets reject.

The package supplies `HTMLElementTagNameMap` typing for the default prototype
tag plus typed `addEventListener` overloads. It exports a framework-neutral
`AvalElementAttributes` type, but it does not depend on React types
or globally augment a framework's JSX namespace.

### 6.1 Preparation and readiness

Connected markup calls `prepare()` internally. An explicit call joins the same
generation-scoped operation. Repeated calls after a ready result resolve with
the same immutable result. Abort of one caller does not abort shared element
preparation; the element lifecycle always owns preparation through its own
root abort signal. Caller signals and `timeoutMs` bind only that caller's wait.
This prevents one component wait from canceling a still-connected element.
The caller timeout may shorten but never extend the element's default
preparation deadline, and never disables M7's internal phase watchdogs.

`prepare()` before connection, with empty `src`, or after final disposal
rejects with the appropriate `NotReadyError` or `AbortError`. It never remains
pending through source replacement. A static result is successful usable
preparation, not a rejected promise.

The public readiness ladder remains:

```text
unready -> metadataReady -> visualReady -> interactiveReady
                                      \-> staticReady
```

`error` and `disposed` are terminal within one source generation. A source
replacement creates a new generation whose public readiness begins at
`unready`; it does not mutate the old generation's captured promise result.

### 6.2 State and event requests

`setState(name)` delegates to the sole graph/player request authority and
retains all M3/M5.5 settlement rules: stable no-op resolves next microtask,
duplicate in-flight destination joins, supersession rejects with `AbortError`,
missing route rejects `RouteError`, and recoverable animated failure resolves
only after the requested static state is covered.

`send(event)` synchronously returns whether the current graph accepts the
authored event. Before metadata it returns `false`. It starts the same
asynchronous graph work but deliberately returns no completion promise; hosts
that need acknowledgement use `setState()`.

`readyFor(state)` returns `false` before metadata, for an unknown/unroutable
state, while required animated route resources are unavailable, or in a
disposed generation. Static state replacement remains possible even when
`readyFor()` is false because that predicate specifically describes the valid
animated direct route.

The declarative `state` setter reflects an intent and cannot expose a request
promise. Invalid or unroutable declarative intent leaves the prior accepted
runtime request unchanged and emits a normalized nonfatal `error`. A later
valid attribute update proceeds normally. Imperative `setState()` does not
rewrite the attribute, so controlled framework markup remains controlled by
the framework.

### 6.3 Pause, resume, and final disposal

`pause()` is idempotent and records manual play intent as false. It freezes the
rational logical clock on the current valid visual. State requests remain
admissible; static mode can commit immediately and animated mode retains the
newest intent until advancing presentation resumes. A visible paused candidate
may remain prepared, but the M7 manager may reclaim it under pressure.

The `paused` getter reports the inverse of manual play intent. It does not
conflate an offscreen/document-hidden suspension or reduced-motion static mode
with a host-requested pause; `effectivelyVisible`, `motion`, `mode`, and
diagnostics expose those conditions separately.

`resume()` records manual play intent as true and resolves only after the
element is again usable in its current visibility/motion mode. If resources
were retained, it resumes without elapsed-time catch-up. If they were evicted
or suspended, it waits behind the current static cover for M7 readiness
rebuild. A static or reduced-motion session resolves as usable static without
starting a loop. Calling `resume()` while viewport/document hidden stores the
intent and resolves after static usability; animation waits for actual
visibility.

`dispose()` aborts public operations, observers, loader bodies,
worker/decoder work, animation callbacks, event routing, and resource leases.
It waits for terminal cleanup and is safe to call more than once.

## 7. DOM Event Contract

All public events are `CustomEvent` instances with immutable, bounded detail
and are not cancelable. Readiness, state, transition, underflow, and fallback
events bubble and cross the shadow boundary with `composed: true`. `error` is
the sole direct-host exception: it does not bubble or compose, matching native
media failure handling and avoiding collisions with page-wide error handlers.
Dispatch never grants an event listener authority over graph or resource
commitment. Every detail includes a positive `generation` so a host can
correlate source replacement without receiving a URL.

| Event | Essential detail |
|---|---|
| `readinesschange` | `generation`, `from`, `to`, optional bounded `reason` |
| `requestedstatechange` | `generation`, `from`, `to`, graph input `sequence` |
| `visualstatechange` | `generation`, `from`, `to` after the draw barrier |
| `transitionstart` | `generation`, `edge`, `from`, `to`, `sequence` |
| `transitionend` | `generation`, `edge`, `from`, `to` after visual commit |
| `underflow` | `generation`, incident ordinal, held presentation ordinal, cumulative count |
| `fallback` | `generation`, normalized static reason, requested and visual state |
| `error` | `generation`, immutable normalized public failure, `fatal` boolean |

The event bridge stages all element getters before dispatch. A listener reading
`visualState` during `visualstatechange` observes the event's target. Normal
transition order remains requested change, transition start, target first
draw, visual change, transition end, then promise settlement in a microtask.
Readiness and fallback retain the M5.5/M6 draw-barrier order.

One consecutive underflow episode produces one `underflow` event while the
diagnostic counter retains every missed content deadline. Recovery followed by
a later miss begins a new incident. Expected `AbortError` from source
replacement, disconnection, supersession, or final disposal does not emit an
`error` event. All other surfaced failures are normalized; no raw thrown
object, Response, URL, ETag, byte array, frame, bitmap, or GL handle enters
event detail.

Calls made by an event listener are serialized after the current effect
transaction. Reentrant `setState()`, motion changes, source replacement, and
disposal cannot splice event order or expose half-staged properties. Listener
exceptions follow normal DOM reporting and do not corrupt player ownership.

## 8. Automatic Inputs and User-Defined Triggers

The compiled manifest remains the sole default mapping from fixed browser
sources to arbitrary authored event identifiers:

```json
{
  "bindings": [
    { "source": "engagement.off", "event": "hover.leave" },
    { "source": "engagement.on", "event": "hover.enter" }
  ]
}
```

The element emits only the existing version-0.1 sources:

- `pointer.enter` and `pointer.leave`;
- `focus.in` and `focus.out`;
- `engagement.on` and `engagement.off`;
- `activate`;
- `visible` and `hidden`.

For each source, at most one manifest binding exists. The element looks up the
binding and calls `send(binding.event)`; it never guesses a state name.
`bindings="none"` removes automatic interaction listeners and source routing,
but direct `send()` and `setState()` remain available.

### 8.1 Interaction target

By default the motion host is the interaction target. For an accessible
control wrapper, `interaction-for` points to a semantic same-root element:

```html
<button id="favorite" type="button" aria-pressed="false">
  <aval-player
    src="/favorite.avl"
    interaction-for="favorite"
    aria-hidden="true"
  >
    <img slot="fallback" src="/favorite.png" alt="">
  </aval-player>
  <span class="sr-only">Favorite</span>
</button>
```

Pointer, focus, and native `click` listeners attach to that target. Native
button keyboard activation produces `click`, so the authored `activate`
binding works for pointer and keyboard without the element synthesizing key
events. The element never calls `preventDefault`, `stopPropagation`,
`setPointerCapture`, `.click()`, or changes the target's role, `tabindex`,
disabled state, or ARIA attributes.

An explicit target ID that cannot be resolved does not silently fall back to
the motion host. Automatic pointer/focus/activation bindings remain inactive,
a nonfatal configuration error is reported once, and target resolution is
retried on connection, metadata readiness, attribute change, or direct
property assignment. Visibility sources continue because they concern the
motion host itself.

### 8.2 Engagement aggregation

The controller maintains two booleans: pointer over the interaction target and
focus within the interaction target. `engagement.on` is emitted only on the
false-to-true transition of their logical OR. `engagement.off` is emitted only
when both become false. Pointer leave therefore cannot cancel a focused
control, and focus out cannot cancel a still-hovered control.

Touch pointer enter/leave does not latch hover engagement. Mouse and hovering
pen input can. Activation remains a native click regardless of pointer type.
Focus containment uses `focusin`/`focusout` plus the actual active element and
does not synthesize focus.

Listeners begin tracking raw state on connection. At `metadataReady`, when the
manifest bindings become known, the controller samples the current target and
host so hover/focus/visibility that began during loading is not lost. Initial
signals move from unknown to their sampled value, so a false sample routes
leave/out/off/hidden and a true sample routes enter/in/on/visible when the
corresponding binding exists. Sources are routed in canonical order: pointer,
focus, engagement, then visibility. Subsequent sources preserve browser event
order. Authors should
normally bind either engagement or its lower-level pointer/focus components,
not competing destinations from all three; deterministic latest-wins still
governs assets that intentionally do so.

Visibility source intent is submitted before the corresponding M7
suspend/resume operation in the same serialized lane. A hidden/visible binding
can therefore update the newest semantic state behind the static cover before
resource teardown or rebuild.

## 9. Motion Preference

`motion="auto"` is the default. It samples
`matchMedia("(prefers-reduced-motion: reduce)")` before preparation and listens
for live changes. The signal is passed only through
`IntegratedPlayer.setHostReducedMotion()`; the element does not implement a
second transition path.

`motion="reduce"` forces static per-state representation. `motion="full"`
ignores the host reduced-motion signal but still obeys visibility suspension,
manual pause, and resource limits. Changing the property or media query is
generation-serialized with loading, visibility, recovery, and disposal.

A page-scoped preference broker owns one `MediaQueryList` listener and
fan-outs the immutable boolean to connected auto-policy elements. It is
reference-counted and removes the listener when unused. If `matchMedia` is
unavailable, auto conservatively uses the runtime's normal capability/static
decision and records an unsupported preference diagnostic; it does not assume
that reduced motion is false as a certification fact.

Reduced mode never starts or advances an infinite body loop. State requests,
automatic bindings, and events still work by atomically swapping strict
per-state statics. Returning to full motion uses the M6 fresh body-frame-zero
re-entry after the intro has already reached its body. A fresh source whose
first animated activation follows initial static preparation still starts at
intro frame zero. Re-entry restarts an unfinished intro, while an intro that
already joined the body is never replayed. An explicit noninitial state commit
in static mode waives that pending intro.

## 10. Visibility, Autoplay, and Playback Intent

The element separates semantic visibility from manual play intent:

```text
hostVisible = document visible
           && viewport intersection is positive
           && measured CSS box is non-zero

animationMayAdvance = hostVisible
                   && manual play intent
                   && effective motion is full
                   && animated readiness is active
```

Opacity is not treated as visibility because observing every author style
mutation would be unreliable and expensive. `display:none`, zero-size boxes,
viewport exit, tab hiding, and document page-hide events all suspend through
the M7 host visibility seam.

`autoplay="visible"` initializes manual play intent to true.
`autoplay="manual"` initializes it to false. `pause()` or `resume()` then
overrides that intent until the autoplay attribute itself changes. Setting the
attribute to `visible` resets intent true; setting it to `manual` resets false.
Visibility changes never erase an explicit pause.

A visible manual element still performs normal bounded preparation and may
reach `interactiveReady`; it holds its first valid presentation until resume.
This keeps explicit `prepare()` meaningful without advancing logical time.

The initial intersection state is conservatively hidden until observed. M7
can load bounded metadata and the current strict static while hidden without a
decoder lease. Entering view rebuilds animation behind the static cover before
logical time begins. Leaving view freezes the exact content ordinal, covers
static, cancels animation callbacks, and releases reclaimable animation
resources. Re-entry restarts an unfinished intro at frame zero; otherwise it
starts the current semantic body's frame zero without wall-time catch-up or
intro replay.

Document `visibilitychange`, `pagehide`, viewport intersection, autoplay, and
manual calls enter one coalesced controller lane. `pageshow` after a
back-forward-cache restore performs fresh capability/resource validation; no
worker or decoder is assumed to survive freezing.

## 11. Presentation Size, Fit, and DPR

The shadow host defaults to `display: inline-block` and obtains an intrinsic
aspect ratio from the manifest canvas and pixel-aspect ratio. Once metadata is
known, absent author CSS gives the element the manifest logical width and
height in CSS pixels. Author CSS width/height wins. Positive `width` and
`height` attributes provide early layout hints before metadata; when only one
is present the other dimension follows the known aspect ratio.

Authors should set dimensions in CSS for responsive layouts:

```css
aval-player {
  width: clamp(3rem, 10vw, 8rem);
  aspect-ratio: 1;
}
```

An element with no metadata, no size hints, and no intrinsic fallback content
has no promised pre-load size. Documentation therefore places a sized fallback
or width/height attributes in layout-sensitive examples.

One `ResizeObserver` measures the content box. DPR changes are sampled through
a page-scoped DPR broker using resolution-media-query and viewport/window
resize signals. Changes are coalesced to one animation frame and passed to the
M6 `BrowserPresentationPlanes` authority. The same source crop, destination
rectangle, integer raster boundary, backing dimensions, and resolution clamp
apply to static and animated canvases.

`fit` absent uses the manifest canvas fit. A present fit attribute overrides
it for presentation only. `contain` letterboxes transparently, `cover` crops
from the center, `fill` stretches, and `none` centers one intrinsic-size image.
M8 does not add arbitrary object positioning. Fit and resize redraw the
already committed frame without advancing graph state, replaying animation,
or briefly exposing the lower layer.

Backing allocation is uniformly clamped by the format limit, GL device limit,
DPR, and M7 byte lease. A clamp is visible in diagnostics but is not an error
when both planes preserve the exact mapping. A zero-sized element keeps the
fallback/current pixels logically committed and allocates no zero-sized
canvas; positive resize rebuilds geometry before reveal.

Internal canvas and image layers are `aria-hidden`, non-focusable, and do not
capture pointer events. Their CSS is package-owned. The open shadow root is
inspectable but applications must treat its children as non-public.

## 12. Static Fallback and Progressive Enhancement

Fallback is a progressive ladder:

1. light-DOM `slot="fallback"` is usable before definition and when JavaScript
   is disabled;
2. the asset's strictly validated current-state PNG covers the fallback at
   `visualReady` or `staticReady`;
3. animation covers static only after a prepared first draw.

The light-DOM fallback is never removed, cloned, interpreted, or fetched by
the package. The element merely slots it. Per-state enhancement always comes
from the digest-verified asset; no independent image request can bypass its
retrieval identity or integrity policy.

Missing secure context, WebCodecs, worker, AVC profile, WebGL2, decoder lease,
or reduced-motion preference produces a usable static result when strict PNG
display works. CORS, CSP, network, integrity, parser, or strict static failure
leaves the light-DOM fallback visible and emits fatal `error`. The element
never creates a seeking `<video>` substitute.

For no-JavaScript use, documentation includes a small author-owned baseline
style so the unknown custom element and its fallback image reserve the desired
box. `:defined` may be used for enhancement styling, but correctness does not
depend on it.

## 13. Accessibility Contract

The motion element is a visual primitive, not a control or status widget. It
adds no role, accessible name, `tabindex`, keyboard handler, live region,
pressed state, or business action. Host DOM supplies those semantics.

Documented patterns use:

- a native `<button>` or `<a>` as the interaction target for interactive
  motion;
- `aria-hidden="true"` and `alt=""` for purely decorative animation;
- visible or screen-reader text for the control's name;
- an independent live region/text update for loading, success, or error; and
- a separate pause control when nonessential motion continues beyond five
  seconds and is not already stopped by interaction or visibility.

Keyboard behavior comes from native controls. The element observes the
target's focus and click; it never duplicates Enter/Space handling. Animation
is never the only means of conveying state, selection, error, progress, or
confirmation. Static reduced-motion states must communicate no less semantic
information than animated states.

The compiler retains M6 flashing analysis/warnings. Documentation warns
against rapid luminance flashes, excessive parallax, and high-frequency
infinite motion even when `motion="full"` is available.

## 14. Diagnostics and Developer Experience

`getDiagnostics()` returns a deeply frozen, bounded observation. Its summary
contains:

- element/source generation, connected/final-disposed flags, and readiness;
- animated/static mode, assurance, normalized static reason, and last bounded
  public failure;
- state names, event names, manifest binding pairs, requested/visual state,
  transition phase, and graph input sequence;
- configured/effective motion, host preference, autoplay/manual intent,
  document/intersection/box/effective visibility;
- selected rendition/profile, transport mode label, request/body counts,
  verified/resident byte counts, player/page tracked bytes, decoder lease
  state, and reclamation count;
- presentation CSS/backing size, fit, effective DPR, resolution scale, and
  clamp reasons;
- preparation, source replacement, pause/resume, underflow, fallback, context
  recovery, and cleanup counters; and
- terminal outstanding-resource counters.

`getDiagnostics({ trace: true })` additionally returns the existing bounded
runtime trace and element lifecycle/input trace, capped at 512 records each.
It never exposes mutable runtime owners. The default package does not write to
the console, install a global hook, upload telemetry, or render a debug overlay.
The M8 playground consumes only this public method and DOM events, proving that
diagnosis does not require private imports.

All text is capped and normalized. Snapshots exclude URL/path strings, ETags,
headers, integrity values, response bodies, source media names, fallback HTML,
raw errors, bytes, frames, bitmaps, workers, readers, GL objects, and resource
lease handles.

## 15. React and Other Framework Semantics

The API is designed for framework ownership without embedding a framework:

- string configuration has reflected attributes with stable camel-case
  properties;
- `state` is declarative and latest-wins, making controlled rendering natural;
- imperative acknowledgement uses a ref and `setState()`;
- custom events use `addEventListener` with typed detail; all except the
  direct-host `error` event bubble/compose;
- object-only `interactionTarget` is assigned through a ref/effect;
- same-task configuration updates coalesce into one source generation; and
- disconnect cleanup tolerates same-task DOM movement and Strict Mode-style
  mount ordering without retaining detached resources.

A React example uses the custom tag for static props and a typed ref for
events/methods. It does not rely on React-specific custom-event prop naming,
which varies by React version and typing setup. The package publishes a plain
attribute interface and a copyable JSX augmentation snippet, not a mandatory
React dependency or wrapper.

Frameworks must not control shadow canvases, mirror `visualState` back into the
`state` prop on every event, or treat an expected supersession `AbortError` as
a fatal application error.

## 16. npm, CDN, and Build Ergonomics

`@pixel-point/aval-element` is built as publish-ready ESM with declarations, the
module worker asset, and explicit package exports:

```text
@pixel-point/aval-element       SSR-safe types and definition helper
@pixel-point/aval-element/auto  browser-only default-tag registration
```

The root is side-effect-free. The auto entry is marked as the sole intentional
side effect so bundlers can tree-shake correctly. No CommonJS, framework,
WASM, encoder, `VideoEncoder`, `SharedArrayBuffer`, or cross-origin-isolation
dependency is added.

The worker is constructed from a packaged module URL, never a blob or string,
so a host can authorize it with `worker-src`. The package uses no `eval`,
`new Function`, inline script, generated HTML, remote import, analytics, or
runtime CDN assumption. Shadow styling is self-contained; a policy that blocks
the browser's supported component-style mechanism may reduce enhancement but
must leave the light-DOM fallback usable.

The CDN guide pins an exact package version and imports `/auto`. The npm guide
uses explicit definition. Hosting documentation includes correct `.avl`
content type guidance, byte ranges, identity encoding, strong ETag, CORS,
credentialed CORS, CSP `worker-src`/`connect-src`, and optional external asset
integrity. It explains that external integrity intentionally disables range
startup in version 0.

The original combined element/player/worker target below 75 KiB gzip was not
met and must be recorded as a miss, not silently redefined as a pass. The
approved delivery gates instead measure the complete static bootstrap closure
at strictly below 75 KiB, the complete loaded element/player graph at no more
than 250 KiB, and the self-contained worker at no more than 20 KiB, all under
one pinned production bundler/minifier/gzip recipe. Package tarballs contain no
fixtures, traces, source media, temporary output, credentials, or absolute
paths.

## 17. Authoring Experience

### 17.1 One-command rendered-video loop

The direct path remains frame-canonical:

```text
avl compile input.mov --loop 48:96 --out orbit.avl
```

It produces one state named `idle`, an optional intro `[0, 48)`, a closed body
loop `[48, 96)`, a strict static from loop frame zero, and no automatic
bindings. The element loops it with only `src`. No runtime seeks or timestamp
loop points are created.

Successful output prints:

- source and canonical frame rate;
- intro/body frame ranges and time equivalents;
- visible/coded geometry and detected alpha policy;
- asset bytes and declared/runtime resource estimates;
- static/alpha/continuity report summary;
- the output digest; and
- copyable npm and HTML snippets using the generated file.

Unused source tail frames produce an actionable warning. Variable frame rate,
bad seams, alpha threshold failure, unsafe dimensions, and unsupported tools
retain stable diagnostic codes, exact field/frame context, and one remediation
sentence. Terminal text is escaped and never interpreted as control sequences.

### 17.2 User-defined states and starter project

`avl init <directory>` creates a small idle/hover project with:

- project schema `0.2` and comments in an adjacent guide, not invalid JSON;
- licensed/generated RGBA sample frames and recorded provenance;
- arbitrary state/event names, one resident reversible edge, exact restart
  runways, per-state statics, and engagement bindings;
- an accessible native-button HTML example using `interaction-for`;
- npm and CDN entry examples;
- a local build command and expected diagnostics; and
- no account, upload, framework, or remote asset dependency.

The starter demonstrates that names are author-controlled data. It is not a
special hard-coded hover template inside the runtime.

### 17.3 Watch playground

`avl dev project.json` watches source/project files, compiles to a temporary
file, validates the complete result, and atomically publishes only successful
bytes. The browser keeps the last valid generation while an invalid edit is
reported. A successful compile replaces `src` with a cache-busted local URL so
the element's real generation cleanup path is exercised.

The local page shows the public element plus readiness, requested/visual
state, route readiness, source/input generation, current presentation,
resource counters, underflow/fallback counts, continuity/alpha reports, and a
frame ruler. Controls can set any discovered state or send any discovered
event. It offers rapid hover/focus, source replacement, reduced-motion,
visibility, resize/DPR, and multi-player stress cases.

The dev server binds loopback by default, uses the browser localhost secure-
context exception, serves exact range/entity headers, uploads nothing, and
does not weaken production validation. `--open` is opt-in. Watch bursts are
debounced and compilation generations are abortable/latest-wins.

## 18. Documentation and Adoption Examples

M8 publishes concise public documentation organized by the task a new user is
trying to complete:

1. install or use a pinned CDN module;
2. compile a rendered video into a seamless partial loop;
3. place the element with a progressive fallback;
4. add user-defined states and engagement bindings;
5. drive states from application data;
6. wrap motion in an accessible semantic control;
7. integrate through React refs and events;
8. configure reduced motion, pause/resume, fit, and source replacement;
9. host range/CORS/CSP/integrity correctly; and
10. diagnose static fallback, invalid assets, underflow, and resource limits.

Every example includes expected fallback behavior and cleanup. Examples use
the public package only. They do not copy internal player construction,
recommend `<video>` seeking, claim that a visual seam can be synthesized, or
call a best-effort runtime result certified.

## 19. Security and Trust Boundary

The element treats attributes, resolved URLs, compiled bytes, manifest
identifiers, response metadata, image callbacks, DOM events, media-query
events, observer entries, dimensions, DPR, and framework calls as untrusted.

It enforces these rules:

- no attribute is parsed as JSON, HTML, CSS, JavaScript, a selector, or an
  expression;
- `interaction-for` is a same-root ID lookup, not a caller-controlled selector;
- state/event identifiers are validated and never interpolated into markup,
  CSS, event names, log control sequences, or URLs;
- the shadow tree is created with DOM APIs and fixed text, never `innerHTML`;
- slotted fallback nodes remain host-owned and are never cloned or executed;
- default retrieval sends no cross-origin credentials and opaque responses are
  rejected;
- M7 bounds/range/entity/integrity validation remains upstream of parser,
  decoder, and PNG use;
- only digest-verified asset statics may enhance the author fallback;
- event and diagnostic detail is bounded, frozen, and secret-free;
- expected aborts are quiet; and
- no observer, event, or promise callback can publish after its generation is
  superseded or disposed.

Element configuration can lower but not raise format/runtime hard limits.
There is no public method for injecting media bytes, a decoder, shader, worker
script, fetch response, GL object, graph definition, or resource lease.

## 20. Cleanup and Race Rules

Ownership is hierarchical:

```text
AvalElement
  -> configuration/input/visibility/resize subscriptions
  -> active ElementAssetGeneration
      -> root abort and source-scoped waits
      -> M7 asset session and page participant
      -> integrated player and pending graph promises
      -> presentation planes and backing leases
      -> DOM event bridge and bounded traces
```

All source-affecting updates are latest-generation-wins. All observers write
into one serialized element lane. Old callbacks check both terminal ownership
and generation before staging public properties or dispatching.

Source replacement order is: mark old generation superseded, abort its public
waits and DOM routing, await M7 terminal cleanup, reset staged asset properties,
show the best current fallback layer, then start the new generation. Same-task
configuration is coalesced, but generations never overlap decoder/resource
ownership.

Terminal cleanup publishes an immutable receipt keyed by element/source
generation. `completed` requires participant-scoped registration, logical
bytes, leases, cleanup/work/waits, decoder tickets, workers/frames, pending
runtime/load/transport work, renderer/context resources, and failures to
settle. Page totals are separate and may stay nonzero for peers. An incomplete
receipt blocks the successor and `finalDisposed`; a later completed receipt can
recover on a subsequent serialized operation.

Disconnection, final disposal, page hide, visibility suspension, motion-policy
change, context loss, realm adoption, and source replacement can race.
Exactly one coordinator decides which generation may publish. Every controller
close is idempotent; cleanup errors are normalized and do not skip later
owners. Final `dispose()` resolves only when outstanding request readers,
timers, callbacks, listeners, frames, bitmaps, workers, decoders, GL objects,
leases, target listeners, observers, media-query subscriptions, and public
waits owned by that participant are zero. Shared page totals are diagnostic
context, not a per-element zero requirement.

## 21. Verification and Evidence

### 21.1 Unit, type, and property coverage

Deterministic tests cover:

- SSR-safe root import and browser-only auto registration;
- initial/repeated definition, foreign collision, and multiple package copies;
- pre-upgrade properties, observed/reflected attributes, invalid values, and
  same-task configuration coalescing;
- shadow layer order and no-clear fallback/static/animated/fatal swaps;
- connected prepare, empty source, source identity replacement, late callback
  suppression, same-task DOM move, true disconnect/reconnect, and final
  disposal;
- preparation idempotency, caller abort/timeout, state attribute queuing,
  `setState`/`send`/`readyFor`, pause/resume, and settlement order;
- typed, immutable, bubbling/composed events, listener reentrancy, underflow
  incident coalescing, and quiet expected aborts;
- host and explicit interaction targets, unresolved IDs, pointer/focus
  aggregation, touch exclusion, native button mouse/keyboard activation,
  initial metadata sampling, binding disable, and canonical source order;
- live auto/reduce/full motion, broker reference counts, rapid policy flips,
  and no reduced loops;
- document/intersection/box visibility, visible/manual autoplay, explicit pause
  retention, hide/show intent order, BFCache signals, and resume rebuild;
- intrinsic and explicit size, contain/cover/fill/none, ResizeObserver bursts,
  fractional boxes, DPR changes, clamps, zero size, and exact plane geometry;
- immutable bounded diagnostics and hostile text/URL/header/identifier
  exclusion;
- React-style property-before-upgrade, ref assignment, controlled `state`,
  event subscription, and same-task rerender behavior; and
- exact cleanup counters after failure/race injection at every phase.

Property/mutation tests vary attribute strings, state/event identifiers,
observer ordering, media-query flips, source generations, promise aborts,
dimensions, DPR, native event sequences, and disconnect timing. All loops,
queues, trace arrays, and allocation terms retain explicit caps.

### 21.2 Real browser proof

The M8 browser proof imports only `@pixel-point/aval-element` public entries and
uses real custom-element upgrade, HTTP M7 loading, worker WebCodecs, WebGL2,
Canvas2D statics, observers, media query, and input events. It covers:

- zero-code one-state intro/partial-loop playback;
- an all-routes transparent user-state asset;
- state attribute updates before/during/after readiness;
- hover, focus retention across pointer leave, native button keyboard
  activation, custom host `send`, and bindings disabled;
- exact DOM event/property/promise ordering;
- live reduced/full transition, manual pause/resume, offscreen suspension, and
  no intro replay on re-entry;
- CSS resize, fit, DPR, static/animated plane equivalence, and transparent
  composition;
- unsupported animation, integrity/network failure, strict static failure, and
  light-DOM fallback continuity;
- rapid source/config replacement and disconnect/reconnect cleanup;
- multiple visible/hidden elements under M7 page budgets; and
- diagnostic snapshots with zero terminal owners.

A separate JavaScript-disabled page verifies that the light-DOM fallback and
author baseline sizing remain usable. CORS/CSP fixtures prove anonymous and
credentialed behavior without committing secrets. Unsupported browser
capability is reported honestly as static; M8 does not substitute mocked GL,
`<video>`, or another codec.

The successful Chromium production proof runs three consecutive times. M9
later adds named-device performance certification and observed-display claims.

### 21.3 Adoption and package gates

The final evidence records:

- exact source/tool/browser versions and public fixture digests;
- root/auto entry contents, module-worker URL, tarball contents, and gzip size;
- first-use direct compile commands and deterministic output;
- starter provenance, project/asset validation, and all public examples;
- dev-watch invalid/valid generation behavior;
- public attribute/property/type declarations;
- event traces for interaction, state, fallback, source replacement, and
  reentrancy;
- motion/visibility/pause/resume and resize/DPR traces;
- accessibility tab/click/name assertions and no injected semantics;
- transport/resource/cleanup snapshots without secret values;
- unit/browser pass counts, mutation seeds, security/maintainability audit;
  and
- an explicit boundary: no permanent product naming, framework wrapper,
  native runtime, authoring GUI, telemetry/service worker/persistent cache, or
  M9 certification claim.

## 22. Non-goals

M8 does not add:

- a new compiled format version, codec, alpha layout, graph feature, binding
  source, expression language, selector language, or runtime graph editor;
- direct frame/time seeking, playback-rate control, arbitrary loop attributes,
  or an `HTMLVideoElement` fallback;
- a React/Vue/Svelte wrapper or a mandatory framework dependency;
- automatic roles, focusability, keyboard synthesis, live regions, business
  actions, navigation, analytics, or state persistence;
- runtime recoloring, text/image slots inside the rendered pixels, hit regions,
  audio, or captions;
- object-position controls, filters, author shaders, or public shadow-canvas
  mutation;
- a visual timeline/graph authoring application, cloud encoder, hosted CDN,
  account, registry, marketplace, or collaboration;
- service-worker integration, Cache Storage/IndexedDB persistence, background
  prefetch, authenticated early ranges, or asset telemetry;
- mobile animated certification, permanent package/tag/extension naming, or
  standards/patent-safety claims; or
- the M9 named-profile performance and observed-display certification report.
