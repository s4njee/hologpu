# Soft specular light sweep (`light-sweep`)

## Technique summary

A single T1 fullscreen fragment pass evaluates an angled Gaussian band. The default intensity is 0.22; `tint` and `intensity` accept CSS tokens. Output is premultiplied linear colour, so attach it `front` over the real hero or image. The effect carries no information and leaves the underlying page visible.

`progress: -1` is the automatic-clock sentinel: the band crosses the host once in 1.2 seconds and then stays invisible. Explicit progress from 0 through 1 overrides that clock, including exactly 0. The final and initial poses have zero alpha; fading the Gaussian tails avoids an edge highlight after settlement. Reduced motion forces the final pose even while CSS or a timeline supplies another progress.

## CSS and timeline recipes

```ts
import lightSweep from '@mk7s/hologpu/effects/light-sweep';
import { attach } from '@mk7s/hologpu/dom';

const hero = document.querySelector<HTMLElement>('.hero')!;
const field = await attach(hero, lightSweep, { layer: 'front' });
// Automatic one-time sweep needs no author animation.
```

For an author-controlled sweep, set an explicit start before attaching, then change the custom property. The CSS bridge registers its typed number automatically. The same property change can run again on hover or when entering the viewport.

```css
.hero {
  --hgpu-progress: 0;
  transition: --hgpu-progress 1.2s;
}
.hero.is-visible {
  --hgpu-progress: 1;
}
```

```ts
const field = await attach(hero, lightSweep, {
  layer: 'front',
  params: lightSweep.presets.timeline,
});
field.timeline(0.5);
// Or bindTimeline(field.field!, () => normalizedScrollProgress).
```

The `timeline` preset sets duration to 1 with automatic progress selected, so the core normalized timeline maps directly to band progress. Explicit CSS progress takes precedence over time, including a bound timeline. Remove the authored CSS progress to hand control back to the clock. The core timeline pauses automatic playback while scrubbing.

Bind a transparent product image with `await field.field?.bindInput('image', { kind: 'image', source: img })` to multiply sheen opacity by its alpha. Image inputs use the existing baseline texture adapter and manual bilinear sampling; no optional WebGPU feature is needed. The sheen does not copy the image itself: keep the real image in the DOM beneath the front layer. Binding uses normalized coordinates; the host and cutout must share the intended crop and bounds.

## Resources and fallback

One fullscreen pass and a 1×1 opaque mask (four bytes) for the unbound-image path. Bound media textures remain owned by the runtime input adapter. No history, simulation or persistent particle state. The generated settled poster is transparent; the CSS fallback is also transparent, leaving the page unchanged without WebGPU.

## Failure modes

The width and angle are normalized host geometry, so a very wide host changes the physical band width. The effect polls opted-in CSS parameters through the standard bridge; after the automatic sweep renders its final transparent frame, unchanged scheduled frames skip GPU drawing. An explicit progress pose also renders only when dirty. The field clock and CSS polling stay active, so later CSS changes redraw immediately. Reset clears the settlement state and allows a new automatic sweep. Transparent product images need correctly aligned host bounds. This is decorative alpha sheen rather than physical reflection or lighting.
