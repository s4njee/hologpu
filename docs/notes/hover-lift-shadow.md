# hover-lift-shadow

A T1 Gaussian contact shadow outside a rounded card. The default tint is blue-grey at
0.2 intensity. `elevation` is a CSS-driven 0…1 value: it spreads the shadow and moves
its centre down by 3…15 CSS pixels. There is no time-driven motion; reduced motion
keeps the same finished pose. Unchanged frames submit no GPU work.

Attach behind the card with `padding: 32` for the default pose. Higher elevation may
need `padding: 48` to include the soft tail. A canvas confined to the border box clips
the exterior shadow. The DOM adapter supplies the host border-box rectangle and all
four elliptical corner radii inside the padded canvas. Standalone fields may author
`rect`, `radius`, `radiiX` and `radiiY` themselves; distances, blur and AA use CSS pixels
and stay stable across DPR and resolution scale.

```ts
await attach(card, hoverLiftShadow, { layer: 'behind', padding: 32 });
```

```css
.card {
  --hgpu-elevation: 0.15;
  transition: --hgpu-elevation 180ms ease;
}
.card:hover,
.card:focus-visible {
  --hgpu-elevation: 0.65;
}
```

`--hgpu-tint` and `--hgpu-intensity` theme the appearance. The host and its real DOM
content carry meaning, so hover is optional. The no-WebGPU path uses a parameter-aware
CSS `box-shadow` on the actual host; the bundled poster is a standalone fixture.
An explicit author poster takes precedence. No DOM capture, feedback history,
optional GPU features or simulation resources are used.

## Parameters (generated)

<!-- params:start -->

| Parameter | Type  | Default               | Range / choices | Group      | Description                                                                                     |
| --------- | ----- | --------------------- | --------------- | ---------- | ----------------------------------------------------------------------------------------------- |
| rect      | vec4  | [0.12,0.18,0.76,0.64] | 0…1             | Geometry   | Local normalized border box: left, top, width, height.                                          |
| radius    | f32   | 24                    | 0…200           | Geometry   | Legacy rounded corner radius in CSS pixels.                                                     |
| radiiX    | vec4  | [-1,-1,-1,-1]         | -1…4096         | Geometry   | Horizontal CSS corner radii: top-left, top-right, bottom-right, bottom-left; -1 retains radius. |
| radiiY    | vec4  | [-1,-1,-1,-1]         | -1…4096         | Geometry   | Vertical CSS corner radii: top-left, top-right, bottom-right, bottom-left; -1 retains radius.   |
| elevation | f32   | 0.15                  | 0…1             | Appearance | Card lift; controls shadow spread and downward offset.                                          |
| intensity | f32   | 0.2                   | 0…1             | Appearance | Maximum exterior contact-shadow opacity.                                                        |
| tint      | color | "#283b66"             | —               | Palette    | Subtle shadow tint; alpha also scales opacity.                                                  |

<!-- params:end -->
