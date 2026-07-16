# Multi-Codec Thermo-Nuclear Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every blocker found in the multi-codec review while preserving AVAL behavior and proving the rabbit codec demo in Chromium and WebKit/Safari.

**Architecture:** Establish one format-owned codec identity contract, one player-owned certified source/rendition pipeline, and codec-specific typed compiler/runtime adapters. Keep protocol orchestration separate from unit buffering and readiness evidence separate from worker submission planning. Reuse one publication primitive layer and one browser-safe build-report parser.

**Tech Stack:** TypeScript, JavaScript modules, Vitest, Playwright, WebCodecs, FFmpeg/FFprobe, Vite.

---

### Task 1: Lock down the canonical codec contract

**Files:**
- Modify: `packages/format/src/video/codec-string.ts`
- Modify: `packages/format/src/manifest-schema.ts`
- Modify: `packages/format/src/index.ts`
- Modify: `packages/format/test/video-codec-string.test.ts`
- Modify: `packages/element/src/element-source-candidates.ts`
- Modify: `packages/element/test/element-source-candidates.test.ts`

- [ ] **Step 1: Add failing tests for unsupported and mistyped codec strings**

```ts
expect(parseVideoCodecString("avc1.000000")).toBeUndefined();
expect(parseVideoCodecString("vp09.99.99.08")).toBeUndefined();
expect(parseVideoCodecString("av01.2.00M.08.0.110.01.01.01.0")).toBeUndefined();
expect(parseVideoCodecString("vp09.00.10.12")).toBeUndefined();
```

- [ ] **Step 2: Run the focused format/element tests and confirm the new cases fail**

Run: `npx vitest run packages/format/test/video-codec-string.test.ts packages/element/test/element-source-candidates.test.ts --config vitest.m9.config.ts`

- [ ] **Step 3: Replace regex-family guessing with codec-owned parsers and export canonical metadata**

```ts
export const VIDEO_CODECS = Object.freeze(["h264", "h265", "vp9", "av1"] as const);
export const VIDEO_BITSTREAM_BY_CODEC = Object.freeze({
  h264: "annex-b", h265: "annex-b", vp9: "frame", av1: "low-overhead"
} as const);
export type ParsedVideoCodecString =
  | { readonly family: "h264"; readonly bitDepth: 8 }
  | { readonly family: "h265"; readonly bitDepth: 8 | 10 }
  | { readonly family: "vp9"; readonly bitDepth: 8 }
  | { readonly family: "av1"; readonly bitDepth: 8 | 10 };
```

- [ ] **Step 4: Make the element MIME parser delegate codec validation to the format helper**
- [ ] **Step 5: Run focused tests and typecheck the format and element packages**

### Task 2: Make source mutation and selection atomic

**Files:**
- Modify: `packages/element/src/element-source-observer.ts`
- Modify: `packages/element/src/element-reconciler.ts`
- Modify: `packages/element/test/element-source-observer.test.ts`
- Modify: `packages/element/test/element-source-generation-publication.test.ts`
- Modify: `packages/player-web/src/runtime/video-source-selection.ts`
- Modify: `packages/element/src/browser-runtime-factory.ts`
- Modify: `packages/player-web/src/runtime/integrated-animated-preparation.ts`
- Modify: `apps/playground/src/main.ts`

- [ ] **Step 1: Add a failing immediate reorder-then-prepare test**

```ts
reorderDirectChildSources(host, "vp9");
await element.prepare();
expect(openedCodec).toBe("vp9");
```

- [ ] **Step 2: Prove the current implementation joins the stale generation**
- [ ] **Step 3: Add observer `flushRecords()` ownership and invoke it before configuration flush**

```ts
public flushRecords(): void {
  const records = this.#observer?.takeRecords() ?? [];
  if (records.some((record) => affectsDirectSource(this.#host, record))) this.#changed();
}
```

