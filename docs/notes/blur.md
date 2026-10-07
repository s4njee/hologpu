# Separable and pyramid blur (`blur`)

## Question

How do exact separable kernels compare with a compact dual Kawase pyramid?

## Technique summary

Gaussian and box modes apply two normalized one-dimensional convolutions. Radius is bounded to 24 output texels; both axes use the output resolution, including when input and output sizes differ. Gaussian sigma is radius / 3 with a 0.35 minimum. Samples clamp at the image boundary, so constant premultiplied RGBA remains constant. Dual Kawase alternates weighted centre/diagonal downsampling with axial/diagonal upsampling, using one to five levels and radius-scaled offsets. All four colour channels are filtered together.

## References

[GPU Gems: high-quality filtering](https://developer.nvidia.com/gpugems/gpugems/part-iv-image-processing/chapter-24-high-quality-filtering)

[Intel: Kawase blur and moving box averages](https://www.intel.com/content/www/us/en/developer/videos/improving-real-time-gpu-based-image-blur-algorithms-kawase-blur-and-moving-box-averages.html)

## Passes and resources

Gaussian and box use two fullscreen passes and one full-size RGBA16 intermediate. The allocated dual pyramid also contains downsample and reconstructed levels, exposed as taps. Every stage has an immutable 16-byte settings buffer; pipeline and module leases are shared by source. The fallback is a private 64² RGBA32 linear HDR test card. Logical allocation accounting includes all these resources.

## WebGPU features used

Baseline render pipelines, sampled float texture loads, RGBA16 render targets and uniform buffers. No optional feature is required. Manual bilinear sampling also accepts RGBA32 data without `float32-filterable`. Inputs are borrowed from the runtime provider; destroy releases owned resources and pipeline leases. Reduced motion freezes at the declared pose; unavailable WebGPU uses the declared CSS fallback.

## Parameters (generated)

<!-- params:start -->

| Parameter | Type | Default    | Range / choices            | Group  | Description                                                                                    |
| --------- | ---- | ---------- | -------------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| algorithm | enum | "gaussian" | gaussian, dual-kawase, box | Filter | Normalized separable Gaussian or box; dual Kawase uses a down/up pyramid.                      |
| radius    | f32  | 8          | 0…24                       | Kernel | Gaussian/box radius in output texels; Gaussian sigma is radius / 3. Dual offset is radius / 8. |
| passes    | u32  | 3          | 1…5                        | Kernel | Dual Kawase pyramid depth.                                                                     |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded on the development Apple M1 Max / macOS 26.6.2 using the production preview. Defaults, seed 7, physical 512² display, DPR 1 and fixed resolution/work quality. Each of three runs discards 30 warm-up updates then measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion and timestamp readback. Filter defaults use their owned deterministic linear HDR test card; lighting uses its documented scene and grid.

| Browser              | CPU mean ms           | Completion p95 ms     | Summed GPU pass p95 ms | rAF median ms            | Record                               |
| -------------------- | --------------------- | --------------------- | ---------------------- | ------------------------ | ------------------------------------ |
| chrome 154.0.8037.98 | 0.282 / 0.267 / 0.294 | 4.200 / 3.800 / 4.100 | 2.490 / 2.425 / 2.359  | 16.700 / 16.700 / 16.700 | [JSON](../benchmarks/m4-chrome.json) |
| webkit 26.6          | 0.442 / 0.283 / 0.283 | 6.000 / 5.000 / 6.000 | 4.710 / 3.243 / 4.819  | 17.000 / 17.000 / 17.000 | [JSON](../benchmarks/m4-webkit.json) |

CPU encode, queue-completion wall latency and rAF cadence measure different boundaries. GPU columns are sums of actual pass timestamps when supported; quantization and overlapping intervals can make their sum exceed completion latency. They are a diagnostic rather than whole-frame elapsed time. Initialization and compilation are excluded, machine load is uncontrolled, and allocation sizes are logical rather than VRAM. The separate [M4 video-chain gate](../m4.md) uses a genuinely decoded 1920×1080 clip, four filters and full-size intermediates, with a measured idle-refresh baseline. Small software snapshots and CPU-reference hardware tests verify numerical/lifecycle properties separately from speed.

<!-- measurements:end -->

## Failure modes

Gaussian and box impulse kernels match a CPU convolution, including clamp boundaries and total interior impulse energy within the two-pass half-precision storage bound (2⁻⁹ + 2⁻²⁰ + 49×2⁻²⁴ for the tested radius-three kernel, including a conservative subnormal allowance). Per-pixel CPU agreement remains within 0.00015. Metal measured 0.999208 interior Gaussian impulse energy; float attachment conversion is included in that value. Upsampled Gaussian and box impulses retain isotropic second moments. Dual Kawase preserves constant HDR RGBA at odd dimensions. The pyramid is an approximation with level-dependent shape; near boundaries total impulse energy need not equal one because clamping repeats boundary texels.

## Production readiness

Choose a radius-to-level calibration against a reference blur, reduce idle pyramid allocation for separable modes, and specialize bounded kernels after measuring compilation versus draw cost.
