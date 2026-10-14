# bright-pass

A T4 highlight extractor for screenshot glow. Selection uses unpremultiplied linear
Rec.709 luminance, not maximum RGB: a saturated red pixel and equally bright green
pixel can fall on opposite sides of the threshold. The default threshold is 0.65,
softness 0.1 and intensity 0.25. `softness: 0` selects values at or above the threshold
exactly. HDR input values above one remain HDR; extraction does not tone-map them.

The optional texture parameter/input named `mask` consumes canonical scalar coverage
from red. Bind the core mask descriptor to extract an author image's alpha, red or
luminance coverage, or to rasterize an SVG path. Missing masks are white. Coverage
multiplies the selected source colour and alpha together, preserving premultiplication.

```ts
const glowEffect = chain(brightPass, bloom);
const glow = await attach(screenshotWrapper, glowEffect, {
  layer: 'front',
  playing: false,
  resolutionScale: 0.5,
  params: {
    s0_threshold: 0.65,
    s0_softness: 0.1,
    s0_intensity: 0.25,
    s1_threshold: 0,
    s1_knee: 0,
    s1_strength: 0.3,
    s1_levels: 3,
  },
});
await glow.field!.bindInput('image', { kind: 'image', source: screenshotImage });
await glow.field!.bindInput('mask', { kind: 'mask', source: authorMask, channel: 'alpha' });
glow.canvas.style.mixBlendMode = 'screen';
```

The original screenshot remains in the light DOM. The first stage supplies the
selected colour to bloom; setting bloom's own threshold to zero avoids thresholding
the dimmed extraction again. A 600-pixel screenshot at half resolution is the intended
recipe, rather than a full-viewport glow. Keep both source and author mask aligned to
the same normalized crop. The mask is applied before bloom, so the halo may extend
beyond mask boundaries after blur. This is an extraction filter, not a final masked
compositor.

For a static mask, use an image or ImageBitmap. Canvas masks are mutable and their
coverage is extracted again whenever the filter renders; freezing a canvas into an
ImageBitmap avoids that repeated CPU work.

`--hgpu-threshold`, `--hgpu-intensity` and `--hgpu-tint` theme the standalone filter.
In a chain those names are prefixed `s0_`. The filter has no time-driven motion;
reduced motion keeps the same static image. DOM fallback preserves the authored image
with no fixture poster unless an explicit baked author poster is supplied. All colour
and texture sampling works with baseline WebGPU, including unfilterable HDR inputs.
