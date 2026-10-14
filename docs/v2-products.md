# Backlog v2: product imagery and screenshots

Section 3.4 adds five catalogue effects: `depth-parallax`, `product-sheen`, `bright-pass`, `masked-composite` and `pointer-map`. Screenshot glow and hero video grading are recipes. The catalogue contains 73 effects.

Open `/products.html` for two original product illustrations and aligned depth maps, a transparent product cutout, screenshot glow, a chart-only pointer lens and a muted 1280×720 video. The image-progress slider controls depth and sheen directly, using mouse, touch or keyboard input. Moving over a depth image temporarily gives the pointer control; leaving restores the slider pose, so stale pointer coordinates cannot cancel or saturate scrubbing. Slider changes made during setup are retained. Show originals and depth maps to compare the treatments; the video starts only when requested. `/products.html?reduce=1` freezes motion and `/products.html?fallback=1` keeps the native media and baked screenshot glow.

## Depth and product light

```ts
const surface = await attach(imageWrapper, depthParallax, { layer: 'front' });
await surface.field?.bindInput('image', { kind: 'image', source: productImage });
await surface.field?.bindInput('depth', {
  kind: 'mask',
  source: alignedDepthImage,
  channel: 'red',
});
```

White depth is near and black is far. The depth map must match the image framing and aspect ratio. `amount` is capped at 2% of the rendered image width, including combined pointer/progress input; the default 0.015 amount and 0.25 intensity give a much smaller shift. `progress: 0.5` is neutral. Reduced motion preserves the original image exactly. Clamp filling and a small blur handle the outer sampling boundary; this is a quiet 2D warp, not reconstruction of unseen geometry. Avoid depth discontinuities across fine transparent details and leave room around the product.

Attach to a supported wrapper such as a `div`, rather than an `img` or `figure`, which cannot host the required shadow root. Keep the real image in the light DOM for layout, alt text and fallback. For a full-image replacement, hide only its visual rendering while the attachment is ready, to avoid doubling partially transparent pixels:

```css
.replacement[data-hgpu-state='ready'] > img {
  visibility: hidden;
}
```

`imageFallback: true` suppresses the built-in fixture poster for these authored-image attachments. An explicit author poster still takes precedence. `product-sheen` is a transparent **overlay** and retains the visible original beneath it. It samples only the product's alpha silhouette; `progress` places the highlight and the optional automatic preset moves it. Reduced motion produces no sheen. Colours and intensity are CSS-drivable.

## Linear masks and bounded refraction

`InputSource` accepts a `mask` descriptor with an image, image bitmap, mutable canvas or SVG path string. Images are copied before binding resolves, so the caller may immediately close its bitmap. Path strings accept `width`, `height` and `fillRule`; the default size is 256×256. Mutable canvas masks remain caller-owned and re-extract their pixels during rendering, so use an immutable image or bitmap for a static mask on an animated field.

Coverage uploads as one linear `r8unorm` channel, without a conversion pass or mip allocation. Shaders read **red**, not alpha (sampling a single-channel texture returns alpha 1). The default `channel: 'alpha'` extracts image alpha. `channel: 'red'` treats grayscale bytes as already-linear scalar data and ignores alpha; it is intended for opaque depth maps. `channel: 'luminance'` decodes sRGB before Rec.709 weighting and multiplies by alpha. Each scalar is quantized to 8 bits. This makes gray 128 depth about 0.502, while gray 128 luminance coverage is about 0.216.

```ts
await field.bindInput('mask', {
  kind: 'mask',
  source: 'M260 360H1142V662H260Z',
  width: 1200,
  height: 750,
});
```

`masked-composite` mixes premultiplied original and filtered RGBA through coverage and `blend`. Bind `image`, `filtered` and `mask` for standalone use. In a chain, bind `original` for the scene and let the preceding stage supply the filtered primary image. Missing filtered data preserves the original; missing mask gives full coverage. Optional legacy alpha/luminance channel selectors are for RGBA texture inputs, rather than canonical single-channel masks.

