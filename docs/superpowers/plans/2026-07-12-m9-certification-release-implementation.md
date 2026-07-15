# M9 Certification and 1.0 Release Implementation Plan

**Date:** 2026-07-12

**Design:** [M9 Certification and 1.0 Release Design](../specs/2026-07-12-m9-certification-release-design.md)

## Outcome

Turn the completed M8 web product into one immutable, reproducible `1.0.0`
release set. Add deterministic CI, golden/provenance enforcement, API reports,
package-consumer checks, bounded mutation and lifecycle stress, a public-path
browser harness, validated named-device runtime reports, optional and strictly
separate observed-display reports, SBOM/provenance artifacts, documentation,
protected publication, and rollback evidence.

M8 must be gated and committed before production M9 work begins. M9 ends only
after the exact final tarballs have passed repository gates and named-profile
certification. Publication is a protected external mutation over those same
tarballs, not an implicit consequence of a local test command.

## Engineering Rules

- Keep compiled wire format `0.1` and compiler project schema `0.2`; package
  `1.0.0` does not alter either format.
- Use one closed vocabulary for `passed`, `failed`, `unsupported`,
  `inconclusive`, `not-run`, and `withdrawn`.
- Keep CI functional correctness, named runtime scheduling, observed display,
  and authored visual quality in separate report fields and files.
- Never infer scan-out, displayed-frame, black-frame, or physical seam claims
  from RAF, decoder, GPU-fence, canvas submission, screenshot, or readback
  timestamps.
- Build final tarballs once. Certification, consumer smoke, SBOM, attestation,
  and publication all identify those same bytes.
- Never rebuild, rewrite a golden, discard a failed run, or edit a raw report
  during a release workflow.
- Run timing certification headed in a visible foreground document on a named
  branded browser. Playwright engines remain functional CI evidence only.
- Capability-probe exact codec/graphics behavior. Unsupported animation must
  pass the static path and remain labeled unsupported.
- Keep all stress generators bounded and seeded. Record every seed and minimized
  failure; never allow an unbounded fuzz job in CI or certification.
- Use explicit ownership counters as the leak correctness gate. Browser heap,
  RSS, GPU, and energy readings remain observational unless their exact
  measurement model is documented.
- Use package public exports in browser, examples, and consumer tests. Private
  loader, worker, scheduler, renderer, and lease modules are not test shortcuts.
- Keep release/certification tooling private and browser-neutral. Safari can run
  the same in-page harness without pretending Playwright WebKit is Safari.
- Pin Node/tool/action/browser inputs used in a claim. A floating `latest` or
  `stable` string never appears as evidence; reports contain the resolved full
  version.
- Use least-privilege workflows, lockfile-only installs, protected OIDC registry
  publishing, and no long-lived publication secret.
- Do not bundle FFmpeg, FFprobe, libx264, a browser, or a camera-analysis binary
  in public packages.
- Commit source, schemas, bounded reports, summaries, and digests. Do not commit
  tarballs, browser profiles, large traces/captures, caches, credentials, local
  paths, or device serials.

## Execution Order

### 1. Freeze certification vocabulary, release policy, and schemas

Create:

```text
config/release/release-policy.json
schemas/candidate-manifest.schema.json
schemas/release-manifest.schema.json
schemas/certification-runtime.schema.json
schemas/certification-display.schema.json
schemas/certification-attachment.schema.json
packages/certification/package.json
packages/certification/tsconfig.json
packages/certification/src/model.ts
packages/certification/src/status.ts
packages/certification/src/schema-loader.ts
packages/certification/src/schema-validation.ts
packages/certification/src/canonical-json.ts
packages/certification/test/schema-validation.test.ts
packages/certification/test/canonical-json.test.ts
```

Mark `@pixel-point/aval-certification` private and exclude it from the public
release set. Add it to workspace typecheck/build/test without making the five
public packages depend on it.

`release-policy.json` owns:

- package order/names and synchronized version;
- exact minimum Node/npm versions and reviewed CI matrix;
- required OS/browser/display profile classes;
- required scenario IDs and repetition counts;
- normative throughput/boundary criteria;
- artifact/report retention and size caps;
- allowed report attachment media types;
- dependency severity/license policy; and
- previous-known-good/rollback fields.

Implement bounded validators for both report layers. Runtime reports must reject
observed-display pass fields; display reports must reference a passed runtime
report. Reject unsafe integers, non-finite values, duplicate IDs, unknown enum
values, overlong strings/arrays, missing environment fields, absolute paths,
URL queries, serial-number fields, and attachment digest/length mismatch.

