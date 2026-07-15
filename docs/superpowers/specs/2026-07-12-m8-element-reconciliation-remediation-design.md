# M8 Element Reconciliation Remediation Design

## Outcome

This amendment closes the M8 maintainability and ownership gaps without
changing format `0.1` or the public element contract. One typed element
authority serializes source identity, configuration, visibility, motion,
presentation, declarative state, and manual play intent. The custom element is
only a browser reflection/dispatch facade.

## Focused authorities

The implementation has three coordination modules:

1. `ElementDesiredState` is a pure reducer. It owns one immutable desired
   snapshot and monotonically increasing revision/source-identity tokens. It
   contains normalized configuration, connection/terminal state, realm,
   document/intersection/box visibility, box/DPR, host motion preference,
   interaction target intent, declarative and imperative state intent, and
   manual play intent. It performs no DOM or runtime work.
2. `ElementReconciler` is the sole effect actor. It owns the source controller,
   runtime generation, layers, realm/input owners, public state/events,
   binding routing, failures, and one coalescing reconcile lane. No observer,
   attribute, lifecycle, or manual callback calls a runtime owner directly.
3. `ElementOwnershipLedger` records element-side physical ownership and
   retryable release failures. It publishes bounded immutable snapshots and
   contributes to terminal cleanup completion.

`ElementSourceOwner`, `ConfigurationQueue`, and the independent visibility and
motion operation lanes are removed. Small pure helpers remain separate; the
new reconciler must not absorb attribute parsing, event-detail construction,
intrinsic arithmetic, broker implementation, or runtime composition.

## Desired snapshot and one lane

Every continuous signal produces a closed reducer action. The snapshot carries
its revision and source identity token. The effect lane retains at most one
active reconcile and one newest pending snapshot. A newer continuous revision
supersedes the pending one and migrates internal completion interest to the
newest revision.

Source-affecting attribute callbacks synchronously increment the source token,
close the old DOM bridge/public waits, and begin active generation retirement.
Normalized same-task configuration is still read once before the pending
reconcile. A new generation starts only after the old runtime cleanup receipt
is complete. The create callback captures the current immutable source
snapshot rather than reading scattered element fields.

Reconcile order is fixed:

1. realm/layer viability and interaction binding;
2. source retirement or newest generation creation;
3. runtime visibility and canonical visible/hidden binding route;
4. motion policy and host reduction;
5. intrinsic sizing and latest box/DPR/fit resize;
6. declarative or imperative state intent; and
7. manual play intent.

Before and after any awaited runtime effect, the actor checks terminal state,
source token, active generation, and the newest relevant intent sequence. A
queued visible resume also rechecks effective visibility and manual playing.
It can never resume after a later hidden or pause action.

## Public command settlement

Public commands enter the same authority, but retain their exact semantics:

- `prepare()` joins only the current source generation. Replacement aborts its
  source-specific wait; it never migrates to the successor.
- duplicate `setState(destination)` calls join one request. A later distinct
  destination rejects the superseded request with `AbortError`; it does not
  silently migrate.
- `resume()` applies only while its play-intent sequence and source generation
  remain current. A later pause rejects/supersedes it; becoming hidden may let
  the runtime retain play intent without starting visible realtime work.
- internal configuration/observer revisions may coalesce and migrate.
- `send()` and `readyFor()` remain synchronous queries through the authority
  against the current active generation.

Waiter sets have explicit caps. Terminal/source invalidation rejects captured
waiters once and clears them. DOM event transactions still stage public state
before dispatch, defer listener-triggered work until dispatch exits, and settle
the initiating runtime promise afterward.

## Observable retryable ownership

Owner invalidation always precedes release attempts. Automatic input callbacks
are per-attachment closures that capture the attachment token and target. A
callback left physically installed after a failed removal is inert and cannot
read or act on the next target.

Realm, broker, observer, listener, and scheduled-frame owners attempt every
release independently. A failed release remains owned with a concrete bounded
retry operation; it is not marked released. Later stop, rebind, and final
dispose retry outstanding releases. Nonterminal failure reports one bounded
nonfatal `element-cleanup-incomplete` event per cleanup generation, while the
new realm/source may remain usable.

The frozen element ownership snapshot contains:

- physical target listener count;
- observer count;
- broker subscription/infrastructure count;
- scheduled frame/timer count;
- pending reconcile/command count;
- retained release retry count; and
- cumulative release failure count.

Terminal diagnostics expose this snapshot. The source cleanup receipt is
merged with terminal element ownership. `completed` requires every
participant-scoped runtime field and every element ownership field to be zero,
with no failed release. `finalDisposed` becomes true only after the merged
receipt completes; otherwise `dispose()` rejects and diagnostics remain
truthful. Raw DOM exceptions are never exposed.

## Closed readiness and browser proofs

`AvalReadinessChangeDetail.reason` is `StaticReason`, never an open
string.

The one-state browser proof grades a fixed bounded content-tick window. It
requires intro frames exactly once as `[0, 1, 2]`, then complete consecutive
body cycles `[0, 1, 2, 3, 4, 5, 6, 7]`, one graph/media/readback identity per
graded tick, no duplicated seam frame, and zero underflow.

Duplicate-definition compatibility is proven with two separately bundled
physical copies of the real element package. The first bundle registers; the
second independently observes and reuses that constructor through the shared
version marker. A handcrafted marked constructor is not evidence.

## Non-goals

This amendment does not change media scheduling, graph semantics, manifest
fields, source project syntax, accessibility policy, framework wrappers, or
the web-only product boundary.
