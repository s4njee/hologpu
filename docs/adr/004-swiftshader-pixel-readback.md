# ADR-004 — Deterministic software-adapter pixel checks

- Date: 2026-10-07
- Status: Confirmed for the M0 shader
- Spike: M0 4

## Question

Can Playwright reliably test WebGPU pixels using the software-adapter configuration from Holochart v2?

## Experiment and result

Chromium launches with `--enable-unsafe-webgpu --use-angle=swiftshader`. The pixel test asserts the reported SwiftShader adapter identity and fallback-adapter flag, so a hardware adapter cannot silently satisfy the experiment. One fixed seed and step produces deterministic compute colors, an internal float texture, and a final SDR resolve.

The readback path renders into an RGBA8 texture, copies it to a mapped staging buffer with rows padded to 256 bytes, then strips padding. A 65×33 CSS-pixel target at DPR 1 and 2 deliberately crosses row-alignment boundaries. Every RGBA channel is compared with the CPU reference within one byte; two full captures must be byte-for-byte identical. A changed step must change the bytes. Stored PNG screenshots of the stage validate browser compositing of the half-alpha region over white as well as the opaque half.

The test runs at both DPRs. Expected PNG paths omit the OS suffix because the fixture is a font-free canvas rendered by a pinned software browser; project names retain separate DPR baselines. The full suite also tests missing-WebGPU fallback, fractional resize, scroll position, resource teardown, and a short benchmark. CI installs Playwright's matching Chromium revision from the locked package dependency and runs `pnpm check`.

## Decision and limits

Keep small, seeded software-adapter fixtures in CI, pair snapshots with analytic or CPU-reference assertions, and explicitly verify the selected adapter. Stored images are in `tests/browser/pixels.spec.ts-snapshots`.

These checks establish determinism for an integer-seeded, simple shader on this software implementation. Noise, floating-point simulations and different WGSL compilers may require tolerances and convergence checks. They do not establish hardware performance or guarantee identical pixels across native browsers. Native correctness and performance stay separate validation work. The CI workflow is configured; local execution passed, but no remote CI run has been performed.