Implement one canonical JSON serializer with recursively sorted object keys,
preserved array order, UTF-8, no insignificant whitespace, one terminal newline,
and rejection of unsupported values. Round-trip every schema example and prove
that reordered input yields identical bytes.

Run:

```text
npx vitest run packages/certification/test/schema-validation.test.ts packages/certification/test/canonical-json.test.ts
npm run typecheck -w @pixel-point/aval-certification
```

### 2. Freeze the 1.0 public API and compatibility policy

Update all five public package manifests and indexes. Create:

```text
api-extractor.base.json
packages/graph/api-extractor.json
packages/format/api-extractor.json
packages/compiler/api-extractor.json
packages/player-web/api-extractor.json
packages/element/api-extractor.json
etc/api/graph.api.md
etc/api/format.api.md
etc/api/compiler.api.md
etc/api/player-web.api.md
etc/api/element.api.md
scripts/release/check-api-classification.mjs
config/release/api-classification.json
docs/versioning.md
docs/migration/0.x-to-1.0.md
```

Set each public package to `1.0.0`, `private: false`, explicit `files`, explicit
conditional exports, ESM type, license, engines, repository/homepage/bugs,
side-effects, and exact `1.0.0` internal dependencies. Do not expose the private
certification package or source-private subpaths.

Generate declaration rollups and API reports with one pinned API Extractor
version. Classify every exported item as stable, experimental, deprecated, or
internal. Fail if an exported item lacks a classification, an internal type
leaks into a signature, a stable item changes without a checked semver entry,
or an experimental item is described as stable documentation.

Add compile-only hostile consumers for package-root exports and custom-element
types. Prove private deep paths, mutable snapshots, invalid event detail, unknown
attributes/options, and internal lease/worker construction are rejected.

Run:

```text
npm run build
npm run api:report
npm run api:check
npm run typecheck
```

### 3. Produce deterministic publishable package contents

Create:

```text
scripts/release/build-packages.mjs
scripts/release/inspect-tarball.mjs
scripts/release/hash-file-list.mjs
tests/consumers/node-esm/package.json
tests/consumers/node-esm/index.mjs
tests/consumers/typescript-nodenext/package.json
tests/consumers/typescript-nodenext/index.ts
tests/consumers/typescript-bundler/package.json
tests/consumers/typescript-bundler/index.ts
tests/consumers/browser-vite/package.json
tests/consumers/browser-vite/index.html
tests/consumers/browser-vite/src/main.ts
tests/package/package-contents.test.ts
tests/package/package-consumers.test.ts
```

Build into fresh staging directories and run `npm pack --json` once per package.
Normalize only inputs under repository control; fail on unexpected file order or
metadata rather than patching a tarball. Inspect every archive without executing
it. Require README/license/notices, built ESM, declarations, and the documented
compiler bin/player worker entries. Reject tests, source fixtures, build info,
coverage, caches, large media, local-path source maps, executables other than the
compiler JS bin, credentials, keys, and undeclared binaries.

Install the five exact tarballs into fresh consumer directories with an isolated
npm cache. Test Node ESM, TypeScript `NodeNext`, TypeScript `Bundler`, Vite browser
build, compiler `--help`/invalid-input behavior, worker URL resolution, and
custom-element registration. Prove the element root imports without browser
globals or registration and the documented `/auto` entry performs the sole
intentional browser registration side effect. Compare two clean builds on the
same toolchain for identical file lists and tarball digests.

Run:

```text
npm run release:pack
npm run release:inspect-packages
npm run test:consumers
```

### 4. Centralize fixture and provenance verification

Create:

```text
schemas/fixture-provenance.schema.json
scripts/fixtures/verify-all.mjs
scripts/fixtures/verify-provenance.mjs
scripts/fixtures/regenerate-semantic-check.mjs
tests/fixtures/all-provenance.test.ts
tests/fixtures/deterministic-regeneration.test.ts
```

Replace milestone-specific ad hoc digest checks with one read-only composition
that calls each package's canonical validators. Do not duplicate header, index,
AVC, PNG, alpha, geometry, graph, or SHA-256 logic. Validate all M4-M8 fixtures,
source projects, generators, source frames, assets, expected route/profile
summaries, per-blob digests, and provenance cross-references.

