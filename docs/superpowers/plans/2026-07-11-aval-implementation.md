# AVAL Implementation Plan

**Date:** 2026-07-11

**Status:** Approved design moving into implementation

**Design:** [AVAL Format Design](../specs/2026-07-11-aval-format-design.md)

## 1. Objective

Build the web-only AVAL system in evidence-driven milestones. Each milestone freezes only the contracts it proves. The first milestone is an in-memory WebCodecs experiment, not the final container: it must demonstrate that one independently decodable loop unit can be submitted repeatedly with new rational timestamps, without seeking, resetting, reconfiguring, or flushing at its seams.

At this stage, the AVAL name, `@pixel-point/aval-*` package scope, and `.avl` asset suffix remain private and provisional until naming is finalized.

## 2. Engineering Rules

- Use TypeScript with strict checking and native ESM.
- Use npm workspaces so contributors need no additional package manager.
- Keep browser-independent graph and format logic free of DOM and codec imports.
- Keep experimental code under explicit `experimental` modules until its contract passes the milestone gate.
- Do not freeze the binary container before loop and reversal scheduling pass in real browsers.
- Treat browser codec output, encoded assets, manifests, network responses, and decoded dimensions as untrusted.
- Close every `VideoFrame` deterministically and make resource ownership visible in APIs.
- Use capability probes, never browser-name feature assumptions.
- Use static fallback rather than an `HTMLVideoElement` seeking fallback.
- Commit at each passing milestone so later experiments can be compared or reverted independently.

## 3. Tooling Baseline

The repository will use:

- Node.js 22.12 or later;
- npm workspaces;
- TypeScript project references;
- Vitest for browser-independent unit tests;
- Vite for the local playground and production demo build;
- Playwright for browser correctness and stress tests; and
- browser-native WebCodecs and WebGL2, with no mandatory WASM runtime.

The first spike generates synthetic encoded frames with `VideoEncoder` only as a test-fixture convenience. The production player will never require `VideoEncoder`. It probes H.264 Annex B first and permits VP8 as a clearly labeled spike-only fallback when a test browser cannot encode H.264. Passing the VP8 fallback proves scheduler behavior, not the final H.264 media profile.

## 4. Milestone Map

| Milestone | Deliverable | Exit criterion |
|---|---|---|
| M0 | Workspace foundation | Install, typecheck, unit test, and production build all pass from a clean checkout. |
| M1 | Continuous in-memory loop | 1,000 decoded seams have exact frame order, one decoder configuration, zero boundary resets/flushes, and no leaked frames. A realtime playground also runs without format-induced underflow after readiness. |
| M2 | Resident reversible interaction | Rapid enter/leave traces reverse an active cached clip on the next eligible content frame and recover both endpoint bodies inside measured runways. |
| M3 | Deterministic graph engine | State, port, portal, finite/held, inverse-event, latest-wins, promise, and event-order traces match the specification. |
| M4 | Minimal compiled format | Canonical header, manifest, index, parser, reference-frame profile, hostile fixtures, and round-trip tests pass. |
| M5 | H.264 compiler and decoder worker | A user-installed FFmpeg produces inspected Annex B units that decode continuously in the worker on supported profiles. |
| M5.5 | Integrated scheduler and readiness | Real compiled assets exercise every direct edge through portal, finish, cut, reversal, fallback, and promise settlement without crossing a readiness contract. |
| M6 | Transparency and static fallback | Packed alpha meets error thresholds; strict PNG fallback represents every state; reduced motion is correct. |
| M7 | Hardened loader and budgets | Range/entity/integrity tests, resource caps, lifecycle cleanup, and multi-player eviction all pass. |
| M8 | Public custom element | The framework-neutral element, zero-config single-loop path, events, accessibility guidance, and diagnostics are documented and tested. |
| M9 | Certification candidate | Named real-browser reports pass the 1,000-boundary scheduling suite, with observed-display evidence reported separately. |

## 5. M0 — Workspace Foundation

### Files

