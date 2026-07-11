# Rendered Motion Experiment

An open, web-only experiment for short pre-rendered animations with seamless partial loops, user-defined states, and deterministic interaction transitions.

The project is intentionally unnamed. “Rendered motion” and `.rma` are descriptive prototype labels, not product branding.

## Current milestones

M1 proves continuous partial-loop scheduling in a real browser:

- browser-generated H.264 Annex B access units;
- one continuously configured `VideoDecoder`;
- exact rational timestamps assigned to every repeated iteration;
- no seek, reset, configure, or flush at loop seams;
- a realtime decoded presentation lead; and
- 2,002 machine-tagged decoder outputs across exactly 1,000 seams.

M2 adds one arbitrary reversible endpoint pair:

- a bounded, deduplicated WebGL2 `RGBA8` texture-array cache;
- source and target restart runways with explicit memory accounting;
- one forward decoder whose obsolete generations are closed safely;
- adjacent-frame reversal on the next content tick;
- recovery of both endpoint bodies before their eight-frame runways end;
- context-loss and visibility-safe logical-time freezing; and
- 1,000 cached resident reversal draws with 1,000+ framebuffer tag reads.

M3 freezes the browser-independent user-defined graph:

- one to 32 creator-defined states with loop, finite, or held bodies;
- portal, finish, cut, locked, reversible, completion, and static routes;
- deterministic frame commands from explicit consecutive content ticks;
- latest-wins input, direct follow-ons, and adjacent-frame active reversal;
- immutable ordered effects and exactly-once request settlement descriptors;
- strict input, routing-operation, resource, and diagnostic-trace bounds; and
- 10,320 seeded fuzz ticks replayed with deep deterministic equality.

M4 freezes the minimal compiled asset contract:

- one canonical, deterministic 0.1 header, manifest, front index, and payload layout;
- strict UTF-8 canonical JSON with duplicate, dangerous-key, and hostile-input rejection;
- closed rendition, unit, graph, readiness, fallback, and resource-limit schemas;
- canonical reference-RGBA samples plus deliberately shallow M4 PNG envelopes;
- a bounded writer with a verified static-offset fixed point and byte-identical round trips;
- range-only immutable parsing with no retained media payload views; and
- two checked-in conformance assets plus deterministic mutation fuzzing.

The FFmpeg compiler, integrated decoder scheduler, packed alpha, range loader,
and public custom element follow in later milestones.

## Run it

Requirements: Node.js 22.12 or later and a browser with WebCodecs. The experiment probes H.264 Annex B first and labels VP8 only as a scheduler fallback.

```bash
npm install
npm run dev
```

Then open the displayed localhost URL. The page includes the hover/focus
reversal demo, resident-cache diagnostics, the 1,000-reversal GPU proof, and
the original 1,000-seam loop proof.

## Verify it

```bash
npm run typecheck
npm run test:unit
npm run build
npm run test:browser
```

Install the Chromium test runtime first if it is not already cached:

```bash
npx playwright install chromium
```

## Documentation

- [Format design](docs/superpowers/specs/2026-07-11-web-rendered-motion-format-design.md)
- [Implementation plan](docs/superpowers/plans/2026-07-11-web-rendered-motion-implementation.md)
- [M2 design addendum](docs/superpowers/specs/2026-07-11-m2-resident-reversible-interaction-design.md)
- [M2 implementation plan](docs/superpowers/plans/2026-07-11-m2-resident-reversible-interaction-implementation.md)
- [M4 format design](docs/superpowers/specs/2026-07-11-m4-minimal-compiled-format-design.md)
- [M4 implementation plan](docs/superpowers/plans/2026-07-11-m4-minimal-compiled-format-implementation.md)
- [M1 browser evidence](docs/evidence/2026-07-11-m1-continuous-loop.md)
- [M2 browser evidence](docs/evidence/2026-07-11-m2-resident-reversal.md)
- [M3 graph evidence](docs/evidence/2026-07-11-m3-deterministic-graph.md)
- [M4 format evidence](docs/evidence/2026-07-11-m4-minimal-compiled-format.md)

Headless browser results prove decoded ordering and lifecycle behavior, not physical display scan-out continuity. Display certification requires separate headed device profiles and external observation.