Check absence of absolute paths, timestamps that influence bytes, URLs,
credentials, undeclared environment, and extra files. Verify exact byte identity
only for the full recorded FFmpeg/FFprobe/compiler fingerprint. With another
supported native tool build, compile twice and compare within-build bytes, then
validate semantic frame identity, quality, geometry, graph routes, and strict
container structure without modifying goldens.

Add one mutation test that changes every provenance digest/length/cross-reference
in turn and proves a stable path-free failure. Make generated provenance check
mode fail the repository if checked bytes would change.

Run:

```text
npm run fixtures:verify
npm run fixtures:regeneration-check -- --tool-backed
```

### 5. Add bounded release mutation and fuzz suites

Create focused owners under existing packages plus:

```text
tests/mutation/release-corpus.test.ts
tests/mutation/release-corpus.ts
tests/mutation/release-seeds.json
scripts/testing/run-seeded-matrix.mjs
scripts/testing/minimize-failure.mjs
```

Compose, without reimplementing, the format/PNG/AVC, graph, compiler, loader,
resource, lifecycle, element, and report-schema generators. Add a stable corpus
for every past minimized failure. Cap input bytes, element counts, operations,
wall time, shrink steps, output logs, and retained cases. Record generator
version, seed, cases, rejects, maximum observed allocation/counter, and minimized
input digest.

At each integer/count/offset/frame/byte/queue/deadline limit, generate at least
1,000 bounded values across below/at/above and safe-integer arithmetic. Require
every rejection to settle readers, timers, buffers, frames, workers, decoders,
bitmaps, GL resources, leases, listeners, callbacks, elements, and promises.

Run a small fixed seed set on pull requests, the full committed corpus on main
and release, and rotating seeds on schedule. Never auto-commit a new seed or
golden.

Run:

```text
npm run test:mutation -- --profile pull-request
npm run test:mutation -- --profile release
```

### 6. Expand the functional browser matrix

Update:

```text
playwright.config.ts
package.json
tests/browser/*
```

Create:

```text
playwright.reference.config.ts
playwright.production.config.ts
tests/browser/m9-public-element.spec.ts
tests/browser/m9-loader-lifecycle.spec.ts
tests/browser/m9-alpha-sizing.spec.ts
tests/browser/m9-capability-fallback.spec.ts
tests/browser/m9-package-import.spec.ts
```

Run the independently encoded reference profile in pinned Playwright Chromium,
Firefox, and WebKit. Serve built/packed public package entries. Exercise the M8
element, user-defined states, zero-config loop, events/promises, engagement,
reduced motion, sizing, loader/integrity, multi-player budgets, visibility,
context loss, source replacement, fallback, accessibility, and cleanup.

Run production AVC assertions only after exact support probes. Emit a structured
unsupported result while still requiring strict static behavior. Assert that
the report labels Playwright products as functional engine runs, never Chrome,
Edge, Firefox-branded, Safari, named device, or observed display certification.

Run browser-reference files sequentially inside each engine to avoid benchmark
contention; exercise concurrency explicitly inside multi-player scenarios. Run
the full reference matrix three consecutive times in the release lane.

Run:

```text
npm run test:browser:reference
npm run test:browser:production
```

### 7. Build the public-path 1,000-boundary certification harness

Create:

```text
apps/playground/src/certification/index.ts
apps/playground/src/certification/app.ts
apps/playground/src/certification/run-config.ts
apps/playground/src/certification/frame-ledger.ts
apps/playground/src/certification/deadline-ledger.ts
apps/playground/src/certification/route-ledger.ts
apps/playground/src/certification/resource-ledger.ts
apps/playground/src/certification/report-export.ts
apps/playground/src/certification/style.css
packages/certification/src/scenario-contract.ts
packages/certification/src/runtime-criteria.ts
packages/certification/src/runtime-report.ts
packages/certification/test/runtime-criteria.test.ts
tests/browser/m9-certification-harness.spec.ts
```

The browser page imports only the packed element/public player APIs and loads the
checked compact all-routes packed-alpha fixture through the M7 HTTP path. It
shows a persistent certification banner and refuses to run when hidden,
unfocused, dev-mode, source-mismatched, or missing a complete operator profile.

Implement independent scenarios and ledgers for:

- 1,000 loop boundaries;
- 1,000 all-route transition boundaries;
- 1,000 seeded active inverse requests balanced over phases/directions;
- at least 1,000 portal selections covering every legal body position;
- 10,000 pure/fake-clock rapid inputs plus a 1,000-operation headed subset;
- at least 300 post-warm-up decoder outputs for throughput; and
- terminal disposal/resource settlement.

