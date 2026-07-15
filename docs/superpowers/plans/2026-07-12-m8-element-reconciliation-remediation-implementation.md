# M8 Element Reconciliation Remediation Plan

## Rules

- Work test-first and keep browser runs trace/screenshot-off.
- Keep one active plus one newest pending reconcile.
- Preserve synchronous source invalidation and exact public waiter/event order.
- Attempt every teardown, retain failed ownership, and never infer cleanup.
- Do not touch compiler dev-server or release/publish code.

## 1. Freeze types and desired-state reducer

Add focused reducer tests for closed snapshots, source token invalidation,
effective visibility, play sequence, state sequence, and bounded revisions.
Close readiness detail reason to `StaticReason` in the public compile surface.

## 2. Add the single reconcile lane and waiter rules

Add failing tests proving one active/newest pending reconcile, internal
revision migration, source-specific prepare abort, duplicate-state join,
distinct-state supersession, and resume invalidation by pause/hidden/source.
Implement bounded waiter registries and immutable effect inputs.

## 3. Move coordination into `ElementReconciler`

Move source controller/generation creation, configuration application,
visibility/motion/resize effects, state intent, play intent, realm/input
signals, diagnostics, and cleanup coordination behind the authority. Delete
`ElementSourceOwner`, `ConfigurationQueue`, and the independent visibility and
motion lanes. Reduce `AvalElementImpl` to reflection, lifecycle, and
public delegation.

## 4. Make element ownership retryable and observable

Add `ElementOwnershipLedger` tests. Change AutomaticInputs to tokenized
per-target closures and retryable physical listener releases. Change realm,
document/DPR/motion brokers, intersection/resize observation, and scheduled
frames to report exact ownership and retain retry work. Flip hostile tests to
expect incomplete snapshots/failures while verifying every release attempt and
stale callback inertia.

## 5. Merge terminal ownership into cleanup proof

Extend diagnostics and cleanup receipt with the element ownership snapshot.
Add source-free and active-source terminal tests. `dispose()` must reject and
leave `finalDisposed: false` for any nonzero owner or failure, then succeed if a
later retry drains all ownership.

## 6. Strengthen real browser proofs

Grade the complete one-state trace window with exact graph/media/readback
correspondence and seam/underflow assertions. Produce two independent in-memory
test bundles from the real package entry and verify duplicate registration
convergence. Run only the affected Chromium specs until the architecture
checkpoint.

## 7. Architecture checkpoint

Run element source/test typecheck, focused reducer/reconciler/ownership/bridge
unit tests, and targeted lifecycle/events/one-state/definition browser tests.
Report exact counts and remaining limitations before any full 39-test suite.
