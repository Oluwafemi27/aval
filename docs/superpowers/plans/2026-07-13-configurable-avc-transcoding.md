# Configurable AVC Transcoding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Always transcode author-supplied master media into independently decodable AVAL AVC units while giving authors safe CRF, preset, and bitrate-ceiling controls and reporting the exact encoding policy used.

**Architecture:** Add strict project schema `0.3` and versioned AVC-v1 rendition profiles that accept bounded CRF quantization while preserving the current low-delay Baseline, closed-GOP, one-reference, no-B-frame runtime contract. Encoding controls are typed and allowlisted; the compiler continues to own codec, pixel format, color, alpha packing, GOP boundaries, headers, threads, and raw Annex-B output. Existing `0.1`/`0.2` projects retain their current ABR/medium/zerolatency behavior and v0 output profile.

**Tech Stack:** TypeScript 7, Node.js 22, FFmpeg/FFprobe, libx264, raw H.264 Annex B, WebCodecs, Vitest, Playwright, API Extractor.

---

## Decisions and boundaries

- Project `0.3` always decodes and re-encodes every authored frame. Passthrough is not part of this change.
- Output remains H.264 through `libx264`. HEVC output requires a separate format, inspector, runtime, and browser-certification plan.
- Never accept raw FFmpeg arguments. They could override GOP independence, output paths/protocols, color, alpha packing, references, or deterministic threads.
- Expose only `preset`, ABR or capped CRF rate control, and `maxBitrate`.
- Allow presets `ultrafast`, `superfast`, `veryfast`, `faster`, `fast`, `medium`, `slow`, `slower`, and `veryslow`. Exclude `placebo`.
- Validate CRF as an integer from `1` through `51`. CRF `0` is incompatible with the current Constrained Baseline profile's lossless output.
- Use `maxBitrate` for both FFmpeg `-maxrate` and the current one-second `-bufsize`/CPB contract.
- Derive CRF-mode manifest average bitrate from final canonical access-unit bytes; declare configured `maxBitrate` as peak.
- Keep Baseline, CAVLC, yuv420p, BT.709 limited, one reference, no B-frames, closed GOP, stable parameter sets, repeated headers, one slice, fixed threads, and one initial IDR compiler-owned.
- Do not expose `faststart`: AVAL is not MP4 and already places its header/manifest/index first.
- Do not expose `hvc1`: it is an HEVC-in-MP4 tag and is meaningless for raw AVC in AVAL.
- Keep scale under project canvas/rendition dimensions. Keep audio disabled with compiler-owned `-an`.
- Treat “best available master” as an author contract. Record source facts and warn about obvious delivery codecs, but do not claim metadata can prove source quality.
- Keep packed-alpha decode-back quality gates unchanged; an aggressive CRF may correctly fail them.
- Project `0.3` always emits v1 renditions. Direct compilation keeps v0 only for the untouched legacy default; using `--crf` or an explicit nonlegacy preset emits v1.
- AVAL output is sample-only: no poster/static-image payload participates in transcoding or file size.

## Author-facing project shape

CRF:

```json
{
  "id": "avc.1x",
  "width": 1280,
  "height": 720,
  "encoding": {
    "codec": "h264",
    "preset": "veryslow",
    "rateControl": {
      "mode": "crf",
      "crf": 20,
      "maxBitrate": 10000000
    }
  }
}
```

ABR:

```json
{
  "id": "avc.1x",
  "width": 1280,
  "height": 720,
  "encoding": {
    "codec": "h264",
    "preset": "slow",
    "rateControl": {
      "mode": "abr",
      "averageBitrate": 6000000,
      "maxBitrate": 10000000
    }
  }
}
```

Direct CLI:

```sh
avl compile input.mov --out motion.avl --loop 0:120 \
  --crf 20 --max-bitrate 10000000 --preset veryslow

avl compile input.mov --out motion.avl --loop 0:120 \
  --bitrate 6000000:10000000 --preset slow
```

