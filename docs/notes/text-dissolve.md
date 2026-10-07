# Text mask particle dissolve and reform (`text-dissolve`)

## Question

Can text become real particle primitives while its accessible light-DOM text remains intact?

## Technique summary

A fixed grid of instanced particle quads samples the actual text-mask coverage in the vertex stage. Empty mask cells emit zero alpha. Stable seed hashes produce scatter directions and radii, and progress maps each covered anchor onto a reversible analytic trajectory with a perpendicular curl. Returning progress to zero restores every original anchor exactly. The DOM attachment retains authored light-DOM text for accessibility; it supplies a white text-mask descriptor independently of that text. The default mask is rasterized once on mount, never read back from the GPU each frame.

## References

[WGSL texture loads and sampling](https://www.w3.org/TR/WGSL/#textureLoad)

[CSS Properties and Values API](https://www.w3.org/TR/css-properties-values-api-1/)

[Scroll-driven Animations](https://www.w3.org/TR/scroll-animations-1/)

## Passes and resources

One T3 instanced draw uses the shared createParticleDraw primitive: six vertices per quad, grid columns and half as many rows (8,192 default instances). There is no simulation-history storage and no per-frame CPU particle upload. The shader borrows the normalized text texture; the effect owns only its private R8 fallback mask and pipeline lease. Runtime text inputs retain their own mip chains.

## WebGPU features used

Baseline sampled textures, uniform buffers and render pipelines. Linear-premultiplied HDR output is resolved through the shared runtime. Resolution quality ranges from 0.25 to 1. Reduced motion freezes the declared time pose; authored CSS progress remains an explicit input. The declared CSS fallback is available when WebGPU initialization fails.

## Parameters (generated)

<!-- params:start -->

| Parameter | Type  | Default   | Range / choices | Group     | Description                                                             |
| --------- | ----- | --------- | --------------- | --------- | ----------------------------------------------------------------------- |
| progress  | f32   | 0         | 0…1             | DOM       | Normalized progress; may be driven by a registered CSS custom property. |
| grid      | u32   | 128       | 32…256          | Particles | Number of columns in the mask particle grid; rows are half this number. |
| spread    | f32   | 0.75      | 0…2             | Particles | Normalized displacement at complete dissolution.                        |
| size      | f32   | 1.8       | 0.5…8           | Particles | Particle quad radius in CSS pixels.                                     |
| curl      | f32   | 0.3       | 0…2             | Motion    | Perpendicular sinusoidal trajectory amplitude.                          |
| opacity   | f32   | 0.85      | 0…1             | Particles | Particle opacity, multiplied by the sampled text coverage.              |
| tint      | color | "#c5bbf2" | —               | Palette   | Linear particle colour.                                                 |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded on the development Apple M1 Max / macOS 26.6.2 using the production preview. All current typed defaults, seed 7, physical 512² display, DPR 1 and fixed resolution/work quality. Each of three runs discards 30 warm-up updates then measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion and timestamp readback. Standalone image, text and audio effects use their documented owned fixtures: two HDR cards, a text coverage mask, and a two-sine waveform with its actual DFT. Fluid obstacles uses two packed rectangles with its default 256² grid and 32 pressure iterations.

| Browser              | CPU mean ms           | Completion p95 ms     | Summed GPU pass p95 ms | rAF median ms            | Record                               |
| -------------------- | --------------------- | --------------------- | ---------------------- | ------------------------ | ------------------------------------ |
| chrome 154.0.8037.98 | 0.270 / 0.328 / 0.295 | 4.500 / 4.000 / 4.700 | 0.459 / 0.459 / 0.459  | 16.700 / 16.700 / 16.700 | [JSON](../benchmarks/m5-chrome.json) |
| webkit 26.6          | 0.208 / 0.133 / 0.158 | 6.000 / 4.000 / 5.000 | 1.893 / 1.856 / 3.263  | 17.000 / 17.000 / 17.000 | [JSON](../benchmarks/m5-webkit.json) |

CPU encode, encoding-through-queue-completion wall latency, summed pass timestamps and rAF cadence measure different boundaries. Timestamp precision and overlapping intervals limit interpretation; the summed GPU column is not whole-frame elapsed time. Compilation and initialization are excluded, machine load is uncontrolled, and allocation sizes are logical rather than VRAM. These standalone measurements exclude live media, DOM geometry, CSS polling and attachment costs. The separate [M5 page measurements](../m5.md) cover six actual DOM attachments, visible uniform bridges and the overlay experiment. Numerical references, deterministic software snapshots and device-loss tests establish correctness separately from performance.

<!-- measurements:end -->

## Validation

A half-filled mask emits particles only in the covered half at progress zero; a blank mask emits none. Scatter changes the pixels and reform exactly restores them. The caller mask remains readable after disposal. Both presets, deterministic DPR snapshots and lifecycle/diagnostic checks exercise the real instanced pipeline.

## Failure modes

Grid sampling can omit strokes narrower than a cell. Additive RGB with over-composited coverage preserves overlapping translucent particles, but high emission may saturate the display; the mask reconstructs a sampled particle text surface rather than pixel-perfect typography. Motion is an analytic scrubbed trajectory, not a spring/fluid simulation. Particle quads can move beyond the host clipping rectangle.

## Production readiness

Add coverage-adaptive sampling or compact covered cells on the GPU when preserving fine typography and lowering sparse-mask draw cost become production requirements.