`pointer-map` produces linear normal RG or signed flow RG plus a height channel for `displace`. It is a data field, with no palette or simulation. Reduced motion is neutral; settled maps submit no unchanged GPU frames. Use `center: [-1, -1]` to follow the pointer or a manual normalized center for scroll/touch adapters. The demo borrows its same-device output through a base-level-only chain and confines the result to the chart mask. Ordinary image uploads still follow the existing linear-premultiplied normalization path.

## Screenshot glow and video grading

```ts
const glow = chain(brightPass, bloom);
const surface = await attach(screenshotWrapper, glow, {
  layer: 'front',
  resolutionScale: 0.5,
  poster: '/your-baked-glow.png',
  params: {
    s0_threshold: 0.55,
    s0_intensity: 0.25,
    s1_threshold: 0,
    s1_knee: 0,
    s1_strength: 0.45,
    s1_levels: 4,
  },
});
surface.canvas.style.mixBlendMode = 'screen';
await surface.field?.bindInput('image', { kind: 'image', source: screenshot });
// Optional author coverage, e.g. exclude navigation and text from the glow.
await surface.field?.bindInput('mask', maskDescriptor);
```

`bright-pass` thresholds **unpremultiplied linear luminance**, then applies the selection, optional mask, brand tint and intensity to the premultiplied image. HDR values survive extraction. Bloom's own threshold is zero to avoid discarding the already-selected highlights. Keep the original screenshot visible, and give the fallback poster the same screen blend. The demo's baked overlay is generated from its actual screenshot and mask with `node scripts/product-glow-poster.mjs`.

```ts
import { heroVideoGrade } from '@mk7s/hologpu/recipes';
const surface = await attach(videoWrapper, heroVideoGrade, {
  layer: 'front',
  preset: 'warm',
  playing: false,
});
await surface.field?.bindInput('image', { kind: 'video', source: video });
```

Use a muted looping video with a poster, limited to **1280×720**. The exported recipe has neutral and warm presets, a mild color grade and fine grain. The existing `grain-overlay` is a transparent T1 overlay; it cannot be the second filter of `chain` and would omit the graded image. This recipe uses a small T4 adapter with the same grain parameters and noise, preserving the full image and alpha. Grain changes at 18 Hz while video keeps its own decode cadence. Reduced motion freezes grain and the demo pauses the native video. Authors control native playback separately from the field transport. Frame callbacks invalidate a paused field when decoded content changes. A parallel native `timeupdate` backup handles callback silence from hidden/non-presenting video, after 100 ms and at no more than 10 Hz; it checks changed media time and decoded readiness. This backup is bounded freshness, not a promise of full decoder frame rate. Explicit paused seeks invalidate immediately. Disposal removes the event listeners and cancels the one callback chain without changing caller playback. Firefox and WebKit use the measured Canvas-copy normalization path; Chrome hardware uses external video textures. Software adapters use CPU-copy interop, reported separately.

## Validation

Focused browser tests cover linear scalar masks and ownership/restore, two-percent parallax bounds, DPR 1/2 edge behaviour, premultiplication, original-image reduced motion, alpha-limited sheen, linear luminance/HDR extraction, optional masks, composite endpoints, map neutrality and idle settlement, native demo controls, authored fallbacks and desktop/mobile layout. Generated catalogue posters remain available for standalone previews; authored native imagery and the explicit baked glow are the page fallbacks.

