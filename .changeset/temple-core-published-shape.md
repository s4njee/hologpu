---
"@mk7s/hologpu-temple-core": patch
---

Drop the `source` export condition, which pointed at files not included in the published package and made `publint` warn. Consumers resolve the built `dist` output.
