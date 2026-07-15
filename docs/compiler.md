# Compiler

The CLI supports `init`, `compile`, `dev`, `inspect`, `validate`, and `unpack`.
Project schema `0.3` produces wire format `0.1`; package version `1.0.0` does
not change either schema.

```sh
npx avl init my-motion
npx avl compile my-motion/motion.json --out my-motion.avl
npx avl inspect my-motion.avl
npx avl validate my-motion.avl
```

Inputs are strict JSON projects and author-sized video or PNG sequences. The compiler
normalizes timing, creates independently decodable AVC units, validates exact
geometry and alpha policy, and writes motion-only `.avl` assets atomically. An
AVAL contains no embedded poster, static image, or host fallback bytes.
Build reports record the resolved FFmpeg/FFprobe fingerprints and quality
results. In explicit projects, visual-seam heuristic misses are reported for
review while author-selected source pixels remain unchanged. Temporary paths do
not enter compiled bytes.

Project `0.3` renditions support capped CRF or ABR and an allowlisted libx264
preset. Direct input exposes the same policy through `--crf`, `--max-bitrate`,
`--bitrate`, and `--preset`; arbitrary FFmpeg arguments are not accepted.

See [preparing video and authoring states](compiler/authoring-video-and-states.md)
for accepted files, timing and alpha requirements, half-open ranges, a complete
multi-state project, exact no-downscale sizing behavior, and consumer code.

FFmpeg, FFprobe, libx264, and codec patent/licensing obligations are not bundled
or cleared by this project. Use a reviewed local toolchain and obtain legal
review for production distribution.
