# ADR-002 — Internal float targets and SDR resolve (D5)

- Date: 2026-10-07
- Status: Confirmed as the default; retain a direct-target experiment
- Spikes: M0 1 and 2, plus HDR configuration probe

## Question

Is `rgba16float` a usable common intermediate format, and does using it require HDR canvas support or optional shader features?

## Experiment and result

A fullscreen triangle reads a computed color from a storage buffer and writes premultiplied alpha to an `rgba16float` texture. A second triangle reads the texture with `textureLoad` and writes to `navigator.gpu.getPreferredCanvasFormat()`. An alternate mode writes directly to the canvas. Neither path requests optional device features.

Both paths pass on Chrome, Firefox and WebKit hardware. Pixel tests verify the float-to-RGBA8 readback against a CPU reference to within one byte, including half alpha and padded rows. Native Safari also reports repeatable zero-error readback. Float internal textures work in Firefox even though its `rgba16float` **canvas** configuration throws. Internal float precision and HDR presentation are separate capabilities.

On the Chrome hardware benchmark, six float surfaces cost 21.71 MiB of owned texture payload; direct mode owns no intermediate textures. Mean CPU encoding ranges were 0.137–0.214 ms (float) and 0.114–0.163 ms (direct). Both recorded approximately 16.666 ms rAF cadence. The ranges overlap and this test does not establish the GPU bandwidth cost of resolve or its effect on a realistic simulation.

Sources: [raw measurements](../benchmarks/m0-chrome.json), [browser probes](../benchmarks/m0-probes.json), [compatibility research](../compatibility.md).

## Decision and consequences

Keep the float intermediate as the default for simulations, composition and later HDR experiments; resolve to the preferred SDR canvas format by default. Keep direct rendering as a research comparison and possible future optimization for simple opaque fragment effects.

Do not require `shader-f16` for a float texture format. Do not globally request `float32-filterable` for the baseline. M0 exercises texel loads, not filtering/blending precision; later passes must validate their own access patterns. HDR presentation is explicitly gated by canvas configuration, errors and display capability, with SDR maintained where unsupported. M8 still needs physical-display HDR validation.