`--crf` and `--bitrate` are mutually exclusive. `--crf` requires `--max-bitrate`; an orphan `--max-bitrate` is invalid. Encoding flags are invalid for project JSON because the project owns each rendition policy.

## File responsibility map

### Create

- `packages/compiler/src/source-project-v03-schema.ts`: strict project `0.3` validator.
- `packages/compiler/src/compile/avc-encoding-policy.ts`: pure rate-control, preset, and measured-bitrate helpers.
- `packages/compiler/test/source-project-v03-schema.test.ts`: closed schema and version dispatch.
- `packages/compiler/test/avc-encoding-policy.test.ts`: policy and arithmetic tests.
- `packages/compiler/test/encode-argv-mutation.test.ts`: prove unsupported/user-controlled FFmpeg tokens cannot enter encoder argv.
- `packages/compiler/test/discovery.test.ts`: prove calibration evidence is keyed by the effective encoding policy.
- `docs/project/0.3.md`: normative authoring contract.

### Core modifications

- `packages/compiler/src/model.ts`: public project, normalized policy, CLI option, probe, and build-report types.
- `packages/compiler/src/source-project-normalize.ts`: legacy and `0.3` adapters.
- `packages/compiler/src/ffmpeg/encode-unit.ts`: sole ordered FFmpeg argv owner.
- `packages/compiler/src/compile/avc-rendition-pipeline.ts`: encode, canonicalize, measure, inspect, and decode-back.
- `packages/format/src/avc/parameter-sets.ts`: retain PPS initial QP.
- `packages/format/src/avc/slice-header.ts`: validate final slice QP.
- `packages/format/src/avc/inspector.ts`: frozen-v0 versus bounded-v1 policy.
- `packages/player-web/src/runtime/avc-candidate-factory-config.ts` and `packages/player-web/src/decoder-worker/core-validation.ts`: matching runtime policy.
- `packages/compiler/src/ffmpeg/probe.ts`: source codec/profile/bit-depth evidence.

### Task 1: Add project `0.3` and normalize legacy policies

**Files:**
- Create: `packages/compiler/src/source-project-v03-schema.ts`
- Create: `packages/compiler/test/source-project-v03-schema.test.ts`
- Modify: `packages/compiler/src/model.ts`
- Modify: `packages/compiler/src/source-project-normalize.ts`
- Modify: `packages/compiler/src/index.ts`
- Modify: `packages/compiler/test/source-project-schema.test.ts`
- Preserve: `packages/compiler/test/source-project-v02-schema.test.ts`

- [ ] **Step 1: Write failing schema tests**

Assert a valid `0.3` CRF rendition normalizes to:

```ts
{
  id: "avc.1x",
  width: 1280,
  height: 720,
  avcProfileVersion: "v1",
  encoding: {
    codec: "h264",
    preset: "veryslow",
    legacyZeroLatency: false,
    rateControl: { mode: "crf", crf: 20, maxBitrate: 10_000_000 }
  }
}
```

Reject CRF `0`/`52`, `placebo`, missing maximum bitrate, wrong union keys, unknown keys, and ABR average above maximum. Prove `0.2` still rejects `encoding` and normalizes to legacy medium ABR.

- [ ] **Step 2: Run and confirm red**

```sh
npx vitest run --config vitest.m9.config.ts \
  packages/compiler/test/source-project-v03-schema.test.ts \
  packages/compiler/test/source-project-v02-schema.test.ts \
  packages/compiler/test/source-project-schema.test.ts
```

Expected: project `0.3` is unsupported.

- [ ] **Step 3: Add exact public types**