Record rational expected ordinals, event availability, prepared-frame time,
eligible RAF deadline, callback start, canvas submission completion, GPU-fence
status where supported, graph state, route/port/unit/local-frame identity,
diagnostic events, and resource snapshots. Never name a field `displayedTime`
or `scanoutTime`.

Apply the normative seam threshold independently to
`canvasSubmissionGap` values, using the non-boundary submission p99. Keep this
browser-side criterion separate from the same formula over independently
observed display refreshes.

Test the criteria evaluator against constructed first/last/missing/duplicate/
late/wrap/reversal/portal cases and 1,000-boundary off-by-one mutations. The
headed harness runs without synchronous readback; a separate functional mode
uses tolerant readback to cross-check frame-tag interpretation.

Run:

```text
npx vitest run packages/certification/test/runtime-criteria.test.ts
npm run test:browser -- tests/browser/m9-certification-harness.spec.ts
```

### 8. Add resource, lifecycle, visibility, context, and network fault profiles

Create:

```text
apps/playground/src/certification/resource-soak.ts
apps/playground/src/certification/lifecycle-stress.ts
apps/playground/src/certification/visibility-stress.ts
apps/playground/src/certification/context-stress.ts
apps/playground/src/certification/network-fault-stress.ts
packages/certification/src/ownership-criteria.ts
packages/certification/test/ownership-criteria.test.ts
tests/browser/m9-resource-fault.spec.ts
```

Use production M7/M8 diagnostics and explicit fault adapters; do not inspect
private maps or make a second resource model. Implement:

- 100 complete element/session lifecycle cycles;
- a configurable 30-minute multi-player soak under exact default caps;
- 100 source replacements and connect/disconnect/adoption cycles;
- hide/show and reduce/full at every preparation/playback phase;
- repeated supported WebGL loss/restore plus failed restore;
- worker crash, decoder error/reclamation, PNG timeout/failure, and GL allocation
  failure; and
- the complete local bounded M7 network/entity/integrity/watchdog fault table.

Every scenario snapshots before/peak/terminal counters and requires return to
the shared baseline. Keep optional process/heap/GPU/energy sampling in a
separate observational map with provider, units, resolution, and availability.
Do not fail a browser merely for lacking a nonstandard memory API.

Use shortened deterministic durations in pull-request browser tests, complete
counts on release CI, and the real 30-minute soak on each supported named
profile. Test abort and report export during the soak so partial artifacts are
valid but `inconclusive`.

Run:

```text
npx vitest run packages/certification/test/ownership-criteria.test.ts
npm run test:browser -- tests/browser/m9-resource-fault.spec.ts
```

### 9. Implement benchmark collection without contaminating correctness

Create:

```text
packages/certification/src/benchmark-model.ts
packages/certification/src/benchmark-statistics.ts
packages/certification/src/benchmark-report.ts
packages/certification/test/benchmark-statistics.test.ts
apps/playground/src/certification/benchmarks.ts
config/release/benchmark-baselines.json
scripts/certification/compare-benchmark.mjs
```

Measure metadata/first-static/visual/interactive readiness, decoder output and
upload throughput, eligible-deadline slack, callback-to-canvas-submit, route
latency, rebuild latency, network/residency, tracked byte categories, queue and
eviction behavior, compiler time/working set/output/quality, and package/example
transfer sizes.

Store raw finite samples and derive count/min/max/median/p95/p99 with deterministic
rank rules. Reject mixed clocks/units, warm-up samples in measured statistics,
silent outlier deletion, fewer than required samples, hidden documents, power
changes, or enabled readback/screenshots/devtools/verbose logging.

Shared CI produces advisory comparisons only. The named runtime gate enforces
at least 1.5x actual post-warm-up decoder output throughput and the normative
deadline/boundary rules. Same-profile regressions outside the checked review
band require an accepted release note; no universal CPU/RSS/GPU threshold is
invented.

Run:

```text
npx vitest run packages/certification/test/benchmark-statistics.test.ts
npm run benchmark:deterministic
```

### 10. Capture and validate exact named-profile environments

Create:

```text
packages/certification/src/environment-model.ts
packages/certification/src/environment-validation.ts
packages/certification/src/capability-record.ts
packages/certification/test/environment-validation.test.ts
scripts/certification/create-run-config.mjs
scripts/certification/serve-candidate.mjs
scripts/certification/validate-runtime-report.mjs
docs/certification/operator-runtime-runbook.md
```

