# Moving Voronoi cells (`voronoi`)

## Question

How do distance metrics change moving cellular boundaries?

## Technique summary

A seeded hash selects one animated point per lattice cell. A 5×5 neighbourhood finds the nearest two points under Euclidean, Manhattan, or Chebyshev distance. Their distance gap creates a border; site identity chooses an OKLCH hue. Points remain inside their cells. The gap is a visual boundary proxy rather than an exact signed distance to the Voronoi edge.

## References

[Steven Worley: A Cellular Texture Basis Function (SIGGRAPH 1996)](https://doi.org/10.1145/237170.237267)

## Passes and resources

One fullscreen triangle writes premultiplied linear colour to an `rgba16float` target. A shared fullscreen resolve unpremultiplies, converts to sRGB, then premultiplies for the canvas. Each field owns the target, a 64-byte frame uniform, and an aligned parameter uniform. Shader modules, bind layouts and async pipelines use device-scoped reference-counted leases. At 512×320 the target is 1,310,720 logical bytes; test readback allocates a temporary SDR texture and padded staging buffer and frees both afterward. Destroy releases listeners, observers, buffers, target and leases; the last field closes the device session.

## WebGPU features used

Baseline fragment shaders, uniform buffers, float colour attachment, sampled texture loads and canvas presentation. No optional adapter features required. Manual texture loads avoid relying on float32 filtering. Reduced motion freezes at time zero. Without WebGPU, the playground displays the declared CSS fallback and retains the readable page.

## Parameters (generated)

<!-- params:start -->

| Parameter | Type | Default     | Range / choices                 | Group     | Description                                                             |
| --------- | ---- | ----------- | ------------------------------- | --------- | ----------------------------------------------------------------------- |
| metric    | enum | "euclidean" | euclidean, manhattan, chebyshev | Algorithm | Distance metric used to select the nearest site.                        |
| scale     | f32  | 8           | 2…24                            | Field     | Cell density along the short stage dimension.                           |
| speed     | f32  | 0.5         | 0…2                             | Motion    | Site oscillation speed.                                                 |
| border    | f32  | 0.07        | 0…0.3                           | Field     | Second-nearest distance-gap threshold; a decorative approximate border. |
| chroma    | f32  | 0.12        | 0…0.25                          | Palette   | Cell OKLCH chroma.                                                      |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded 2026-10-07 on Apple M1 Max / macOS 26.6.2. Default parameters, seed 7, 512×320 physical pixels, DPR 1, resolution scale 1. Three runs; each discards 30 warm-up frames then measures 120 explicit encode/submit calls at fixed 1/60 s in rAF. CPU timings exclude GPU execution; rAF cadence is not a GPU timer. Device state and load are uncontrolled. Logical allocation sizes are not VRAM.

| Browser              | CPU mean ms (three runs) | rAF mean ms (three runs) | Record                               |
| -------------------- | ------------------------ | ------------------------ | ------------------------------------ |
| chrome 154.0.8037.98 | 0.143 / 0.173 / 0.152    | 16.667 / 16.666 / 16.666 | [JSON](../benchmarks/m1-chrome.json) |
| webkit 26.6          | 0.258 / 0.275 / 0.192    | 16.700 / 16.667 / 16.667 | [JSON](../benchmarks/m1-webkit.json) |

Shader compilation is excluded. Optional GPU timestamp queries are deferred to M3. The SwiftShader pixel tests verify repeatability and disposal at DPR 1 and 2, both presets, every enum mode, and no compilation warnings. Hardware engines use the same compile/readback/disposal tests without cross-device image comparison.

<!-- measurements:end -->

## Failure modes

Different metrics create sharp corners and temporal identity changes. Border width varies with site spacing because F2−F1 is not exact edge distance. Large cell coordinates lose precision. High density can alias at small resolution scales.

## Production readiness

Compare exact edge distance, derivative-based border coverage, neighbourhood completeness with a CPU search, and stability of animated nearest-site identity.
