# Authored image section wipe (`section-wipe`)

This baseline T4 transition reveals a second authored image through a directional soft front, a still noise field, or the destination's linear luminance. Bind the source as `image` and the destination as `next`. No page pixels or View Transitions snapshots are captured. Missing `next` preserves the source. Progress 0 and 1 return the corresponding image exactly; intermediate pixels interpolate premultiplied linear RGBA, including alpha, without tinting the images. Reduced motion uses a hard cut: source below 0.5 and destination at or above 0.5.

```ts
import { attach } from '@mk7s/hologpu-dom';
import sectionWipe from '@mk7s/hologpu-effects/section-wipe';
const host = document.querySelector<HTMLDivElement>('.section-images')!;
const [source, next] = host.querySelectorAll('img');
await Promise.all([source!.decode(), next!.decode()]);
const layer = await attach(host, sectionWipe, { layer: 'front', playing: false });
await layer.field?.bindInput('image', source!);
await layer.field?.bindInput('next', next!);
host.style.setProperty('--hgpu-progress', '0.5');
```

Use an authored view timeline, JavaScript scroll mapping, or a range control to set `--hgpu-progress` from 0 to 1. This one-pass effect renders on changes and stays idle between updates; it has no automatic clock animation or simulation. Its only CSS-bound parameter is progress. Keep both images aligned to the same normalized content rectangle and aspect ratio; mismatched crops or `object-fit` letterboxing require author preprocessing. The `next` texture parameter can name a different input binding.

Directional mode defaults to a right-moving front (destination on the left), with down, left and up also available. Feather defaults to 0.06 of reveal threshold range; derivative antialiasing remains at feather 0. Noise uses a smooth value-noise field with eight cells across host height, adjusted for aspect ratio, and a stable seed. Time does not drift the field. Luminance mode reveals bright destination areas first, using straight linear RGB after unpremultiplying; transparent areas have no visible colour to reveal. The `editorial`, `dissolve` and `highlights` presets select these modes without altering image colours.

The DOM fallback should keep both real images and crossfade their CSS opacity using the same progress driver; switch opacity directly at 0.5 under reduced motion. Native images retain their alternative text. This recipe's fallback is author-owned because the effect cannot infer which of a host's DOM images is the destination. Hide both native visual layers while the complete GPU output is ready to avoid doubling translucent content, then restore their fallback opacities on loss or disposal. `imageFallback` suppresses the bundled fixture poster in attachments unless the caller supplies an explicit poster. The standalone catalogue still has a poster.

The effect caches its bind group and texture views while progress changes. It refreshes them when the selected image texture, mip or array layer changes, or the host resizes; in-place texture content uploads reuse the existing views. Changing the destination alias resolves the selected image before checking this cache. No measured speedup is claimed.

The effect owns no extra textures or buffers beyond its pipeline lease and the filter wrapper's default fixture. Bound media follow the core input ownership contract; caller canvases and textures remain borrowed, while static image uploads are cloned and managed by the core. Full resolution is recommended for small screenshots; 0.5 can suit larger pictures after inspection. Numerical tests cover exact endpoints, missing destination, analytical direction and luminance order, seed replay, convex premultiplied blending, reduced cuts, resized output, binding aliases and idle scheduling. Captured own-size and page measurements are recorded in [section 3.5 validation](../v2-transitions.md); strict performance acceptance remains open.

<!-- params:start -->

| Parameter  | Type    | Default       | Range / choices               | Group      | Description                                                                               |
| ---------- | ------- | ------------- | ----------------------------- | ---------- | ----------------------------------------------------------------------------------------- |
| next       | texture | "next"        | —                             | Images     | Destination image binding; an absent destination preserves the source.                    |
| progress   | f32     | 0             | 0…1                           | DOM        | Image transition progress: zero is source, one is destination.                            |
| mode       | enum    | "directional" | directional, noise, luminance | Transition | Directional soft wipe, deterministic noise threshold, or bright-first destination reveal. |
| direction  | enum    | "right"       | right, down, left, up         | Transition | Direction of the advancing front in directional mode.                                     |
| feather    | f32     | 0.06          | 0…0.25                        | Transition | Reveal feather half-width in normalized threshold units.                                  |
| noiseScale | f32     | 8             | 1…24                          | Noise      | Noise cells across host height; noise stays still as progress changes.                    |

<!-- params:end -->
