# Plain HTML example

This source example is illustrative: it is ordinary HTML, CSS, and JavaScript
with a package-aware development server—no framework and no inline script or
style exception. Its asset paths are placeholders.

Place `orbit.avl` and its optional author fallback `orbit.png` in this
directory, then run:

```sh
npm install
npm run dev
```

Vite resolves the public `@pixel-point/aval-element` package import. A browser
cannot resolve a bare npm specifier by opening `index.html` from disk; use this
workflow, another package-aware bundler, or an exact pinned CDN URL.

For an immediately runnable generated asset and browser workflow, use
`avl init` and `npm run dev` in the generated starter.