- [ ] **Step 4: Replace generic `accept` selection with a player-owned certified-source result**
- [ ] **Step 5: Remove the singleton candidate loop and `setTimeout(0)` workaround**
- [ ] **Step 6: Run element and source-selection tests**

### Task 3: Certify renditions once and isolate codec adapters

**Files:**
- Create: `packages/player-web/src/runtime/video-codec-adapters/h264.ts`
- Create: `packages/player-web/src/runtime/video-codec-adapters/h265.ts`
- Create: `packages/player-web/src/runtime/video-codec-adapters/vp9.ts`
- Create: `packages/player-web/src/runtime/video-codec-adapters/av1.ts`
- Create: `packages/player-web/src/runtime/video-codec-adapters/model.ts`
- Modify: `packages/player-web/src/runtime/video-codec-adapters.ts`
- Modify: `packages/player-web/src/runtime/video-rendition-selection.ts`
- Modify: `packages/player-web/src/runtime/video-rendition-inspection.ts`
- Modify: `packages/player-web/src/runtime/asset-catalog.ts`

- [ ] **Step 1: Add identity and adapter-dispatch tests**
- [ ] **Step 2: Introduce a catalog-bound certified rendition**

```ts
export interface CertifiedVideoRendition {
  readonly authoredIndex: number;
  readonly rendition: Readonly<ProductionRendition>;
  readonly geometry: Readonly<VideoRenditionGeometry>;
  readonly decoderConfig: Readonly<VideoDecoderConfig>;
}
```

- [ ] **Step 3: Move codec syntax inspection behind `Record<VideoCodec, VideoBitstreamAdapter>`**
- [ ] **Step 4: Delete downstream manifest/rendition recloning and deep identity comparisons**
- [ ] **Step 5: Run rendition, inspection, catalog, and source-selection tests**

### Task 4: Preserve compiler discriminants end-to-end

**Files:**
- Create: `packages/compiler/src/compile/video-codec-compiler.ts`
- Modify: `packages/compiler/src/compile/video-rendition-pipeline.ts`
- Modify: `packages/compiler/src/compile/video-encoding-policy.ts`
- Modify: `packages/compiler/src/source-project-schema.ts`
- Modify: `packages/compiler/src/source-project-normalize.ts`
- Modify: `packages/compiler/src/compile/compile-bundle-report.ts`
- Modify: `packages/compiler/test/video-rendition-pipeline.test.ts`
- Modify: `packages/compiler/test/source-project-schema.test.ts`

- [ ] **Step 1: Add tests proving normalized encodings use the canonical validator once**
- [ ] **Step 2: Dispatch once into typed codec compilers**

```ts
interface VideoCodecCompiler<E extends NormalizedVideoEncoding> {
  readonly alignment: Readonly<{ width: number; height: number }>;
  bitDepth(encoding: E): VideoBitDepth;
  encode(input: Readonly<CodecEncodeInput<E>>): Promise<Readonly<EncodedCodecUnit>>;
  prepare(input: Readonly<CodecPrepareInput<E>>): Readonly<PreparedEncodingRendition>;
}
```

- [ ] **Step 3: Remove union-array casts and nested codec ternaries**
- [ ] **Step 4: Normalize encodings directly at source-schema ingress**
- [ ] **Step 5: Reuse canonical cloning when building reports**
- [ ] **Step 6: Run compiler unit and real-tool focused tests**

### Task 5: Decompose decoder and readiness state machines

**Files:**
- Create: `packages/player-web/src/decoder-worker/decoder-unit-pipeline.ts`
- Modify: `packages/player-web/src/decoder-worker/core.ts`
- Modify: `packages/player-web/src/decoder-worker/decoder-worker.test.ts`
- Create: `packages/player-web/src/runtime/readiness-group-planner.ts`
- Create: `packages/player-web/src/runtime/browser-readiness-probe.ts`
- Modify: `packages/player-web/src/runtime/browser-video-candidate-readiness.ts`
- Modify: `packages/player-web/src/runtime/worker-samples.ts`

