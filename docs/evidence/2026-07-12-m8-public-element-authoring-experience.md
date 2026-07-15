# M8 public element and authoring evidence

Date: 2026-07-12

Status: local M8 engineering and the test-only exact-archive proof are complete.
The protected immutable candidate, external named-browser/device runs, legal
approval, canonical publication metadata, and registry publication have not
run. No external field below is inferred from local functional evidence.

Reviewed parent checkpoint: `afbec89`. This is the parent commit reviewed for
the checkpoint, not a claim that the current working tree or final candidate
has that hash. The immutable final commit/tree fields remain pending.

## Claim boundary

This checkpoint implements a web-only custom element, compiler starter, and
loopback watch playground. It does not claim a public registry release, CDN
availability, named-browser certification, physical display continuity,
universal smoothness, a native runtime, an authoring GUI, or hosted services.
Static fallback is a usable outcome; browser scheduling and observed display
remain separate evidence classes.

The external image-source API proposed earlier in M8 was removed. The visual
ladder is the author-owned fallback slot, a digest-verified current-state asset
static, and animation after a prepared first draw. The public element has one
runtime path and never creates a seeking `<video>` substitute.

## Final evidence fields

| Field | Required final value | Current result |
|---|---|---|
| Commit and tree | immutable full commit and tree SHA | Local engineering implementation commit `63792f9b51b02f264eca110e646b57df6e4dd6c9`, tree `14c59676a24f48ce8fbdb55c22c89037970f45dc`; protected candidate identity pending. |
| Toolchain | candidate Node/npm/TypeScript/Vite/Playwright and OS | Local gate: Node 25.8.1, TypeScript 7.0.2, Vite 8.1.4, Playwright 1.61.1, macOS arm64; **PENDING — candidate run not started** |
| Package archives | five exact `1.0.0` archive digests and inspection report | Test-only local exact archives passed with release-set SHA-256 `665f58458b17ab6be96809ae8fc213097d4a8757a5a361dd0ae1bd0965bce679`; protected candidate still pending. |
| API surface | frozen declaration/API reports and compatibility result | API Extractor 7.58.9 reports and classifications pass for all five public packages; protected candidate comparison pending. |
| Fixtures and starter | source/project/tool/asset digests and provenance | Seven provenance manifests, twelve assets, both M8 semantic summaries, and the committed 29-file starter verify byte-for-byte. |
| Clean packed starter | install, compile, validate, range, watch replacement, browser, clean CLI exit | Test-only local proof passed all five consumers, generated production starter, worker/static paths, generation 1 to 3 rebuild, terminal cleanup, and exit 130. |
| Unit/type/mutation | exact commands, seeds, files, and pass counts | Local implementation gate passed; exact results below. Protected candidate rerun pending. |
| Browser reference | three fresh-process production repetitions | Pinned Chromium reference passed 73/73; packaged M9 production scenarios passed 21/21 across three repetitions. Firefox/WebKit were not installed because the host lacked unpack space; named-device runs remain pending. |
| CSP | same-origin module worker and constructed styles under strict policy | Local strict-CSP browser proof passed; candidate rerun pending. |
| Realm adoption | same-root preservation and cross-document/root receipt-gated replacement | Local shadow-root and cross-document browser proof passed; candidate rerun pending. |
| Cleanup receipts | exact terminal participant and element owners zero; page totals contextual | Local source/player/element proofs pass, including install-then-throw host APIs, failed first removal, ownerless import rejection, retryable construction cleanup, and bounded stalled acquisition. Candidate rerun pending. |
| Security/legal/audit | exact reports and approved review IDs | **PENDING — protected gates not run** |

## Local implementation verification

These results apply to the current pre-freeze worktree. They are not substituted
for the exact archive-bound candidate run and do not establish a branded-browser
or physical-display certificate.

- `npm run --workspace @pixel-point/aval-element typecheck` passed source and
  test TypeScript checks.
- `npm run --workspace @pixel-point/aval-playground typecheck` passed.
- `npx vitest run packages/element/test` passed 36 files and 98 tests. The
  source and test TypeScript projects also passed.
- `npm run test:mutation -- --profile release` passed 6 files and 67 tests with
  the exact seeds `1,17,127,65535,2135587861,2703025645,3735928559,4294967295`.
  The element model covers hostile configuration plus policy, visibility,
  observer/resize, disconnect, event, command, lane, and source-owner ordering.
- `npm run fixtures:verify` validated seven provenance manifests, twelve
  complete assets, both M8 semantic summaries, and exact regeneration of all
  29 committed starter files. `npm run docs:check` passed 68 documents and five
  example definitions.
