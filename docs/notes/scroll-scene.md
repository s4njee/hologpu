# CSS scroll scene (`scroll-scene`)

## Question

Can normalized CSS scroll progress scrub a GPU scene reversibly without advancing simulation time?

## Technique summary

Progress controls panel rotation, parallax offsets and palette depth directly. Five analytic rounded panels form a layered scene. The parameter has css:true; the DOM bridge registers its scalar custom property and samples animated computed style before rendering. A native scroll-driven CSS animation supplies progress independently of the field playback clock. Restoring the same progress restores the same pixels without replaying simulation history.

## References

[WGSL texture loads and sampling](https://www.w3.org/TR/WGSL/#textureLoad)

[CSS Properties and Values API](https://www.w3.org/TR/css-properties-values-api-1/)

[Scroll-driven Animations](https://www.w3.org/TR/scroll-animations-1/)

## Passes and resources

One T1 fullscreen pass, no owned custom textures or particle buffers. The CSS bridge and in-flow canvas attachment are separate DOM resources and are removed by their owner on teardown. Browser scroll animation timing may be asynchronous, while computed-style sampling and WebGPU command submission remain main-thread operations.

## WebGPU features used

Baseline sampled textures, uniform buffers and render pipelines. Linear-premultiplied HDR output is resolved through the shared runtime. Resolution quality ranges from 0.25 to 1. Reduced motion freezes the declared time pose; authored CSS progress remains an explicit input. The declared CSS fallback is available when WebGPU initialization fails.

## Parameters (generated)

<!-- params:start -->

| Parameter  | Type  | Default   | Range / choices | Group   | Description                                                             |
| ---------- | ----- | --------- | --------------- | ------- | ----------------------------------------------------------------------- |
| progress   | f32   | 0         | 0…1             | DOM     | Normalized progress; may be driven by a registered CSS custom property. |
| depth      | f32   | 1         | 0.1…4           | Scene   | Parallax depth multiplier.                                              |
| turns      | f32   | 1         | 0…4             | Scene   | Rotation turns across the scroll range.                                 |
| radius     | f32   | 0.13      | 0.02…0.4        | Scene   | Rounded panel corner radius in normalized height.                       |
| first      | color | "#e5aa8c" | —               | Palette | Foreground panel colour.                                                |
| second     | color | "#8aadeb" | —               | Palette | Background panel colour.                                                |
| background | color | "#0e1d30" | —               | Palette | Scene background colour.                                                |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded on the development Apple M1 Max / macOS 26.6.2 using the production preview. All current typed defaults, seed 7, physical 512² display, DPR 1 and fixed resolution/work quality. Each of three runs discards 30 warm-up updates then measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion and timestamp readback. Standalone image, text and audio effects use their documented owned fixtures: two HDR cards, a text coverage mask, and a two-sine waveform with its actual DFT. Fluid obstacles uses two packed rectangles with its default 256² grid and 32 pressure iterations.

| Browser              | CPU mean ms           | Completion p95 ms     | Summed GPU pass p95 ms | rAF median ms            | Record                               |
| -------------------- | --------------------- | --------------------- | ---------------------- | ------------------------ | ------------------------------------ |
| chrome 154.0.8037.98 | 0.253 / 0.251 / 0.233 | 4.800 / 4.500 / 3.900 | 0.328 / 0.393 / 0.328  | 16.700 / 16.700 / 16.700 | [JSON](../benchmarks/m5-chrome.json) |
| webkit 26.6          | 0.217 / 0.117 / 0.258 | 4.000 / 4.000 / 4.000 | 2.844 / 2.670 / 2.594  | 17.000 / 17.000 / 17.000 | [JSON](../benchmarks/m5-webkit.json) |

CPU encode, encoding-through-queue-completion wall latency, summed pass timestamps and rAF cadence measure different boundaries. Timestamp precision and overlapping intervals limit interpretation; the summed GPU column is not whole-frame elapsed time. Compilation and initialization are excluded, machine load is uncontrolled, and allocation sizes are logical rather than VRAM. These standalone measurements exclude live media, DOM geometry, CSS polling and attachment costs. The separate [M5 page measurements](../m5.md) cover six actual DOM attachments, visible uniform bridges and the overlay experiment. Numerical references, deterministic software snapshots and device-loss tests establish correctness separately from performance.

<!-- measurements:end -->

## Validation

GPU references prove that progress 0, 0.5 and 1 produce different poses and returning to zero exactly reproduces the initial image. DOM integration tests separately verify the actual native timeline/custom-property bridge. Defaults and two presets are snapshotted at both DPRs; replay, reduced motion and disposal are verified.

## Failure modes

Native scroll-timeline support differs by engine. The DOM stage reports fallback progress driving where required, rather than claiming a compositor timeline. Geometry remains screen-space and axis-aligned; layer depth is artistic parallax, not a 3D depth buffer.

## Production readiness

Measure computed-style sampling under layout pressure and consider a dedicated worker rendering path before promising compositor-only execution.
