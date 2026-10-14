# Noise-eroded heading reveal (`heading-reveal`)

## Technique summary

One T1 fragment pass lays a flat page-colour cover over masked glyphs. Stable seeded noise perturbs a left-to-right progress boundary, eroding that cover to uncover the original DOM heading. The default progress is 1, leaving ordinary text fully visible. Explicit zero covers the glyphs, halfway progress reveals approximately half, and final progress is exactly transparent. Reduced motion always forces the final visible heading regardless of CSS or timeline position.

**The background must be a flat, opaque colour matching `page`.** The effect cannot reproduce a gradient, image, video or arbitrary DOM background beneath the heading. It samples the text mask, never captured DOM pixels. `page` alpha is ignored because the cover needs opaque page colour. Nonzero mask coverage becomes an opaque page-colour cover, including anti-aliased glyph edges, so the original heading stays concealed until the reveal reaches it.

`intensity` defaults to 0.25 and ranges from 0 through 1. It controls boundary noise, not cover opacity. The noise cell pitch is specified in CSS pixels and remains stable across DPR 1 and 2.

## CSS and timeline recipes

```ts
import headingReveal from '@mk7s/hologpu/effects/heading-reveal';
import { attach } from '@mk7s/hologpu/dom';

const heading = document.querySelector<HTMLElement>('.headline')!;
const overlay = await attach(heading, headingReveal, { layer: 'front' });
```

```css
.hero {
  background: #11121b;
}
.headline {
  --hgpu-page: #11121b;
  --hgpu-progress: 0;
  transition: --hgpu-progress 1.2s;
}
.headline.is-visible {
  --hgpu-progress: 1;
}
```

The custom property is typed by the attachment's CSS bridge. Attach before changing `is-visible`, so the transition interpolates its number. Keep meaningful copy in the light DOM: the effect changes presentation only and the final copy never depends on a pointer.

For normalized scroll progress, attach with `preset: 'timeline'` and call `overlay.timeline(progress)` or use `bindTimeline(overlay.field!, source)`. The `timeline` preset sets progress to the -1 sentinel, selecting normalized `frame.time`; explicit CSS progress takes precedence. The normal default remains fully revealed.

## Resources and fallback

The shared typography helper supplies a 512×256 RGBA8 text fixture (524,288 bytes) for standalone previews; attached real text uses the runtime's host-sized mask instead. The shader samples alpha, uses one seeded hash per fragment, and writes premultiplied linear page colour. One fullscreen pass; no feedback, particles, optional WebGPU features or stored animation state. Resolution scale is 1 for glyph alignment. Unchanged progress stops GPU drawing while CSS polling stays active; timeline progression redraws as needed.

Without WebGPU, the overlay is transparent and the original heading is fully visible. The generated settled poster is transparent. No fallback animation hides meaningful copy.

## Failure modes

A mismatched page colour leaves a visible silhouette around unrevealed glyphs. Coloured or translucent backgrounds cannot be concealed correctly. Font shaping and anti-aliasing vary by operating system; wrapped-line geometry is supplied by the attachment mask adapter.

## Parameters

<!-- params:start -->

| Parameter | Type  | Default   | Range / choices | Group   | Description                                                                             |
| --------- | ----- | --------- | --------------- | ------- | --------------------------------------------------------------------------------------- |
| progress  | f32   | 1         | -1…1            | Motion  | Reveal progress; 1 shows the real heading, -1 selects the normalized timeline clock.    |
| page      | color | "#11121b" | —               | Palette | Opaque flat page colour used to cover unrevealed glyphs; must match the DOM background. |
| intensity | f32   | 0.25      | 0…1             | Reveal  | Noise perturbation of the reveal boundary, not cover opacity.                           |
| scale     | f32   | 3         | 1…16            | Reveal  | Noise cell pitch in CSS pixels.                                                         |
| feather   | f32   | 0.04      | 0.005…0.2       | Reveal  | Soft transition width in normalized heading coordinates.                                |

<!-- params:end -->
