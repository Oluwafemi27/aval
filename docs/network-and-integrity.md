# Network and integrity

Without external integrity the web loader prefers bounded range requests. The
server must return exact identity-encoded partial bytes, a valid
`Content-Range`, a stable strong entity validator, CORS permission, and
consistent total length. Malformed, compressed, truncated, redirected, or
entity-changing ranges are rejected. An ignored range may enter the documented
bounded complete-response fallback.

Fetch exposes a decoded stream for a complete `200` while its response headers
still describe the encoded representation. The loader therefore ignores
`Content-Encoding` and `Content-Length` for complete responses, bounds decoded
bytes by the file cap, and then validates the complete decoded AVAL asset. Exact
range lengths and offsets remain identity-only. Gzip or Brotli on a complete
response is supported, though usually wasteful for already-compressed media
payloads.

An `integrity="sha256-..."` token requests whole-asset authenticity. Because a
range cannot authenticate unseen bytes, external integrity intentionally uses
a bounded full fetch before parsing media. Internal per-blob SHA-256 remains
mandatory in both modes.

For a CDN, preserve `Range`, `If-Range`, `ETag`, `Content-Range`,
`Accept-Ranges`, and identity `Content-Encoding` on partial responses. Cache
complete immutable assets by content hash. Never transform a `206`. CSP must permit the
asset origin, package scripts, module worker, and canvas/WebGL behavior used by
your application; do not add `unsafe-eval` for this library.
