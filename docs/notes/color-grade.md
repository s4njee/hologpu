# 3D LUT and tone mapping (`color-grade`)

## Question

What does a real 3D texture buy over an analytic colour transform?

## Technique summary

The shader unpremultiplies input, applies exposure, lift, inverse-power gamma and gain, then selects linear, Reinhard, an ACES-inspired rational fit or a filmic rational curve. An optional baked 1D tone curve is applied by three channel lookups. The result enters a genuine 17³ RGBA32 lookup texture, with manual eight-corner trilinear interpolation. Identity, warm and cool matrix looks fill the texture on the CPU. LUT input is normalized and clamped to [0,1]; blending the LUT with the analytic result is explicit.

## References

[Narkowicz: ACES filmic curve fit](https://knarkowicz.wordpress.com/2016/01/06/aces-filmic-tone-mapping-curve/)

[WebGPU: texture views and dimensions](https://www.w3.org/TR/webgpu/#texture-view-creation)

## Passes and resources

One fullscreen pass binds the source, the real 3D LUT and the generated toneCurve 1D texture. The LUT uses 17³×16 = 78,608 logical bytes and is regenerated when the look changes. No hardware float32 filtering is assumed. Seventeen depth-slice taps expose each real 3D LUT plane through raw texture copies without replacing the 3D resource with a texture array. Source alpha is retained and the transformed straight RGB is premultiplied again.

## WebGPU features used

Baseline render pipelines, sampled float texture loads, RGBA16 render targets and uniform buffers. No optional feature is required. Manual bilinear sampling also accepts RGBA32 data without `float32-filterable`. Inputs are borrowed from the runtime provider; destroy releases owned resources and pipeline leases. Reduced motion freezes at the declared pose; unavailable WebGPU uses the declared CSS fallback.

## Parameters (generated)

<!-- params:start -->

| Parameter   | Type  | Default             | Range / choices                | Group      | Description                                         |
| ----------- | ----- | ------------------- | ------------------------------ | ---------- | --------------------------------------------------- |
| toneMap     | enum  | "aces"              | linear, reinhard, aces, filmic | Tone       | Tone operator before the normalized 3D lookup.      |
| exposure    | f32   | 0                   | -4…4                           | Tone       | Linear exposure multiplier in stops.                |
| lift        | vec3  | [0,0,0]             | -0.5…0.5                       | Colour     | Linear additive RGB offset.                         |
| gamma       | vec3  | [1,1,1]             | 0.1…3                          | Colour     | Per-channel inverse-power gamma.                    |
| gain        | vec3  | [1,1,1]             | 0…3                            | Colour     | Linear RGB gain.                                    |
| toneCurve   | curve | [0,0.25,0.5,0.75,1] | —                              | Tone curve | Evenly spaced baked tone-curve LUT values.          |
| curveAmount | f32   | 0                   | 0…1                            | Tone curve | Tone curve blend after the operator.                |
| look        | enum  | "identity"          | identity, warm, cool           | LUT        | 17³ LUT data: identity or RGB matrix look.          |
| lutAmount   | f32   | 1                   | 0…1                            | LUT        | Blend between tone result and trilinear LUT output. |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded on the development Apple M1 Max / macOS 26.6.2 using the production preview. Defaults, seed 7, physical 512² display, DPR 1 and fixed resolution/work quality. Each of three runs discards 30 warm-up updates then measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion and timestamp readback. Filter defaults use their owned deterministic linear HDR test card; lighting uses its documented scene and grid.

| Browser              | CPU mean ms           | Completion p95 ms     | Summed GPU pass p95 ms | rAF median ms            | Record                               |
| -------------------- | --------------------- | --------------------- | ---------------------- | ------------------------ | ------------------------------------ |
| chrome 154.0.8037.98 | 0.348 / 0.316 / 0.326 | 3.200 / 2.800 / 2.900 | 0.393 / 0.393 / 0.393  | 16.700 / 16.700 / 16.700 | [JSON](../benchmarks/m4-chrome.json) |
| webkit 26.6          | 0.425 / 0.425 / 0.325 | 5.000 / 5.000 / 4.000 | 0.759 / 0.862 / 1.862  | 17.000 / 17.000 / 17.000 | [JSON](../benchmarks/m4-webkit.json) |

CPU encode, queue-completion wall latency and rAF cadence measure different boundaries. GPU columns are sums of actual pass timestamps when supported; quantization and overlapping intervals can make their sum exceed completion latency. They are a diagnostic rather than whole-frame elapsed time. Initialization and compilation are excluded, machine load is uncontrolled, and allocation sizes are logical rather than VRAM. The separate [M4 video-chain gate](../m4.md) uses a genuinely decoded 1920×1080 clip, four filters and full-size intermediates, with a measured idle-refresh baseline. Small software snapshots and CPU-reference hardware tests verify numerical/lifecycle properties separately from speed.

<!-- measurements:end -->

## Failure modes

Identity and warm matrix LUTs plus every tone operator match CPU formulae. The identity z=8 plane exactly matches its CPU RGB lattice, and catalogue checks inspect all seventeen depth slices. A non-identity tone curve changes channel output; lift/gamma/gain preserve alpha. The ACES-inspired fit is not the complete ACES colour-management system. Normalized LUT coordinates clip HDR when the LUT blend is nonzero, and 17³ resolution approximates nonlinear looks.

## Production readiness

Support authored .cube imports, log-encoded HDR LUT domains, tetrahedral interpolation and measured colour error. Colour-space metadata should accompany imported images and LUTs.
