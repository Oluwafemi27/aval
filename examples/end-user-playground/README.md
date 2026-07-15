# End-user playground

This permanent example exercises the public `@aval/element` API
with a real checked-in, two-state asset. From the repository root, run:

```sh
npm install
npm run playground
```

Open the printed loopback URL (normally `http://127.0.0.1:5173`). Hover or
focus the favorite icon to exercise authored input bindings, or use either
button to toggle the `idle` and `engaged` states explicitly.

The animation uses workspace packages and does not require FFmpeg at runtime.
If the animated browser path is unavailable, the custom element retains the
checked-in PNG fallback and reports the fallback state on the page.