```ts
export const AVC_ENCODER_PRESETS = Object.freeze([
  "ultrafast", "superfast", "veryfast", "faster", "fast",
  "medium", "slow", "slower", "veryslow"
] as const);
export type AvcEncoderPreset = typeof AVC_ENCODER_PRESETS[number];

export type AvcRateControlV03 =
  | { readonly mode: "abr"; readonly averageBitrate: number; readonly maxBitrate: number }
  | { readonly mode: "crf"; readonly crf: number; readonly maxBitrate: number };

export interface AvcEncodingV03 {
  readonly codec: "h264";
  readonly preset: AvcEncoderPreset;
  readonly rateControl: AvcRateControlV03;
}

export interface NormalizedAvcEncoding extends AvcEncodingV03 {
  readonly legacyZeroLatency: boolean;
}
```

Add `SourceRenditionTargetV03`, `SourceProjectV03`, and `avcProfileVersion: "v0" | "v1"`. Set the newest constant to `0.3` while retaining `0.1`/`0.2` dispatch.

- [ ] **Step 4: Implement strict validation and adapters**

Project `0.3` uses `avc-annexb-auto-v1`, `avc-annexb-opaque-v1`, or `avc-annexb-packed-alpha-v1`. Legacy renditions normalize to:

```ts
{
  codec: "h264",
  preset: "medium",
  legacyZeroLatency: true,
  rateControl: {
    mode: "abr",
    averageBitrate: rendition.bitrate.average,
    maxBitrate: rendition.bitrate.peak
  }
}
```

- [ ] **Step 5: Verify and commit**

```sh
npx vitest run --config vitest.m9.config.ts \
  packages/compiler/test/source-project-v03-schema.test.ts \
  packages/compiler/test/source-project-v02-schema.test.ts \
  packages/compiler/test/source-project-schema.test.ts
npm run typecheck -w @pixel-point/aval-compiler
git add packages/compiler/src packages/compiler/test/source-project-*.test.ts
git commit -m "feat(compiler): add configurable AVC project schema"
```

### Task 2: Version AVC quantizer validation

**Files:**
- Modify: `packages/format/src/avc/types.ts`
- Modify: `packages/format/src/avc/parameter-sets.ts`
- Modify: `packages/format/src/avc/slice-header.ts`
- Modify: `packages/format/src/avc/inspector.ts`
- Modify: `packages/format/src/avc/incremental-inspector.ts`
- Modify: `packages/format/src/avc/encoder-preparation.ts`
- Modify: `packages/format/test/avc-fixture.ts`
- Test: `packages/format/test/avc-inspector.test.ts`
- Test: `packages/format/test/avc-incremental-inspector.test.ts`
- Test: `packages/format/test/avc-encoder-preparation.test.ts`

- [ ] **Step 1: Add failing v0/v1 QP tests**

Prove v0 rejects nonzero `pic_init_qp_minus26`; v1 accepts a nonzero value only when every final QP is in `0..51`; v1 rejects underflow/overflow; stable PPS across units remains mandatory.

- [ ] **Step 2: Run and confirm the current frozen-QP failure**

```sh
npx vitest run --config vitest.m9.config.ts \
  packages/format/test/avc-inspector.test.ts \
  packages/format/test/avc-incremental-inspector.test.ts \
  packages/format/test/avc-encoder-preparation.test.ts
```

Expected: v1 fixture fails with the current frozen `pic_init_qp_minus26` diagnostic.

- [ ] **Step 3: Retain initial QP and slice delta**

Add `picInitQpMinus26` to `ParsedPps`, `sliceQpDelta` to `ParsedSliceHeader`, and this profile field:

```ts
readonly quantizationPolicy: "fixed-qp26-v0" | "bounded-qp-v1";
```

- [ ] **Step 4: Validate the complete QP expression**

```ts
const finalQp = 26 + pps.picInitQpMinus26 + sliceQpDelta;
requireAvc(
  finalQp >= 0 && finalQp <= 51,
  path,
  "final slice QP is outside the 8-bit AVC range"
);
```

For v0 additionally require `picInitQpMinus26 === 0`. Do not relax Baseline, CAVLC, reference, reorder, slice-count, or parameter-set checks.

- [ ] **Step 5: Verify and commit**