The run-config command takes reviewed, bounded operator inputs for exact browser,
OS, hardware class, driver/Metal, display, scale, power, thermal, background
load, and artifact paths. The page adds browser-observable capabilities and
runtime results. The validator refuses mismatched release/fixture/harness
digests, stale times, missing full versions/builds, hidden or backgrounded runs,
serials/personal paths, or a claimed hardware/software decode mode that was not
observable.

Support the browser-neutral local page first. Optional controller adapters may
launch installed Chrome, Edge, or Firefox in headed clean profiles, but do not
make controller availability a prerequisite for shipping Safari. Safari uses
the same page and operator runbook in the shipping browser; Playwright WebKit
output cannot fill its product/version fields.

Create one canonical profile ID from public-safe normalized environment fields,
never a hardware serial. Each of three repetitions begins with a fresh browser
profile/process and retains failures or host interruptions. Validate and render
the JSON only after all raw attachment digests are known.

Run:

```text
npm run certification:serve -- --candidate artifacts/1.0.0/candidate-manifest.json
npm run certification:validate-runtime -- path/to/runtime-report.json --candidate artifacts/1.0.0/candidate-manifest.json
```

### 11. Implement the separate observed-display evidence path

Create:

```text
packages/certification/src/display-model.ts
packages/certification/src/display-criteria.ts
packages/certification/src/display-report.ts
packages/certification/test/display-criteria.test.ts
apps/playground/src/certification/display-pattern.ts
scripts/certification/import-display-observations.mjs
scripts/certification/validate-display-report.mjs
docs/certification/operator-display-runbook.md
```

The display pattern renders redundant error-tolerant content IDs, occurrence
IDs, complements, calibration patches, and an independently clocked capture
marker without changing production scheduling. The import tool accepts a
bounded canonical observation CSV/JSON produced from either a qualifying
scan-out trace or calibrated external capture. It records refresh/capture
ordinals, decoded IDs/confidence, ambiguous/missing samples, calibration, and
raw attachment digests.

Require external capture rate at least four times independently measured
refresh. Normalize expected content repetition before grading accidental
duplicates. Implement the master seam-gap threshold exactly and propagate any
ambiguous boundary/capture drop to `inconclusive`. Reject RAF/canvas/readback/
screenshot fields offered as scan-out evidence and reject an observation file
whose runtime report did not pass.

Observed-display evidence remains optional. Documentation and release summaries
must render absent evidence as `not measured`, not blank or passed.

Run:

```text
npx vitest run packages/certification/test/display-criteria.test.ts
npm run certification:validate-display -- path/to/display-report.json --runtime path/to/runtime-report.json --candidate artifacts/1.0.0/candidate-manifest.json
```

### 12. Build executable documentation and support tables

Create or update:

```text
README.md
docs/quick-start.md
docs/states-and-triggers.md
docs/element-api.md
docs/compiler.md
docs/network-and-integrity.md
docs/accessibility-and-motion.md
docs/performance-and-budgets.md
docs/troubleshooting.md
docs/browser-support.md
docs/format/0.1.md
docs/project/0.2.md
docs/security.md
docs/releases/1.0.0.md
docs/certification/method.md
examples/zero-config-loop/*
examples/idle-hover-states/*
examples/network-integrity/*
scripts/docs/check-docs.mjs
tests/docs/examples.test.ts
```

Make quick starts copy-pasteable against packed `1.0.0` packages. Cover
zero-config loop, user states/triggers, hover/focus engagement, explicit API,
partial-loop behavior, reversal/portal/finite/held semantics, readiness/events,
fallback/reduced motion, sizing/semantics, compiler/dev flow, CDN/range/ETag/
integrity/CSP, diagnostics, resource policy, and unsupported behavior.

Generate browser-support tables from validated runtime/display reports. Use
separate `runtime scheduling` and `observed display` columns and explicit
`unsupported`, `failed`, and `not measured` cells. Do not hand-edit result
tables.

Typecheck every TypeScript/HTML-module snippet, build every example from packed
tarballs, run its primary browser interaction, and validate internal links,
package names, commands, exports, event/error names, JSON, and version strings.

Run:

```text
npm run docs:check
npm run test:examples
```

### 13. Add security, license, SBOM, and workflow policy checks

Create:

```text
SECURITY.md
THREAT-MODEL.md
THIRD_PARTY_NOTICES.md
config/release/license-policy.json
config/release/security-exceptions.json
scripts/security/check-lockfile.mjs
scripts/security/check-workflows.mjs
scripts/security/check-package-artifacts.mjs
scripts/security/generate-sbom.mjs
scripts/security/validate-sbom.mjs
scripts/security/check-licenses.mjs
tests/security/supply-chain.test.ts
```

