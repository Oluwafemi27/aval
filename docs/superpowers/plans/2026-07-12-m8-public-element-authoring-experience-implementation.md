# M8 Public Element and Authoring Experience Implementation Plan

**Date:** 2026-07-12

**Design:** [M8 Public Element and Authoring Experience Design](../specs/2026-07-12-m8-public-element-authoring-experience-design.md)

## Outcome

Add one framework-neutral, SSR-safe `@pixel-point/aval-element` package over
the completed M7 browser runtime. Make a one-state compiled asset work through
one definition call and one HTML tag, while preserving arbitrary authored
states, exact graph settlement, automatic engagement bindings, reduced-motion
static behavior, visible autoplay, pause/resume, responsive fit/DPR,
progressive fallback, bounded diagnostics, and complete generation cleanup.

Finish the adoption path around that element: actionable direct-compile
output, a licensed/provenanced idle-hover starter, a loopback watch playground,
plain HTML/CDN/npm/React/accessibility/hosting documentation, and real-browser
evidence using only public APIs. Preserve compiled wire version `0.1` and the
single M7 player/resource path.

M7 must be gated and committed before production M8 implementation begins.
M8 is one later intentional milestone commit after its complete evidence gate
passes. Preparing this plan does not authorize an external npm publish, CDN
upload, product-name decision, or certification claim.

## Engineering Rules

- Write a failing focused test before each production slice. Use pure injected
  seams for controller unit tests and real Playwright DOM for browser semantics;
  do not rely on a DOM polyfill to certify custom-element behavior.
- Preserve compiled format `0.1`, source project `0.1` compatibility, and the
  normalized source project `0.2` path. M8 adds no manifest field or binding
  source.
- `@pixel-point/aval-element` may depend on public
  `@pixel-point/aval-player-web` exports only. It must not import player private
  paths, parse the container, fetch payloads, decode media, schedule frames,
  manage page leases, validate PNG, or implement graph routing again.
- Keep the package root safe in a process with no DOM globals. Touch
  `HTMLElement`, `customElements`, `document`, canvas, observers, or media
  queries only after an explicit browser definition/connection call.
- Keep root registration side-effect-free. Limit automatic registration to the
  explicit `/auto` entry and mark that entry as the sole package side effect.
- Keep one serialized element lane for source configuration, declarative state,
  visibility, motion policy, pause/resume, recovery, and disposal. Every async
  callback carries an asset generation.
- Never reveal an undrawn canvas, stale-source frame, or failed
  replacement. The last usable fallback layer stays visible until a new layer
  has drawn successfully.
- Use manifest bindings exactly. Do not infer `hovered`, `active`, `success`,
  or any other state name from DOM input.
- Do not add role, `tabindex`, keyboard synthesis, live region, navigation,
  analytics, or business action. Observe an explicit semantic interaction
  target without changing it.
- Use the existing M6 motion setter, M7 visibility setter, M6 presentation
  geometry, and M7 resource accounting. Do not create element-local policy or
  memory implementations.
- Bound and freeze public event/diagnostic data. Never expose URL, path, ETag,
  headers, integrity values, response bodies, fallback markup, raw errors,
  bytes, browser media objects, GL objects, or leases.
- Make source replacement, disconnect, reconnect, same-task DOM moves, observer
  races, and final disposal explicit tests. Every terminal counter reaches zero.
- Keep production files focused by authority. The HTMLElement adapter must not
  become a giant controller.
- Keep the default package silent: no console output, global devtools hook,
  telemetry, remote import, inline script, blob worker, `eval`, or
  `new Function`.
- Do not add a framework wrapper, visual editor, hosted service, persistent
  cache, service worker, runtime seek/speed API, or M9 certification work.
- Do not commit `dist`, package tarballs, Vite output, Playwright traces,
  browser caches, generated user projects, source video, credentials, local
  URLs, absolute paths, or raw unbounded traces.

## Execution Order

### 1. Scaffold the element package and freeze public contracts

Add:

```text
packages/element/package.json
packages/element/tsconfig.json
packages/element/tsconfig.test.json
packages/element/src/index.ts
packages/element/src/auto.ts
packages/element/src/public-types.ts
packages/element/src/errors.ts
packages/element/test/public-api.compile.ts
packages/element/test/public-api.test.ts
```

Update the root workspace/project references and package lock. Add no runtime
dependency beyond `@pixel-point/aval-player-web` and the types it publicly
re-exports.

Freeze closed public unions for:

- prototype tag name and definition result;
- autoplay, automatic bindings, cross-origin, motion, and fit values;
- reflected attributes and element property types;
- staged readiness/mode/state/input-binding properties;
- prepare, state request, event send, route readiness, pause/resume, diagnostic,
  and final-dispose methods;
- immutable DOM event detail and event-name maps;
- immutable diagnostics summary/trace options; and
- element configuration/fallback failure codes layered over normalized runtime
  failures.

Add `HTMLElementTagNameMap` typing for the default prototype tag and typed
`addEventListener` overloads without importing React. Export a plain
`AvalElementAttributes` interface for framework type augmentation.
Compile hostile examples proving closed enums, read-only staged properties,
read-only state/binding lists, immutable event detail, and nonconstructible
diagnostic/resource internals.

Keep `package.json` release-safe but do not externally publish. The package
exports root and `/auto`; root is marked side-effect-free and `/auto` is listed
as the one intentional side effect.

Run:

```text
npx vitest run packages/element/test/public-api.test.ts
npm run typecheck -w @pixel-point/aval-element
```