```sh
npx vitest run --config vitest.m9.config.ts packages/format/test/avc-*.test.ts
npm run typecheck -w @pixel-point/aval-format
git add packages/format/src/avc packages/format/test/avc-*.test.ts
git commit -m "feat(format): validate bounded AVC CRF quantization"
```

### Task 3: Propagate AVC-v1 through the wire and browser

**Files:**
- Modify: `packages/format/src/model.ts`
- Modify: `packages/format/src/manifest-rendition-schema.ts`
- Modify: `packages/format/src/manifest-limits-schema.ts`
- Modify: `packages/format/src/writer-normalize.ts`
- Modify: `packages/format/src/avc/rendition-geometry.ts`
- Test: `packages/format/test/manifest-schema.test.ts`
- Test: `packages/format/test/writer.test.ts`
- Test: `packages/format/test/avc-rendition-geometry.test.ts`
- Modify: `packages/player-web/src/runtime/asset-catalog.ts`
- Modify: `packages/player-web/src/runtime/avc-rendition-selection.ts`
- Modify: `packages/player-web/src/runtime/avc-candidate-factory-config.ts`
- Modify: `packages/player-web/src/decoder-worker/protocol.ts`
- Modify: `packages/player-web/src/decoder-worker/core-validation.ts`
- Test: `packages/player-web/src/runtime/asset-catalog.test.ts`
- Test: `packages/player-web/src/runtime/rendition-selection.test.ts`
- Test: `packages/player-web/src/runtime/browser-avc-candidate.test.ts`
- Test: `packages/player-web/src/decoder-worker/decoder-worker.test.ts`

- [ ] **Step 1: Add failing profile allowlist tests**

Add `avc-annexb-opaque-v1` and `avc-annexb-packed-alpha-v1`. Test round trips, reject unknown profiles, and reject mixed v0/v1 production profiles in one asset.

- [ ] **Step 2: Run focused tests and confirm unsupported-profile failures**

```sh
npx vitest run --config vitest.m9.config.ts \
  packages/format/test/manifest-schema.test.ts \
  packages/format/test/writer.test.ts \
  packages/format/test/avc-rendition-geometry.test.ts \
  packages/player-web/src/runtime/asset-catalog.test.ts \
  packages/player-web/src/runtime/rendition-selection.test.ts \
  packages/player-web/src/runtime/browser-avc-candidate.test.ts \
  packages/player-web/src/decoder-worker/decoder-worker.test.ts
```

- [ ] **Step 3: Add one shared exact mapper**

```ts
export function avcQuantizationPolicyForRendition(
  profile: AvcProductionRenditionProfileV01
): "fixed-qp26-v0" | "bounded-qp-v1" {
  return profile.endsWith("-v1") ? "bounded-qp-v1" : "fixed-qp26-v0";
}
```

Keep codec strings `avc1.42E0xx`; CRF does not change AVC family/profile/level notation.

- [ ] **Step 4: Verify main-thread/worker parity**

Run the Step 2 tests plus format/player typechecks. Both sides must accept exactly the same v1 profiles and quantization policy.

- [ ] **Step 5: Commit**

```sh
git add packages/format/src packages/format/test \
  packages/player-web/src/runtime packages/player-web/src/decoder-worker
git commit -m "feat(player): support bounded-quantizer AVC renditions"
```

### Task 4: Implement safe encoder policies and exact argv

**Files:**
- Create: `packages/compiler/src/compile/avc-encoding-policy.ts`
- Create: `packages/compiler/test/avc-encoding-policy.test.ts`
- Modify: `packages/compiler/src/ffmpeg/encode-unit.ts`
- Modify: `packages/compiler/src/ffmpeg/discovery.ts`
- Modify: `packages/compiler/test/encode-argv.test.ts`
- Create: `packages/compiler/test/encode-argv-mutation.test.ts`
- Create: `packages/compiler/test/discovery.test.ts`

- [ ] **Step 1: Add failing CRF, ABR, and legacy argv tests**

