# AVAL element: getting started

Install and explicitly register the exact SSR-safe package release:

```sh
npm install @pixel-point/aval-element@1.0.0
```

```js
import { defineAvalElement } from "@pixel-point/aval-element";
defineAvalElement();
```

```html
<aval-player src="/assets/orbit.avl" width="96" height="96">
  <img slot="fallback" src="/assets/orbit.png" alt="" width="96" height="96">
</aval-player>
```

Connection automatically prepares metadata. When animation is supported and
visible, the first revealed internal pixels are a decoded frame and a direct
one-state compile plays its authored intro and body loop without application
code. Unsupported or reduced-motion paths leave the author-owned fallback
visible. Network, parser, integrity, or decode failure does the same.

For a browser-only pinned CDN import, use the explicit side-effect entry:

```js
import "https://your-pinned-cdn.example/@pixel-point/aval-element@VERSION/auto";
```

Do not use an unpinned URL in production. Call `dispose()` when an element
instance is permanently retired; it settles only after the terminal cleanup
receipt. Ordinary disconnection already retires the source. A same-root
same-task DOM move preserves it, while a later true reconnect or cross-realm
adoption starts a receipt-gated source generation.
