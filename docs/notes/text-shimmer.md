# Masked OKLCH headline shimmer (`text-shimmer`)

## Technique summary

One T1 fragment pass gates a three-stop OKLCH gradient with the real headline's alpha mask. A soft Gaussian highlight travels horizontally once in 1.2 seconds, then the overlay becomes transparent. Real text remains in the light DOM beneath the `front` canvas, preserving selection and accessibility. Default opacity is 0.25; palette stops and intensity accept CSS custom properties.

The automatic-clock sentinel is `progress: -1`. Any explicit progress from 0 through 1, including CSS zero, overrides time. Both endpoints are transparent. Reduced motion uses a static gradient across all glyphs at the selected intensity, regardless of progress; it never performs a sweep. Hue interpolation follows the shortest arc in OKLCH and handles nearly achromatic stops. A seeded sub-LSB dither reduces banding.

## CSS and timeline recipes

```ts
import textShimmer from '@mk7s/hologpu/effects/text-shimmer';
import { attach } from '@mk7s/hologpu/dom';

const heading = document.querySelector<HTMLElement>('.headline')!;
const overlay = await attach(heading, textShimmer, { layer: 'front' });
// Default: one 1.2-second shimmer, then hold the original heading.
```

```css
.headline {
  --hgpu-progress: 0;
  --hgpu-first: #d5c1f0;
  --hgpu-second: #fff0dc;
  --hgpu-third: #a9dbe9;
  transition: --hgpu-progress 1.2s;
}
.headline:hover {
  --hgpu-progress: 1;
}
```

This transition also returns through the highlight when hover ends. To replay only forward, clear progress to zero without a transition, then restore the transition and set it to one on the next frame. Set the initial explicit zero before attaching so the bridge can register the typed property before author animation starts. Touch devices retain the real headline without needing hover.

For normalized scroll or animation-library clocks, attach with `preset: 'timeline'`, then call `overlay.timeline(progress)` or `bindTimeline(overlay.field!, source)`. That preset selects the time clock and sets duration to 1, so normalized time maps directly to the highlight. Explicit CSS progress takes precedence.

## Mask and resource contract

DOM attachment supplies a host-sized RGBA mask of actual text. The fragment shader consumes alpha using baseline manual bilinear sampling. A standalone core field without a `text` binding uses a local 512×256 “GPU” fixture. Bind a typed `text`, canvas, or image input to `text` for custom core-only layouts. Target resolution is fixed at scale 1, preserving crisp glyph alignment at DPR 1 and 2.

Each field owns one 512×256 RGBA8 fixture (524,288 bytes), plus the normal runtime target and uniforms. There is no simulation or history. The helper caches its texture bind group until the mask subresource changes and releases its fixture and pipeline on disposal. Settled automatic motion stops GPU draws after the final transparent frame; unchanged explicit progress also sleeps. CSS polling and the clock remain active so later interactions can redraw.

## Fallback and limitations

The generated reduced-motion poster depicts the built-in fixture. For real attached text, the declared gradient fallback uses CSS `background-clip: text` and the same palette parameters; it must follow actual glyphs rather than displaying the fixture poster. The flat element fallback is transparent. Shimmer is decorative, never a replacement for the DOM copy.

Very thin fonts and saturated palette changes can make a 0.25-opacity highlight hard to see over bright text; adjust intensity within 0…1. Gradient width is relative to the heading host, so wrapped text shares one sweep across its full width. Font shaping is platform-dependent, so cross-device pixel identity is not promised.

## Parameters

<!-- params:start -->

| Parameter | Type  | Default   | Range / choices | Group   | Description                                                                   |
| --------- | ----- | --------- | --------------- | ------- | ----------------------------------------------------------------------------- |
| progress  | f32   | -1        | -1…1            | Motion  | Use -1 for one automatic sweep; explicit CSS progress 0…1 owns the position.  |
| duration  | f32   | 1.2       | 0.1…10          | Motion  | Automatic sweep duration; use 1 for normalized timeline progress.             |
| width     | f32   | 0.16      | 0.025…0.5       | Light   | Gaussian highlight width in normalized heading coordinates.                   |
| intensity | f32   | 0.25      | 0…1             | Light   | Peak highlight opacity; reduced motion uses the same static gradient opacity. |
| first     | color | "#d5c1f0" | —               | Palette | First OKLCH gradient stop.                                                    |
| second    | color | "#fff0dc" | —               | Palette | Middle OKLCH gradient stop.                                                   |
| third     | color | "#a9dbe9" | —               | Palette | Final OKLCH gradient stop.                                                    |

<!-- params:end -->