- [ ] **Step 1: Preserve existing worker ordering/flush/retirement tests**
- [ ] **Step 2: Extract unit submission, expected output, buffering, flushing, and retirement into `DecoderUnitPipeline`**
- [ ] **Step 3: Keep `DecoderWorkerCore` responsible only for protocol, generation, decoder configuration, and lifecycle**
- [ ] **Step 4: Add one canonical safe-group/credit plan result**

```ts
interface WorkerGroupPlan {
  readonly requests: readonly WorkerSampleFrameRequest[];
  readonly chunkCost: number;
  readonly frameCost: number;
  readonly fits: boolean;
  readonly reorderLookahead: boolean;
}
```

- [ ] **Step 5: Extract browser readiness probe transport and pure sequence planning**
- [ ] **Step 6: Confirm both production files are below 1,000 lines and run focused runtime tests**

### Task 6: Consolidate publication and report boundaries

**Files:**
- Create: `packages/compiler/src/commands/publication-fs.ts`
- Modify: `packages/compiler/src/commands/compile-bundle-publication.ts`
- Modify: `packages/compiler/src/commands/init-publication.ts`
- Modify: `packages/compiler/src/compile/output.ts`
- Create: `packages/format/src/compile-bundle-report.ts`
- Modify: `packages/format/src/index.ts`
- Modify: `apps/playground/src/main.ts`
- Modify: `apps/playground/v1-http-fixture-plugin.ts`
- Modify: `examples/grass-rabbit-codecs/main.js`

- [ ] **Step 1: Keep publication race/durability tests green while extracting shared filesystem proofs**
- [ ] **Step 2: Delete unreachable single-file publication APIs from `output.ts`**
- [ ] **Step 3: Add a browser-safe `parseCompileBundleReport` contract and tests**
- [ ] **Step 4: Replace all three bespoke report parsers**
- [ ] **Step 5: Render compiler-recorded invocations instead of recreating FFmpeg policy in the example**

### Task 7: Split the example and browser suite, then clean documentation

**Files:**
- Create: `examples/grass-rabbit-codecs/codec-demo-controller.js`
- Create: `examples/grass-rabbit-codecs/codec-report.js`
- Create: `examples/grass-rabbit-codecs/codec-view.js`
- Modify: `examples/grass-rabbit-codecs/main.js`
- Create: `tests/grass-rabbit-codecs/report-ui.spec.ts`
- Create: `tests/grass-rabbit-codecs/codec-activation.spec.ts`
- Create: `tests/grass-rabbit-codecs/rabbit-interaction.spec.ts`
- Create: `tests/grass-rabbit-codecs/support/browser-harness.ts`
- Delete: `tests/grass-rabbit-codecs/browser.spec.ts`
- Modify: `README.md`

- [ ] **Step 1: Move report, controller, and view responsibilities into focused modules**
- [ ] **Step 2: Split the 1,130-line test by behavior and share one typed harness**
- [ ] **Step 3: Resolve README conflict markers and delete obsolete codec/Safari TODOs**
- [ ] **Step 4: Run `git diff --check` and line-count audit**

### Task 8: Full verification

**Files:**
- Verify only; do not change generated assets unless a compiler-output test requires regeneration.

- [ ] **Step 1: Run `npm run typecheck`**
- [ ] **Step 2: Run `npm run test:unit`**
- [ ] **Step 3: Run `npm run build`**
- [ ] **Step 4: Run `npm run test:grass-rabbit`**
- [ ] **Step 5: Run `npm run test:grass-rabbit-codecs` for Chromium and WebKit**
- [ ] **Step 6: Start the codec rabbit server and manually exercise every supported tab in Chromium and WebKit/Safari**
- [ ] **Step 7: Verify unsupported codecs show the example-owned error without creating a runtime player**
- [ ] **Step 8: Run `git diff --check`, inspect `git status`, and report exact test evidence**
