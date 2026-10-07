# Sphere-traced sculpture (`raymarch`)

## Question

How much 3D form can a single fullscreen fragment pass convey with soft shadows and ambient occlusion?

## Technique summary

A sphere and torus form a smooth-union sculpture above a plane. Sphere tracing advances by the scene distance, capped by a user iteration budget and far distance. Central differences estimate normals. A bounded secondary ray approximates soft shadows; five normal-offset samples estimate ambient occlusion. Diffuse, a fixed specular term, fog, and Reinhard tone mapping produce a linear SDR image. The chrome preset changes tint and quality; it is not a physical chrome material.

## References

[John C. Hart: Sphere tracing, a geometric method for the antialiased ray tracing of implicit surfaces](https://doi.org/10.1007/s003710050084)

[Inigo Quilez: ray-marched soft shadows](https://iquilezles.org/articles/rmshadows/)

## Passes and resources

One fullscreen triangle writes premultiplied linear colour to an `rgba16float` target. A shared fullscreen resolve unpremultiplies, converts to sRGB, then premultiplies for the canvas. Each field owns the target, a 64-byte frame uniform, and an aligned parameter uniform. Shader modules, bind layouts and async pipelines use device-scoped reference-counted leases. At 512×320 the target is 1,310,720 logical bytes; test readback allocates a temporary SDR texture and padded staging buffer and frees both afterward. Destroy releases listeners, observers, buffers, target and leases; the last field closes the device session.

## WebGPU features used

Baseline fragment shaders, uniform buffers, float colour attachment, sampled texture loads and canvas presentation. No optional adapter features required. Manual texture loads avoid relying on float32 filtering. Reduced motion freezes at time zero. Without WebGPU, the playground displays the declared CSS fallback and retains the readable page.

## Parameters (generated)

<!-- params:start -->

| Parameter | Type  | Default   | Range / choices | Group   | Description                                  |
| --------- | ----- | --------- | --------------- | ------- | -------------------------------------------- |
| steps     | u32   | 80        | 16…160          | Quality | Maximum sphere-tracing iterations per pixel. |
| speed     | f32   | 0.2       | 0…1             | Motion  | Camera orbit speed.                          |
| softness  | f32   | 12        | 2…32            | Light   | Soft-shadow sharpness coefficient.           |
| ao        | bool  | true      | —               | Light   | Five-sample ambient occlusion.               |
| tint      | color | "#e9b99a" | —               | Palette | Linear material color.                       |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded 2026-10-07 on Apple M1 Max / macOS 26.6.2. Default parameters, seed 7, 512×320 physical pixels, DPR 1, resolution scale 1. Three runs; each discards 30 warm-up frames then measures 120 explicit encode/submit calls at fixed 1/60 s in rAF. CPU timings exclude GPU execution; rAF cadence is not a GPU timer. Device state and load are uncontrolled. Logical allocation sizes are not VRAM.

| Browser              | CPU mean ms (three runs) | rAF mean ms (three runs) | Record                               |
| -------------------- | ------------------------ | ------------------------ | ------------------------------------ |
| chrome 154.0.8037.98 | 0.152 / 0.196 / 0.142    | 16.666 / 16.667 / 16.666 | [JSON](../benchmarks/m1-chrome.json) |
| webkit 26.6          | 0.092 / 0.225 / 0.192    | 14.942 / 16.733 / 16.633 | [JSON](../benchmarks/m1-webkit.json) |

Shader compilation is excluded. Optional GPU timestamp queries are deferred to M3. The SwiftShader pixel tests verify repeatability and disposal at DPR 1 and 2, both presets, every enum mode, and no compilation warnings. Hardware engines use the same compile/readback/disposal tests without cross-device image comparison.

<!-- measurements:end -->

## Failure modes

Fixed epsilon and step budgets can miss small surfaces, create silhouettes or shadow acne, and limit camera scale. Smooth unions and secondary shadow heuristics do not provide an error guarantee. AO is approximate; no PBR, depth buffer, or geometry integration is provided.

## Production readiness

Measure actual GPU time at larger resolutions, add distance-scaled hit tolerances and spatial antialiasing, and compare normals/shadow bounds against analytic references.