CRF must contain `-preset veryslow -crf 20 -maxrate 10000000 -bufsize 10000000`, omit `-b:v`, and never contain `-movflags`, `-tag:v`, `libx265`, or a user filter. ABR must use `-b:v/-maxrate/-bufsize` and omit `-crf`. Legacy mode must remain byte-for-byte identical.

- [ ] **Step 2: Run and confirm red**

```sh
npx vitest run --config vitest.m9.config.ts \
  packages/compiler/test/avc-encoding-policy.test.ts \
  packages/compiler/test/encode-argv.test.ts \
  packages/compiler/test/encode-argv-mutation.test.ts \
  packages/compiler/test/discovery.test.ts
```

- [ ] **Step 3: Add pure allowlisted helpers**

```ts
export function validateAvcEncoding(
  value: Readonly<NormalizedAvcEncoding>
): Readonly<NormalizedAvcEncoding>;

export function avcRateControlArguments(
  value: Readonly<NormalizedAvcEncoding["rateControl"]>
): readonly string[];

export function avcPeakBitrate(
  value: Readonly<NormalizedAvcEncoding>
): number;
```

ABR returns `-b:v`, `-maxrate`, and `-bufsize`; CRF returns `-crf`, `-maxrate`, and `-bufsize`.

- [ ] **Step 4: Preserve runtime invariants after user choices**

For v1 omit `-tune zerolatency` and `sync-lookahead=0` so offline slow presets can use lookahead. Continue forcing Baseline/CAVLC, no B-frames, one ref, closed GOP, headers, color, slices, and threads. Keep the full legacy vector for v0. Include the policy in calibration evidence.

- [ ] **Step 5: Verify and commit**

```sh
npx vitest run --config vitest.m9.config.ts \
  packages/compiler/test/avc-encoding-policy.test.ts \
  packages/compiler/test/encode-argv.test.ts \
  packages/compiler/test/encode-argv-mutation.test.ts \
  packages/compiler/test/discovery.test.ts
npm run typecheck -w @pixel-point/aval-compiler
git add packages/compiler/src/compile/avc-encoding-policy.ts \
  packages/compiler/src/ffmpeg packages/compiler/test
git commit -m "feat(compiler): add safe CRF and preset policies"
```

### Task 5: Measure canonical bitrate and publish truthful evidence

**Files:**
- Modify: `packages/compiler/src/compile/avc-rendition-pipeline.ts`
- Modify: `packages/compiler/src/compile/project-compiler.ts`
- Modify: `packages/compiler/src/compile/direct-compiler.ts`
- Modify: `packages/compiler/src/model.ts`
- Modify: `packages/compiler/src/commands/asset-validation.ts`
- Test: `packages/compiler/test/avc-encoding-policy.test.ts`
- Test: `packages/compiler/test/project-compiler-integration.test.ts`
- Test: `packages/compiler/test/ffmpeg-integration.test.ts`
- Test: `packages/compiler/test/m6-fixture.test.ts`

- [ ] **Step 1: Add failing measured-bitrate and deterministic CRF tests**

```ts
expect(deriveCanonicalAverageBitrate({
  canonicalBytes: 1_000_000,
  frameCount: 120,
  frameRate: { numerator: 24, denominator: 1 }
})).toBe(1_600_000);
```

Add overflow cases. Compile the same CRF fixture twice with one exact FFmpeg executable and require identical bytes, valid v1 inspection, no B-frames, and `average <= peak`. Keep an aggressive packed-alpha CRF rejection test.

- [ ] **Step 2: Run and confirm red**

```sh
npx vitest run --config vitest.m9.config.ts \
  packages/compiler/test/avc-encoding-policy.test.ts \
  packages/compiler/test/project-compiler-integration.test.ts \
  packages/compiler/test/ffmpeg-integration.test.ts
```

- [ ] **Step 3: Derive final average with checked BigInt arithmetic**