### 2. Implement SSR-safe, collision-safe custom-element registration

Add:

```text
packages/element/src/definition.ts
packages/element/src/definition-marker.ts
packages/element/test/definition-node.test.ts
tests/browser/m8-definition.spec.ts
```

Implement `defineAvalElement()` so it:

1. validates a browser environment;
2. checks the browser's `CustomElementRegistry` for `aval-player`;
3. returns an existing constructor only when it carries this package's
   compatible symbol/version marker;
4. rejects a foreign definition with bounded `NotSupportedError`;
5. creates and installs the HTMLElement subclass when absent; and
6. returns that installed constructor.

Use a `Symbol.for` marker containing only the public element API major, not a
mutable global registry. Prove duplicate physical package copies converge for
the same API marker and reject incompatible ownership.

The Node test imports the package root with no DOM globals and asserts no side
effect. The browser test covers initial and repeated definition, foreign
collision, duplicate compatible package copies, and `/auto` registration.
Importing `/auto` without browser globals may reject with
a precise environment error; the root must remain safe.

Run:

```text
npx vitest run packages/element/test/definition-node.test.ts
npx playwright test tests/browser/m8-definition.spec.ts --project=chromium --workers=1
```

### 3. Build the shadow fallback and presentation-layer owner

Add:

```text
packages/element/src/shadow-layers.ts
packages/element/src/shadow-style.ts
tests/browser/m8-shadow-layers.spec.ts
```

Create one open shadow root with fixed DOM API calls and fixed package styling.
Own a named fallback slot, strict static canvas, and animated canvas. Mark
internal visual layers non-focusable, `aria-hidden`, and pointer-transparent;
never mutate host semantics or slotted fallback nodes. There is no independent
image request or external image-source API.

`ShadowLayerOwner` exposes narrow operations:

- show light-DOM fallback;
- provide static/animated canvases to the public M7 browser composition;
- atomically reveal static after draw;
- reveal animation after prepared first draw; and
- return to fallback on fatal current-generation failure.

The owner rejects reveal-before-draw and never clears a visible layer first.
Verified source statics are the only package-owned fallback enhancement, so an
unrelated image request cannot bypass source integrity or cover a ready source.

Browser tests inspect exact layer order/visibility through upgrade,
static cover, animated reveal, source reset, fatal fallback, CSS-disabled
enhancement, and disposal. Include a JavaScript-disabled fallback page later
in the M8 proof; this slice verifies the defined element only.

Run:

```text
npx playwright test tests/browser/m8-shadow-layers.spec.ts --project=chromium --workers=1
```

### 4. Implement exact attribute/property normalization and coalescing

Add:

```text
packages/element/src/element-attributes.ts
packages/element/src/element-configuration.ts
packages/element/src/configuration-queue.ts
packages/element/test/element-configuration.test.ts
tests/browser/m8-properties.spec.ts
```

Define the exact observed attribute list:

```text
src integrity crossorigin motion autoplay fit bindings state
interaction-for width height
```

Implement one parser/normalizer per closed value. Property setters validate
before reflection and throw without mutation. Attribute mutations normalize
invalid input to the documented default, retain a bounded configuration
failure, and schedule a nonfatal error after connection. Empty `src` means no
asset, not an error. Treat absent/empty cross-origin as anonymous.

Enforce the design caps: 4,096 UTF-16 code units for source strings, 256
for interaction IDs, format identifier bounds for state intent, and positive
integer size hints no greater than 16,384 CSS pixels. URL resolution/fetch and
canvas backing retain the stricter M7 and M6 bounds respectively.

Upgrade own pre-definition properties using delete-and-reassign before the
first configuration snapshot. Coalesce all mutations from one task to one
microtask, deriving one immutable configuration and one change set. Retrieval
identity is exactly `src` + `integrity` + `crossorigin`; only those changes
replace the asset generation. Policy, fit, input, state, and size changes route
to their separate owners.

Test permutations and mutations of every enum, integer boundary, identifier,
integrity token, URL string, reflection direction, pre-upgrade property, and
same-task update sequence. In the browser, simulate a framework assigning
properties before definition and batching props after definition. Assert one
source generation and latest declarative state.

Run:

```text
npx vitest run packages/element/test/element-configuration.test.ts
npx playwright test tests/browser/m8-properties.spec.ts --project=chromium --workers=1
```

### 5. Build the sole element asset-generation and runtime composition

Add:

```text
packages/element/src/asset-generation.ts
packages/element/src/browser-runtime-factory.ts
packages/element/src/element-controller.ts
packages/element/src/element-lifecycle.ts
packages/element/test/asset-generation.test.ts
packages/element/test/element-lifecycle.test.ts
```

Audit and, if necessary, complete public M7 exports for:

- bounded URL asset opening with credentials/integrity;
- the shared page resource manager;
- verified sparse catalog/player creation;
- neutral browser AVC candidate/worker/renderer composition;
- strict static store and presentation-plane integration;
- motion and visibility setters;
- realtime pause/resume and context recovery;
- public state/readiness events, snapshots, diagnostics, and cleanup waits.

Do not expose private maps, byte buffers, response objects, leases, worker
ports, or GL handles merely for M8. If one composition call is unwieldy, add a
focused public `createBrowserRuntimePlayer()` facade in player-web that owns
the existing collaborators; do not rebuild them in element.

