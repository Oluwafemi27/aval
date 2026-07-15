# Security policy

Report vulnerabilities privately to the security contact listed in the
repository metadata. Do not include production assets, credentials, private
URLs, or personal device identifiers in a public issue.

The supported line is `1.x`. Security fixes may also update fixture limits,
strict parser rejection, loader policy, or documentation without changing the
wire-format version. Reports should include the affected package/version, a
minimal bounded input, expected and actual behavior, and whether untrusted
network or asset bytes are required.

AVAL treats compiled assets, HTTP responses, element attributes,
DOM events, decoder outputs, worker messages, GPU limits, and certification
attachments as untrusted. A passing runtime report is not publisher
authenticity; use external integrity and a trusted distribution channel.
