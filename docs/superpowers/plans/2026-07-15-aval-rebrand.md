# AVAL Clean-Break Rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Rendered Motion/RMA identity throughout the workspace with AVAL/aval/avl and make `.avl` the sole compiled-asset extension.

**Architecture:** This is a clean-break rename, not a compatibility layer. Public package names, TypeScript symbols, browser globals, the custom element, CLI, MIME/schema identifiers, wire markers, fixtures, examples, tests, and documentation move together so the repository exposes one coherent identity. Existing unrelated worktree changes remain untouched, and generated files are refreshed only through project tooling.

**Tech Stack:** TypeScript 7, Node.js 22, npm workspaces, Vitest, Playwright, Vite, JSON Schema, binary conformance fixtures.

---

## Canonical mapping

| Old | New |
| --- | --- |
| `Rendered Motion` / `Web Rendered Motion` | `AVAL` |
| `rendered motion` / `web rendered motion` | `AVAL` |
| `rendered-motion` | `aval` |
| `RenderedMotion` | `Aval` |
| `renderedMotion` | `aval` |
| `RENDERED_MOTION` | `AVAL` |
| `@rendered-motion/*` | `@pixel-point/aval-*` |
| `<rendered-motion>` | `<aval-player>` |
| `rma` CLI and npm script | `avl` |
| `.rma` | `.avl` |
| `application/vnd.rendered-motion` | `application/vnd.aval` |
| `RMA_*` environment variables | `AVL_*` |
| `RMAF`, `RMAI`, `RMRF` wire markers | `AVLF`, `AVLI`, `AVRF` |
| `rma.reference-rgba` | `aval.reference-rgba` |
| `rendered-motion.dev` | `aval.dev` |
| `pixel-point/rendered-motion` metadata paths | `pixel-point/aval` |

### Task 1: Rename text APIs and source filenames

**Files:**
- Modify: all tracked and non-ignored text source, test, configuration, schema, example, and documentation files containing canonical old-name tokens
- Rename: `packages/element/src/rendered-motion-element.ts` to `packages/element/src/aval-element.ts`
- Rename: `examples/react-ref/src/rendered-motion-jsx.d.ts` to `examples/react-ref/src/aval-player-jsx.d.ts`
- Rename: old-name plan/spec filenames under `docs/superpowers/`

- [ ] **Step 1: Apply longest-token-first replacements**

```text
RENDERED_MOTION -> AVAL
RenderedMotion -> Aval
renderedMotion -> aval
@rendered-motion/ -> @pixel-point/aval-
rendered-motion -> aval
Rendered Motion -> AVAL
rendered motion -> AVAL
```

- [ ] **Step 2: Give the autonomous custom element its valid hyphenated name**

```ts
export const AVAL_TAG_NAME = "aval-player" as const;
export function defineAvalElement(): AvalElementConstructor;
```

- [ ] **Step 3: Rename source files and update imports**

```sh
git status --short
rg -n 'rendered-motion-element|rendered-motion-jsx' --glob '!node_modules/**'
```

Expected: renamed paths are visible and no imports refer to the old filenames.

### Task 2: Rename packages, CLI, extension, URLs, and protocol-facing strings

**Files:**
- Modify: `package.json`, `package-lock.json`, all workspace `package.json` files
- Modify: compiler CLI/dev/init/publication sources and tests under `packages/compiler/`
- Modify: format constants, codecs, tests, and API reports under `packages/format/` and `etc/api/`
- Modify: schemas, release scripts, fixture scripts, Vite/Playwright/Vitest configuration, apps, and examples

- [ ] **Step 1: Change package and executable names**

```json
{
  "name": "aval-workspace",
  "bin": { "avl": "./dist/cli.js" }
}
```

- [ ] **Step 2: Change external identifiers**

```text
application/vnd.aval
https://aval.dev/schemas/...
https://github.com/pixel-point/aval
AVL_FFMPEG
AVL_FFPROBE
AVL_UPDATE_CONFORMANCE_FIXTURES
```

- [ ] **Step 3: Change the wire identity**

```ts
export const FORMAT_MAGIC = [0x41, 0x56, 0x4c, 0x46, 0x0d, 0x0a, 0x1a, 0x0a] as const;
export const ACCESS_UNIT_INDEX_MAGIC = [0x41, 0x56, 0x4c, 0x49] as const;
export const REFERENCE_FRAME_MAGIC = [0x41, 0x56, 0x52, 0x46] as const;
```

- [ ] **Step 4: Ensure all emitted paths use `.avl`**

```text
asset.avl
motion.avl
starter.avl
favorite.avl
grass-rabbit.avl
```

### Task 3: Rename and regenerate compiled fixtures

**Files:**
- Rename: every checked-in and example `*.rma` file to `*.avl`
- Rename: `*.rma.build.json` sidecars to `*.avl.build.json`
- Modify: fixture provenance JSON and documentation tables that record filenames/digests

- [ ] **Step 1: Rename assets without changing their payloads**

```sh
find fixtures examples -type f -name '*.rma' -print
```

Expected before migration: all current asset paths are listed; expected after migration: no output.

- [ ] **Step 2: Rebuild assets using the renamed format writer**

```sh
npm run build:public-packages
npm run fixtures:verify
```

Expected: generated assets begin with `AVLF`; nested access indexes/reference frames use `AVLI`/`AVRF`; provenance digests match.

- [ ] **Step 3: Recompile permanent examples**

```sh
npm run compile:grass-rabbit
npm run build -w @pixel-point/aval-end-user-playground
```

Expected: examples reference and ship `.avl` assets only.

### Task 4: Refresh derived metadata and verify

**Files:**
- Modify: `package-lock.json`, checked-in API reports, release/certification metadata, and generated provenance as produced by repository scripts

- [ ] **Step 1: Refresh the npm lockfile**

```sh
npm install --package-lock-only --ignore-scripts
```

Expected: lockfile workspace entries and links use `@pixel-point/aval-*` only.

- [ ] **Step 2: Run static verification**

```sh
npm run typecheck
npm run build
npm run test:unit
npm run docs:check
npm run fixtures:verify
```

Expected: every command exits 0.

- [ ] **Step 3: Run browser and example verification**

```sh
npm run test:examples
npm run test:browser:reference
npm run test:playground
npm run test:grass-rabbit
```

Expected: every command exits 0.

- [ ] **Step 4: Audit legacy identifiers**

```sh
rg -n -i 'rendered[ _-]?motion|@rendered-motion|\\.rma\\b|\\brma\\b|RMAF|RMAI|RMRF' --glob '!node_modules/**' --glob '!.git/**'
find . -path './node_modules' -prune -o -path './.git' -prune -o -type f -name '*.rma' -print
```

Expected: no active-code, fixture, configuration, or current documentation matches. Historical Git metadata and the enclosing checkout path are outside repository-file scope.