`ElementAssetGeneration` owns exactly one M7 session/player, root abort,
presentation layer attachment, public wait registry, and generation guard.
Construction is metadata/static-first. It starts automatically only while
connected with non-empty source. It publishes no event until public staged
state is ready.

Replacement order is strict: mark old terminal, abort its public waits and
input dispatch, await complete M7 disposal, reset asset-specific public state,
show the author fallback, then open the new source. Never overlap decoder
or page participant ownership across generations. When B and then C arrive
while A is cleaning up, B is retired before resource creation and only C may
start.

Every retirement publishes an immutable cleanup receipt keyed by element and
source generation. Completion requires zero participant registration, bytes,
leases, lifecycle cleanup/work/waits, decoder tickets, worker/frame/runtime
work, loader bodies/waiters, renderer/context resources, and cleanup failures.
Page totals are contextual and may remain nonzero for peer elements. An
incomplete receipt blocks a successor and terminal disposal; a later completed
receipt may recover on a subsequent serialized lane operation.

`ElementLifecycle` schedules disconnect cleanup to a microtask, cancels it for
a same-task reconnect, starts a new generation after a real reconnect, and
distinguishes final public disposal. Test late loader/player/observer
callbacks, replacement during every readiness phase, disconnect during each
phase, reconnect, final disposal, cleanup failure continuation, and exact zero
owner counters.

Cross-document/root reconnection clears the old object-only interaction target,
unpublishes its event bridge before new callbacks, and rebinds constructed
styles plus realm observers. The new realm starts a source only after the old
receipt completes. Same-root same-task movement remains the preservation case.

Run:

```text
npx vitest run packages/element/test/asset-generation.test.ts packages/element/test/element-lifecycle.test.ts
npm run typecheck -w @pixel-point/aval-element
```

### 6. Implement the public readiness, state, and playback facade

Add:

```text
packages/element/src/public-operations.ts
packages/element/src/public-waits.ts
packages/element/src/state-intent.ts
packages/element/test/public-operations.test.ts
packages/element/test/state-intent.test.ts
```

Expose staged getters only; no caller reads the player directly. Implement:

- automatic connected preparation and idempotent explicit `prepare()`;
- caller-scoped abort/timeout wrappers around the element-owned preparation;
- immutable readiness result reuse within one generation;
- `setState()` with exact graph promise settlement;
- synchronous `send()` and `readyFor()`;
- pre-metadata declarative state retention and post-metadata application;
- `pause()` manual intent and `resume()` usability/rebuild wait; and
- final `dispose()`.

The element root signal is always the shared preparation owner. Do not let an
explicit caller signal or timeout abort that shared operation; it bounds only
that caller's wait, can shorten but not extend the element deadline, and every
captured wait rejects on source replacement/disconnect/disposal. Before
metadata, `setState()` rejects,
`send()`/`readyFor()` return false, and only the declarative `state` property is
queued.

An invalid declarative state preserves the prior accepted runtime request,
keeps the written attribute for debugging, and reports one nonfatal normalized
error. Imperative `setState()` never mutates the state attribute. A static
prepare result and static state transition are successful outcomes.

Unit tests use a deterministic fake public player to cover every readiness
phase, stable no-op, duplicate join, supersession, route error, static
recovery, in-flight source replacement, caller abort/timeout, pause while
transitioning, request while paused, reclaimed resume, hidden resume, reduced
resume, and final disposal.

Run:

```text
npx vitest run packages/element/test/public-operations.test.ts packages/element/test/state-intent.test.ts
```

### 7. Bridge staged runtime effects into typed DOM events

Add:

```text
packages/element/src/dom-event-bridge.ts
packages/element/src/dom-event-detail.ts
packages/element/test/dom-event-bridge.test.ts
tests/browser/m8-events.spec.ts
```

Translate the sole M7/player event stream into immutable bubbling, composed
(except for the direct-host, native-media-style `error` event),
noncancelable `CustomEvent`s for readiness, requested state, visual state,
transition start/end, underflow, fallback, and error. Add current element
generation without copying secret transport data. Normalize runtime failures
through one public failure copier.

Stage public getters before dispatch. Preserve pre-draw/post-draw event order
and settle state promises only in the player-authored microtask after visible
events. Queue listener-triggered state, policy, source, and disposal operations
behind the current event transaction.

Treat each M7 underflow callback as one canonical incident; M7 already
coalesces consecutive misses and resets that coalescer after recovery. Retain
the exact cumulative diagnostic count without a second element-local
coalescer. Do not emit error for
expected abort/supersession/disconnection/disposal. Test hostile listener
throws, listener reentrancy, source replacement from an event, event detail
mutation attempts, bubbles/composed delegation, stale generation suppression,
the direct-host error exception, and exact event/property/promise traces in a
real browser.

Run:

```text
npx vitest run packages/element/test/dom-event-bridge.test.ts
npx playwright test tests/browser/m8-events.spec.ts --project=chromium --workers=1
```

### 8. Implement manifest binding routing and engagement aggregation

Add:

```text
packages/element/src/binding-router.ts
packages/element/src/interaction-target.ts
packages/element/src/engagement-controller.ts
packages/element/src/automatic-inputs.ts
packages/element/test/binding-router.test.ts
packages/element/test/engagement-controller.test.ts
tests/browser/m8-inputs.spec.ts
```

Build one immutable source-to-event map from the validated manifest. Duplicate
sources are impossible after format validation; nevertheless reject hostile
injected test data. Source routing calls only the public `send(event)` path and
never names a destination state.

