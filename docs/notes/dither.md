# Dither, palette and CRT (`dither`)

## Question

Can generated noise reduce banding while preserving average binary brightness?

## Technique summary

Bayer uses a fixed 4×4 ordered threshold matrix. Blue-noise mode uploads a deterministic 32² toroidal void/cluster ranking: relax a seeded minority mask under a Gaussian neighbourhood energy, rank cluster removals below the seed density and void insertions above it. Palette mode samples four evenly spaced colours from a baked gradient and chooses nearest linear RGB. CRT mode combines per-channel quantization with horizontal scanlines and a repeating RGB phosphor mask.

## References

[Christoph Peters: void/cluster blue noise](https://momentsingraphics.de/BlueNoise.html)

## Passes and resources

One fullscreen pass binds the image, a 1,024-byte R8 noise texture and the generated paletteGradient LUT. Void/cluster generation occurs once per effect instance during setup and is excluded from steady-state rendering. Both the noise tile and palette source can be inspected through the input/Passes layer.

## WebGPU features used

Baseline render pipelines, sampled float texture loads, RGBA16 render targets and uniform buffers. No optional feature is required. Manual bilinear sampling also accepts RGBA32 data without `float32-filterable`. Inputs are borrowed from the runtime provider; destroy releases owned resources and pipeline leases. Reduced motion freezes at the declared pose; unavailable WebGPU uses the declared CSS fallback.

## Parameters (generated)

<!-- params:start -->

| Parameter       | Type     | Default                                                                                                                                                         | Range / choices                 | Group        | Description                                                                 |
| --------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------ | --------------------------------------------------------------------------- |
| mode            | enum     | "blue-noise"                                                                                                                                                    | bayer, blue-noise, palette, crt | Filter       | Ordered 4×4 Bayer, void/cluster tile, nearest palette or scanline/mask CRT. |
| levels          | u32      | 6                                                                                                                                                               | 2…32                            | Quantisation | Per-channel quantization levels.                                            |
| amount          | f32      | 1                                                                                                                                                               | 0…2                             | Quantisation | Threshold dither amplitude.                                                 |
| scanline        | f32      | 0.3                                                                                                                                                             | 0…1                             | CRT          | CRT horizontal scanline attenuation.                                        |
| paletteGradient | gradient | [{"offset":0,"color":"#16233a"},{"offset":0.3333333333333333,"color":"#7d647d"},{"offset":0.6666666666666666,"color":"#efcea1"},{"offset":1,"color":"#619bb2"}] | —                               | Palette      | Baked linear palette sampled at four evenly spaced positions.               |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded on the development Apple M1 Max / macOS 26.6.2 using the production preview. Defaults, seed 7, physical 512² display, DPR 1 and fixed resolution/work quality. Each of three runs discards 30 warm-up updates then measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion and timestamp readback. Filter defaults use their owned deterministic linear HDR test card; lighting uses its documented scene and grid.

| Browser              | CPU mean ms           | Completion p95 ms     | Summed GPU pass p95 ms | rAF median ms            | Record                               |
| -------------------- | --------------------- | --------------------- | ---------------------- | ------------------------ | ------------------------------------ |
| chrome 154.0.8037.98 | 0.278 / 0.243 / 0.320 | 2.900 / 3.300 / 3.300 | 0.328 / 0.393 / 0.328  | 16.700 / 16.700 / 16.700 | [JSON](../benchmarks/m4-chrome.json) |
| webkit 26.6          | 0.292 / 0.308 / 0.292 | 5.000 / 6.000 / 4.000 | 0.593 / 1.667 / 1.075  | 17.000 / 17.000 / 17.000 | [JSON](../benchmarks/m4-webkit.json) |

CPU encode, queue-completion wall latency and rAF cadence measure different boundaries. GPU columns are sums of actual pass timestamps when supported; quantization and overlapping intervals can make their sum exceed completion latency. They are a diagnostic rather than whole-frame elapsed time. Initialization and compilation are excluded, machine load is uncontrolled, and allocation sizes are logical rather than VRAM. The separate [M4 video-chain gate](../m4.md) uses a genuinely decoded 1920×1080 clip, four filters and full-size intermediates, with a measured idle-refresh baseline. Small software snapshots and CPU-reference hardware tests verify numerical/lifecycle properties separately from speed.

<!-- measurements:end -->

## Failure modes

The noise tile histogram has exactly four occurrences of each byte and its half-density binary mask suppresses low spatial-frequency energy against seeded white noise. GPU Bayer/blue-noise dithering preserves the mean of a uniform 0.5 field under binary quantization. The 32-pixel tile can repeat visibly at large scale; nearest RGB palette distance is not perceptual.

## Production readiness

Compare perceptual palette distances and temporal noise families, increase tile size only after checking setup cost, and add measured output-space dithering when display-code quantization is the intended target.
