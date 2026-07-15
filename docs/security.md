# Security and privacy

Use immutable content-hashed assets, HTTPS, exact CORS/range responses, strong
ETags, CSP, and external integrity when the distribution channel is not already
authenticated. Avoid credentialed cross-origin loading unless required.

The format contains media and declarative graph data only. It cannot execute
JavaScript, selectors, HTML, CSS, or network requests. Public diagnostics and
events are bounded and secret-free. Release reports forbid personal paths,
query-bearing URLs, serial-number fields, unsafe integers, non-finite values,
unbounded attachments, and digest mismatches.

Removing product-policy media ceilings does not remove structural defenses.
Parsers still check integer representation, every byte range and product,
canonical JSON, AVC profile consistency, and digests before
use. Publishers are responsible for the resource cost of large trusted assets;
hosts may configure an explicit lower policy for their deployment.

See the repository [security policy](../SECURITY.md) and [threat model](../THREAT-MODEL.md).