Resolve interaction target in this order: explicit `interactionTarget`
property, same-root `interaction-for` ID, then host when no explicit ID exists.
Reject non-Element, cross-document, and cross-shadow-root objects. A missing
explicit ID disables pointer/focus/activate binding, reports once, and retries
at connection, metadata, attribute change, or direct assignment.

Attach pointer, focusin/focusout, and click listeners without changing or
canceling host behavior. Ignore touch pointer hover latching. Maintain exact
pointer/focus OR engagement edges. Use native click for activation; do not
listen for Enter/Space or synthesize click. Removing/changing targets detaches
all old listeners.

Track raw signals from connection, then sample at metadata readiness in
canonical pointer/focus/engagement/visibility order before routing. Test rapid
enter/leave/focus sequences, focus retained after pointer leave, pointer
retained after focus out, touch activation without hover, nested focus,
relatedTarget edge cases, target replacement, bindings none/auto, invalid
targets, native button pointer click, and native button keyboard click in
Playwright.

Run:

```text
npx vitest run packages/element/test/binding-router.test.ts packages/element/test/engagement-controller.test.ts
npx playwright test tests/browser/m8-inputs.spec.ts --project=chromium --workers=1
```

### 9. Wire live reduced-motion through one page-scoped broker

Add:

```text
packages/element/src/motion-preference-broker.ts
packages/element/src/element-motion-policy.ts
packages/element/test/motion-preference-broker.test.ts
packages/element/test/element-motion-policy.test.ts
tests/browser/m8-motion-policy.spec.ts
```

Create a `WeakMap<Window, MotionPreferenceBroker>` only after connection. Each
broker owns one reduced-motion `MediaQueryList`, immutable current sample,
subscriber set, and reference-counted listener. Listener teardown occurs when
the last auto-policy element disconnects/disposes.

Map `auto`, `reduce`, and `full` only to public M6 player setters. Initial
preference is applied before preparation. Live media-query and attribute
changes enter the element serialized lane and retain M6 cover/re-entry/sticky
failure behavior. Rapid flips are latest-generation-wins.

When `matchMedia` is unavailable, report an unsupported broker capability and
let normal runtime capability/static selection proceed without claiming a host
preference. Test reduce-before-prepare creates no animation candidate; full to
reduce covers current requested state; reduce to full begins body frame zero
without intro; focused/hovered state survives; pre-cover cancellation and
sticky failures match M6; no reduced infinite loop advances.

Run:

```text
npx vitest run packages/element/test/motion-preference-broker.test.ts packages/element/test/element-motion-policy.test.ts
npx playwright test tests/browser/m8-motion-policy.spec.ts --project=chromium --workers=1
```

### 10. Implement document/viewport visibility, autoplay, and pause intent

Add:

```text
packages/element/src/document-visibility-broker.ts
packages/element/src/element-visibility.ts
packages/element/src/autoplay-intent.ts
packages/element/test/element-visibility.test.ts
packages/element/test/autoplay-intent.test.ts
tests/browser/m8-visibility.spec.ts
```

Track document visibility/pagehide/pageshow through one page-scoped broker and
host intersection through one element `IntersectionObserver`. Combine them
with a positive measured CSS box. Initial intersection is hidden until the
observer reports. If required observer capability is unavailable, remain
usable static and report unsupported automation rather than pretending visible
animation is certified.

Before each host visibility change, route the manifest's visible/hidden source
intent through the binding router in the same serialized lane. Then call the
M7 visibility seam. Hidden freezes logical time, covers static, aborts
speculative work, and releases animation leases. Visible waits for a current
generation readiness rebuild and first body-zero draw behind static.

Keep manual play intent separate. Visible autoplay initializes true; manual
initializes false. Pause/resume override until the autoplay attribute changes.
Visibility never erases a pause. State requests remain accepted while hidden
or paused and newest intent governs static/rebuild state. `pageshow` never
assumes pre-freeze codec/worker/GL resources survived.

Test observer task reordering, zero-size intersection, document hide during
prepare/bridge/reentry, repeated hide/show, offscreen state changes, pause then
hide/show, resume while hidden, autoplay attribute reset, budget eviction,
BFCache-style signals, source replacement while suspended, disposal, exact
ordinal freeze, body-zero restart, and intro count.

Run:

```text
npx vitest run packages/element/test/element-visibility.test.ts packages/element/test/autoplay-intent.test.ts
npx playwright test tests/browser/m8-visibility.spec.ts --project=chromium --workers=1
```

### 11. Implement intrinsic sizing, ResizeObserver, fit, and DPR

Add:

```text
packages/element/src/intrinsic-size.ts
packages/element/src/presentation-observer.ts
packages/element/src/dpr-broker.ts
packages/element/test/intrinsic-size.test.ts
packages/element/test/presentation-observer.test.ts
tests/browser/m8-presentation.spec.ts
```

Derive the intrinsic display ratio/size only from validated manifest canvas
and pixel aspect. Width/height hints reserve early space; author CSS wins.
Avoid setting author-owned inline width/height. Use package-owned shadow/host
rules and internal custom properties with documented precedence. Test unknown
element fallback sizing separately from defined-element intrinsic behavior.

Observe the host content box, ignore non-finite/nonpositive hostile reports,
and coalesce resize bursts to one animation frame. A page-scoped DPR broker
uses a rebuilt resolution media query plus viewport/window resize sampling and
notifies only on finite positive changes. Remove every listener/query on last
subscriber.

