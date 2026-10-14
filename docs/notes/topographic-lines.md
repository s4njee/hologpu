# Quiet topographic contours (`topographic-lines`)

## Technique

One T1 fragment pass evaluates a two-octave value-noise height field and draws isolines with `fract` and derivative antialiasing. Both stroke edges are integrated over a derivative pixel footprint, so subpixel lines fade with their coverage rather than keeping full brightness. Height amplitude is limited to 0.2 times the terrain wavelength: the bounded value-noise slope stays below one, so the height interval also supplies a lower bound on adjacent-line separation. `spacing` is clamped to at least 12 CSS pixels to control moiré. No textures, feedback, or optional WebGPU features are required.

## Launch-page use

Use `resolutionScale: 1` for crisp one-CSS-pixel strokes; 0.5 is available when a softer result fits the page. Wavelength, spacing and stroke width are in CSS pixels, using the render resolution divided by its effective DPR. Stroke coverage uses derivatives of the height field, so DPR changes preserve the intended width. The default intensity is 0.15, with `atlas`, `paper`, and `sparse` presets. All colours, intensity, and weight support CSS tokens.

The time-zero height field is the settled reduced-motion pose. For a no-WebGPU path, attach a generated poster of that pose. The declared flat CSS colour is only a last-resort background; it does not reproduce contours.

## Limitations and validation

Near height extrema contours curve tightly, and a local derivative is only a first-order estimate of stroke distance. Rendering at 0.5 scale softens thin lines; large upscaling should be avoided. The runtime reports effective render DPR, including `resolutionScale`, which keeps CSS sizing stable as quality changes. Colours use the runtime's sRGB parser. Browser snapshot and page-budget measurements remain the integration gates; no hardware budget claim is made here.

## Parameters (generated)

<!-- params:start -->

| Parameter | Type  | Default   | Range / choices | Group   | Description                                                                                |
| --------- | ----- | --------- | --------------- | ------- | ------------------------------------------------------------------------------------------ |
| base      | color | "#111b21" | —               | Palette | Flat background colour between contours.                                                   |
| tint      | color | "#a8c4bd" | —               | Palette | Contour line colour.                                                                       |
| intensity | f32   | 0.15      | 0…1             | Field   | Contour contrast against the base colour.                                                  |
| spacing   | f32   | 24        | 12…96           | Field   | Height interval in CSS pixels; terrain slopes keep adjacent lines at least this far apart. |
| weight    | f32   | 1         | 0.5…3           | Field   | Contour stroke width in CSS pixels.                                                        |
| scale     | f32   | 360       | 160…720         | Field   | Base terrain wavelength in CSS pixels.                                                     |
| speed     | f32   | 0.012     | 0…0.1           | Motion  | Slow terrain translation in noise units per second.                                        |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

No hardware measurements recorded yet.
<!-- measurements:end -->