- `package.json`: private npm workspace, scripts, engine requirement.
- `package-lock.json`: reproducible dependency graph.
- `tsconfig.base.json`: strict shared compiler settings.
- `packages/player-web/package.json`: experimental player package.
- `packages/player-web/tsconfig.json`: package typecheck boundary.
- `packages/player-web/src/index.ts`: explicit public exports.
- `apps/playground/package.json`: Vite application.
- `apps/playground/index.html`: accessible demo shell.
- `apps/playground/src/main.ts`: demo bootstrap.
- `apps/playground/src/style.css`: minimal diagnostics layout.
- `playwright.config.ts`: Chromium-first browser suite with Vite web server.
- `tests/browser/`: browser milestone tests.

### Verification

```text
npm install
npm run typecheck
npm run test:unit
npm run build
```

Do not add lint, formatting, release, or framework-wrapper infrastructure until it protects code that actually exists.

## 6. M1 — Continuous In-Memory Loop

### 6.1 Rational frame clock

Create `packages/player-web/src/experimental/rational-time.ts`.

Responsibilities:

- validate positive safe-integer numerator and denominator;
- enforce an effective rate no greater than 60 fps;
- map an unbounded virtual frame ordinal to rounded integer microseconds;
- derive each duration from adjacent timestamps instead of accumulated floating-point time; and
- expose content-frame index as `virtualFrame % unitFrameCount`.

Unit tests cover 24, 25, 30, 50, 60, and 60,000/1,001 fps for monotonicity and long-run drift.

### 6.2 Experimental encoded-loop contract

Create `packages/player-web/src/experimental/encoded-loop.ts`.

The contract contains:

- exact decoder configuration;
- coded and display dimensions;
- rational frame rate;
- one byte-owned encoded access unit per content frame;
- the original key/delta type;
- a mandatory key frame at unit frame zero; and
- a disposal-independent copy of each access unit's bytes.

The validator rejects an empty unit, a non-key first frame, unsafe rates, dimension mismatches, and mutable/detached payload assumptions.

### 6.3 Synthetic fixture encoder

Create `apps/playground/src/spike/create-synthetic-loop.ts`.

It will:

1. probe `avc1.42E020` with Annex B output;
2. fall back to VP8 only for the experimental scheduler fixture;
3. render a two-frame stress unit and a separate 24-frame realtime visual unit, both with large error-tolerant binary frame tags, complements/check bits, and distinct colors;
4. request a key frame only for unit frame zero;
5. retain encoder callback order, true key/delta types, and copied encoded bytes after terminal encoder flush;
6. for H.264, byte-check Annex B start codes plus SPS, PPS, and IDR in the first key access unit and reject an encoder-provided decoder `description`; and
7. return the exact supported decoder configuration and separate `genericLoopReplay` and `h264AnnexB` result labels.

The encoder is absent from production package exports.

### 6.4 Continuous decoder scheduler

Create `packages/player-web/src/experimental/continuous-loop-decoder.ts`.

Responsibilities:

- own exactly one configured `VideoDecoder`;
- resubmit access-unit bytes for every loop iteration using later virtual timestamps;
- maintain a bounded submitted/decode/output horizon with a default input high-water of 16;
- associate each output timestamp with the expected virtual and content frame;
- expose a chronological decoded-frame queue;
- never call `reset()`, `configure()`, or `flush()` at a seam;
- allow one terminal `flush()` during stress-test shutdown only;
- close stale or failed outputs on every path; and
- publish counters for submissions, outputs, configuration calls, terminal flushes, boundary operations, maximum queue depth, and failures.

The implementation uses generation-safe ownership even though M1 has only one path, so M2 can extend it without rewriting frame cleanup.

### 6.5 Fast 1,000-seam stress harness

Create `packages/player-web/src/experimental/stress-loop.ts` and expose it through the playground under a test-only query mode.

The harness will:

- decode 1,001 iterations of the two-frame unit, producing exactly 2,002 outputs and 1,000 iteration seams, as fast as backpressure allows;
- validate every output timestamp and virtual ordinal;
- copy and decode the machine-readable tags around every last-frame → frame-zero seam;
- assert exact consecutive content-frame order;
- assert one decoder configuration, zero resets, and zero boundary flushes;
- perform one terminal flush only after all chunks are submitted;
- close every output and report outstanding-frame count zero; and
- enforce a ten-second no-progress watchdog; and
- report throughput separately from realtime display behavior, requiring at least 1.5× media realtime for the reference stress unit.

