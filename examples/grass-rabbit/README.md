# Grass rabbit hover example

This example compiles the supplied 1280×720, 24 fps video into one `.avl`
containing five exact half-open frame ranges:

- `intro`: `[0, 30)`
- `idle-loop`: `[30, 100)`
- `hover-in`: `[100, 167)`
- `hover-loop`: `[167, 263)`
- `hover-out`: `[263, 311)`

The compiled asset remains 1280×720. The page presents it at exactly 640×360,
centered in a pure-black viewport. Hover or focus the animation to enter the
`hover` state; leave or blur it to return to `idle`.

The `intro` is an initial one-shot attached to the `idle` state. It plays once
from frames 0 through 29, continues directly into `idle-loop`, and does not
replay when `hover-out` returns to idle. Hover intent received during the intro
is queued until that one-shot finishes.

The enter and exit ranges are finite transient `entering` and `exiting`
states. If engagement ends while `hover-in` is still playing, that range
finishes and proceeds directly to `hover-out`; no `hover-loop` frame is played.
If engagement remains active, `hover-in` proceeds to `hover-loop`, which loops
until engagement ends.

`motion.json` points directly to the color-corrected source at
`source/grass-test-with-intro.mp4`. The compiler leaves that source file untouched,
decodes the authored ranges, and re-encodes them as AVAL AVC units with x264
CRF 30, the `veryslow` preset, and a 10 Mbps ceiling, without downscaling,
shortening, or blending. All eight visual seam checks pass for this source;
their deterministic metrics are recorded in the build report while the
authored dimensions and ranges remain authoritative.

The `.avl` contains only motion access units and graph metadata. This page does
not supply an external fallback image, so the black page remains black until
the first decoded animation frame is ready.

From the repository root:

```sh
npm install
npm run compile:grass-rabbit
npm run grass-rabbit
```

For an automated local check, run `npm run test:grass-rabbit`. It opens a
headed Chromium instance so the WebGL/WebCodecs interactive path is exercised,
then verifies the one-shot intro, exact 640×360 centered layout, and both hover
transitions.

The compiled asset is checked in at `public/grass-rabbit.avl`, so recompilation
is only necessary after changing the supplied video or `motion.json`.
