# Noise laboratory (`noise-lab`)

## Question

How do interpolation, lattice geometry, cellular distance, curl, octaves, and domain warp change a procedural field?

## Technique summary

Value noise uses quintic interpolation of hashed scalar lattice values. Gradient noise interpolates dot products with hashed unit directions. Simplex noise skews into a triangular lattice with compact radial weights. Worley uses nearest-site distance. Curl takes centred finite differences of a scalar simplex potential; the preview shows its vector magnitude. A normalized, bounded eight-octave sum applies a 2.03 frequency multiplier. Two simplex channels warp the domain before the sum. These are compact seeded implementations rather than permutation-table reference ports.

## References

[Stefan Gustavson: Simplex noise demystified](https://itn-web.it.liu.se/~stegu76/TNM084-2019/simplexnoise.pdf)

[Bridson, Hourihan, Nordenstam: Curl-Noise for Procedural Fluid Flow](https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph2007-curlnoise.pdf)

## Passes and resources

One fullscreen triangle writes premultiplied linear colour to an `rgba16float` target. A shared fullscreen resolve unpremultiplies, converts to sRGB, then premultiplies for the canvas. Each field owns the target, a 64-byte frame uniform, and an aligned parameter uniform. Shader modules, bind layouts and async pipelines use device-scoped reference-counted leases. At 512×320 the target is 1,310,720 logical bytes; test readback allocates a temporary SDR texture and padded staging buffer and frees both afterward. Destroy releases listeners, observers, buffers, target and leases; the last field closes the device session.

## WebGPU features used

Baseline fragment shaders, uniform buffers, float colour attachment, sampled texture loads and canvas presentation. No optional adapter features required. Manual texture loads avoid relying on float32 filtering. Reduced motion freezes at time zero. Without WebGPU, the playground displays the declared CSS fallback and retains the readable page.

## Parameters (generated)

<!-- params:start -->

| Parameter | Type  | Default   | Range / choices                        | Group     | Description                                       |
| --------- | ----- | --------- | -------------------------------------- | --------- | ------------------------------------------------- |
| kind      | enum  | "simplex" | value, gradient, simplex, worley, curl | Algorithm | Underlying field; curl displays vector magnitude. |
| scale     | f32   | 5         | 1…32                                   | Field     | Base spatial frequency.                           |
| octaves   | u32   | 4         | 1…8                                    | Algorithm | Normalized fractal noise octave count.            |
| warp      | f32   | 1.5       | 0…5                                    | Field     | Domain displacement from two seeded noise fields. |
| speed     | f32   | 0.15      | 0…1                                    | Motion    | Time-driven translation through the field.        |
| low       | color | "#17183c" | —                                      | Palette   | Low-value linear color.                           |
| high      | color | "#e6b88d" | —                                      | Palette   | High-value linear color.                          |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded 2026-10-07 on Apple M1 Max / macOS 26.6.2. Default parameters, seed 7, 512×320 physical pixels, DPR 1, resolution scale 1. Three runs; each discards 30 warm-up frames then measures 120 explicit encode/submit calls at fixed 1/60 s in rAF. CPU timings exclude GPU execution; rAF cadence is not a GPU timer. Device state and load are uncontrolled. Logical allocation sizes are not VRAM.

| Browser              | CPU mean ms (three runs) | rAF mean ms (three runs) | Record                               |
| -------------------- | ------------------------ | ------------------------ | ------------------------------------ |
| chrome 154.0.8037.98 | 0.135 / 0.169 / 0.152    | 16.666 / 16.666 / 16.666 | [JSON](../benchmarks/m1-chrome.json) |
| webkit 26.6          | 0.133 / 0.175 / 0.125    | 16.650 / 16.700 / 16.633 | [JSON](../benchmarks/m1-webkit.json) |

Shader compilation is excluded. Optional GPU timestamp queries are deferred to M3. The SwiftShader pixel tests verify repeatability and disposal at DPR 1 and 2, both presets, every enum mode, and no compilation warnings. Hardware engines use the same compile/readback/disposal tests without cross-device image comparison.

<!-- measurements:end -->

## Failure modes

High frequencies alias without footprint filtering. Curl magnitude hides vector direction and clamps large derivatives. Finite differences depend on epsilon. The noise chunk uses a 3×3 Worley search, which is a bounded approximation for arbitrary site placement; the animated Voronoi effect uses 5×5. Large coordinates eventually lose f32 lattice precision.

## Production readiness

Add footprint-aware octave attenuation, analytic simplex derivatives, vector-field visualization and numerical/statistical reference probes before using this as a simulation velocity field.
