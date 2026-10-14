# Soft aurora veil (`aurora-veil`)

## Technique

One T1 fragment pass uses two-octave value-noise fBm from the shared noise chunk, warped by two additional noise channels. The field bends three wide, softly overlapping bands. Colour stops interpolate in OKLCH with chroma-weighted circular hue; a flat base keeps contrast low. Static display-code-value dither reduces SDR banding. There are no optional WebGPU features or persistent simulation resources.

## Launch-page use

Use `resolutionScale: 0.25` on a hero background: bilinear upscaling softens the wash and cuts the pixel workload to one sixteenth. The quality range allows 0.25–1. Default intensity is 0.22 and drift is 0.035 noise units per second. Reduced motion freezes the finished time-zero composition. Pointer bias defaults to zero and can shift the field by at most ±2%; the design works without hover.

All four colours and intensity support CSS custom properties (`--hgpu-base`, `--hgpu-first`, `--hgpu-second`, `--hgpu-third`, `--hgpu-intensity`). The `ember`, `dusk`, `lagoon`, and `paper` brand palettes are also available in [brand-presets.json](../../packages/effects/src/aurora-veil/brand-presets.json). Ember also ships a generated preset poster. Generate a settled poster with the repository poster script when attaching the effect to a real page. The declared CSS fallback uses the default stops mixed against the default base in linear sRGB; it preserves the palette and contrast, while approximating the warped geometry.

## Limitations and validation

CSS colours are converted through the runtime's sRGB colour parser; this does not provide wide-gamut output. Saturated custom stops can clip, and large upscaling magnifies static dither. The declared CSS fallback is fixed to the default palette; generate a poster or corresponding CSS gradient for custom palettes. Performance gates require browser measurements at 1440×900 CSS pixels, DPR 1 and scale 0.25; no hardware budget claim is made here.

## Parameters (generated)

<!-- params:start -->

| Parameter   | Type  | Default   | Range / choices | Group   | Description                                                |
| ----------- | ----- | --------- | --------------- | ------- | ---------------------------------------------------------- |
| base        | color | "#11121b" | —               | Palette | Flat background colour.                                    |
| first       | color | "#747499" | —               | Palette | First low-saturation aurora stop.                          |
| second      | color | "#598f92" | —               | Palette | Second aurora stop.                                        |
| third       | color | "#9d738b" | —               | Palette | Third aurora stop.                                         |
| intensity   | f32   | 0.22      | 0…1             | Field   | Band contrast against the base colour.                     |
| scale       | f32   | 1.8       | 0.5…4           | Field   | Frequency of the soft domain-warped field.                 |
| speed       | f32   | 0.035     | 0…0.2           | Motion  | Slow field drift in noise units per second.                |
| pointerBias | f32   | 0         | 0…0.02          | Motion  | Optional pointer offset, at most two percent of the field. |
| dither      | bool  | true      | —               | Field   | Static one-code-value SDR dither.                          |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

No hardware measurements recorded yet.
<!-- measurements:end -->
