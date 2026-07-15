# M4 Minimal Compiled Format Evidence

**Date:** 2026-07-11

**Milestone:** Canonical, browser-independent compiled asset contract

## Result

M4 passes its implementation gate. The new pure `@pixel-point/aval-format`
package writes one byte-canonical 0.1 asset, parses a bounded front index,
validates the exact complete layout, checks the M4 conformance payload
envelopes, and adapts the manifest to M3's immutable graph.

The production TypeScript project exposes only `ES2023` types and depends only
on `@pixel-point/aval-graph`. It has no DOM, WebCodecs, Node, network, or
platform-crypto dependency. Parsed results are detached, recursively frozen
metadata and numeric ranges; no returned object retains caller media bytes.

`.avl` remains a private prototype suffix, not a registered or published file
format.

## Captured Environment

- macOS 15.6, arm64
- Node.js 25.8.1
- npm 11.11.0
- TypeScript 7.0.2
- Vitest 4.1.10
- Playwright 1.61.1

## Frozen Contracts

- Exact 64-byte `AVLF` header, 16-byte `AVLI` index header, 32-byte sample
  records, eight-byte alignment, zero padding, and exact end-of-file geometry.
- Strict UTF-8 canonical JSON with bytewise key ordering, safe integers,
  null-prototype parsing, duplicate/dangerous-key rejection, and lower-only
  depth, node, string, manifest, and file budgets.
- A closed 0.1 manifest for reference RGBA, opaque AVC Annex B, packed-alpha
  AVC Annex B, body/bridge/reversible/one-shot units, creator states, triggers,
  transitions, bindings, readiness, fallback, and declared resource limits.
- One canonical rendition→unit→frame sample plan shared by schema validation,
  writer normalization, index validation, and layout planning.
- One canonical byte-layout planner shared by the writer and reader, including
  header/index geometry, unit/static positions, padding, records, and final
  length.
- A deterministic 32-iteration static-offset fixed point with a directly
  exercised non-convergence branch and a final fixed-point recheck.
- Exact `AVRF` reference-frame envelopes and M4's intentionally shallow PNG
  signature/IHDR gate.

## Golden and Adversarial Proof

The format suite contains 212 tests across 20 files. It covers exact binary
headers and records, canonical JSON grammar and mutation fuzzing, every closed
manifest union, graph adaptation, bounded prefix parsing, layout aliases and
padding, reference frames, shallow PNG envelopes, canonical writing, byte-
identical round trips, and fixed-point convergence at alignment and decimal-
width boundaries.

Hostile tests exercise sparse and oversized arrays, throwing proxies, unsafe
integers, overlong UTF-8, unknown keys, record truncations, huge lengths,
malformed supplied front indexes, and every whole-file truncation. Writer and
schema paths reject declared counts before traversing or allocating their
corresponding collections. Fixed-seed byte and structured mutations may only
produce a recursively frozen valid result or `FormatError`; built-in exception
leakage is a failure.

The checked-in fixtures are deterministic writer output:

| Fixture | Bytes | Whole-file SHA-256 |
| --- | ---: | --- |
| `reference-loop.avl` | 1,593 | `d2741ca678232bbd30e0c10d0572d83ed147222604b074a21e05a3440ef642f8` |
| `reference-graph.avl` | 5,713 | `91cd7336c518caba4ce5df07a13203fccaebb48ef756c7d41d6fd6441be68d95` |

These digests are review provenance only; runtime digest verification belongs
to M7.

## Maintainability Gate

A strict review rejected the first green implementation because manifest
schema concerns, UTF-8 scalar rules, canonical sample traversal, and byte
layout were repeated across large modules. The final implementation splits the
schema by rendition, unit, graph, limits, and relations; gives UTF-8/scalar
logic one owner; gives sample ordering one owner; and makes writer/reader
geometry derive from the same planner. Focused hostile tests guard every
allocation-order issue found by the contract audit.

## Verification Gate

The final repository gate completed successfully:

```text
npm run typecheck       passed across all workspaces and tests
npm run test:unit       45 files, 492 tests passed
npm run build           graph, format, player, and playground passed
npm run test:browser    7 Chromium regression tests passed
npm audit --audit-level=high
                        0 vulnerabilities
npm pack --dry-run -w @pixel-point/aval-format
                        package contents inspected successfully
git diff --check        passed
```

The browser suite retained the M0/M1 smoke and 1,000-loop-seam evidence plus
the M2 visible reversal, 1,000 cached reversal, recovery, and context-loss
proofs. Generated `dist` output was removed after verification and is not part
of the M4 change.

## Claim Boundary

M4 proves structural binary, canonical JSON, manifest, graph-mapping, layout,
reference-envelope, and shallow PNG-envelope conformance. It intentionally
does not claim H.264 bitstream decodability, full PNG chunks/CRC/IDAT/IEND
conformance, SHA-256 payload integrity, network/range integrity, actual media
decode, integrated scheduling, packed-alpha rendering, accessibility, or
physical display continuity. Those remain M5 through M9 work.
