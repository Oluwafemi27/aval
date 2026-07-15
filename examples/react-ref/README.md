# React ref example

This example keeps React integration at the application boundary. It uses the
public custom-element definition function, a typed ref, native DOM event
listeners, a controlled authored `state`, and an author-owned slotted fallback.
It does not require or publish a React wrapper.

The example targets the exact future `@aval/element` 1.0.0 release.
That package is an optional peer only so this directory can keep an honest,
isolated lockfile before the prototype is published. Install the exact element
package before typechecking or running the application:

```sh
npm install
npm install @aval/element@1.0.0
npm run typecheck
npm run build
npm exec vite
```

Version 1.0.0 is not claimed to exist on a public registry yet. Repository CI
uses `scripts/verify-packed.mjs` with the locally built 1.0.0 package archives,
so it verifies the package users will install without substituting source-path
aliases or private imports.

Place an asset defining `idle`, `loading`, and `done` at `public/status.avl` to
exercise the three controls. Without that asset, the example intentionally
keeps the slotted fallback visible and reports the normalized failure.
