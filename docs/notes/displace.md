# Refraction from normal and flow maps (`displace`)

## Question

Can a filter consume another effect’s physical state or rendered colour without rebinding code?

## Technique summary

The map input is independent of the image. A texture-backed mapSource parameter selects its input binding name, defaulting to map; generated binding/sample helpers resolve the selection through the runtime. Normal encoding decodes premultiplied RG from [0,1] to [-1,1]; flow encoding reads signed RG values directly. Refraction samples the image at a scaled map offset. Liquid adds two travelling coordinate waves, ripple adds an exponentially damped radial wave around the pointer, and glass adds a blue-height finite-difference gradient. Displacement retains the fetched premultiplied RGBA rather than interpreting source colour as straight.

## References

[WebGPU sampled texture bindings](https://www.w3.org/TR/webgpu/#sampled-texture)

[GPU Gems: high-quality filtering](https://developer.nvidia.com/gpugems/gpugems/part-iv-image-processing/chapter-24-high-quality-filtering)

## Passes and resources

One fullscreen pass binds image and map as unfilterable float 2D views and samples both manually bilinear. The runtime can provide an RG32 physical flow tap or another effect’s RGBA16 output; mip and array selection are preserved by the binding view. Without a bound map, the image input also supplies the map; both use the private deterministic card when no inputs are supplied.

## WebGPU features used

Baseline render pipelines, sampled float texture loads, RGBA16 render targets and uniform buffers. No optional feature is required. Manual bilinear sampling also accepts RGBA32 data without `float32-filterable`. Inputs are borrowed from the runtime provider; destroy releases owned resources and pipeline leases. Reduced motion freezes at the declared pose; unavailable WebGPU uses the declared CSS fallback.

## Parameters (generated)

<!-- params:start -->

| Parameter | Type    | Default  | Range / choices                   | Group  | Description                                                                  |
| --------- | ------- | -------- | --------------------------------- | ------ | ---------------------------------------------------------------------------- |
| mapSource | texture | "map"    | —                                 | Map    | Input binding name for the normal or flow map.                               |
| mode      | enum    | "ripple" | refraction, liquid, ripple, glass | Filter | Map refraction plus optional liquid, radial ripple or height-gradient glass. |
| encoding  | enum    | "normal" | normal, flow                      | Filter | Normal RG is decoded from 0–1; flow RG is signed physical velocity.          |
| amount    | f32     | 0.035    | 0…0.2                             | Filter | Displacement amplitude in normalized image coordinates.                      |
| frequency | f32     | 25       | 1…80                              | Motion | Liquid/ripple angular spatial frequency.                                     |
| speed     | f32     | 2        | 0…10                              | Motion | Liquid/ripple angular speed in radians/s.                                    |
| decay     | f32     | 5        | 0…20                              | Motion | Radial ripple exponential falloff.                                           |
| glass     | f32     | 3        | 0…10                              | Glass  | Height-channel gradient multiplier.                                          |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded on the development Apple M1 Max / macOS 26.6.2 using the production preview. Defaults, seed 7, physical 512² display, DPR 1 and fixed resolution/work quality. Each of three runs discards 30 warm-up updates then measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion and timestamp readback. Filter defaults use their owned deterministic linear HDR test card; lighting uses its documented scene and grid.

| Browser              | CPU mean ms           | Completion p95 ms     | Summed GPU pass p95 ms | rAF median ms            | Record                               |
| -------------------- | --------------------- | --------------------- | ---------------------- | ------------------------ | ------------------------------------ |
| chrome 154.0.8037.98 | 0.247 / 0.251 / 0.297 | 3.000 / 3.100 / 3.200 | 0.459 / 0.459 / 0.393  | 16.700 / 16.700 / 16.700 | [JSON](../benchmarks/m4-chrome.json) |
| webkit 26.6          | 0.275 / 0.317 / 0.275 | 5.000 / 5.000 / 5.000 | 0.966 / 0.398 / 1.030  | 17.000 / 17.000 / 17.000 | [JSON](../benchmarks/m4-webkit.json) |

CPU encode, queue-completion wall latency and rAF cadence measure different boundaries. GPU columns are sums of actual pass timestamps when supported; quantization and overlapping intervals can make their sum exceed completion latency. They are a diagnostic rather than whole-frame elapsed time. Initialization and compilation are excluded, machine load is uncontrolled, and allocation sizes are logical rather than VRAM. The separate [M4 video-chain gate](../m4.md) uses a genuinely decoded 1920×1080 clip, four filters and full-size intermediates, with a measured idle-refresh baseline. Small software snapshots and CPU-reference hardware tests verify numerical/lifecycle properties separately from speed.

<!-- measurements:end -->

## Failure modes

Normal and signed-flow maps both produce the expected one-texel displacement against a CPU ramp, and zero amplitude is an identity operation. The encoding is explicit because signed physical velocity and normalized colour are not interchangeable. Clamp sampling stretches boundaries; this is screen-space distortion without geometry thickness or Snell-law ray tracing.

## Production readiness

Offer border modes, physically meaningful map units and depth/thickness inputs, then measure distortion from a live solver versus pre-recorded video.
