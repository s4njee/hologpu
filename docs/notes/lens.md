# Lens and film stack (`lens`)

## Question

How much optical character fits into one bounded sampling pass?

## Technique summary

A radial k1 polynomial warps UV coordinates for barrel or pincushion distortion. Red and blue use opposite radial offsets while green and alpha use the centre sample. A smooth vignette attenuates linear RGB. Seeded hash grain depends on frame index and therefore replays with a fixed seed and frame count. Optical colour operations unpremultiply and repremultiply around the retained source coverage.

## References

[GPU Gems: high-quality filtering](https://developer.nvidia.com/gpugems/gpugems/part-iv-image-processing/chapter-24-high-quality-filtering)

[Reed: hash functions for GPU rendering](https://www.reedbeta.com/blog/hash-functions-for-gpu-rendering/)

## Passes and resources

One fullscreen pass; all sampling is manual bilinear with clamped image edges. Three colour fetches share the same source. No additional owned output texture is needed beyond the runtime or chain target. The wrapper owns a deterministic HDR fallback test card.

## WebGPU features used

Baseline render pipelines, sampled float texture loads, RGBA16 render targets and uniform buffers. No optional feature is required. Manual bilinear sampling also accepts RGBA32 data without `float32-filterable`. Inputs are borrowed from the runtime provider; destroy releases owned resources and pipeline leases. Reduced motion freezes at the declared pose; unavailable WebGPU uses the declared CSS fallback.

## Parameters (generated)

<!-- params:start -->

| Parameter  | Type | Default | Range / choices | Group  | Description                                   |
| ---------- | ---- | ------- | --------------- | ------ | --------------------------------------------- |
| barrel     | f32  | 0.12    | -0.5…0.5        | Optics | Radial k1 barrel / pincushion distortion.     |
| aberration | f32  | 0.002   | 0…0.025         | Optics | Radial red/blue channel separation.           |
| vignette   | f32  | 0.3     | 0…1             | Film   | Smooth radial attenuation.                    |
| grain      | f32  | 0.025   | 0…0.2           | Film   | Seeded zero-mean linear film grain amplitude. |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded on the development Apple M1 Max / macOS 26.6.2 using the production preview. Defaults, seed 7, physical 512² display, DPR 1 and fixed resolution/work quality. Each of three runs discards 30 warm-up updates then measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion and timestamp readback. Filter defaults use their owned deterministic linear HDR test card; lighting uses its documented scene and grid.

| Browser              | CPU mean ms           | Completion p95 ms     | Summed GPU pass p95 ms | rAF median ms            | Record                               |
| -------------------- | --------------------- | --------------------- | ---------------------- | ------------------------ | ------------------------------------ |
| chrome 154.0.8037.98 | 0.229 / 0.237 / 0.288 | 3.900 / 3.600 / 3.600 | 1.835 / 1.966 / 0.524  | 16.700 / 16.700 / 16.700 | [JSON](../benchmarks/m4-chrome.json) |
| webkit 26.6          | 0.200 / 0.242 / 0.275 | 5.000 / 5.000 / 5.000 | 1.298 / 0.468 / 1.184  | 17.000 / 17.000 / 17.000 | [JSON](../benchmarks/m4-webkit.json) |

CPU encode, queue-completion wall latency and rAF cadence measure different boundaries. GPU columns are sums of actual pass timestamps when supported; quantization and overlapping intervals can make their sum exceed completion latency. They are a diagnostic rather than whole-frame elapsed time. Initialization and compilation are excluded, machine load is uncontrolled, and allocation sizes are logical rather than VRAM. The separate [M4 video-chain gate](../m4.md) uses a genuinely decoded 1920×1080 clip, four filters and full-size intermediates, with a measured idle-refresh baseline. Small software snapshots and CPU-reference hardware tests verify numerical/lifecycle properties separately from speed.

<!-- measurements:end -->

## Failure modes

The clean preset has zero warp, aberration, vignette and grain, providing a neutral identity stack. Clamp boundaries stretch edge pixels under strong distortion. Grain is a temporal white hash rather than scanned film or blue noise. The radial polynomial is an artistic lens model, without calibrated camera coefficients.

## Production readiness

Calibrate multiple radial/tangential coefficients, use border policies appropriate to crop versus transparent content, and compare temporal grain spectra.
