# End-user playground design

## Goal

Add a permanent, immediately runnable example that lets a developer verify the
AVAL consumer experience locally. The example must use a real
checked-in `.avl` asset, the public custom-element API, and an obvious
interaction without requiring published npm packages or an authoring toolchain.

## Approach

Create `examples/end-user-playground` as a small Vite application inside the
existing npm workspace. Add a root `playground` script that starts this example
on a loopback address. The example will resolve AVAL packages through
workspace dependencies, so it exercises the same public exports a consumer uses
while remaining runnable before the packages are published.

The example will not compile assets during startup. A known-good, checked-in
multi-state `.avl` fixture and its poster frame will make startup fast and avoid
requiring FFmpeg for a runtime smoke test.

## User experience

The page presents one compact favorite control containing a
`<aval-player>` element. Its animation begins in `idle` and transitions to
`engaged` on hover or keyboard focus, then reverses on release. A separate
toggle button makes the same state change available on touch devices and makes
the behavior easy to inspect deliberately.

The page includes short instructions, a visible current-state/readiness label,
and a link or command hint explaining how to start the playground. It is a
consumer example, so it avoids the engineering telemetry and certification
controls found in `apps/playground`.

## Components and data flow

- `package.json` declares Vite and `@pixel-point/aval-element`, plus `dev` and
  `build` scripts.
- `index.html` provides semantic controls, the custom element, and its slotted
  static fallback image.
- `main.js` registers the element through its public export, observes public
  readiness/state/error events, and connects the explicit toggle control.
- `style.css` supplies a focused responsive presentation and clear focus,
  loading, ready, fallback, and error states.
- `public/favorite.avl` is the real two-state asset fetched by the element.
- `public/favorite.png` is the author-owned fallback shown before readiness or
  when runtime capability checks fail.

Pointer and focus interaction use the element's authored interaction binding.
The explicit toggle calls the element's public `setState()` method. Status text
is derived only from public events and API results.

## Failure behavior

The fallback remains meaningful when JavaScript, WebCodecs, WebGL, asset
loading, or decoding is unavailable. Runtime failures are rendered as concise
page status rather than being visible only in the console. Controls remain
keyboard accessible, and reduced-motion behavior is delegated to the public
element contract.

## Repository integration

The root `npm run playground` command delegates to the example workspace. The
root README gains a short local-playground section with install, run, and URL
instructions. Existing examples remain unchanged because they intentionally
illustrate package-registry consumption or placeholder integration patterns.

## Verification

- Run the example package's production build.
- Run repository type checking and relevant unit tests.
- Launch the dev server and verify the full interaction in a real browser:
  initial fallback, readiness, hover/focus transition, explicit toggle,
  reversal, and absence of console errors.
- Confirm the page remains usable with motion runtime capabilities unavailable
  by checking the static fallback path.

## Non-goals

- Editing or compiling source frames in the playground.
- Replacing the existing engineering playground or certification pages.
- Adding a framework wrapper, backend, upload flow, or asset inspector.
- Depending on an unpublished public registry release.
