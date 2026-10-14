# Progress line

A thin transparent rule reveals a polyline by its actual length in CSS pixels. Edit `p0` through `p7` as normalized `[x, y]` coordinates and set `pointCount` to 2…8. Unequal horizontal, vertical and diagonal segments consume progress in proportion to their visible length, rather than one equal interval per segment. Resizing recomputes the length in the new aspect ratio.

`progress: 0` is completely empty; `progress: 1` draws the full path without a lingering head glow. Repeated points are safe, and an entirely zero-length path stays transparent. Intermediate progress has round caps and a small glow bounded by `headGlow` CSS pixels. `width` is also in CSS pixels. Both remain consistent at DPR 1 and DPR 2; the effect keeps resolution scale at 1 for a crisp thin stroke.

`--hgpu-progress`, `--hgpu-tint`, `--hgpu-intensity`, `--hgpu-width` and `--hgpu-headGlow` can drive the appearance through CSS. Width and glow tokens use numbers measured in CSS pixels, for example `--hgpu-width: 2`. Intensity defaults to 0.25. The effect has no clock or pointer motion and submits GPU work only when inputs, parameters or size change. Reduced motion preserves the author's progress, including an intermediate step, rather than changing the information it represents.

For fallback, retain an author-owned SVG alongside the GPU canvas. The exported helper returns the same geometry, including a blank path for a wholly degenerate polyline:

```ts
const d = progressLinePath(width, height, field.params);
path.setAttribute('d', d);
path.setAttribute('pathLength', '1');
path.setAttribute('fill', 'none');
path.setAttribute('stroke-linecap', 'round');
path.setAttribute('stroke-linejoin', 'round');
path.style.strokeDasharray = '1';
path.style.strokeDashoffset = String(1 - progress);
path.style.visibility = progress === 0 ? 'hidden' : 'visible';
```

Use the same tint, opacity and CSS-pixel stroke width on the SVG, and update its geometry when the host resizes. The native path carries the author's fallback geometry; the canvas remains decorative. The pass uses only the ordinary frame/parameter uniform buffers and output target, with no owned textures, history or custom buffers.

## Parameters

<!-- params:start -->

| Parameter  | Type  | Default    | Range / choices | Group    | Description                                               |
| ---------- | ----- | ---------- | --------------- | -------- | --------------------------------------------------------- |
| pointCount | u32   | 6          | 2…8             | Path     | Number of authored points, connected in order.            |
| p0         | vec2  | [0.05,0.8] | 0…1             | Path     | Normalized path point 0.                                  |
| p1         | vec2  | [0.35,0.8] | 0…1             | Path     | Normalized path point 1.                                  |
| p2         | vec2  | [0.35,0.2] | 0…1             | Path     | Normalized path point 2.                                  |
| p3         | vec2  | [0.65,0.2] | 0…1             | Path     | Normalized path point 3.                                  |
| p4         | vec2  | [0.65,0.8] | 0…1             | Path     | Normalized path point 4.                                  |
| p5         | vec2  | [0.95,0.8] | 0…1             | Path     | Normalized path point 5.                                  |
| p6         | vec2  | [0.95,0.5] | 0…1             | Path     | Normalized path point 6.                                  |
| p7         | vec2  | [0.95,0.2] | 0…1             | Path     | Normalized path point 7.                                  |
| progress   | f32   | 1          | 0…1             | Progress | Fraction of actual CSS-pixel path length revealed.        |
| tint       | color | "#91b6ee"  | —               | Palette  | Stroke and head tint.                                     |
| intensity  | f32   | 0.25       | 0…1             | Style    | Stroke and bounded head opacity.                          |
| width      | f32   | 1.5        | 0.25…8          | Style    | Stroke thickness in CSS pixels.                           |
| headGlow   | f32   | 6          | 0…24            | Style    | Bounded head glow radius in CSS pixels; zero disables it. |

<!-- params:end -->

Browser coverage and captured native timing gates are recorded in [section 3.5 validation](../v2-transitions.md).
