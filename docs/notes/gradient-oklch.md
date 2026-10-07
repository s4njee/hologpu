# OKLCH mesh gradient (`gradient-oklch`)

## Question

Can three moving colour stops remain perceptually balanced while avoiding SDR banding?

## Technique summary

Three orbiting centres produce normalized Gaussian weights. Stops enter as CSS colours decoded to linear sRGB, then convert to OKLab/OKLCH. Lightness and chroma use weighted averages; hue uses a circular average. Out-of-gamut RGB is clipped. Seeded static dither is applied at ±0.5 of an 8-bit display code value before returning to linear colour. Alpha interpolates separately. This is a smooth three-centre field, not a triangulated mesh.

## References

[Björn Ottosson: Oklab derivation and matrices](https://bottosson.github.io/posts/oklab/)

[CSS Color 4: OKLab and OKLCH](https://www.w3.org/TR/css-color-4/#ok-lab)

## Passes and resources

One fullscreen triangle writes premultiplied linear colour to an `rgba16float` target. A shared fullscreen resolve unpremultiplies, converts to sRGB, then premultiplies for the canvas. Each field owns the target, a 64-byte frame uniform, and an aligned parameter uniform. Shader modules, bind layouts and async pipelines use device-scoped reference-counted leases. At 512×320 the target is 1,310,720 logical bytes; test readback allocates a temporary SDR texture and padded staging buffer and frees both afterward. Destroy releases listeners, observers, buffers, target and leases; the last field closes the device session.

## WebGPU features used

Baseline fragment shaders, uniform buffers, float colour attachment, sampled texture loads and canvas presentation. No optional adapter features required. Manual texture loads avoid relying on float32 filtering. Reduced motion freezes at time zero. Without WebGPU, the playground displays the declared CSS fallback and retains the readable page.

## Parameters (generated)

<!-- params:start -->

| Parameter | Type  | Default   | Range / choices | Group   | Description                                      |
| --------- | ----- | --------- | --------------- | ------- | ------------------------------------------------ |
| first     | color | "#f071b4" | —               | Palette | First mesh stop, parsed to linear RGB.           |
| second    | color | "#476aff" | —               | Palette | Second mesh stop.                                |
| third     | color | "#ffbe66" | —               | Palette | Third mesh stop.                                 |
| spread    | f32   | 2.5       | 0.5…8           | Field   | Gaussian stop concentration.                     |
| speed     | f32   | 0.2       | 0…2             | Motion  | Orbital speed of the three mesh stops.           |
| dither    | bool  | true      | —               | Field   | One display-code-value dither to reduce banding. |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded 2026-10-07 on Apple M1 Max / macOS 26.6.2. Default parameters, seed 7, 512×320 physical pixels, DPR 1, resolution scale 1. Three runs; each discards 30 warm-up frames then measures 120 explicit encode/submit calls at fixed 1/60 s in rAF. CPU timings exclude GPU execution; rAF cadence is not a GPU timer. Device state and load are uncontrolled. Logical allocation sizes are not VRAM.

| Browser              | CPU mean ms (three runs) | rAF mean ms (three runs) | Record                               |
| -------------------- | ------------------------ | ------------------------ | ------------------------------------ |
| chrome 154.0.8037.98 | 0.157 / 0.161 / 0.157    | 16.666 / 16.667 / 16.666 | [JSON](../benchmarks/m1-chrome.json) |
| webkit 26.6          | 0.225 / 0.200 / 0.267    | 16.650 / 16.667 / 16.658 | [JSON](../benchmarks/m1-webkit.json) |

Shader compilation is excluded. Optional GPU timestamp queries are deferred to M3. The SwiftShader pixel tests verify repeatability and disposal at DPR 1 and 2, both presets, every enum mode, and no compilation warnings. Hardware engines use the same compile/readback/disposal tests without cross-device image comparison.

<!-- measurements:end -->

## Failure modes

Clipping can flatten saturated regions; circular hue averages can be unstable for opposite hues and give achromatic stops too much hue influence. Static white-noise dither can become visible when enlarged. CSS colours outside sRGB are converted through an sRGB Canvas2D and lose wide-gamut information.

## Production readiness

Compare chroma-weighted hue and perceptual gamut mapping, measure banding at different bit depths, and test transparency over real page backgrounds.