Pass CSS dimensions, DPR, fit override, and leased backing byte limit to the
one M6 `BrowserPresentationPlanes.resize()` authority. Do not derive crop or
canvas backing size in element. Equivalent resize must not clear/redraw;
changed resize redraws the current static and animated frame under the same
mapping without a graph tick.

Test manifest/default fit, every override, odd logical dimensions, pixel
aspect, fractional CSS sizes, DPR 1/1.25/2/3, resize storms, equivalent resize,
zero size, format/device/byte clamps, source replacement with new aspect,
static/animated swaps, and exact plane/backing equality in a real browser.

Run:

```text
npx vitest run packages/element/test/intrinsic-size.test.ts packages/element/test/presentation-observer.test.ts
npx playwright test tests/browser/m8-presentation.spec.ts --project=chromium --workers=1
```

### 12. Add bounded diagnostics, public failure normalization, and security tests

Add:

```text
packages/element/src/diagnostics.ts
packages/element/src/element-trace.ts
packages/element/src/public-failure.ts
packages/element/test/diagnostics.test.ts
packages/element/test/security.test.ts
```

Compose `getDiagnostics()` from immutable public M7/player snapshots and
element-owned counters. Copy only the design fields; do not return collaborator
snapshots by reference if they contain extra/private data. Cap element and
runtime traces at 512 records each and all text at the shared bounded limit.
Deep-freeze lists, records, contexts, and last failure.

Count source/input/motion/visibility/resize generations, prepare/source
replacement/pause/resume/underflow/fallback/context-recovery/cleanup events,
and outstanding owner categories. Diagnostics are observational and can never
trigger reclamation, retry, fetch, prepare, or graph work.

Fuzz source strings, integrity tokens, ETags/headers via fake M7 failures,
state/event IDs, target IDs, fallback nodes, thrown objects, observer entries,
dimensions, and event-listener errors. Assert no HTML/CSS/selector/code
interpretation, terminal escape, secret text, browser object, URL/path,
credentials, raw byte, or mutable authority appears in messages, DOM events,
snapshots, or traces.

Search and classify every `innerHTML`, selector construction, console/global,
blob worker, dynamic code, credentials, and raw error path.

Run:

```text
npx vitest run packages/element/test/diagnostics.test.ts packages/element/test/security.test.ts
rg -n "innerHTML|insertAdjacentHTML|querySelector|console\.|window\[|globalThis\[|new Blob|eval\(|new Function|credentials|detail:" packages/element/src
```

### 13. Finish progressive fallback and accessibility behavior

Add/update:

```text
packages/element/test/accessibility-contract.test.ts
tests/browser/m8-progressive-accessibility.spec.ts
apps/playground/m8-no-js.html
apps/playground/src/m8-accessible-control.ts
```

Prove the element never adds role, tabindex, accessible name, live region,
keydown handler, ARIA state, navigation, or business click. Internal canvases
remain presentation-only. Slotted fallback stays host-owned and available
without JavaScript.

Build a native button example with explicit `interaction-for`, empty-alt
fallback, visually hidden label, focus-visible styling owned by the page, and
separate semantic status updates. Test tab order, browser-native Enter/Space
click, pointer click, focus/pointer engagement retention, reduced motion,
missing JS, failed definition, failed network/CORS/CSP simulation, failed
unsupported animation, and fatal strict-static fallback.

For nonessential motion over five seconds, documentation—not automatic
element semantics—provides the pause-control requirement. Assert animation is
not the sole loading/success/error announcement in shipped examples.

Run:

```text
npx vitest run packages/element/test/accessibility-contract.test.ts
npx playwright test tests/browser/m8-progressive-accessibility.spec.ts --project=chromium --workers=1
```

### 14. Polish the direct one-command loop output

Update/add:

```text
packages/compiler/src/commands/compile.ts
packages/compiler/src/commands/compile-publication.ts
packages/compiler/src/cli-output.ts
packages/compiler/src/diagnostics.ts
packages/compiler/src/adoption-summary.ts
packages/compiler/test/direct-adoption.test.ts
packages/compiler/test/cli-output.test.ts
```

Do not change direct compile semantics: input intro `[0, loopStart)`, closed
body `[loopStart, loopEnd)`, unused tail warning, one `idle` state, strict
static from body frame zero, and empty binding table. Keep frame indices
canonical; printed time is explanatory.

On success, produce one deterministic bounded adoption summary containing
frame rate/ranges and times, visible/storage/coded geometry, alpha decision,
asset/resource estimates, continuity/static/alpha summaries, output digest,
and escaped copyable npm/HTML snippets. JSON output receives corresponding
closed fields without ANSI/control text.

Make every common first-run failure actionable: FFmpeg discovery/profile,
variable frame rate, invalid loop range, unused tail, seam duplicate/mismatch,
alpha quality, source bounds, output collision, and publication failure. Each
has one stable code, field/frame context, and remediation sentence. Never
weaken M5/M6 validation to make output friendlier.

Test opaque/alpha image sequences and rendered video with deterministic fake
tool seams, every half-open range boundary, hostile filenames/control text,
TTY/non-TTY/JSON output, and byte-identical compiled output before/after the
presentation-only CLI changes.

Run:

```text
npx vitest run packages/compiler/test/direct-adoption.test.ts packages/compiler/test/cli-output.test.ts
npm run typecheck -w @pixel-point/aval-compiler
```

### 15. Replace the placeholder init output with the idle-hover starter

Update/add:

