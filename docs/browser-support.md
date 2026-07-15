# Browser support

Functional CI uses pinned Playwright Chromium, Firefox, and WebKit engines. It
proves browser-path correctness and fallback-state behavior; it is not a
branded Chrome, Edge, Firefox, or Safari certificate.

The player probes the exact authored WebCodecs configuration and WebGL texture
requirements. If a browser or GPU cannot allocate them, playback uses the
host's external fallback/error path; it does not retry with a smaller canvas,
rendition, cache, or frame rate.

<!-- BEGIN GENERATED SUPPORT -->
| Profile | Host fallback | Runtime scheduling | Observed display |
| --- | --- | --- | --- |
| No named profiles | not run | not run | not measured |
<!-- END GENERATED SUPPORT -->

This table remains conservative until validated, digest-linked named reports
are committed. Runtime scheduling describes the browser-side content/deadline
ledger. Observed display requires a separate qualified scan-out trace or
calibrated external capture; RAF, decoder callbacks, GPU fences, canvas
submission, screenshots, and readback do not prove physical display continuity.
