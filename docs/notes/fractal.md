# Julia / Mandelbrot explorer (`fractal`)

## Question

When does f32 lose deep-zoom detail, and what can paired f32 arithmetic preserve?

## Technique summary

Iterate z²+c for Julia or Mandelbrot sets, using a bailout magnitude of 16 and logarithmic smooth escape colouring in OKLCH. A switch selects ordinary f32 or a high/low pair with compensated addition and Dekker-style split multiplication. An integer exponent/mantissa reconstruction forces each intermediate to round to f32 before compensation; the multiplication split uses integer mantissa masking. Centre and residual are separate uniforms so the low coordinate is not rounded away before the GPU. At zoom 10⁶, neighbouring coordinates can collapse in the f32 path. Paired arithmetic is an experiment, not native f64 or a portable 48-bit guarantee.

## References

[T. J. Dekker: A floating-point technique for extending the available precision](https://doi.org/10.1007/BF01397083)

[Inigo Quilez: smooth Mandelbrot colouring](https://iquilezles.org/articles/mset_smooth/)

[WGSL: reassociation and fusion](https://www.w3.org/TR/WGSL/#reassociation-and-fusion)

## Passes and resources

One fullscreen triangle writes premultiplied linear colour to an `rgba16float` target. A shared fullscreen resolve unpremultiplies, converts to sRGB, then premultiplies for the canvas. Each field owns the target, a 64-byte frame uniform, and an aligned parameter uniform. Shader modules, bind layouts and async pipelines use device-scoped reference-counted leases. At 512×320 the target is 1,310,720 logical bytes; test readback allocates a temporary SDR texture and padded staging buffer and frees both afterward. Destroy releases listeners, observers, buffers, target and leases; the last field closes the device session.

## WebGPU features used

Baseline fragment shaders, uniform buffers, float colour attachment, sampled texture loads and canvas presentation. No optional adapter features required. Manual texture loads avoid relying on float32 filtering. Reduced motion freezes at time zero. Without WebGPU, the playground displays the declared CSS fallback and retains the readable page.

## Parameters (generated)

<!-- params:start -->

| Parameter  | Type | Default      | Range / choices    | Group     | Description                                                                  |
| ---------- | ---- | ------------ | ------------------ | --------- | ---------------------------------------------------------------------------- |
| fractalSet | enum | "mandelbrot" | mandelbrot, julia  | Algorithm | Escape-time complex map.                                                     |
| arithmetic | enum | "f32"        | f32, double-single | Algorithm | Double-single uses paired f32 arithmetic, not native f64.                    |
| center     | vec2 | [-0.5,0]     | -2…2               | View      | Complex-plane center. The low residual is supplied separately for deep zoom. |
| residual   | vec2 | [0,0]        | -0.0001…0.0001     | View      | Low component of the center in double-single mode.                           |
| zoom       | f32  | 1            | 0.5…1000000        | View      | Magnification; f32 eventually loses neighboring-pixel distinctions.          |
| iterations | u32  | 100          | 16…300             | Quality   | Maximum escape-time iterations.                                              |
| julia      | vec2 | [-0.8,0.156] | -1.5…1.5           | Algorithm | Complex constant for the Julia set.                                          |
| hue        | f32  | 0.4          | 0…6.28             | Palette   | OKLCH smooth-coloring hue offset.                                            |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded 2026-10-07 on Apple M1 Max / macOS 26.6.2. Default parameters, seed 7, 512×320 physical pixels, DPR 1, resolution scale 1. Three runs; each discards 30 warm-up frames then measures 120 explicit encode/submit calls at fixed 1/60 s in rAF. CPU timings exclude GPU execution; rAF cadence is not a GPU timer. Device state and load are uncontrolled. Logical allocation sizes are not VRAM.

| Browser              | CPU mean ms (three runs) | rAF mean ms (three runs) | Record                               |
| -------------------- | ------------------------ | ------------------------ | ------------------------------------ |
| chrome 154.0.8037.98 | 0.153 / 0.137 / 0.148    | 16.665 / 16.667 / 16.666 | [JSON](../benchmarks/m1-chrome.json) |
| webkit 26.6          | 0.067 / 0.175 / 0.208    | 16.550 / 16.625 / 16.692 | [JSON](../benchmarks/m1-webkit.json) |

Shader compilation is excluded. Optional GPU timestamp queries are deferred to M3. The SwiftShader pixel tests verify repeatability and disposal at DPR 1 and 2, both presets, every enum mode, and no compilation warnings. Hardware engines use the same compile/readback/disposal tests without cross-device image comparison.

<!-- measurements:end -->

## Failure modes

WGSL permits reassociation and fusion. The original algebraic compensation collapsed on Metal; explicit rounding barriers now preserve the residual. GPU probes check sub-ULP addition and multiplication, and 64 seeded bounded cases (including cancellation) compare raw compute-buffer results against CPU f64 within 10⁻¹⁰ absolute error. A separate 10,000-case development probe agreed across Chrome Metal, WebKit Apple and SwiftShader (maximum relative addition error 3.45×10⁻¹⁵, multiplication 7.14×10⁻¹⁵). These probes do not certify full fractal iteration error, extreme exponents, overflow or underflow behavior. Inputs must split a deep centre manually into Math.fround(center) and center−Math.fround(center). The 300-iteration cap can hide deep boundaries. No perturbation rendering, arbitrary precision, or fractal antialiasing is implemented.

## Production readiness

Compare escape counts and coordinate residuals against a CPU f64/arbitrary-precision reference across compilers. Establish a safe zoom range, expose automatic centre splitting, increase/adapt iteration budgets, and add perturbation rendering if deeper exploration is required.