Use a pinned generator to create SPDX 2.3 JSON for the complete workspace and
for each packed public package. Cross-check package names, versions, dependency
edges, checksums, licenses, and file digests against lockfile/tarballs. Keep the
generated release SBOMs in the artifact set; commit only stable policy and any
small canonical source SBOM required by the project.

Scan source, fixtures, provenance, docs, reports, traces, tarballs, and SBOMs for
credentials, private keys, tokens, local paths, query strings, unexpected
binaries, executable modes, and bundled native codecs. Validate that every
workflow action is pinned to a full reviewed commit, checkout credentials are
not persisted, permissions are least privilege, installs use the lockfile, job
timeouts exist, and pull requests have no publish/id-token authority.

Run dependency audit. Reject critical production findings and unwaived high
production findings. Validate every exception's exact subject, reachability,
mitigation, owner, review, and expiry before the next release. Generate license
notices and fail on unknown or policy-incompatible licensing.

Run:

```text
npm audit --audit-level=high
npm run security:check
npm run sbom:generate
npm run sbom:validate
npm run licenses:check
```

### 14. Install the required CI and scheduled workflows

Create:

```text
.github/workflows/ci.yml
.github/workflows/scheduled-hardening.yml
.github/workflows/release-candidate.yml
.github/workflows/publish.yml
```

`ci.yml` runs source, unit, cross-platform, browser-reference, capability-probed
production, package-consumer, and security lanes. Use exact versions from
release policy, npm cache keyed by lockfile/tool version, sequential browser
timing files, job timeouts, concurrency cancellation, and bounded artifact
retention. Upload structured results even on failure.

`scheduled-hardening.yml` runs full mutation seeds, long fake-clock/lifecycle
stress, semantic FFmpeg matrix, and repeated browser suites. It has no write or
publish authority and never opens a golden-update commit automatically.

`release-candidate.yml` accepts one immutable commit, requires a clean annotated
version intent, re-runs complete gates, packages once, generates API/SBOM/
provenance artifacts, writes the candidate manifest, signs/attests the artifact
set where available, and stores it in a protected release environment. The
release manifest is created only after validated named reports exist.

`publish.yml` is manual and protected. It accepts only a verified release
manifest/artifact-set digest, obtains short-lived registry identity, publishes
the existing tarballs under `next`, runs registry consumers, then separately
promotes exact versions to `latest`. Do not expose publication to pull requests
or rebuild source.

Add tests that parse workflow YAML and policy rather than relying on review
alone.

### 15. Generate and verify the immutable release manifest

Create:

```text
packages/certification/src/release-manifest.ts
packages/certification/src/artifact-verifier.ts
packages/certification/test/release-manifest.test.ts
scripts/release/create-manifest.mjs
scripts/release/verify-manifest.mjs
scripts/release/render-release-notes.mjs
```

Hash commit/tree/tool versions, package tarballs/file lists/registry integrity,
API/declaration reports, browser harness, fixtures/provenance, docs/examples,
SBOM/licenses, CI results, certification reports/attachments, security/legal
records, and rollback target into canonical JSON. Refuse a dirty tree, missing
artifact, duplicate path, symlink escape, local path, changed digest, stale
report, mismatched version, failed required criterion, or an attachment larger
than policy.

Because named reports are produced after package build, use two immutable
manifests:

1. `candidate-manifest.json` identifies all executable/content artifacts and is
   the digest named by every certification run;
2. `release-manifest.json` embeds the candidate digest and adds validated
   reports, review records, release notes, and rollback target without changing
   the candidate artifacts.

This avoids a self-referential digest while preserving exact certification.
Test any candidate artifact mutation and any report substitution as a hard
failure.

Run:

```text
npm run release:create-candidate-manifest
npm run release:verify-manifest
```

The candidate command runs before named certification. The release-manifest
command must reject incomplete report sets and is run for the successful final
artifact only after Step 17.

### 16. Implement publication ledger, dry run, and rollback drill

Create:

```text
schemas/publication-ledger.schema.json
packages/certification/src/publication-ledger.ts
packages/certification/test/publication-ledger.test.ts
scripts/release/publish-exact.mjs
scripts/release/promote-dist-tags.mjs
scripts/release/rollback-dist-tags.mjs
scripts/release/verify-registry.mjs
docs/releases/publication-runbook.md
docs/releases/rollback-runbook.md
```

