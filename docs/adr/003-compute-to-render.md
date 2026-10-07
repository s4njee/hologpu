# ADR-003 — Compute writes followed by render reads

- Date: 2026-10-07
- Status: Confirmed
- Spike: M0 3

## Question

Can a compute pass update a storage buffer that all canvas render passes read in the same submission?

## Experiment

The compute shader uses an eight-invocation workgroup with a bounds check for six colors. It hashes a fixed seed, step and surface index using wrapping `u32` arithmetic, producing six `vec4f` colors. A 96-byte buffer has `STORAGE | COPY_SRC` usage. The compute bind group exposes it as read/write; render bind groups expose it as read-only. The compute pass ends before the render passes begin, all in one command encoder.

A staging buffer with `COPY_DST | MAP_READ` copies the compute result back to JavaScript. Tests compare all 24 channels against a CPU reference that uses unsigned arithmetic and `Math.imul`. Each of six tiny render targets is also read back, confirming that its surface index selects the corresponding color rather than merely testing buffer contents. Changing the step changes the rendered pixels.

The tests pass on Chromium/SwiftShader at DPR 1 and 2 and on Chrome, headed Firefox, and WebKit hardware. Pipeline creation is asynchronous, shader compilation rejects errors or warnings, and tests require no uncaptured GPU errors. Native Safari's integrated verifier also passes.

## Decision

Use explicit pass ordering within one submission for dependent compute/render work. No CPU mapping or queue completion wait is needed between those passes. Readback waits are for validation only; keep them outside the animation loop.

This proves basic buffer synchronization and visibility, not a particle algorithm or the M1 effect contract. Compatibility feature level remains a separate constraint; the M0 storage binding must not be assumed portable to reduced capability devices.
