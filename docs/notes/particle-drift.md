# particle-drift

A local T3 overlay of 256–2048 Gaussian dust quads. The default is 512 records,
4 CSS-pixel nominal diameter and 0.18 intensity, with warm ember, pearl and rose
presets. Its default resolution scale is 0.5: the bilinear upscale softly
blends the small Gaussian sprites while reducing the draw and resolve area.
Explicit `resolutionScale: 1` remains available. Effective DPR retains every
geometry and interaction measurement in CSS pixels at either scale.
`--hgpu-tint` and `--hgpu-intensity` drive the brand appearance. Dust has
no meaning; keep the native page content in the light DOM.

The particle scaffold supplies one 16-byte storage record per mote and an
additive instanced-quad draw. A compact compute pass writes UV centre, opacity
weight and diameter scale. There are no feedback textures, trails, HDR histories,
spatial hashes or optional GPU features. Particle records use 8 KiB at the
default count and at most 32 KiB, plus a 16-byte phase uniform; display resolution
does not increase particle state. Changing count reallocates only this buffer.

Motion follows seeded bounded orbits within six CSS pixels of each mote's
anchor. Pointer repulsion has a quadratic falloff in CSS pixels and moves a mote
by at most 32 CSS pixels, with a 12-pixel default. Pixels, rather than UV radii,
keep the treatment consistent across aspect ratios, DPR and resolution scale.
The doubled and single orbital rates are periodic; JavaScript reduces the
phase in double precision before uploading its f32 uniform, so an all-day tab
does not accumulate trajectory or clock error. Explicit `drawAt(time, seed)`
poses are deterministic and reversible. A pointer outside normalized [0,1]
coordinates disables repulsion for direct callers.

Reduced motion writes the exact seeded scatter, ignores pointer and time, and
retains it. No steady animation submits while paused or reduced. Genuine pointer
and parameter events can request a redraw through the shared field API; the
reduced pose remains pixel-identical, and its record compute pass is cached.
There is no continuous simulation to keep alive after a field stops playing.
The bundled generated poster is this settled scatter over transparency.

Use one stateful field per page and attach it to an element. Start paused, play
on hover, and stop after a brief pointer-exit interval. Touch and keyboard users
get the same finished seeded scatter. An explicit play control can opt into
continuous slow motion. This effect does not install its own interaction clock
or DOM listeners; `playing: false`, `play()`, `pause()` and the existing field
pointer adapter define its lifecycle.

```ts
const dust = await attach(heroDecoration, particleDrift, {
  layer: 'front',
  playing: false,
  preset: 'ember',
});
heroDecoration.addEventListener('pointerenter', () => dust.play());
heroDecoration.addEventListener('pointerleave', () => dust.pause());
```

A premultiplied Gaussian sprite tapers smoothly to zero at its quad edge. RGB
uses additive blending; alpha uses source-over coverage, so empty pixels stay
transparent and overlapping motes do not replace earlier coverage. Opacity is
normalized above 512 records to keep a density increase from also increasing
the page's light level. Each draw clears the transparent layer; prior positions
leave no trails. Keep the default low intensity so particles support the copy.

Browser tests compare storage against the CPU hash, check radial pointer
falloff and CSS-pixel bounds, replay long-running clocks, verify exact reduced
pixels, count/resize ownership and disposal, and ensure an idle field submits no
new work. Page benchmarks and browser results are recorded in the section 3.6
validation document.

## Parameters (generated)

<!-- params:start -->

| Parameter | Type  | Default   | Range / choices | Group       | Description                                                                  |
| --------- | ----- | --------- | --------------- | ----------- | ---------------------------------------------------------------------------- |
| count     | u32   | 512       | 256…2048        | Particles   | Bounded dust record count; one particle field per launch page.               |
| size      | f32   | 4         | 0.5…12          | Geometry    | Gaussian quad diameter in CSS pixels.                                        |
| intensity | f32   | 0.18      | 0…1             | Light       | Low additive opacity, normalized above 512 records.                          |
| tint      | color | "#ffd8ae" | —               | Palette     | Brand dust colour; alpha scales the opacity.                                 |
| speed     | f32   | 0.035     | 0…0.15          | Motion      | Slow orbital phase in radians per second; drift stays within six CSS pixels. |
| radius    | f32   | 120       | 24…240          | Interaction | Pointer falloff radius in CSS pixels.                                        |
| repulsion | f32   | 12        | 0…32            | Interaction | Maximum gentle pointer displacement in CSS pixels.                           |

<!-- params:end -->
