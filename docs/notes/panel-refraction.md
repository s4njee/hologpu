# Panel refraction

A frosted card samples another HoloGPU field's premultiplied linear output. It cannot refract arbitrary DOM content: no HTML capture, screenshot, or experimental browser flag is involved. The demo places three draggable cards over an `aurora-veil` hero.

Attach the panel behind the card's real text and controls, then call `await panel.bindBackdrop(hero)`, where `hero` is an attachment or an `EffectField` on the same device. The attachment updates `sourceRect` from the card's border box and hero canvas viewport bounds before each frame, so scrolling, dragging and resizing keep the borrowed hero aligned. Reduced motion uses the hero's frozen pose; the panel adds no time-dependent motion.

```ts
const hero = await attach(heroHost, auroraVeil);
const panel = await attach(cardHost, panelRefraction, { layer: 'behind' });
await panel.bindBackdrop(hero);
```

For direct runtime use, bind the hero field to `image` and supply `sourceRect: [x, y, width, height]` normalized to the hero canvas. This rect maps the card's local UV into the hero, while `rect` locates the card within its own canvas. All radii, blur, rim and refraction distances use CSS pixels. Per-corner `radiiX` and `radiiY` support elliptical CSS border radii; negative vectors select the scalar `radius`.

The baseline T4 pass uses at most five bilinear samples, a rounded-card SDF normal, bounded rim displacement and a thin specular edge. `blur: 0`, `refraction: 0`, `intensity: 0` provide an exact aligned sample inside the card mask. `--hgpu-brand` and `--hgpu-intensity` control the quiet tint and edge; default intensity is 0.22. Blur and refraction remain independently adjustable.

The pass borrows the source texture and allocates no intermediate render targets. The standalone catalogue fixture occupies 64 KiB and the filter scaffold owns it. Destroying the panel releases its resources without destroying the hero. Production fallback uses CSS `backdrop-filter: blur()` on the card while preserving real DOM content; the generated poster serves standalone previews.

## Parameters (generated)

<!-- params:start -->

| Parameter  | Type  | Default               | Range / choices | Group    | Description                                                                                     |
| ---------- | ----- | --------------------- | --------------- | -------- | ----------------------------------------------------------------------------------------------- |
| rect       | vec4  | [0.12,0.18,0.76,0.64] | 0…1             | Geometry | Local normalized border box: left, top, width, height.                                          |
| radius     | f32   | 24                    | 0…200           | Geometry | Legacy rounded corner radius in CSS pixels.                                                     |
| radiiX     | vec4  | [-1,-1,-1,-1]         | -1…4096         | Geometry | Horizontal CSS corner radii: top-left, top-right, bottom-right, bottom-left; -1 retains radius. |
| radiiY     | vec4  | [-1,-1,-1,-1]         | -1…4096         | Geometry | Vertical CSS corner radii: top-left, top-right, bottom-right, bottom-left; -1 retains radius.   |
| sourceRect | vec4  | [0,0,1,1]             | —               | Source   | Normalized hero xywh sampled by the card; bindBackdrop updates this from layout.                |
| refraction | f32   | 2                     | 0…8             | Glass    | Maximum rim displacement in CSS pixels.                                                         |
| blur       | f32   | 2                     | 0…8             | Glass    | Five-tap cross blur radius in CSS pixels.                                                       |
| rim        | f32   | 18                    | 1…64            | Glass    | Depth of the refracted rim in CSS pixels.                                                       |
| edge       | f32   | 0.8                   | 0.25…3          | Glass    | Thin specular edge width in CSS pixels.                                                         |
| intensity  | f32   | 0.22                  | 0…1             | Glass    | Brand tint and specular edge strength.                                                          |
| brand      | color | "#e4edff"             | —               | Palette  | Quiet brand tint and edge colour, parsed to linear RGB.                                         |

<!-- params:end -->