### 6.6 Realtime canvas player

Create `packages/player-web/src/experimental/loop-canvas-player.ts`.

It will:

- use the 24-frame visual orbit unit and prepare an eight-frame presentation lead before motion starts;
- drive content ticks from `requestAnimationFrame` and the rational clock;
- draw each expected `VideoFrame` to a canvas and close it immediately;
- distinguish expected repeated display refreshes from content-frame duplication;
- hold the last valid canvas image and emit underflow when no next frame exists;
- freeze logical time while paused or hidden;
- rebuild lead before resume; and
- dispose decoder, frames, callbacks, and listeners idempotently.

M1 uses Canvas 2D because the experiment is opaque and tests scheduling. M2 introduces persistent WebGL2 texture arrays; M6 introduces the packed-alpha compositor.

### 6.7 Playground

The first page shows:

- the animated synthetic loop;
- codec/profile actually selected;
- readiness and running state;
- virtual frame and content-frame index;
- queue occupancy and decoder queue size;
- seam, underflow, late-frame, and disposed-frame counts;
- start, pause, resume, and rerun-stress controls; and
- the latest 1,000-seam result.

It must remain useful with animation unsupported by displaying an explicit static diagnostic instead of a blank canvas.

### 6.8 M1 tests

Browser-independent tests:

- rational time monotonicity and drift;
- exact known timestamp sequences and monotonicity across 1,000,000 virtual frames;
- encoded-unit validation;
- counter/state invariants with a fake decoder adapter; and
- idempotent disposal.

Playwright tests:

- secure-context capability probing;
- the selected codec is declared honestly;
- 1,000 seams pass exact tag and timestamp ordering;
- boundary reset/configure/flush counters are zero;
- one terminal flush is recorded;
- outstanding frames are zero after stress completion; and
- the visible demo reaches running state, advances across several seams, and reports no decoder error.

If bundled Chromium lacks H.264 encode support, the scheduler test must pass with VP8 and record `h264AnnexB: "unsupported"`. H.264-specific proof remains open until it passes in a supported branded Chrome or other real browser; it is not silently inferred from VP8. Playwright ordering and pixel results are functional evidence only, not physical display or Safari certification.

## 7. M2 — Persistent Reversible Interaction

Add an internal renderer cache abstraction with a WebGL2 `RGBA8` texture array. Copy decoded frames through one bounded RGBA staging buffer, deduplicate endpoint runway layers, and close source frames after upload. Add a reversible clip controller that indexes the cache forward or backward, switches direction only on content boundaries, and uses source/target runways while the sole decoder prepares body continuation.

Tests cover immediate inverse intent while the clip is visible, pending inverse cancellation before the portal, non-inverse latest-wins queuing, array-layer and byte caps, context loss, hide/rebuild, and zero use-after-close. M2 does not yet expose the public state graph.

## 8. M3 — Deterministic Graph Engine

Create `packages/graph` with no DOM, media, or timer imports. Model states, body kinds, named ports, edges, request sequences, and graph phases as validated discriminated unions. Drive it with explicit `tick(frame)` and `send(input)` calls so every trace is deterministic.

Implement direct-edge routing, inverse-event lookup against a pending prospective target, looping versus finite portal search, held finish behavior, locked bridge queuing, active reversible direction changes, promise settlement descriptors, and normative event ordering. Golden traces cover idle/hover, loading/success/error, intro skipping, static recovery, duplicate requests, and rapid fuzzed inputs.

## 9. M4 — Minimal Compiled Format

Create `packages/format` only after M1–M3 contracts are stable. Implement the exact 64-byte header, canonical JSON manifest schema, 32-byte access-unit index records, byte/alignment validation, reference-frame payload profile, strict PNG descriptors, and canonical writer. Use a duplicate-key-aware JSON parser and checked integer/range arithmetic.

