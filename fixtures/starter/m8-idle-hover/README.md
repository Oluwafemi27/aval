# AVAL idle/hover starter

The state names (`idle` and `engaged`) and event names
(`control.engage` and `control.release`) are ordinary author data. The
runtime does not contain a special hover state.

Build and validate locally:

```sh
npm install
npm run build
npm run validate
npm run dev
```

`npm run dev` is the zero-config compiler/watch/browser workflow. The included
`index.html` is the equivalent bundler entry: its npm package import is resolved
by Vite, Parcel, Webpack, and other package-aware web tooling. It demonstrates
a native button as the semantic interaction target and a light-DOM fallback.

The generated RGBA frames are CC0-1.0 and their exact provenance is recorded
in `provenance.json`. No upload, account, framework, or remote asset is
required.
