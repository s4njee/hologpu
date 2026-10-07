# HoloCSS motion snapshot

Vendored from the sibling `holocss` checkout at commit `c4dd129` on 2026-10-07.
`motion.css` is its built native motion entry; `properties.css` is its typed animation properties source. The MIT license is retained alongside the files. This keeps the static playground and repository installation independent of an unpublished sibling package.

The M5 page demo uses HoloCSS motion tokens and native disclosure transitions. A CSS transition of the registered `--hcss-number` drives `--hgpu-progress` through the uniform bridge. HoloGPU does not depend on HoloCSS at runtime; callers can use its engine bridges or any tween library to assign `field.params`.