```ts
const numerator = BigInt(canonicalBytes) * 8n * BigInt(frameRate.numerator);
const denominator = BigInt(frameCount) * BigInt(frameRate.denominator);
const average = (numerator + denominator - 1n) / denominator;
```

Measure all canonical units exactly once. For v1 publish measured average and configured peak; reject measured average above peak. Canonicalize with peak as a conservative temporary average, then strict-inspect again with final values. Keep v0 authored bitrate fields unchanged.

- [ ] **Step 4: Add structured build evidence**

```ts
readonly encoding: {
  readonly codec: "libx264";
  readonly preset: AvcEncoderPreset;
  readonly rateControl: AvcRateControlV03;
  readonly legacyZeroLatency: boolean;
  readonly canonicalBytes: number;
  readonly measuredAverageBitrate: number;
};
```

Build the manifest from compiled rendition details. Bump build details from `0.1` to `0.2`.

- [ ] **Step 5: Verify and commit**

```sh
npx vitest run --config vitest.m9.config.ts \
  packages/compiler/test/project-compiler-integration.test.ts \
  packages/compiler/test/ffmpeg-integration.test.ts \
  packages/compiler/test/m6-fixture.test.ts
git add packages/compiler/src/compile packages/compiler/src/model.ts \
  packages/compiler/src/commands/asset-validation.ts packages/compiler/test
git commit -m "feat(compiler): publish measured AVC encoding evidence"
```

### Task 6: Add direct CLI controls and long-encode timeouts

**Files:**
- Modify: `packages/compiler/src/cli-args.ts`
- Modify: `packages/compiler/src/commands/compile.ts`
- Modify: `packages/compiler/src/commands/compile-publication.ts`
- Modify: `packages/compiler/src/commands/dev.ts`
- Modify: `packages/compiler/src/cli.ts`
- Modify: `packages/compiler/src/adoption-summary.ts`
- Modify: `packages/compiler/src/model.ts`
- Test: `packages/compiler/test/cli-args.test.ts`
- Test: `packages/compiler/test/commands.test.ts`
- Test: `packages/compiler/test/cli.test.ts`
- Test: `packages/compiler/test/direct-adoption.test.ts`

- [ ] **Step 1: Add failing CLI grammar tests**

Parse `--crf 20 --max-bitrate 10000000 --preset veryslow --media-timeout-ms 900000`. Reject incompatible/missing flags, invalid ranges, unknown presets, and project-file overrides.

- [ ] **Step 2: Run and confirm unknown flags**

```sh
npx vitest run --config vitest.m9.config.ts \
  packages/compiler/test/cli-args.test.ts \
  packages/compiler/test/commands.test.ts \
  packages/compiler/test/cli.test.ts \
  packages/compiler/test/direct-adoption.test.ts
```

- [ ] **Step 3: Forward only structured settings**

Construct one `NormalizedAvcEncoding`; never parse a free-form option string. Forward `mediaTimeoutMs` through project, direct, and dev compilation. Record structured invocation options.

- [ ] **Step 4: Update help and human output**

```text
--crf 1..51                  constrained CRF for direct media
--max-bitrate bits/second    required ceiling with --crf
--preset name                allowlisted x264 preset through veryslow
--media-timeout-ms integer   per FFmpeg operation for slow/large encodes
```

Print configured mode/preset and measured average/peak. State that `faststart`, muxer tags, arbitrary FFmpeg args, and HEVC output are unavailable.

- [ ] **Step 5: Verify and commit**

```sh
npx vitest run --config vitest.m9.config.ts \
  packages/compiler/test/cli-args.test.ts \
  packages/compiler/test/commands.test.ts \
  packages/compiler/test/cli.test.ts \
  packages/compiler/test/direct-adoption.test.ts
npm run typecheck -w @pixel-point/aval-compiler
git add packages/compiler/src packages/compiler/test
git commit -m "feat(cli): expose safe AVC quality controls"
```

### Task 7: Make the master-input contract explicit and auditable

