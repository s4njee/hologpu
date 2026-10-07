# HDR pyramid bloom (`bloom`)

## Question

Can a chain preserve HDR energy until tone mapping and expose each bloom level?

## Technique summary

A soft-knee brightness threshold extracts premultiplied linear HDR highlights. Successive half-size textures use weighted downsampling. Reconstruction upsamples from the coarsest level and adds the corresponding extraction level at each resolution. A final composite adds intensity-scaled RGB glow to the original image. Alpha is the maximum of base alpha and bounded glow coverage, so a highlight can spread beyond a transparent silhouette.

## References

[GPU Gems: real-time glow](https://developer.nvidia.com/gpugems/gpugems/part-iv-image-processing/chapter-21-real-time-glow)

## Passes and resources

Threshold and composite are full-size passes; one to six actual downsample and corresponding upsample levels use RGBA16 targets. Levels are separate owned textures rather than subresources of a single mip texture, permitting independent read/write passes. Four pipelines each own a 16-byte immutable settings buffer. The private fallback includes values above one to make the threshold visible.

## WebGPU features used

Baseline render pipelines, sampled float texture loads, RGBA16 render targets and uniform buffers. No optional feature is required. Manual bilinear sampling also accepts RGBA32 data without `float32-filterable`. Inputs are borrowed from the runtime provider; destroy releases owned resources and pipeline leases. Reduced motion freezes at the declared pose; unavailable WebGPU uses the declared CSS fallback.

## Parameters (generated)

<!-- params:start -->

| Parameter | Type | Default | Range / choices | Group      | Description                                      |
| --------- | ---- | ------- | --------------- | ---------- | ------------------------------------------------ |
| threshold | f32  | 1       | 0…4             | Extraction | Linear HDR brightness threshold.                 |
| knee      | f32  | 0.3     | 0…1             | Extraction | Smooth transition half-width around threshold.   |
| strength  | f32  | 0.35    | 0…2             | Composite  | Additive intensity of reconstructed glow.        |
| levels    | u32  | 4       | 1…6             | Pyramid    | Downsample levels accumulated during upsampling. |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded on the development Apple M1 Max / macOS 26.6.2 using the production preview. Defaults, seed 7, physical 512² display, DPR 1 and fixed resolution/work quality. Each of three runs discards 30 warm-up updates then measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion and timestamp readback. Filter defaults use their owned deterministic linear HDR test card; lighting uses its documented scene and grid.

| Browser              | CPU mean ms           | Completion p95 ms     | Summed GPU pass p95 ms | rAF median ms            | Record                               |
| -------------------- | --------------------- | --------------------- | ---------------------- | ------------------------ | ------------------------------------ |
| chrome 154.0.8037.98 | 0.377 / 0.343 / 0.434 | 4.200 / 5.400 / 6.400 | 1.966 / 2.818 / 2.753  | 16.700 / 16.700 / 16.700 | [JSON](../benchmarks/m4-chrome.json) |
| webkit 26.6          | 0.550 / 0.450 / 0.358 | 6.000 / 7.000 / 6.000 | 3.672 / 2.892 / 7.379  | 17.000 / 17.000 / 17.000 | [JSON](../benchmarks/m4-webkit.json) |

CPU encode, queue-completion wall latency and rAF cadence measure different boundaries. GPU columns are sums of actual pass timestamps when supported; quantization and overlapping intervals can make their sum exceed completion latency. They are a diagnostic rather than whole-frame elapsed time. Initialization and compilation are excluded, machine load is uncontrolled, and allocation sizes are logical rather than VRAM. The separate [M4 video-chain gate](../m4.md) uses a genuinely decoded 1920×1080 clip, four filters and full-size intermediates, with a measured idle-refresh baseline. Small software snapshots and CPU-reference hardware tests verify numerical/lifecycle properties separately from speed.

<!-- measurements:end -->

## Failure modes

Dim constant fields below the threshold are unchanged; zero strength is an identity composite. An isolated HDR impulse produces nonzero adjacent pixels through the down/up pyramid. Each level is inspectable. Intensity depends on pyramid depth because reconstruction accumulates levels; this is an artistic bloom, not a radiometrically normalized scattering model.

## Production readiness

Add threshold anti-flicker filtering and level-normalized reconstruction. Test HDR presentation separately from internal float precision; the normal canvas resolve remains SDR.
