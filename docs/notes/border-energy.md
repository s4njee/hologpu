# Rounded rectangle border energy (`border-energy`)

## Question

Can an effect follow the geometry of a real element without a tessellated border mesh?

## Technique summary

The shader evaluates the analytic rounded-rectangle distance in physical pixels. The DOM attachment supplies a normalized local rectangle and its CSS corner radius; the radius is clamped to half the shorter edge. A derivative-antialiased stroke and exponential distance glow share that geometry. A travelling angular energy pulse modulates the border emission. CSS pixel radii and widths multiply by DPR, preserving their apparent size across displays.

## References

[WGSL texture loads and sampling](https://www.w3.org/TR/WGSL/#textureLoad)

## Passes and resources

One fullscreen T1 fragment pass. Frame and parameter uniform buffers are borrowed; the effect owns a shared pipeline lease and no custom textures. The runtime owns the HDR surface and final display resolve.

## WebGPU features used

Baseline sampled textures, uniform buffers and render pipelines. Linear-premultiplied HDR output is resolved through the shared runtime. Resolution quality ranges from 0.25 to 1. Reduced motion freezes the declared time pose; authored CSS progress remains an explicit input. The declared CSS fallback is available when WebGPU initialization fails.

## Parameters (generated)

<!-- params:start -->

| Parameter | Type  | Default               | Range / choices | Group    | Description                                           |
| --------- | ----- | --------------------- | --------------- | -------- | ----------------------------------------------------- |
| rect      | vec4  | [0.12,0.18,0.76,0.64] | 0…1             | Geometry | Local normalized rectangle: left, top, width, height. |
| radius    | f32   | 24                    | 0…200           | Geometry | Rounded corner radius in CSS pixels.                  |
| width     | f32   | 2                     | 0.5…24          | Geometry | Border stroke width in CSS pixels.                    |
| glow      | f32   | 14                    | 1…100           | Light    | Exponential glow falloff distance in CSS pixels.      |
| speed     | f32   | 0.4                   | 0…4             | Motion   | Energy pulse revolutions per second.                  |
| intensity | f32   | 1.5                   | 0…5             | Light    | Linear border emission multiplier.                    |
| tint      | color | "#92dfe7"             | —               | Palette  | Linear border emission colour.                        |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded on the development Apple M1 Max / macOS 26.6.2 using the production preview. All current typed defaults, seed 7, physical 512² display, DPR 1 and fixed resolution/work quality. Each of three runs discards 30 warm-up updates then measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion and timestamp readback. Standalone image, text and audio effects use their documented owned fixtures: two HDR cards, a text coverage mask, and a two-sine waveform with its actual DFT. Fluid obstacles uses two packed rectangles with its default 256² grid and 32 pressure iterations.

| Browser              | CPU mean ms           | Completion p95 ms     | Summed GPU pass p95 ms | rAF median ms            | Record                               |
| -------------------- | --------------------- | --------------------- | ---------------------- | ------------------------ | ------------------------------------ |
| chrome 154.0.8037.98 | 0.228 / 0.303 / 0.270 | 4.400 / 4.000 / 5.200 | 0.262 / 0.328 / 0.328  | 16.700 / 16.700 / 16.700 | [JSON](../benchmarks/m5-chrome.json) |
| webkit 26.6          | 0.275 / 0.175 / 0.258 | 4.000 / 3.000 / 6.000 | 1.741 / 1.509 / 1.701  | 17.000 / 17.000 / 17.000 | [JSON](../benchmarks/m5-webkit.json) |

CPU encode, encoding-through-queue-completion wall latency, summed pass timestamps and rAF cadence measure different boundaries. Timestamp precision and overlapping intervals limit interpretation; the summed GPU column is not whole-frame elapsed time. Compilation and initialization are excluded, machine load is uncontrolled, and allocation sizes are logical rather than VRAM. These standalone measurements exclude live media, DOM geometry, CSS polling and attachment costs. The separate [M5 page measurements](../m5.md) cover six actual DOM attachments, visible uniform bridges and the overlay experiment. Numerical references, deterministic software snapshots and device-loss tests establish correctness separately from performance.

<!-- measurements:end -->

## Validation

The GPU reference checks glow alpha against the rounded-rectangle CPU distance at symmetric corners and the interior. Large radii remain finite. Catalogue tests exercise both presets, deterministic replay, reduced-motion pose, DPR 1/2 snapshots, shader diagnostics and disposal.

## Failure modes

The pulse travels by polar angle rather than constant arc length, so apparent speed differs between long edges and corners. A single radius represents all corners; asymmetric CSS corner radii require a richer schema. A full-element glow clips at the canvas boundary unless the caller reserves padding.

## Production readiness

Add per-corner radii and a padded host attachment when exterior glows matter; retain the shared analytic shape rather than rasterizing the DOM border.
