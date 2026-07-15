# Versioning

Five public packages share one package version and use exact internal package
dependencies. Package semver, `.avl` wire version, and compiler-project version
are independent:

| Space | 1.0 release value |
| --- | --- |
| Public packages | `1.0.0` |
| Compiled wire format | `0.1` |
| Compiler project | `0.2` |

Patch releases fix behavior without new required fields. Minor releases may add
exports, optional diagnostic fields, authored capabilities, or opt-in behavior
without changing defaults. Removing or reinterpreting stable API, adding a
required field, or changing default element/CLI semantics requires a major.
Experimental exports are excluded from compatibility promises only when the API
report and documentation classify them explicitly.
