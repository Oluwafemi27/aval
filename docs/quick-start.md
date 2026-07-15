# Quick start

Install the element and compiler at the synchronized 1.0 version:

```sh
npm install @aval/element@1.0.0
npm install --save-dev @aval/compiler@1.0.0
npx avl init my-motion
cd my-motion
npm install
npm run dev
```

Open the printed loopback URL. This is the immediately runnable end-to-end
path: the generated directory includes source frames, project, exact package
dependencies, author fallback, and watch compiler. When integrating the built
asset into a package-aware web application, register the element once and use
ordinary markup like this illustrative snippet:

```html
<script type="module" src="/motion.js"></script>

<aval-player src="/my-motion.avl" width="320" height="320">
  <img slot="fallback" src="/my-motion.png" alt="">
</aval-player>
```

```js
// motion.js, resolved by your package-aware web build
import { defineAvalElement } from "@aval/element";
defineAvalElement();
```

A one-state compiled body loops without JavaScript seeking or a loop range.
The package root is SSR-safe and has no registration side effect. Client-only
pages may instead import `@aval/element/auto`.

The compiler requires a caller-installed FFmpeg/FFprobe build with libx264. It
never downloads or bundles native tools. See [compiler setup](compiler.md) and
[browser support](browser-support.md).
