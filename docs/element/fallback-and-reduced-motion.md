# Fallback and reduced motion

The visual ladder is the author-owned light-DOM fallback followed by animation
after its first decoded frame has been drawn. The element never hides the
fallback before animated pixels are ready. The fallback is not stored in or
requested by the `.avl` asset.

`motion="auto"` follows live `prefers-reduced-motion`; `reduce` leaves the
author-owned fallback visible and `full` ignores that preference while still
respecting visibility, pause intent, and resource limits. Reduced mode does not
decode or advance animation. If a fresh source first becomes animated after an
initial hidden/static preparation, it still begins at intro frame zero. Once
that intro has reached the body, later reduced-to-full or visibility re-entry
begins the current state's body at frame zero without replaying the intro.
If visibility or motion policy interrupts the intro before that join, the next
eligible activation restarts it at frame zero. An explicit programmatic state
commit in static mode can instead move away from the initial state and waive
the intro; automatic inputs remain gated until the runtime is visible.

Offscreen, document-hidden, page-hidden, and zero-size hosts suspend through
the same player visibility path. Logical time freezes. Re-entry rebuilds behind
the author-owned fallback without elapsed-time catch-up. `pause()` is
independent of visibility; `resume()` records intent even while hidden.