```text
packages/compiler/src/commands/init.ts
packages/compiler/src/commands/init-template.ts
packages/compiler/test/init-starter.test.ts
fixtures/starter/m8-idle-hover/
fixtures/starter/m8-idle-hover/provenance.json
```

Create the complete project in a temporary sibling directory, fsync/write as
supported, validate every generated project/media file, and rename into an
initially absent target. Preserve the existing no-overwrite/race-safe rules.

The template contains source project 0.2, generated/licensed RGBA frames,
idle/hover looping bodies, one short reversible bridge with restart runways,
strict statics, engagement on/off bindings, a native-button element example,
local build scripts, and a concise README. JSON remains valid JSON; explanatory
comments live in README. Record deterministic generator/source/frame/project
digests, license, and provenance.

Compile the generated project with the recorded real FFmpeg toolchain, validate
and inspect its asset, run it through the public element proof, and assert the
starter contains no credentials, remote URL, account/upload step, framework,
generated build output, absolute path, or ambiguous ownership/license.

Run:

```text
npx vitest run packages/compiler/test/init-starter.test.ts
npm run build -w @pixel-point/aval-compiler
node packages/compiler/dist/cli.js init .tmp-m8-starter
node packages/compiler/dist/cli.js compile .tmp-m8-starter/project.json --out .tmp-m8-starter/output.avl
node packages/compiler/dist/cli.js validate .tmp-m8-starter/output.avl
```

Remove temporary output after the manual gate; never commit it.

### 16. Extend `avl dev` into the public-element watch playground

Update/add:

```text
packages/compiler/src/commands/dev.ts
packages/compiler/src/commands/dev-server.ts
packages/compiler/src/commands/dev-publication.ts
packages/compiler/test/dev-server.test.ts
apps/playground/m8-dev-entry.html
apps/playground/src/m8-dev-client.ts
apps/playground/src/m8-diagnostics-panel.ts
```

Preserve the existing 100 ms aborting single-flight watcher. Add a bounded
loopback-only HTTP server that serves the last validated atomically published
asset with the exact M7 range/entity/identity headers and the M8 page/module
assets. No invalid build replaces the last valid bytes. A successful build
increments a bounded generation and tells the browser to set a cache-busted
local `src`, thereby exercising real element replacement/cleanup.

Use a bounded same-origin event stream or WebSocket with explicit message
grammar, connection/body/message caps, ping/watchdog cleanup, and no remote
control. Bind `127.0.0.1`/`::1` only by default. Do not expose source files,
accept uploads, execute browser input, disable validation, or add permissive
production CORS. `--open` is opt-in and uses a safely constructed local URL.

The page discovers states/events/bindings through public element properties,
drives only public methods, and renders `getDiagnostics()` plus compiler report
data. Include rapid state/event controls, engagement target, motion/autoplay,
visibility instruction, fit/size/DPR views, source-replacement button,
multi-player budget stress, frame ruler, continuity/alpha summaries, and exact
underflow/fallback/resource counts.

Test port collision, bind failure, malformed requests/ranges, slow/stalled
clients, disconnect, repeated rebuilds, invalid edit retention, valid atomic
replacement, watcher path changes, cancellation, terminal server cleanup, and
no source/credential/path leakage to the browser.

Run:

```text
npx vitest run packages/compiler/test/dev-command.test.ts packages/compiler/test/dev-server.test.ts
npm run build -w @pixel-point/aval-compiler
```

### 17. Write public integration, hosting, and framework documentation

Add:

```text
docs/element/getting-started.md
docs/element/attributes-and-api.md
docs/element/states-events-and-bindings.md
docs/element/accessibility.md
docs/element/react.md
docs/element/hosting-cors-csp-integrity.md
docs/element/fallback-and-reduced-motion.md
docs/element/diagnostics.md
docs/compiler/quick-loop.md
docs/compiler/user-defined-states.md
docs/compiler/dev-workflow.md
examples/plain-html/
examples/react-ref/
```

Keep the first path short: install/define, direct compile, tag with fallback,
expected loop. Then progressively introduce user-defined state markup,
imperative acknowledgement, custom authored events, engagement bindings,
native semantic wrappers, reduced motion, pause/resume, fit, source
replacement, and diagnostics.

Document pinned CDN `/auto` and npm explicit-definition entries without
claiming an actual published version before release. State the prototype
package/tag/extension naming. The React example uses a typed ref,
`addEventListener`, controlled `state`, and optional `interactionTarget` effect;
it adds no wrapper package or runtime dependency.

Hosting guidance gives exact M7 range, strong ETag, identity encoding,
Content-Length/Content-Range, CORS anonymous/credentialed, CSP connect/worker,
module worker, MIME, caching, and external integrity consequences. Include
copyable server examples only when their header behavior is exact and tested.

Run every command/snippet through a documentation fixture test. Typecheck the
React example against a pinned dev-only React version if already acceptable to
the repository; otherwise compile the exported framework-neutral attribute/ref
types and test the actual browser output without adding a production React
dependency.

Run:

```text
npm run typecheck
npm run build
git diff --check
```

### 18. Create deterministic M8 element/adoption fixtures

Add:

```text
fixtures/conformance/m8/one-state-partial-loop.avl
fixtures/conformance/m8/user-states-all-routes-alpha.avl
fixtures/conformance/m8/provenance.json
fixtures/conformance/m8/update-provenance.mjs
apps/playground/m8-http-fixture-plugin.ts
```