Round-trip golden fixtures, mutation fuzzing, malformed samples, overlap/alias tests, and bounded-allocation assertions are the gate. The `.avl` extension remains private.

## 10. M5 — Compiler and H.264 Worker Path

Create `packages/compiler` and move browser decoding into a dedicated worker in `packages/player-web`. The CLI invokes but never bundles a user-installed FFmpeg. It accepts a PNG sequence or local rendered video, rejects variable frame rate by default, splits intro/loop/bridge units, forces independent unit starts, emits Annex B H.264 plus access-unit records, and inspects SPS/PPS/NAL/dependency constraints rather than trusting flags.

Add `init`, direct-input `compile --loop`, project `compile`, `inspect`, `validate`, `unpack`, and `dev`. Compiler fixtures must reproduce byte-identical output for identical inputs and tool versions.

## 11. M5.5 — Integrated Scheduler and Readiness

Join `packages/graph`, `packages/format`, and the worker decoder behind explicit scheduler interfaces before adding alpha complexity. Implement source submission horizons, edge-specific consecutive lead, looping portal selection, held portal/finish preparation, resident cut runways, generation-based obsolete-output disposal, readiness dry runs, and static recovery settlement.

Use opaque compiled fixtures to exercise every direct edge from every request phase. The gate requires graph trace, decoder submission trace, presentation trace, readiness result, property/event order, and promise settlement to agree. One-frame bridges must include target frame zero before departure; cuts must use resident target runways; active reversals must use cached layers; and no partially prepared graph may report `interactiveReady` under the all-routes policy.

## 12. M6 — Transparency and Static Fallback

Implement stacked packed alpha, BT.709 limited-range conversion, even/macroblock padding, RGBA8 WebGL2 compositing, premultiplied blending, and alpha error measurements. Emit a strict per-state PNG from each canonical body entry when the source omits one. Validate PNG chunks, CRCs, inflated scanline bounds, and decoded dimensions before display.

Test light/dark/saturated backgrounds, alpha thresholds, resize/DPR, reduced motion, missing codec/WebGL/worker, and fallback during an in-flight requested state.

## 13. M7 — Loader, Integrity, and Resource Manager

Implement bounded front-index loading, strict `206`/`Content-Range`, absent-or-identity encoding, strong-ETag/`If-Range`, full-fetch fallback, entity-change rejection, unit digests, and optional whole-file external integrity. Add shared page decoder and memory budgets, visibility suspension, static eviction, context recovery, abortable watchdogs, and complete cleanup.

Network and lifecycle tests cover every failure class in the design specification.

## 14. M8 — Public Element and Authoring Experience

Create `packages/element` with the internal placeholder tag, typed imperative API, state/readiness properties, deterministic events, automatic engagement aggregation, reduced-motion handling, pause/resume, light-DOM fallback, intrinsic sizing, and diagnostics. Keep host DOM responsible for semantics and business actions.

Finish the one-command loop path, starter idle/hover project, watch-mode playground, actionable compiler diagnostics, and concise integration documentation.

## 15. M9 — Certification Candidate

Run unit and browser correctness in CI. Run performance certification manually on named headed profiles. Keep runtime scheduling evidence separate from observed display evidence. Publish exact versions, hardware, power state, refresh rate, codec result, rendition, failures, and raw traces.

The release candidate gate is 1,000 exact loop/transition boundaries without a format-induced underflow, plus the active-reversal and portal-bound suites. Unsupported profiles remain static or best-effort and are never labeled certified.

## 16. Immediate Execution Order

The current implementation turn executes M0 and M1 only:

1. scaffold the npm/TypeScript/Vite workspace;
2. implement and unit-test rational time and the encoded-loop contract;
3. implement the synthetic codec probe and fixture generator;
4. implement the continuous decoder and fast stress harness;
5. implement the realtime canvas player and diagnostics page;
6. install the Playwright Chromium runtime;
7. run typecheck, unit tests, production build, and browser tests;
8. visually inspect the running playground and browser console;
9. fix every M1 failure rather than weakening assertions; and
10. commit M1 only when the gate passes, clearly recording whether H.264 or the VP8 fallback was exercised.

M2 begins only after M1 evidence is recorded.
