# Borrowed image hover transition (`image-hover`)

## Question

Can CSS hover or scroll interpolate two actual image textures while the field preserves their owners?

## Technique summary

The primary image and imageB are independent borrowed linear-premultiplied textures. Progress selects their exact endpoints. Intermediate progress applies opposite sine-coordinate or radial-ripple displacement, strongest at halfway; wipe uses a feathered spatial threshold. The registered scalar CSS bridge can drive progress continuously during hover transitions or a scroll animation. The shader performs the interpolation; a JavaScript hover handler is not a substitute for the CSS timeline.

## References

[WGSL texture loads and sampling](https://www.w3.org/TR/WGSL/#textureLoad)

[CSS Properties and Values API](https://www.w3.org/TR/css-properties-values-api-1/)

[Scroll-driven Animations](https://www.w3.org/TR/scroll-animations-1/)

## Passes and resources

One T4 fullscreen pass binds two manually bilinear-sampled textures. Without supplied inputs, the filter wrapper owns a deterministic HDR card and this effect owns a distinct second card, so standalone catalogue previews remain meaningful. Runtime image/video adapters retain their own mip chains. Effect disposal releases only private fallback textures and pipeline leases.

## WebGPU features used

Baseline sampled textures, uniform buffers and render pipelines. Linear-premultiplied HDR output is resolved through the shared runtime. Resolution quality ranges from 0.25 to 1. Reduced motion freezes the declared time pose; authored CSS progress remains an explicit input. The declared CSS fallback is available when WebGPU initialization fails.

## Parameters (generated)

<!-- params:start -->

| Parameter | Type | Default | Range / choices    | Group      | Description                                                             |
| --------- | ---- | ------- | ------------------ | ---------- | ----------------------------------------------------------------------- |
| progress  | f32  | 0       | 0…1                | DOM        | Normalized progress; may be driven by a registered CSS custom property. |
| amount    | f32  | 0.055   | 0…0.3              | Distortion | UV distortion amplitude, strongest halfway through the transition.      |
| frequency | f32  | 22      | 1…100              | Distortion | Distortion spatial angular frequency.                                   |
| feather   | f32  | 0.12    | 0.001…0.5          | Transition | Wipe feather width in normalized image coordinates.                     |
| mode      | enum | "wave"  | wave, ripple, wipe | Transition | Wave, radial ripple or feathered wipe transition.                       |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded on the development Apple M1 Max / macOS 26.6.2 using the production preview. All current typed defaults, seed 7, physical 512² display, DPR 1 and fixed resolution/work quality. Each of three runs discards 30 warm-up updates then measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion and timestamp readback. Standalone image, text and audio effects use their documented owned fixtures: two HDR cards, a text coverage mask, and a two-sine waveform with its actual DFT. Fluid obstacles uses two packed rectangles with its default 256² grid and 32 pressure iterations.

| Browser              | CPU mean ms           | Completion p95 ms     | Summed GPU pass p95 ms | rAF median ms            | Record                               |
| -------------------- | --------------------- | --------------------- | ---------------------- | ------------------------ | ------------------------------------ |
| chrome 154.0.8037.98 | 0.290 / 0.270 / 0.313 | 4.600 / 4.300 / 5.600 | 0.393 / 0.262 / 0.328  | 16.700 / 16.700 / 16.700 | [JSON](../benchmarks/m5-chrome.json) |
| webkit 26.6          | 0.075 / 0.108 / 0.183 | 4.000 / 4.000 / 4.000 | 1.771 / 1.731 / 1.516  | 17.000 / 17.000 / 17.000 | [JSON](../benchmarks/m5-webkit.json) |

CPU encode, encoding-through-queue-completion wall latency, summed pass timestamps and rAF cadence measure different boundaries. Timestamp precision and overlapping intervals limit interpretation; the summed GPU column is not whole-frame elapsed time. Compilation and initialization are excluded, machine load is uncontrolled, and allocation sizes are logical rather than VRAM. These standalone measurements exclude live media, DOM geometry, CSS polling and attachment costs. The separate [M5 page measurements](../m5.md) cover six actual DOM attachments, visible uniform bridges and the overlay experiment. Numerical references, deterministic software snapshots and device-loss tests establish correctness separately from performance.

<!-- measurements:end -->

## Validation

Constant premultiplied RGBA references verify all three modes at progress 0, 0.5 and 1, including every pixel of the feathered wipe. Both caller textures remain readable after effect disposal. Two presets, enums, snapshots, replay and reduced-motion/disposal checks cover the catalogue contract.

## Failure modes

Clamp sampling stretches source edges under distortion. Both images map to the same normalized UV; source aspect/crop policy belongs to the caller. CSS animations still reach GPU uniforms through sampled computed style on the main thread; this is not a claim that WebGPU submission runs on the compositor.

## Production readiness

Add explicit crop modes and measure the CSS sampling/upload boundary separately from image decode and shader work.
