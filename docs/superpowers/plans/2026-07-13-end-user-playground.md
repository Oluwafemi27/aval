# End-user Playground Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a permanent one-command browser example that demonstrates a real interactive AVAL asset through public consumer APIs.

**Architecture:** Register a new Vite example as an explicit npm workspace, serve a checked-in asset and fallback from its `public` directory, and keep all runtime interaction in one small public-API-only module. A dedicated Playwright configuration starts the example and verifies readiness, state transitions, fallback markup, and console cleanliness.

**Tech Stack:** npm workspaces, Vite 8, browser JavaScript, AVAL custom element, Playwright.

---

## File structure

- `examples/end-user-playground/index.html`: semantic page and progressive fallback markup.
- `examples/end-user-playground/main.js`: element registration, status rendering, and explicit state toggle.
- `examples/end-user-playground/style.css`: responsive presentation and interaction states.
- `examples/end-user-playground/public/favorite.avl`: checked-in compiled idle/engaged asset.
- `examples/end-user-playground/public/favorite.png`: checked-in author fallback.
- `examples/end-user-playground/package.json`: isolated Vite commands and workspace dependency.
- `examples/end-user-playground/README.md`: direct run and behavior notes.
- `tests/end-user-playground/playground.spec.ts`: end-to-end consumer-flow assertions.
- `playwright.playground.config.ts`: dedicated server and browser configuration.
- `package.json`: workspace registration and root run/test commands.
- `package-lock.json`: npm workspace lock metadata.
- `README.md`: discoverable local-playground instructions.

### Task 1: Register the example workspace

**Files:**
- Create: `examples/end-user-playground/package.json`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Create the example package manifest**

```json
{
  "name": "@pixel-point/aval-end-user-playground",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "vite build",
    "dev": "vite --host 127.0.0.1"
  },
  "dependencies": {
    "@pixel-point/aval-element": "1.0.0"
  },
  "devDependencies": {
    "vite": "8.1.4"
  }
}
```

- [ ] **Step 2: Register the workspace and root commands**

Add `examples/end-user-playground` to the root `workspaces` array and add:

```json
"playground": "npm run dev -w @pixel-point/aval-end-user-playground",
"test:playground": "playwright test --config playwright.playground.config.ts"
```

- [ ] **Step 3: Refresh lock metadata**

Run: `npm install --package-lock-only --ignore-scripts`

Expected: npm exits 0 and `package-lock.json` contains an `examples/end-user-playground` workspace entry linked from `node_modules/@pixel-point/aval-end-user-playground`.

### Task 2: Produce the real demonstration asset

**Files:**
- Create: `examples/end-user-playground/public/favorite.avl`
- Create: `examples/end-user-playground/public/favorite.png`

- [ ] **Step 1: Build the compiler and its public dependencies**

Run: `npm run build:public-packages`

Expected: all five public package builds exit 0.

- [ ] **Step 2: Compile the checked starter source**

Run:

```sh
node --enable-source-maps packages/compiler/dist/cli.js compile \
  fixtures/starter/m8-idle-hover/motion.json \
  --out examples/end-user-playground/public/favorite.avl
```

Expected: the command exits 0 and reports an asset containing `idle` and `engaged` states.

- [ ] **Step 3: Copy the author fallback**

Copy `fixtures/starter/m8-idle-hover/frames/frame-0000.png` to `examples/end-user-playground/public/favorite.png` and verify both files are non-empty with `test -s`.

### Task 3: Build the consumer page

**Files:**
- Create: `examples/end-user-playground/index.html`
- Create: `examples/end-user-playground/main.js`
- Create: `examples/end-user-playground/style.css`

- [ ] **Step 1: Write semantic progressive markup**

The page must contain a focusable `#favorite-control`, an `aval-player#favorite-motion` element with `src="/favorite.avl"`, `state="idle"`, `interaction-for="favorite-control"`, and a slotted `<img src="/favorite.png">`, plus `#toggle-state` and live `#runtime-status` elements.

- [ ] **Step 2: Wire only public element APIs**

Implement `main.js` with:

