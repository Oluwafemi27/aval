# @pixel-point/aval-element

Progressive, web-only `<aval-player>` custom element for interactive
AVAL assets. It lazy-loads the decoder/runtime only after a source
is assigned, preserves author-owned fallback content, supports arbitrary
authored states and events, and leaves that external fallback visible when
animation is unavailable or reduced motion is requested.

```sh
npm install @pixel-point/aval-element@1.0.0
```

```js
import "@pixel-point/aval-element/auto";
```

```html
<button id="favorite" type="button">
  <aval-player
    src="/favorite.avl"
    interaction-for="favorite"
    aria-hidden="true"
  >
    <img slot="fallback" src="/favorite.png" alt="">
  </aval-player>
  <span>Favorite</span>
</button>
```

Use `setState(name)` for application state, `send(event)` for authored graph
events, and the reflected `state`, `motion`, `autoplay`, `fit`, and
`bindings` properties for framework integration. The package creates no
seeking `<video>`; playback is frame-scheduled through the AVAL
web runtime.

See the repository element API, accessibility, network/integrity, and browser
support guides for the complete contract.
