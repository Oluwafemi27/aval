# M6 malformed strict-PNG corpus

Every file is derived deterministically by
`fixtures/compiler/m6/source/generate.mjs`. `corpus.json` is the canonical,
class-unique inventory; hashes and observed failures are frozen again in
`../provenance.json`.

| File | Rejection class | Expected code |
| --- | --- | --- |
| `truncated-signature.png` | `signature-range` | `PNG_ENVELOPE_INVALID` |
| `bad-signature.png` | `signature-value` | `PNG_ENVELOPE_INVALID` |
| `truncated-chunk-header.png` | `chunk-header-range` | `PNG_ENVELOPE_INVALID` |
| `oversized-chunk-payload.png` | `per-chunk-payload-limit` | `PNG_ENVELOPE_INVALID` |
| `truncated-chunk-payload.png` | `chunk-payload-crc-range` | `PNG_ENVELOPE_INVALID` |
| `bad-crc.png` | `chunk-crc` | `PNG_ENVELOPE_INVALID` |
| `non-ascii-chunk-type.png` | `chunk-type-ascii` | `PNG_ENVELOPE_INVALID` |
| `first-chunk-not-ihdr.png` | `ihdr-first` | `PNG_ENVELOPE_INVALID` |
| `bad-ihdr-length.png` | `ihdr-length` | `PNG_ENVELOPE_INVALID` |
| `zero-dimension.png` | `dimensions-positive` | `PNG_ENVELOPE_INVALID` |
| `descriptor-dimension-mismatch.png` | `descriptor-dimensions` | `PNG_ENVELOPE_INVALID` |
| `bad-bit-depth.png` | `ihdr-bit-depth` | `PNG_ENVELOPE_INVALID` |
| `bad-color-type.png` | `ihdr-color-type` | `PNG_ENVELOPE_INVALID` |
| `bad-compression-method.png` | `ihdr-compression-method` | `PNG_ENVELOPE_INVALID` |
| `bad-filter-method.png` | `ihdr-filter-method` | `PNG_ENVELOPE_INVALID` |
| `interlaced.png` | `ihdr-interlace` | `PNG_ENVELOPE_INVALID` |
| `misplaced-srgb.png` | `srgb-placement-or-duplication` | `PNG_ENVELOPE_INVALID` |
| `bad-srgb-intent.png` | `srgb-payload` | `PNG_ENVELOPE_INVALID` |
| `iend-before-idat.png` | `iend-requires-idat` | `PNG_ENVELOPE_INVALID` |
| `nonempty-iend.png` | `iend-empty-payload` | `PNG_ENVELOPE_INVALID` |
| `unknown-chunk.png` | `restricted-chunk-grammar` | `PNG_ENVELOPE_INVALID` |
| `too-many-chunks.png` | `chunk-count-limit` | `PNG_ENVELOPE_INVALID` |
| `trailing-byte.png` | `terminal-iend` | `PNG_ENVELOPE_INVALID` |
| `missing-iend.png` | `missing-terminal-iend` | `PNG_ENVELOPE_INVALID` |
| `short-zlib-member.png` | `zlib-minimum-length` | `PNG_ENVELOPE_INVALID` |
| `bad-zlib-method.png` | `zlib-compression-method` | `PNG_ENVELOPE_INVALID` |
| `bad-zlib-window.png` | `zlib-window-size` | `PNG_ENVELOPE_INVALID` |
| `bad-zlib-fcheck.png` | `zlib-fcheck` | `PNG_ENVELOPE_INVALID` |
| `zlib-preset-dictionary.png` | `zlib-preset-dictionary` | `PNG_ENVELOPE_INVALID` |
| `reserved-block-type.png` | `deflate-reserved-block` | `PNG_DEFLATE_INVALID` |
| `stored-nonzero-padding.png` | `deflate-stored-padding` | `PNG_DEFLATE_INVALID` |
| `stored-len-nlen-mismatch.png` | `deflate-stored-complement` | `PNG_DEFLATE_INVALID` |
| `stored-output-overrun.png` | `deflate-stored-output-overrun` | `PNG_DEFLATE_INVALID` |
| `stored-truncated-byte.png` | `deflate-stored-byte-range` | `PNG_DEFLATE_INVALID` |
| `fixed-literal-overrun.png` | `deflate-literal-output-overrun` | `PNG_DEFLATE_INVALID` |
| `fixed-reserved-literal.png` | `deflate-reserved-literal` | `PNG_DEFLATE_INVALID` |
| `fixed-reserved-distance.png` | `deflate-reserved-distance` | `PNG_DEFLATE_INVALID` |
| `fixed-missing-history.png` | `deflate-distance-history` | `PNG_DEFLATE_INVALID` |
| `fixed-copy-overrun.png` | `deflate-copy-output-overrun` | `PNG_DEFLATE_INVALID` |
| `dynamic-empty-code-length-tree.png` | `deflate-code-length-tree-empty` | `PNG_DEFLATE_INVALID` |
| `dynamic-oversubscribed-code-length-tree.png` | `deflate-code-length-tree-oversubscribed` | `PNG_DEFLATE_INVALID` |
| `dynamic-incomplete-code-length-tree.png` | `deflate-code-length-tree-incomplete` | `PNG_DEFLATE_INVALID` |
| `dynamic-leading-repeat16.png` | `deflate-repeat16-without-previous` | `PNG_DEFLATE_INVALID` |
| `dynamic-repeat-overflow.png` | `deflate-code-length-repeat-overflow` | `PNG_DEFLATE_INVALID` |
| `dynamic-missing-eob-symbol.png` | `deflate-literal-tree-missing-eob` | `PNG_DEFLATE_INVALID` |
| `dynamic-reserved-distance-tree.png` | `deflate-dynamic-reserved-distance` | `PNG_DEFLATE_INVALID` |
| `dynamic-oversubscribed-literal-tree.png` | `deflate-literal-tree-oversubscribed` | `PNG_DEFLATE_INVALID` |
| `dynamic-incomplete-literal-tree.png` | `deflate-literal-tree-incomplete` | `PNG_DEFLATE_INVALID` |
| `dynamic-empty-distance-tree-used.png` | `deflate-empty-distance-tree-used-by-length` | `PNG_DEFLATE_INVALID` |
| `dynamic-oversubscribed-distance-tree.png` | `deflate-distance-tree-oversubscribed` | `PNG_DEFLATE_INVALID` |
| `dynamic-incomplete-distance-tree.png` | `deflate-distance-tree-incomplete` | `PNG_DEFLATE_INVALID` |
| `dynamic-unmatched-huffman-code.png` | `deflate-huffman-code-unmatched` | `PNG_DEFLATE_INVALID` |
| `missing-eob.png` | `deflate-missing-eob` | `PNG_DEFLATE_INVALID` |
| `missing-final-block.png` | `deflate-missing-final-block` | `PNG_DEFLATE_INVALID` |
| `nonzero-terminal-padding.png` | `deflate-terminal-padding` | `PNG_DEFLATE_INVALID` |
| `trailing-deflate-byte.png` | `deflate-trailing-byte` | `PNG_DEFLATE_INVALID` |
| `short-deflate-output.png` | `deflate-output-length` | `PNG_DEFLATE_INVALID` |
| `bad-adler.png` | `adler32` | `PNG_DEFLATE_INVALID` |
| `bad-filter.png` | `scanline-filter` | `PNG_SCANLINE_INVALID` |

`contracts.json` freezes executable malformed packed-geometry, SPS-crop,
alpha-quality, runtime-resource, PNG-budget, combined-IDAT, and DEFLATE-limit
cases. Those limit-only cases are generated in memory and executed by the
owning format test because encoding multi-megabyte limit sentinels as corpus
files would add no parser coverage. The format, compiler, and web-player fixture
tests execute the case owned by their layer; provenance binds both inventories.

Malformed files must never be passed to a native image decoder before the
strict pure-code envelope and DEFLATE validation completes.
