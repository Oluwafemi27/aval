# Element API

`aval-player` supports these reflected attributes: `src`, `integrity`,
`crossorigin`, `motion`, `autoplay`, `fit`, `bindings`, `state`,
`interaction-for`, `width`, and `height`. It has no image URL property; an
optional fallback slot belongs to the host document and is not embedded in the
asset.

Core methods are `prepare()`, `setState()`, `send()`, `readyFor()`, `pause()`,
`resume()`, `getDiagnostics()`, and terminal `dispose()`. Runtime state is read
through `readiness`, `mode`, `staticReason`, `requestedState`, `visualState`,
`isTransitioning`, `paused`, `effectivelyVisible`, `stateNames`, `eventNames`,
and `inputBindings`.

Events are non-cancelable `CustomEvent` instances with immutable bounded
details: `readinesschange`, `requestedstatechange`, `visualstatechange`,
`transitionstart`, `transitionend`, `underflow`, `fallback`, and `error`. Every
event except `error` bubbles and is composed. Listen for `error` directly on
the element; keeping that event local follows native media behavior and avoids
colliding with page-wide error handlers. Every detail includes a positive
source `generation`; it never contains a source URL, integrity token, response
body, ETag, or credential.

`prepare({ signal, timeoutMs })` joins generation preparation. Aborting one
caller stops only that caller's wait. Source replacement rejects old public
waits and prevents old frames or events from publishing.

`getDiagnostics()` exposes an immutable cleanup receipt for the most recently
retired source. A completed receipt proves participant-scoped ownership reached
zero. Page totals are reported separately and may remain nonzero while peer
elements share the page runtime. Cross-document/root adoption clears an
object-only interaction target and receipt-gates the new realm's source; a
same-root same-task move preserves the existing generation.
