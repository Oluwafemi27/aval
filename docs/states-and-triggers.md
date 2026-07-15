# States and triggers

State names are authored data, not a fixed runtime enum. Discover them from
`stateNames`, request one imperatively, or reflect a declarative intent:

```ts
const motion = document.querySelector("aval-player");
if (!(motion instanceof HTMLElement) || !("setState" in motion)) {
  throw new Error("AVAL is not registered");
}

await motion.setState("loading");
motion.state = "success";
```

`setState()` follows latest-wins graph semantics. A duplicate destination joins
the in-flight request; a superseded request rejects with `AbortError`; a missing
route rejects with `RouteError`. The `state` attribute/property stores intent
and does not expose a promise.

Assets can bind the fixed pointer, focus, engagement, activation, and visibility
sources to arbitrary authored event names. Motion preference is a host policy,
not a binding source. `send(name)` returns whether the current graph accepted
an authored event. The element never guesses that “hover” means a state with a
particular name.

Partial loops, finite bodies, held bodies, portals, finish routes, locked
bridges, cuts, and resident reversible transitions are compiled graph behavior.
They are not implemented by seeking a video element, so a loop seam does not
pause for a media seek.
