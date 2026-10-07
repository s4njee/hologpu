# Sobel, toon and Kuwahara (`edges`)

## Question

How does neighbourhood cost change between edge extraction and painterly smoothing?

## Technique summary

A 3×3 Sobel stencil computes linear luminance derivatives. Sobel returns magnitude; toon quantizes straight RGB and darkens edges. Kuwahara computes RGB means and summed channel variances in four overlapping quadrants, selecting the minimum-variance mean. The anisotropic variant rotates and elongates quadrant sampling along the local Sobel tangent (1.5×) and compresses its normal (0.65×). This bounded orientation variant does not implement a smoothed structure tensor or polynomial sector weights.

## References

[Kyprianidis et al.: image and video abstraction by anisotropic Kuwahara filtering](https://www.kyprianidis.com/p/tpcg2009/)

[GPU Gems: high-quality filtering](https://developer.nvidia.com/gpugems/gpugems/part-iv-image-processing/chapter-24-high-quality-filtering)

## Passes and resources

One fullscreen pass; Sobel samples nine points. Painterly modes additionally sample four quadrants of up to (radius+1)² texels, radius bounded to four. Only the runtime/chain target and fallback image are owned. Source alpha is retained; filtering RGB after unpremultiplication avoids using alpha coverage as colour.

## WebGPU features used

Baseline render pipelines, sampled float texture loads, RGBA16 render targets and uniform buffers. No optional feature is required. Manual bilinear sampling also accepts RGBA32 data without `float32-filterable`. Inputs are borrowed from the runtime provider; destroy releases owned resources and pipeline leases. Reduced motion freezes at the declared pose; unavailable WebGPU uses the declared CSS fallback.

## Parameters (generated)

<!-- params:start -->

| Parameter | Type | Default | Range / choices                             | Group     | Description                                                                                       |
| --------- | ---- | ------- | ------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------- |
| mode      | enum | "toon"  | sobel, toon, kuwahara, anisotropic-kuwahara | Filter    | Sobel magnitude, quantized toon, minimum-variance quadrants or edge-oriented elongated quadrants. |
| strength  | f32  | 2       | 0…8                                         | Edges     | Sobel magnitude gain.                                                                             |
| levels    | u32  | 5       | 2…16                                        | Toon      | Toon per-channel quantization levels.                                                             |
| radius    | u32  | 3       | 1…4                                         | Painterly | Kuwahara quadrant radius in texels.                                                               |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded on the development Apple M1 Max / macOS 26.6.2 using the production preview. Defaults, seed 7, physical 512² display, DPR 1 and fixed resolution/work quality. Each of three runs discards 30 warm-up updates then measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion and timestamp readback. Filter defaults use their owned deterministic linear HDR test card; lighting uses its documented scene and grid.

| Browser              | CPU mean ms           | Completion p95 ms     | Summed GPU pass p95 ms | rAF median ms            | Record                               |
| -------------------- | --------------------- | --------------------- | ---------------------- | ------------------------ | ------------------------------------ |
| chrome 154.0.8037.98 | 0.264 / 0.266 / 0.320 | 3.200 / 3.200 / 3.700 | 1.573 / 1.638 / 0.721  | 16.700 / 16.700 / 16.700 | [JSON](../benchmarks/m4-chrome.json) |
| webkit 26.6          | 0.225 / 0.225 / 0.217 | 5.000 / 7.000 / 6.000 | 0.884 / 2.281 / 1.008  | 17.000 / 17.000 / 17.000 | [JSON](../benchmarks/m4-webkit.json) |

CPU encode, queue-completion wall latency and rAF cadence measure different boundaries. GPU columns are sums of actual pass timestamps when supported; quantization and overlapping intervals can make their sum exceed completion latency. They are a diagnostic rather than whole-frame elapsed time. Initialization and compilation are excluded, machine load is uncontrolled, and allocation sizes are logical rather than VRAM. The separate [M4 video-chain gate](../m4.md) uses a genuinely decoded 1920×1080 clip, four filters and full-size intermediates, with a measured idle-refresh baseline. Small software snapshots and CPU-reference hardware tests verify numerical/lifecycle properties separately from speed.

<!-- measurements:end -->

## Failure modes

Sobel step magnitude matches the known CPU kernel result. Toon produces expected quantized flat colours; both Kuwahara variants preserve constant colour and alpha. Flat gradients explicitly use a fixed tangent, avoiding undefined atan2(0,0) on Metal. Nearly flat gradients have noisy orientation, quadrant selection can pop in video, and unpremultiplication near transparent edges amplifies hidden-colour noise.

## Production readiness

Add a smoothed structure tensor, continuous sector weights, alpha-aware statistics and video temporal-stability measurements before increasing radius.