Across the focused suite, 42 software cases pass at DPR 1/2 and 63 native cases pass across Chrome, headed Firefox and WebKit. A further 34 software cases cover existing input normalization, ownership, DOM attachments and poster priority. The native video normalization regression also passes all three engines with its original 0.03 interior-patch tolerance. Paused video references wait for three identical Canvas captures, then verify byte stability across normalization; otherwise Firefox can expose a still-settling decoded frame after `pause()`. The product video test compares four authored uniform interiors at 0.035, retains full-frame diagnostics, and proves automatic refresh while field transport is paused, no duplicate uploads, the bounded backup, sole callback chain and caller-owned playback. Lifecycle tests hold pipeline compilation through `pagehide` and abort the native video source: both paths release all fields and preserve native media fallbacks. Desktop/mobile snapshots were inspected at DPR 1/2. All 76 unit tests, catalogue discovery, type checks and the production build pass.

With `pnpm dev` running, reproduce timing with `HOLOGPU_BENCHMARK_RUNS=3 pnpm benchmark:v2-products chrome` and the corresponding `webkit` command. The script mounts actual DOM images, scalar masks and a playing native 1280×720 loop at DPR 1, with 30 warmup and 80 completed samples per capture. Singles are 560 CSS pixels wide; the seven-field mixed page uses 440-pixel elements above the fold at 1440×1000. Forced active frames include CPU encoding, input normalization/mips when decoded media changes, effect passes and canvas resolve. Native decoding runs independently; queue completion does not measure decoder wall time. Ordinary settled effects submit less often than these forced active captures.

| Field / own host size                     | Chrome GPU p95 range, ms | WebKit GPU p95 range, ms |
| ----------------------------------------- | -----------------------: | -----------------------: |
| `depth-parallax` / 560×373                |              1.507–2.097 |              1.388–2.162 |
| `product-sheen` / 560×373                 |              0.328–2.294 |              1.598–1.828 |
| `bright-pass` / 560×350                   |              0.393–2.818 |              1.697–1.970 |
| `pointer-map` / 560×350, no resolve       |              3.801–3.998 |              1.581–1.836 |
| `masked-composite` / 560×350, held source |              3.015–3.277 |              1.562–1.866 |
| Screenshot glow / 560×350 at half scale   |            18.874–23.134 |            12.179–13.610 |

These are three initial captures per engine, with whole-field GPU timestamps and separate completed-work wall latency. Chrome timestamps are quantized, and summed pass intervals can exceed queue wall latency; do not substitute them for elapsed frame time. GPU validation reports no errors. Machine load is uncontrolled, so followup captures establish current behavior rather than a controlled speed comparison.

Three final native video/mixed followups per engine verify 39–40 media-normalization frames out of 80, with advancing native media time and no GPU errors. Hero video GPU p95 is **2.228–2.556 ms Chrome / 6.325–6.832 ms WebKit** at 560×315; completed-work p95 is **3.6 / 3.4 / 4.1 ms Chrome** and **12 / 12 / 12 ms WebKit**. The seven-field mixed page completes at **7.9 / 6.4 / 6.3 ms Chrome** and **12 / 13 / 13 ms WebKit**, missing the 4 ms gate in every followup. These captures use Chrome external video and WebKit Canvas-copy interop.

The initial mixed-page completion values were 4.5 / 4.4 / 5.2 ms Chrome and 14 / 14 / 5 ms WebKit. The final initial WebKit capture has **zero refreshed media inputs**, despite advancing `currentTime`; its 5 ms result is excluded from live-video acceptance. Raw samples are preserved with `videoRefresh.valid: false`. The followups demonstrate live refresh after adding the bounded native-event backup, without treating advancing media time alone as evidence of current GPU pixels.

Records: [Chrome initial](benchmarks/v2-products-chrome.json), [WebKit initial](benchmarks/v2-products-webkit.json), [Chrome video/mixed followup](benchmarks/v2-products-chrome-followup.json), [WebKit video/mixed followup](benchmarks/v2-products-webkit-followup.json). Filtered followups use `HOLOGPU_BENCHMARK_SCENARIOS=hero-video-grade,mixed-page` and preserve initial records. Strict per-field budgets (0.5 ms Chrome / 1.5 ms WebKit) and the 4 ms completed-work page budget remain open; section 3.4 is implemented and functionally verified but not fully accepted.
