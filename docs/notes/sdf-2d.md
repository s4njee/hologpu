# Metaballs and Boolean shapes (`sdf-2d`)

## Question

Can analytic distance fields create smooth moving unions and crisp Boolean cuts without geometry?

## Technique summary

An orbiting circle and rounded box combine through minimum, maximum, subtraction, or polynomial smooth union. The pointer shifts the circle while a button is pressed. The signed distance passes through derivative-sized smoothstep coverage; optional isolines reveal the field outside the shape. The smooth union demonstrates a metaball-like merge of two analytic primitives.

## References

[Inigo Quilez: 2D distance functions](https://iquilezles.org/articles/distfunctions2d/)

[WGSL derivative built-ins](https://www.w3.org/TR/WGSL/#derivative-builtin-functions)

## Passes and resources

One fullscreen triangle writes premultiplied linear colour to an `rgba16float` target. A shared fullscreen resolve unpremultiplies, converts to sRGB, then premultiplies for the canvas. Each field owns the target, a 64-byte frame uniform, and an aligned parameter uniform. Shader modules, bind layouts and async pipelines use device-scoped reference-counted leases. At 512×320 the target is 1,310,720 logical bytes; test readback allocates a temporary SDR texture and padded staging buffer and frees both afterward. Destroy releases listeners, observers, buffers, target and leases; the last field closes the device session.

## WebGPU features used

Baseline fragment shaders, uniform buffers, float colour attachment, sampled texture loads and canvas presentation. No optional adapter features required. Manual texture loads avoid relying on float32 filtering. Reduced motion freezes at time zero. Without WebGPU, the playground displays the declared CSS fallback and retains the readable page.

## Parameters (generated)

<!-- params:start -->

| Parameter | Type  | Default        | Range / choices                             | Group    | Description                                 |
| --------- | ----- | -------------- | ------------------------------------------- | -------- | ------------------------------------------- |
| operation | enum  | "smooth-union" | smooth-union, union, intersection, subtract | Geometry | Combine a moving circle and rounded box.    |
| radius    | f32   | 0.22           | 0.05…0.45                                   | Geometry | Circle radius in normalized stage units.    |
| smoothing | f32   | 0.2            | 0.005…0.4                                   | Geometry | Smooth-union blend distance.                |
| speed     | f32   | 0.6            | 0…2                                         | Motion   | Orbit speed; the pointer shifts the circle. |
| contours  | bool  | true           | —                                           | Field    | Show distance isolines outside the surface. |
| tint      | color | "#8be5cf"      | —                                           | Palette  | Shape fill color.                           |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded 2026-10-07 on Apple M1 Max / macOS 26.6.2. Default parameters, seed 7, 512×320 physical pixels, DPR 1, resolution scale 1. Three runs; each discards 30 warm-up frames then measures 120 explicit encode/submit calls at fixed 1/60 s in rAF. CPU timings exclude GPU execution; rAF cadence is not a GPU timer. Device state and load are uncontrolled. Logical allocation sizes are not VRAM.

| Browser              | CPU mean ms (three runs) | rAF mean ms (three runs) | Record                               |
| -------------------- | ------------------------ | ------------------------ | ------------------------------------ |
| chrome 154.0.8037.98 | 0.152 / 0.157 / 0.170    | 16.666 / 16.666 / 16.666 | [JSON](../benchmarks/m1-chrome.json) |
| webkit 26.6          | 0.058 / 0.175 / 0.167    | 16.667 / 16.550 / 16.600 | [JSON](../benchmarks/m1-webkit.json) |

Shader compilation is excluded. Optional GPU timestamp queries are deferred to M3. The SwiftShader pixel tests verify repeatability and disposal at DPR 1 and 2, both presets, every enum mode, and no compilation warnings. Hardware engines use the same compile/readback/disposal tests without cross-device image comparison.

<!-- measurements:end -->

## Failure modes

Smooth union is no longer an exact distance everywhere. Boolean joins have derivative discontinuities; isolines are not antialiased independently and alias at small sizes. Fill alpha is opaque even when tint includes CSS alpha. Pointer offset occurs only with a pressed button.

## Production readiness

Add exact primitive/Boolean CPU reference probes, independent contour antialiasing, and a documented transparent-mask mode before using this as a UI mask.