**Files:**
- Modify: `packages/compiler/src/model.ts`
- Modify: `packages/compiler/src/ffmpeg/probe.ts`
- Modify: `packages/compiler/src/compile/project-source.ts`
- Modify: `packages/compiler/src/compile/project-compiler.ts`
- Modify: `packages/compiler/src/compile/direct-compiler.ts`
- Test: `packages/compiler/test/probe-argv.test.ts`
- Test: `packages/compiler/test/probe.test.ts`
- Test: `packages/compiler/test/project-compiler-integration.test.ts`
- Modify: `docs/compiler.md`
- Modify: `docs/compiler/authoring-video-and-states.md`
- Create: `docs/project/0.3.md`
- Modify: `docs/project/0.2.md`
- Modify: `packages/compiler/README.md`

- [ ] **Step 1: Add failing source-audit tests**

Probe `codec_name`, `profile`, `bits_per_raw_sample`, and `bit_rate`. Require those facts in build details. Delivery codecs produce one warning but do not fail compilation.

- [ ] **Step 2: Run and confirm missing evidence**

```sh
npx vitest run --config vitest.m9.config.ts \
  packages/compiler/test/probe-argv.test.ts \
  packages/compiler/test/probe.test.ts \
  packages/compiler/test/project-compiler-integration.test.ts
```

- [ ] **Step 3: Record bounded facts and classification**

```ts
readonly codecName: string;
readonly codecProfile: string | null;
readonly bitsPerRawSample: number | null;
readonly sourceBitrate: number | null;
readonly transcodeClassification:
  | "mezzanine-or-lossless"
  | "delivery-codec"
  | "unknown";
```

For H.264/HEVC/AV1/VP9, warn that the delivery codec will be transcoded and the highest-quality available master should be used. Never hard-reject based only on these facts.

- [ ] **Step 4: Write normative documentation**

Require the highest-quality available source: ProRes 422 HQ, DNxHR HQX, FFV1, or RGBA PNG for opaque; ProRes 4444 or RGBA PNG for alpha. Explain that compilation always transcodes in `0.3`, never mutates the input, and cannot prove a file is a true master. A high-quality HEVC source is accepted when the caller's FFmpeg can decode it, but AVAL output remains AVC. State that x265 CRF `32` is not equivalent to x264 CRF `32`; evaluate H.264 around CRF `18..23` first. Correct wording that implies encoded pixels remain source-identical.

- [ ] **Step 5: Verify and commit**

```sh
npx vitest run --config vitest.m9.config.ts \
  packages/compiler/test/probe-argv.test.ts \
  packages/compiler/test/probe.test.ts \
  packages/compiler/test/project-compiler-integration.test.ts
npm run docs:check
git add packages/compiler/src packages/compiler/test docs/compiler* docs/project packages/compiler/README.md
git commit -m "docs(compiler): define the master input transcode contract"
```

### Task 8: Migrate starter and rabbit example

**Files:**
- Modify: `packages/compiler/src/commands/init.ts`
- Modify: `packages/compiler/test/init-starter.test.ts`
- Modify: `examples/grass-rabbit/motion.json`
- Modify: `examples/grass-rabbit/README.md`
- Regenerate: `examples/grass-rabbit/public/grass-rabbit.avl`
- Regenerate: `examples/grass-rabbit/public/grass-rabbit.avl.build.json`
- Modify: `tests/grass-rabbit/grass-rabbit.spec.ts`

- [ ] **Step 1: Add failing starter/example assertions**

Require `0.3`, explicit CRF/preset, v1 profile, measured bitrate evidence, exact 281 frames, and unchanged source SHA. Preserve DPR-2/640px/black-page/hover tests.

- [ ] **Step 2: Run and confirm the current `0.2` failure**

```sh
npx vitest run --config vitest.m9.config.ts packages/compiler/test/init-starter.test.ts
npm run test:grass-rabbit
```

- [ ] **Step 3: Migrate with a reviewed H.264 starting policy**

