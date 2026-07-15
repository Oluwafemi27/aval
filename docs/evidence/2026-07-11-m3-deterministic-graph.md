# M3 Deterministic Graph Evidence

**Date:** 2026-07-11

**Milestone:** Browser-independent deterministic state graph

## Result

M3 passes its implementation gate. The new `@pixel-point/aval-graph` package
accepts a validated creator-defined graph and produces deterministic,
immutable presentation commands, ordered semantic effects, and exactly-once
request-settlement descriptors from explicit inputs and consecutive content
ticks.

The package does not decode, render, load media, schedule time, create actual
promises, or dispatch DOM events. Its production TypeScript project exposes
only `ES2023` library types and no ambient types, which compiler-enforces the
browser-independent boundary.

## Captured Environment

- macOS 15.6 (24G84), arm64
- Node.js 25.8.1
- npm 11.11.0
- TypeScript 7.0.2
- Vitest 4.1.10
- Playwright 1.61.1

The M3 engine itself is pure TypeScript. Chromium was exercised only to prove
that all earlier browser milestones remained green.

## Frozen Contracts

- One to 32 user-defined states and up to 64 direct edges, with checked IDs,
  references, resource counts, port geometry, trigger ambiguity, immediate
  cycles, and reversible-pair consistency.
- Loop, finite, and held bodies with explicit portal, finish, cut,
  transitionless, locked, reversible, completion, intro, and static behavior.
- Exactly one immutable presentation per consecutive content tick, with
  engine-owned authored cursors and an explicit `routeReady` handshake.
- Latest-wins routing, pending inverse cancellation, adjacent-frame active
  reversal, and at most one valid direct follow-on from the active target.
- Monotonic input/request IDs, duplicate request groups, deterministic
  supersession, and microtask settlement descriptors without runtime promises.
- Atomic requested-state updates, stable effect ordering, a 32-input-per-tick
  bound, a 64-route-operation bound, and a 256-result diagnostic trace.
- Preparing, animated, static recovery, static failure, and idempotent disposal
  lifecycle paths.

## Golden and Adversarial Proof

The package suite contains 113 tests across ten files. Golden traces cover
intro play and skip, loop and finite routing, finish, cut, held bodies,
transitionless edges, static mode and recovery, locked/reversible bridges,
follow-ons, inverse cancellation, completion triggers, duplicate groups, and
effect/settlement order.

Validation tests exercise hostile references, limits, ambiguity, geometry,
cycles including one-frame finite cycles, inverse definitions, sparse arrays,
checked arithmetic, and input immutability. Portal-search, request-ledger,
atomic route-plan, operation-journal, and pure intent-decision tests isolate
their respective algorithms.

A strict maintainability pass split route topology, operation accounting, and
intent planning out of the reducer. The coordinating engine is 935 lines,
below the 1,000-line review boundary, while its extracted modules each own a
single testable invariant instead of wrapping engine callbacks.

Four fixed fuzz seeds each execute 2,500 generated ticks followed by 80 drain
ticks, for 10,320 ticks total, and replay two fresh engines. The suite checks
deep determinism, frozen results, cursor and frame bounds, visual commits,
exactly-once ordered settlement, pending-count reconciliation, deliberate
40-input overflow bursts, convergence, and trace retention. It exposed and
then guarded two subtle cases: superseding a follow-on while a reversal was
queued, and rejecting an invalid second-hop event while an active edge already
owned the sole direct follow-on slot.

## Verification Gate

The final gate completed successfully:

```text
npm run typecheck       passed across graph, player, playground, and tests
npm run test:unit       25 files, 280 tests passed
npm run build           passed; graph declarations and production app built
npm run test:browser    7 Chromium regression tests passed
npm audit --audit-level=high
                        0 vulnerabilities
npm pack --dry-run -w @pixel-point/aval-graph
                        package contents inspected successfully
git diff --check        passed
```

The browser regression suite kept the M0/M1 smoke and 1,000-loop-seam proof,
plus the M2 visible reversal, 1,000 cached reversal, recovery, and context-loss
proofs green.

## Claim Boundary

M3 proves deterministic semantic routing over authored frame identities. It
does not yet freeze or parse the binary container, compile creator media,
decode graph-selected units in a worker, measure integrated readiness, support
packed alpha, load byte ranges, expose a public custom element, or certify
physical display continuity. Those are the M4 through M9 milestones.