Make every registry operation read-before-write and idempotent. Record exact
package/version/tarball digest, registry integrity, before/after tag, result,
time, and approval. If a version exists, accept only an exact integrity match;
never overwrite or treat a different version as success.

Dry-run against a local disposable registry or no-write registry adapter. Test
network failure after every package, existing exact/different versions, partial
`next`, consumer failure, interrupted promotion, and rollback in reverse
dependency order. A failed partial release cannot reach `latest`.

The rollback drill restores recorded prior tags, deprecates the affected exact
versions in the fake registry, withdraws report summaries without deleting raw
evidence, and renders public mitigation instructions. Do not use `npm unpublish`
or add a runtime remote kill switch.

Run:

```text
npm run release:publish-dry-run
npm run release:rollback-drill
```

### 17. Run and publish the named certification matrix

Create directories from schemas, not handwritten prose:

```text
docs/certification/1.0.0/index.json
docs/certification/1.0.0/index.md
docs/certification/1.0.0/<profile-id>/runtime-scheduling.json
docs/certification/1.0.0/<profile-id>/runtime-scheduling.md
docs/certification/1.0.0/<profile-id>/observed-display.json  # only when run
docs/certification/1.0.0/<profile-id>/observed-display.md    # only when run
```

For macOS 26 Apple Silicon M1-or-later, run shipping Safari 26 and current
stable Chrome/Firefox plus Edge where supported. For Windows 11 with UHD
620-class-or-better graphics, run current stable Chrome/Edge/Firefox and record
Safari unavailable. Replace every channel description in the report with exact
product version/build. Test 60 Hz and 120 Hz where exposed.

For every exact supported production profile:

1. verify candidate/artifact/fixture/harness digests;
2. capture the exact public-safe environment and probes;
3. fresh-start the branded browser in a visible headed document;
4. run three complete loop/transition/reversal/portal/rapid-input/throughput/
   cleanup repetitions;
5. run lifecycle/resource/fault and the 30-minute soak;
6. preserve failed, interrupted, and inconclusive attempts;
7. validate/canonicalize the report and attachment hashes; and
8. have a second reviewer verify environment and criteria.

For unsupported production AVC, run the strict static fallback suite and emit
separate unsupported-animation and passed-static criteria. Do not substitute a
codec/browser/engine. Run observed-display capture only where the qualifying
method and operator are available; otherwise generate an explicit `not measured`
summary cell, not a display report claiming success.

At least one supported animated macOS profile and one supported animated Windows
profile must pass. Any available browser whose exact supported configuration
fails blocks the release until fixed or accurately removed from the claimed
support policy.

After the matrix and second reviews pass, generate the release manifest from
the unchanged candidate digest and the validated report index. Regenerate no
package, harness, fixture, documentation, or SBOM byte at this stage.

Run:

```text
npm run release:create-release-manifest -- --reports docs/certification/1.0.0
npm run release:verify-manifest
```

### 18. Final evidence, audit, and release gate

Create:

```text
docs/evidence/2026-07-12-m9-certification-release.md
```

Run from a clean checkout at the candidate commit:

```text
npm ci --ignore-scripts
npm run check:generated
npm run typecheck
npm run test:unit
npm run test:mutation -- --profile release
npm run build
npm run test:browser:reference
npm run test:browser:production
npm run test:consumers
npm run test:examples
npm run fixtures:verify
npm run api:check
npm run docs:check
npm run security:check
npm audit --audit-level=high
npm run sbom:generate
npm run sbom:validate
npm run release:pack
npm run release:inspect-packages
npm run release:publish-dry-run
npm run release:rollback-drill
npm run release:verify-manifest
git diff --check
```

Then run the named matrix and validate every committed report/index/support
table from the exact candidate digest. Repeat the complete packaged browser
smoke three times and verify all final terminal counters.

Run a strict maintainability and authority audit. Reject:

- duplicate claim/status/deadline/boundary/report-schema owners;
- report prose or support tables editable independently of canonical JSON;
- any callback timestamp relabeled as display/scan-out evidence;
- Playwright product relabeled as a branded-browser certification;
- a final artifact rebuilt after certification;
- private imports in harness/examples/consumer tests;
- a floating tool/action/browser dependency in a claim;
- golden rewriting or failed-run deletion in CI/release scripts;
- unbounded fuzz/log/report/attachment/resource behavior;
- heap/RSS telemetry used as ownership truth;
- tarballs containing source-private, local, secret, native codec, or unexpected
  executable content;