The one-state fixture has a visible intro and partial body loop with robust
machine-readable frame tags. The multi-state fixture uses arbitrary names,
transparent/fractional/opaque pixels, every M5.5 route family, strict shared
and distinct statics, engagement/activate/visibility bindings, odd dimensions,
and lower-rendition selection. Reuse the canonical M6/M7 assets only if they
already prove every M8 public path; do not create visually similar duplicate
fixtures without a missing requirement.

Provenance records source-frame, project, compiler, FFmpeg, final asset,
manifest/index, and external-integrity digests plus exact tool versions and
license. Regeneration must be deterministic for the recorded environment and
must never update expected hashes implicitly during tests.

The HTTP fixture plugin exposes exact success plus bounded CORS, credential,
integrity, range, entity-change, stalled, missing, and CSP cases. It
never writes secret header values to reports.

Run:

```text
npm run build -w @pixel-point/aval-compiler
node fixtures/conformance/m8/update-provenance.mjs --check
node packages/compiler/dist/cli.js validate fixtures/conformance/m8/one-state-partial-loop.avl
node packages/compiler/dist/cli.js validate fixtures/conformance/m8/user-states-all-routes-alpha.avl
```

### 19. Build the public-API-only M8 real browser proof

Add:

```text
apps/playground/src/m8-element-proof.ts
tests/browser/m8-element-adoption.spec.ts
```

The page imports the root definition helper or `/auto`, uses only the public
custom element/API, and exposes a bounded serializable report. It must not
import player-web private modules, construct fake player collaborators, patch
the custom-element internals, or read the shadow canvases to bypass public
state except for explicit pixel-composition evidence already allowed by the
M6 proof harness.

Prove in one deterministic flow:

1. no-JS light-DOM fallback in a separate browser context;
2. root and auto registration/upgrade plus pre-definition props;
3. one-state intro followed by many exact partial-loop boundaries;
4. transparent all-routes arbitrary states through state attribute,
   `setState`, `send`, and automatic bindings;
5. pointer/focus engagement, pointer leave while focused, native button
   keyboard activation, visible/hidden binding, and bindings none;
6. property/event/promise ordering and listener reentrancy;
7. static-first readiness, live reduce/full, no reduced loop, manual
   pause/resume, offscreen/document suspension, body-zero rebuild, no intro
   replay, and no elapsed-time catch-up;
8. contain/cover/fill/none, resize, DPR, odd transparent geometry, exact plane
   mapping, and clamp diagnostics;
9. anonymous/credentialed CORS, optional external integrity, unsupported
   animation static result, loader failure, strict-static
   failure, and continued progressive fallback;
10. rapid retrieval/config/state replacement, disconnect/reconnect, context
    loss, and stale callback suppression;
11. multiple competing players under default M7 decoder/byte budgets; and
12. exact final zero requests/readers/timers/callbacks/observers/listeners/
    brokers/frames/bitmaps/workers/decoders/GL/leases/waits/participants.

Record scheduled frame order separately from visible pixel evidence. Capture
unsupported capability as static/unsupported, not a mocked animated pass.
Assert no `<video>`, seek, decoder-per-state, or second runtime path appears.

Run the successful production configuration three consecutive times:

```text
npx playwright test tests/browser/m8-element-adoption.spec.ts --project=chromium --workers=1
npx playwright test tests/browser/m8-element-adoption.spec.ts --project=chromium --workers=1
npx playwright test tests/browser/m8-element-adoption.spec.ts --project=chromium --workers=1
```

### 20. Complete mutation, maintainability, package, and claim audits

Add/update:

```text
packages/element/test/element-fuzz.test.ts
packages/element/test/public-api.compile.ts
docs/evidence/2026-07-12-m8-public-element-authoring-experience.md
```

Run seeded configuration/source/input/observer/policy/resize/disconnect/event
mutation tests. Record seeds and bounded maxima. Every rejected generation
asserts the previous/fallback layer remains usable and all created owners
retire.

Run a strict maintainability review and reject:

- an HTMLElement subclass that owns loader, graph, player, bindings,
  visibility, sizing, and diagnostics logic directly;
- any private player-web import or duplicate format/runtime authority;
- DOM globals evaluated by the package root;
- registration as an unmarked root side effect;
- multiple overlapping source generations or untagged async callbacks;
- reveal-before-draw, clear-before-cover, or stale event;
- inferred state names or automatic state transitions outside manifest
  bindings;
- manual key activation, injected semantics, or business actions;
- parallel reduced-motion, visibility, resize geometry, memory, or cleanup
  implementations;
- unbounded observer/event/trace/wait queues;
- raw URL/header/error/byte/browser object exposure;
- console/global/telemetry/debug-overlay side effects;
- invalid watch output replacing the last valid asset; or
- examples that use private APIs or mislabel best-effort as certified.

Searches include:

```text
rg -n "@pixel-point/aval-player-web/src|@pixel-point/aval-(format|graph)/src" packages/element
rg -n "HTMLElement|customElements|document|window|matchMedia|IntersectionObserver|ResizeObserver" packages/element/src
rg -n "innerHTML|insertAdjacentHTML|querySelector|eval\(|new Function|new Blob|console\.|globalThis\[" packages/element/src
rg -n "role|tabindex|aria-|keydown|keyup|preventDefault|stopPropagation|\.click\(" packages/element/src
rg -n "currentTime|seek|HTMLVideoElement|VideoDecoder|WebGL|fetch\(" packages/element/src
rg -n "setState\(.*hover|hovered|success|loading|error" packages/element/src
rg -n "addEventListener|removeEventListener|observe\(|unobserve\(|disconnect\(|setTimeout|requestAnimationFrame" packages/element/src
```