```js
import { defineAvalElement } from "@pixel-point/aval-element";
import "./style.css";

defineAvalElement();

const motion = document.querySelector("#favorite-motion");
const toggle = document.querySelector("#toggle-state");
const status = document.querySelector("#runtime-status");
if (!(motion instanceof HTMLElement) || !(toggle instanceof HTMLButtonElement) || status === null) {
  throw new Error("The playground markup is incomplete");
}

function renderStatus(message, state = "loading") {
  status.textContent = message;
  status.dataset.status = state;
}

motion.addEventListener("readinesschange", () => {
  if (motion.readiness === "interactiveReady") {
    renderStatus("Interactive · idle", "ready");
    toggle.disabled = false;
  }
});

motion.addEventListener("visualstatechange", (event) => {
  const state = event.detail.to;
  toggle.setAttribute("aria-pressed", String(state === "engaged"));
  renderStatus(`Interactive · ${state}`, "ready");
});

motion.addEventListener("fallback", () => renderStatus("Static fallback", "fallback"));
motion.addEventListener("error", (event) => {
  renderStatus(`Fallback · ${event.detail.failure.message}`, "error");
});

toggle.addEventListener("click", async () => {
  const engage = toggle.getAttribute("aria-pressed") !== "true";
  toggle.disabled = true;
  try {
    await motion.setState(engage ? "engaged" : "idle");
  } catch (error) {
    renderStatus(error instanceof Error ? error.message : "State change failed", "error");
  } finally {
    toggle.disabled = motion.readiness !== "interactiveReady";
  }
});
```

- [ ] **Step 3: Add the focused responsive presentation**

Use system fonts, a high-contrast card, a 48-pixel minimum control target, visible `:focus-visible` rings, responsive single-column layout below 720 pixels, and `prefers-reduced-motion` rules that remove decorative CSS transitions.

- [ ] **Step 4: Build the example**

Run: `npm run build -w @pixel-point/aval-end-user-playground`

Expected: Vite exits 0 and emits `examples/end-user-playground/dist/index.html` plus hashed JavaScript/CSS assets and copied `favorite.avl`/`favorite.png`.

### Task 4: Add browser verification

**Files:**
- Create: `playwright.playground.config.ts`
- Create: `tests/end-user-playground/playground.spec.ts`

- [ ] **Step 1: Configure an isolated browser server**

Configure Playwright with `testDir: "./tests/end-user-playground"`, one Chromium worker, base URL `http://127.0.0.1:4175`, and a web server command `npm run playground -- --port 4175 --strictPort`.

- [ ] **Step 2: Write the end-to-end test**

The test must:

```ts
test("runs the public end-user interaction", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  const motion = page.locator("#favorite-motion");
  await expect(motion.locator('img[slot="fallback"]')).toHaveAttribute("src", "/favorite.png");
  await expect.poll(() => motion.evaluate((node) =>
    (node as HTMLElement & { readiness: string }).readiness
  ), { timeout: 20_000 }).toBe("interactiveReady");
  await page.locator("#toggle-state").click();
  await expect.poll(() => motion.evaluate((node) =>
    (node as HTMLElement & { visualState: string | null }).visualState
  )).toBe("engaged");
  await expect(page.locator("#runtime-status")).toContainText("engaged");
  expect(errors).toEqual([]);
});
```

- [ ] **Step 3: Run the focused browser test**

Run: `npm run test:playground`

Expected: one Chromium test passes with no console errors.

### Task 5: Document and verify the complete workflow

**Files:**
- Create: `examples/end-user-playground/README.md`
- Modify: `README.md`

- [ ] **Step 1: Document the example locally**

Explain that `npm install` followed by `npm run playground` from the repository root opens `http://127.0.0.1:5173`, and identify hover/focus, toggle, and fallback behaviors.

- [ ] **Step 2: Add root README discovery**

Add a `Local end-user playground` section after the five-minute start with:

```sh
npm install
npm run playground
```

State that the checked-in example uses workspace packages and does not require FFmpeg at runtime.

- [ ] **Step 3: Run repository checks**

Run: `npm run typecheck`

Expected: all workspace and test TypeScript checks pass.

Run: `npm run test:unit`

Expected: the unit suite passes.

Run: `npm run build`

Expected: the full workspace build, including the registered example workspace, exits 0.

- [ ] **Step 4: Inspect the final diff**

Run: `git diff --check && git status --short`

Expected: no whitespace errors; only the planned playground, configuration, lockfile, documentation, and test files are changed.
