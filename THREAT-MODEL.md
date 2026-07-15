# Threat model

## Protected assets

The runtime protects page availability, bounded memory/decoder/GPU ownership,
graph determinism, source-generation isolation, and the confidentiality of
credentials and local environment details. Release tooling additionally
protects tarball identity, report provenance, registry tags, and rollback
records.

## Trust boundaries

- `.avl` headers, manifests, indexes, AVC, PNG, and offsets are hostile bytes.
- HTTP status, range metadata, validators, encodings, redirects, chunks, and
  body length are hostile until their exact contract and digest pass.
- Element attributes, authored identifiers, DOM events, observers, and public
  callbacks can be re-entrant.
- Workers, decoders, canvases, WebGL contexts, and browser callbacks can fail,
  arrive late, or outlive a replaced source unless generation ownership stops
  them.
- Reports and attachments are hostile until schema, bounds, path, length, and
  digest verification completes.
- Registry state must be read before any publish/tag mutation.

## Explicit non-goals

This project does not provide DRM, secret media, remote code execution inside
assets, a runtime kill switch, patent clearance, or physical display evidence
from browser callback timestamps. Codec and source-media rights remain the
publisher's responsibility.