- The complete 49-test M8 Chromium matrix passed in 35.3 seconds with one
  worker. The one-state activation/loop ledger then passed three consecutive
  strict runs in 6.1 seconds total, proving activation readback frame 0,
  real-time intro frames 1 and 2, three exact eight-frame body periods,
  consecutive presentation ordinals, graph/media/readback agreement, and zero
  underflows or fallbacks.
- The final combined element/compiler/playground unit gate passed 78 files and
  312 tests after the terminal actor-lane and committed-durability regressions.
- The final repository-wide single-worker gate passed 287 files and 2,336 tests;
  every workspace and top-level test TypeScript project also passed.
- That matrix includes JavaScript-disabled fallback, native control semantics,
  strict CSP, anonymous and credentialed CORS, integrity, real BFCache restore,
  live DPR change, reduced motion, cross-root/document adoption, stalled lazy
  runtime acquisition, rejected runtime-module loading, source races,
  multiple-player budgets, shadow-root focus, sticky touch suppression, and
  completed source/player/element cleanup receipts. Unit fault injection adds
  host calls that install before throwing and removals that fail once.

The full-run fixture initially exposed shared-session request exhaustion. The
playground now derives a bounded query hash for each proof page, and a regression
test proves different query cases do not share transport state. The corrected
matrix results above all used fresh fixture servers; no listener remained after
the runs.

## Cleanup and adoption contract to prove

The bounded immutable diagnostic receipt identifies element and source
generations. `completed` requires zero participant registration, logical bytes,
leases, registered cleanup, tracked work, pending waits, decoder tickets,
workers, frames, runtime work, source copies, staging bytes, loads, response
bodies, interested waiters, renderer/context resources, and cleanup failures.
Page byte/participant/decoder totals are separate and may remain nonzero for
peers. An incomplete receipt blocks a successor and terminal `finalDisposed`;
a later completed receipt may recover on a subsequent serialized operation.

A same-root same-task move preserves its generation. Cross-root/document
reconnection clears the old object target, unpublishes its bridge, rebinds
constructed styles and realm observers, and publishes no successor until the
old source supplies a completed receipt.

## Provisional size decision — not frozen-package evidence

The original combined element/player/worker target below 75 KiB gzip was
missed. It is not counted as a pass. The approved measurable delivery gates
are bootstrap `< 75 KiB`, complete loaded element/player graph `<= 250 KiB`,
and self-contained worker `<= 20 KiB`.

A post-gate source-tree run of `node scripts/performance/measure-m8-bundles.mjs`
with Vite 8.1.4/Oxc and gzip level 9 produced:

| Boundary | Bytes gzip | Gate | Provisional result |
|---|---:|---:|---|
| Static bootstrap closure | 25,259 | `< 76,800` | pass |
| Lazy runtime closure | 209,699 | reported, no separate gate | measured |
| Complete loaded graph | 234,958 | `<= 256,000` | pass |
| Decoder worker | 15,829 | `<= 20,480` | pass |
| Former combined interpretation | 250,787 | `< 76,800` | **miss** |

The candidate fields remain **PENDING** and must be replaced only by a rerun
over the frozen source/archive graph; this source-tree table does not certify
final packages.

## Test-only exact packed proof

`scripts/release/test-packed-dev.mjs` is wired into package and candidate CI.
It requires five exact archives, installs them into a new temporary project
with an isolated offline npm cache, launches the installed compiler CLI, checks
loopback/range/ETag/identity behavior, drives the installed public element in
Chromium, changes valid project input, observes a new asset and source
generation, forbids browser requests outside the loopback origin, and requires
the CLI to settle after `SIGINT` without force-killing it.

Result: **PASSED — test-only local exact archive proof**. The five archive
SHA-256 values were:

| Package | Archive bytes | SHA-256 |
|---|---:|---|
| `@pixel-point/aval-graph` | 22,803 | `d30f81097ded224a8b26925e1f0047a4a894c9ebcdeea6ac9eabdcf091063d29` |
| `@pixel-point/aval-format` | 74,209 | `81d68ca490f6b0c2216168b5f7c835fb1262e74f29f90fa5c4bc57a4af1d2780` |
| `@pixel-point/aval-player-web` | 417,379 | `26ffc90c5b9b1d639dd688af3e3480f319983bbb6e6cf97bc2800a0aa892417f` |
| `@pixel-point/aval-element` | 62,408 | `2b9bd411b59ee3b3397a55f837d4119d51634761c3a2e728fcef834705b9ee8a` |
| `@pixel-point/aval-compiler` | 123,373 | `7bf95d019dadb9982a523b877fc28122a34a858bbd91d1364280390ea1f63135` |

The proof used synthetic metadata only inside one OS-temporary authority root,
cleaned it afterward, and reported `externalPublication: false`. These digests
are reproducible local engineering evidence, not an immutable protected
candidate or a registry-release claim.
