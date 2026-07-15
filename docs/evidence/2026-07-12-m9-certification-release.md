# M9 certification and release evidence

Date: 2026-07-12

Status: local engineering, exact test-only archives, clean consumers/examples,
and bundled-Chromium functional certification are complete. Protected candidate
creation, Firefox/WebKit execution on this disk-constrained host, external named
profiles, human legal/publication-metadata approval, and registry publication
remain pending.

Local implementation freeze: commit
`63792f9b51b02f264eca110e646b57df6e4dd6c9`, tree
`14c59676a24f48ce8fbdb55c22c89037970f45dc`. This is engineering evidence,
not the still-uncreated protected candidate identity.

## Implemented independent certification authority

- Private `@pixel-point/aval-certification` package with the closed result
  vocabulary, bounded canonical JSON, exact runtime/display report separation,
  environment normalization, public-safe profile IDs, attachment verification,
  conformance runner, runtime/display criteria, benchmark statistics, ownership
  settlement, candidate/release manifest validation, API compatibility policy,
  and idempotent publication planning.
- Seven versioned JSON schemas plus release, API, benchmark, license, security,
  and toolchain policies.
- Browser-side scheduling criteria use only `canvasSubmission*` evidence. A
  separate observed-display evaluator requires independent observations and
  yields `inconclusive` for ambiguity or dropped capture.
- Artifact bundles reject path traversal, symlinks, digest/length substitution,
  excessive size, and unapproved media types. Display reports bind to the exact
  bytes and passed status of their referenced runtime report.

Focused and repository-wide results on the final local implementation tree:

```text
packages/certification: 13 files, 44 tests passed
M9 repository policy suites: 5 files, 11 tests passed
certification package source/test typecheck: passed
complete repository: 287 files, 2,336 tests passed
all workspace and top-level test typechecks: passed
```

## Fixture and provenance composition

`scripts/fixtures/verify-all.mjs` performs a read-only composition. It verified
seven provenance files and 260 on-disk digest/length references, ran the
tool-free generated checks, strict-validated twelve complete assets through the
format package, checked both M8 semantic summaries, and reproduced the exact
29-file starter:

```text
M4: reference-graph.avl, reference-loop.avl
M5: opaque-loop.avl, opaque-path.avl, opaque-reversible.avl
M5.5: opaque-all-routes.avl
M6: opaque-odd.avl, packed-alpha-all-routes.avl, packed-alpha-loop.avl
M7: reference-packed.avl
M8: one-state-partial-loop.avl, user-states-all-routes-alpha.avl
```

Golden verification does not invoke FFmpeg. Native-tool regeneration remains a
separate explicit `--tool-backed` semantic lane.

## Release and supply-chain gates

- SHA-pinned, least-privilege pull-request, scheduled hardening, immutable
  candidate, and protected publication workflows.
- Lockfile-only installation checks, exact dependency source/integrity policy,
  workflow authority checks, package content scanning, license policy, SPDX 2.3
  generation/validation, and high-severity dependency audit.
- Build-once package, archive inspection, clean consumer, candidate/release
  manifest, exact publication, promotion, registry verification, and reverse
  rollback tooling. Registry mutation requires an explicit protected execution
  flag and approval ID; dry runs do not mutate.
- The publish lane records npm's current authentication boundary: OIDC requires
  Node 22.14.0/npm 11.5.1 and can publish under `next`, while `dist-tag`
  promotion needs a separate short-lived protected authorization. The workflow
  does not falsely claim OIDC authority for `latest` promotion.
- Current audit result: 0 vulnerabilities. Lockfile, workflow, security, API,
  and deterministic SBOM checks passed; the workspace SPDX document validated
  152 package records before the final lockfile audit reported 158 entries.
- API Extractor 7.58.9 generated and verified the five committed API reports.
- The legal license gate intentionally remains closed: API Extractor's exact
  `minimatch@10.2.3` dependency declares `BlueOak-1.0.0`, which is recorded as
  `reviewRequired` and has not been approved by a qualified human reviewer.

## Documentation and claim boundary

The executable docs check covered 68 Markdown documents and five public package
examples. It checks relative links, exact 1.0 package names, public imports, and
the generated support-table region. Quick start, state/trigger, element,
compiler, network/integrity, accessibility, budget, troubleshooting, versioning,
security, format/project, release, certification, publication, and rollback
documentation are present.

The checked certification index intentionally says `not-run` and `not measured`.
No named browser, observed-display, final release, registry, or universal
smoothness claim is made by this engineering checkpoint.

## Exact local package and browser proof

`scripts/release/test-packed-local.mjs` built each package twice, required
deterministic archives, inspected every tar member, installed all five archives
into clean Node ESM, TypeScript NodeNext, TypeScript Bundler, Vite, compiler CLI,
generated-starter, and example consumers, then exercised the built public
element and real module worker in pinned Chromium. It passed with release-set
SHA-256:

```text
665f58458b17ab6be96809ae8fc213097d4a8757a5a361dd0ae1bd0965bce679
```

The public package archive SHA-256 values were `d30f8109…` (graph),
`81d68ca4…` (format), `26ffc90c…` (player-web), `2b9bd411…` (element), and
`7bf95d01…` (compiler). The packed starter advanced from source generation 1
to 3 after a valid watch replacement, finished `interactiveReady`, and the CLI
terminated at the documented interrupt status 130. All five examples, including
the React reference, built from the archives.

The source/dev Chromium matrix passed 73/73, and the dedicated pinned-Chromium
reference project passed the same 73/73. The seven packaged M9 production
scenarios passed three consecutive repetitions (21/21). These are Playwright
functional-engine results, not branded Chrome, Safari, Firefox, Edge, physical
display, or scan-out evidence. Firefox and WebKit were not run locally because
their pinned browser archives could not unpack in the host's remaining 489 MiB;
the pinned CI matrix remains configured to install and execute both.

## Remaining protected gates

The following cannot be fabricated by repository code and block an actual
`1.0.0` publication claim:

1. approved canonical repository/homepage/issues metadata and npm scope
   ownership authority;
2. qualified approval or an approved dependency decision for the review-required
   BlueOak build-tool license, plus the broader legal review record;
3. creation of the protected immutable candidate from an authorized clean commit;
4. three fresh-process headed repetitions for every required named macOS and
   Windows profile plus lifecycle/fault and 30-minute soak evidence;
5. two independent report reviews and a passed generated report index;
6. release manifest creation over the unchanged candidate digest; and
7. an explicitly authorized protected registry publication.

Before the first public publish, the release operator must add truthful
canonical repository/homepage/issue URLs once they exist. They are intentionally
omitted from source package metadata today because this checkout has no public
git remote; no placeholder URL is accepted.

Observed-display evidence remains optional and absent. If it is later gathered,
it must use the separate schema and qualifying independent method.