Every match must be the sole intended browser adapter, fixed internal
accessibility attribute, explicit prohibited-term test, or removed.

Build a production consumer entry and record bootstrap, loaded graph, and
worker gzip sizes, package exports, dependency tree, and tarball contents. The
original combined target below 75 KiB was missed and remains recorded as a
miss. Enforce the approved delivery gates instead: complete static bootstrap
closure `< 75 KiB`, complete loaded element/player graph `<= 250 KiB`, and the
self-contained worker `<= 20 KiB` under the pinned production recipe.

## Planned Production Files

```text
packages/element/src/
  index.ts
  auto.ts
  public-types.ts
  errors.ts
  definition.ts
  definition-marker.ts
  aval-element.ts
  element-controller.ts
  element-lifecycle.ts
  element-attributes.ts
  element-configuration.ts
  configuration-queue.ts
  shadow-layers.ts
  shadow-style.ts
  asset-generation.ts
  browser-runtime-factory.ts
  public-operations.ts
  public-waits.ts
  state-intent.ts
  dom-event-bridge.ts
  dom-event-detail.ts
  binding-router.ts
  interaction-target.ts
  engagement-controller.ts
  automatic-inputs.ts
  motion-preference-broker.ts
  element-motion-policy.ts
  document-visibility-broker.ts
  element-visibility.ts
  autoplay-intent.ts
  intrinsic-size.ts
  presentation-observer.ts
  dpr-broker.ts
  diagnostics.ts
  element-trace.ts
  public-failure.ts
```

This list is an ownership map, not permission to create empty or one-function
files. Merge adjacent files when one focused implementation remains easy to
understand; split any file that begins to own multiple authorities.

Existing compiler `compile`, `init`, `dev`, publication, output, and diagnostic
modules are extended in place. Existing M6/M7 player composition, static,
motion, visibility, resource, and presentation files remain the sole runtime
authorities.

## Planned Test, Fixture, Example, and Evidence Files

```text
packages/element/test/*.test.ts
packages/element/test/public-api.compile.ts
tests/browser/m8-*.spec.ts
fixtures/conformance/m8/*
fixtures/starter/m8-idle-hover/*
apps/playground/src/m8-*.ts
apps/playground/m8-*.html
docs/element/*
docs/compiler/*
examples/plain-html/*
examples/react-ref/*
docs/evidence/2026-07-12-m8-public-element-authoring-experience.md
```

The wildcard denotes the focused files in the execution steps, not one giant
test, proof, or documentation module.

## Final M8 Gate

Run from a cleanly understood worktree after M7 is committed:

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
npm pack --dry-run -w @pixel-point/aval-element
git diff --check
```

Also:

- regenerate/verify M8 fixtures and starter with recorded compiler/FFmpeg;
- run every documented compile/init/validate/dev command and public snippet;
- run the production M8 Chromium proof three consecutive times;
- run the JS-disabled, accessibility, CORS/CSP/integrity, source race,
  multi-player, and terminal cleanup browser cases;
- run seeded element/configuration/input/observer/lifecycle mutation suites;
- run strict security and maintainability/authority audits;
- inspect all package/example contents; and
- measure the combined production ESM/worker gzip target.

Write:

```text
docs/evidence/2026-07-12-m8-public-element-authoring-experience.md
```

The evidence records:

- exact commit/tree, Node/npm/TypeScript/Vitest/Vite/Playwright/browser/OS
  versions;
- fixture/starter source/project/compiler/FFmpeg/asset/integrity digests and
  license/provenance;
- package root/auto registration, SSR import, tag collision, and
  pre-upgrade property results;
- exact public attributes/properties/methods/events/types and tarball exports;
- zero-code intro/partial-loop order and all-routes arbitrary state traces;
- declarative/imperative request, event, property, promise, and reentrancy
  ordering;
- pointer/focus/engagement/native keyboard activation and initial-sample
  traces;
- reduced/full, visible/manual, pause/resume, hide/show/BFCache, body-zero,
  intro-count, and logical-ordinal evidence;
- fallback/static/animated layer swaps and no-JS/CORS/CSP/integrity/
  unsupported/fatal behavior;
- CSS size/fit/DPR/backing/clamp and exact static/animated geometry;
- multiple-player page budget, eviction, context recovery, and underflow
  incidents;
- bounded public diagnostics and proof of excluded secret/browser objects;
- direct compile adoption summary, starter output, dev invalid/valid
  generation behavior, and docs snippet results;
- exact terminal element/request/reader/timer/callback/observer/listener/
  broker/frame/bitmap/worker/decoder/GL/lease/wait/participant counters;
- original combined 75 KiB miss, split bootstrap/loaded-graph/worker gzip
  gates, dependency tree, package contents, unit/browser pass
  counts, mutation seeds, and audit result; and
- explicit boundary: prototype naming and publish-ready local artifacts only;
  no external package/CDN release, framework wrapper, hosted service,
  authoring GUI, persistent cache, native runtime, or M9 certification.

Do not mark M8 complete or commit it until every gate is green, the evidence
contains no secret or local identifier, all shipped examples use only public
APIs, the custom element retains exactly one underlying runtime path, and the
audit finds one authority for registration, configuration generation, layer
visibility, input aggregation, motion preference, visibility/autoplay,
presentation observation, public event staging, and cleanup.