- release workflow authority on pull requests or long-lived registry tokens;
- a publish retry that can overwrite or accept different bytes; and
- rollback that depends on unpublish or remote runtime control.

Searches include:

```text
rg -n "displayed|scan.?out|seamless|certified" packages apps tests docs scripts .github
rg -n "requestAnimationFrame|performance\.now|VideoFrame\.timestamp|fenceSync|readPixels" apps packages tests
rg -n "playwright|webkit|chromium|chrome|edge|firefox|safari" docs/certification packages/certification
rg -n "latest|stable|@[A-Za-z0-9._/-]+$" .github config/release package.json packages/*/package.json
rg -n "npm publish|dist-tag|unpublish|id-token|NODE_AUTH_TOKEN" .github scripts
rg -n "(/Users/|/home/|[A-Z]:\\\\|BEGIN .*PRIVATE KEY|token=|authorization:)" docs fixtures artifacts
rg -n "@pixel-point/aval-.+/src/|\.\./src/" apps examples tests/consumers
```

Every match must be a sole authority, explicit negative assertion, schema,
test, reviewed pinned value, or removed.

The M9 evidence records:

- commit/tree and exact tool/dependency/action versions;
- CI job/result/artifact digests and test/pass/skip/unsupported counts;
- fixture/source/generator/asset/provenance/tool fingerprints;
- mutation generator versions, seeds, case/rejection counts, bounded peaks, and
  minimized-failure digests;
- candidate/release manifest digests and every tarball/API/docs/SBOM/license
  digest and contents summary;
- exact branded browser/OS/hardware/display/power/profile IDs and capability
  outcomes without serials/personal identifiers;
- all three run IDs, 1,000-boundary counts, first/last frame ordinals, route/
  reversal/portal/rapid-input counts, throughput, canvas deadline statistics,
  underflow/configure/reset/flush/reconfigure/seek counters;
- lifecycle/resource/network/context/visibility scenario counts, peaks, soak
  duration, and terminal baselines;
- observed-display report IDs or explicit `not measured`, always separate from
  runtime results;
- API classifications, package-consumer/example/docs checks, audit findings,
  security exceptions, legal/license review records, and reviewers;
- publish dry-run and rollback-drill ledger digests; and
- the explicit boundary: exact named-profile runtime scheduling certification,
  not universal behavior or physical display continuity unless a separate
  observed-display report passes.

Do not mark M9 complete, tag, or publish until every required result is present,
schema-valid, digest-linked, independently reviewed, and green. Publication of
`1.0.0` is a deliberate protected follow-up over the certified bytes; if the
user has not authorized the external registry mutation, hand off the complete
verified artifact set and exact publish command without performing it.

## Planned Production and Policy Files

```text
packages/certification/             private report/criteria/artifact authority
apps/playground/src/certification/  public-path headed harness
config/release/                     versioned release/API/security policy
schemas/                            canonical report/manifest/ledger schemas
scripts/certification/              run configuration, serve, import, validation
scripts/fixtures/                   read-only golden/provenance verification
scripts/release/                    package, manifest, publish, rollback
scripts/security/                   lockfile, workflow, package, SBOM, licenses
scripts/testing/                    bounded seeded matrix/minimization
```

Existing package indexes/manifests, tests, browser configs, root scripts,
playground routes, and documentation are updated in place. Do not create a
second player, graph, loader, renderer, compiler, or resource implementation in
certification tooling.

## Planned Evidence and Release Files

```text
api-extractor.base.json
etc/api/*.api.md
.github/workflows/{ci,scheduled-hardening,release-candidate,publish}.yml
docs/certification/**
docs/releases/**
docs/evidence/2026-07-12-m9-certification-release.md
examples/{zero-config-loop,idle-hover-states,network-integrity}/**
THREAT-MODEL.md
SECURITY.md
THIRD_PARTY_NOTICES.md
```

Large tarballs, SBOM bundles, traces, raw captures, browser profiles, and
publication ledgers remain immutable release artifacts. The repository stores
their validated digests and public-safe summaries.

## Final Claim Boundary

M9 may claim a reproducible web-only 1.0 package release and runtime scheduling
certification only for the exact published named profiles whose reports pass.
It may publish static-fallback conformance for an unsupported animated profile.
It may claim observed-display continuity only for a separate passed report made
with qualifying independent evidence. It may never generalize those results to
future browser builds, mobile/native platforms, unlisted hardware/power modes,
visual naturalness, codec/patent licensing, or arbitrary system load.
