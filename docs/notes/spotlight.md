# Shared viewport spotlight (`spotlight`)

## Question

Can independently attached canvases display one page light with continuous coordinates?

## Technique summary

Each fragment converts local UV into viewport CSS coordinates using pageRect and measures its distance to the shared pagePointer. The same feathered radial light and viewport-anchored weave appear across separate elements. The DOM adapter updates every visible host rectangle and forwards one document pointer position; the shader does not reinterpret it as a local clamped pointer.

## References

[WGSL texture loads and sampling](https://www.w3.org/TR/WGSL/#textureLoad)

## Passes and resources

One fullscreen T1 pass with frame/parameter buffers. No input image, captured page texture or per-frame readback is required. The common device and scheduler still produce separate legal in-flow canvas surfaces.

## WebGPU features used

Baseline sampled textures, uniform buffers and render pipelines. Linear-premultiplied HDR output is resolved through the shared runtime. Resolution quality ranges from 0.25 to 1. Reduced motion freezes the declared time pose; authored CSS progress remains an explicit input. The declared CSS fallback is available when WebGPU initialization fails.

## Parameters (generated)

<!-- params:start -->

| Parameter   | Type  | Default       | Range / choices | Group    | Description                                                         |
| ----------- | ----- | ------------- | --------------- | -------- | ------------------------------------------------------------------- |
| pageRect    | vec4  | [0,0,512,512] | -100000…100000  | Geometry | Viewport rectangle in CSS pixels: left, top, width, height.         |
| pagePointer | vec2  | [256,256]     | -100000…100000  | DOM      | Shared viewport pointer in CSS pixels; identical for every surface. |
| radius      | f32   | 180           | 1…1000          | Light    | Spotlight radius in viewport CSS pixels.                            |
| softness    | f32   | 0.55          | 0.01…1          | Light    | Fraction of radius occupied by the feathered outer edge.            |
| intensity   | f32   | 1.2           | 0…5             | Light    | Linear reveal intensity.                                            |
| ambient     | f32   | 0.04          | 0…1             | Light    | Linear intensity outside the spotlight.                             |
| tint        | color | "#c4c1ff"     | —               | Palette  | Spotlight colour.                                                   |
| background  | color | "#102133"     | —               | Palette  | Unlit surface colour.                                               |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded on the development Apple M1 Max / macOS 26.6.2 using the production preview. All current typed defaults, seed 7, physical 512² display, DPR 1 and fixed resolution/work quality. Each of three runs discards 30 warm-up updates then measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion and timestamp readback. Standalone image, text and audio effects use their documented owned fixtures: two HDR cards, a text coverage mask, and a two-sine waveform with its actual DFT. Fluid obstacles uses two packed rectangles with its default 256² grid and 32 pressure iterations.

| Browser              | CPU mean ms           | Completion p95 ms     | Summed GPU pass p95 ms | rAF median ms            | Record                               |
| -------------------- | --------------------- | --------------------- | ---------------------- | ------------------------ | ------------------------------------ |
| chrome 154.0.8037.98 | 0.236 / 0.277 / 0.268 | 4.100 / 5.000 / 4.900 | 0.197 / 0.262 / 0.262  | 16.700 / 16.700 / 16.700 | [JSON](../benchmarks/m5-chrome.json) |
| webkit 26.6          | 0.317 / 0.192 / 0.150 | 4.000 / 3.000 / 3.000 | 1.683 / 1.435 / 1.685  | 17.000 / 17.000 / 17.000 | [JSON](../benchmarks/m5-webkit.json) |

CPU encode, encoding-through-queue-completion wall latency, summed pass timestamps and rAF cadence measure different boundaries. Timestamp precision and overlapping intervals limit interpretation; the summed GPU column is not whole-frame elapsed time. Compilation and initialization are excluded, machine load is uncontrolled, and allocation sizes are logical rather than VRAM. These standalone measurements exclude live media, DOM geometry, CSS polling and attachment costs. The separate [M5 page measurements](../m5.md) cover six actual DOM attachments, visible uniform bridges and the overlay experiment. Numerical references, deterministic software snapshots and device-loss tests establish correctness separately from performance.

<!-- measurements:end -->

## Validation

The reference renders adjacent translated rectangles and compares every RGB component with the same CPU viewport-light formula. This verifies coordinate continuity rather than comparing similar-looking local spotlights. Catalogue replay and lifecycle checks run at both software DPRs and in native Chrome/WebKit.

## Failure modes

Viewport coordinates follow axis-aligned bounding boxes. Arbitrary CSS rotation or perspective requires an inverse transform rather than an axis-aligned pageRect. Separate canvases still have independent clipping and composition; this is shared illumination, not one giant page overlay.

## Production readiness

Measure host-transform costs and support inverse matrices before using the spotlight on heavily transformed layouts.