```json
"encoding": {
  "codec": "h264",
  "preset": "slow",
  "rateControl": { "mode": "crf", "crf": 20, "maxBitrate": 10000000 }
}
```

Keep source, dimensions, state ranges, and bindings unchanged. Do not copy the x265 CRF number directly.

- [ ] **Step 4: Rebuild and verify Chrome**

```sh
npm run compile:grass-rabbit
npm run test:grass-rabbit
```

Expected: fresh headed Chromium passes; the report records CRF/preset and unchanged source identity.

- [ ] **Step 5: Commit**

```sh
git add packages/compiler/src/commands/init.ts packages/compiler/test/init-starter.test.ts \
  examples/grass-rabbit tests/grass-rabbit
git commit -m "feat(examples): demonstrate explicit CRF transcoding"
```

### Task 9: Regenerate APIs and run the full gate

**Files:**
- Modify: `packages/compiler/test/public-api.compile.ts`
- Modify: `packages/format/test/public-api.compile.ts`
- Regenerate: `etc/api/compiler.api.md`
- Regenerate: `etc/api/format.api.md`
- Regenerate as needed: `etc/api/player-web.api.md`

- [ ] **Step 1: Add public API compile assertions**

Exercise project `0.3`, `AvcEncodingV03`, `AvcRateControlV03`, presets, v1 profiles, and programmatic direct CRF options. Assert no public `string[]`/extra-argv escape hatch.

- [ ] **Step 2: Run focused feature tests**

```sh
npx vitest run --config vitest.m9.config.ts \
  packages/format/test/avc-*.test.ts \
  packages/format/test/manifest-schema.test.ts \
  packages/compiler/test/source-project-v03-schema.test.ts \
  packages/compiler/test/avc-encoding-policy.test.ts \
  packages/compiler/test/encode-argv.test.ts \
  packages/compiler/test/project-compiler-integration.test.ts \
  packages/compiler/test/ffmpeg-integration.test.ts \
  packages/compiler/test/cli-args.test.ts \
  packages/compiler/test/cli.test.ts \
  packages/player-web/src/runtime/asset-catalog.test.ts \
  packages/player-web/src/runtime/rendition-selection.test.ts \
  packages/player-web/src/runtime/browser-avc-candidate.test.ts \
  packages/player-web/src/decoder-worker/decoder-worker.test.ts
```

- [ ] **Step 3: Regenerate APIs and build**

```sh
npm run api:report
npm run typecheck
npm run build
```

- [ ] **Step 4: Run repository and browser gates**

```sh
npm run docs:check
npm run fixtures:verify
npm run test:unit
npm run compile:grass-rabbit
npm run test:grass-rabbit
git diff --check
```

Use the recorded FFmpeg/libx264 toolchain for exact goldens. Do not weaken alpha or AVC validation for an older local toolchain.

- [ ] **Step 5: Record before/after evidence and commit**

Record source codec/bytes, policy, measured bitrate, exact FFmpeg fingerprint,
AVC bytes and container metadata bytes separately, compile time for
medium/slow/veryslow, and the Chrome result. Then:

```sh
git add packages/compiler/test/public-api.compile.ts \
  packages/format/test/public-api.compile.ts etc/api docs
git commit -m "chore: publish configurable AVC transcode APIs"
```

## Completion criteria

- Project `0.3` and direct input support capped CRF and allowlisted presets.
- CRF output passes strict versioned quantizer/dependency validation; v0 remains frozen.
- The player accepts v1 only through the same low-delay AVC contract.
- Reports contain configured and observed encoding facts.
- Existing `0.1`/`0.2` inputs retain legacy encoding behavior.
- No raw FFmpeg, faststart, muxer tag, HEVC output, arbitrary filter, or passthrough surface exists.
- Documentation requires the highest-quality available master without pretending it is mechanically provable.
- Rabbit Chrome behavior remains correct and size evidence separates encoded motion from container metadata overhead.
