# Backlog v2: scroll, transitions and dividers

Section 3.5 adds `section-wipe`, `wave-divider` and `progress-line`, bringing the catalogue to 76 effects. `/transitions.html` combines two original product illustrations, an opaque section divider and an authored step path. A native slider works without scrolling or a pointer. Reveal modes, reduced motion and native fallbacks are inspectable independently.

## Authored image transitions

```ts
import sectionWipe from '@mk7s/hologpu/effects/section-wipe';
const surface = await attach(wrapper, sectionWipe, {
  layer: 'front',
  playing: false,
  params: { progress: 0 },
});
await surface.field?.bindInput('image', { kind: 'image', source: firstImage });
await surface.field?.bindInput('next', { kind: 'image', source: nextImage });
surface.set({ progress: 0.45, mode: 'directional' });
```

Both images share the same framing and aspect ratio. Endpoints return the original or destination exactly. `directional` supports four travel directions; `noise` uses still seeded noise; `luminance` reveals bright straight-linear destination regions first. Blending remains linear and premultiplied, including partially transparent images. Missing `next` preserves the source. Reduced motion cuts to the destination at progress 0.5. There is no DOM capture or View Transitions dependency.

Retain real images in light DOM for layout and alt text. Hide their pixels with `opacity: 0` only after the field and both inputs are ready; keep the canvas hidden while loading. Opacity preserves the images' accessible semantics. `imageFallback: true` suppresses a built-in fixture poster, and an explicit author poster still takes precedence. The demo's native fallback fades the destination over the source using CSS opacity; its reduced-motion fallback uses the same halfway cut. This simple opacity recipe assumes opaque full-frame images; transparent author images need a separate isolated compositing treatment to avoid doubling overlapping coverage.

The demo reads a native `ViewTimeline` when available, with 35% viewport insets. A passive scroll event coalesces updates into one animation frame; it does not run a separate perpetual loop. Older engines use the equivalent geometry fraction `(0.65 * viewportHeight - subjectTop) / (subjectHeight + 0.3 * viewportHeight)`, clamped to 0…1. The slider disables scroll following until the author re-enables it. Parameters remain responsive with procedural transport paused; `--hgpu-progress` is also CSS-drivable. Use `?timeline=geometry` to inspect the portable path or `?progress=0.45` to start with a manual pose.

## A divider that meets its section

```ts
import waveDivider, { waveDividerPath } from '@mk7s/hologpu/effects/wave-divider';
const geometry = { amplitude: 18, baseline: 0.5, cycles: 1.15, phase: 0 };
const surface = await attach(wrapper, waveDivider, {
  layer: 'front',
  poster: '',
  params: { ...geometry, fill: '#eae9f2' },
});
// Recompute on host resize; use the same fill as the next section.
svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
path.setAttribute('d', waveDividerPath(width, height, geometry));
```

The edge is two gentle sine terms with shared defaults and constants. `amplitude` is in CSS pixels and is capped to retain top/bottom clearance. An analytic SDF edge accounts for local slope and derivative antialiasing. The last backing-pixel row receives full fill, including at reduced resolution, so a block divider meets an immediately adjacent section without an inline baseline gap. Use an **opaque** fill matching the section background; there is no intensity parameter for this opaque surface. Translucent fills cannot create an opaque seam.

Reduced motion freezes time at zero even during explicit `drawAt` calls. `waveDividerPath` creates the same time-zero edge with curvature-bounded polyline interpolation error at most 0.01 CSS pixels. It validates positive finite dimensions and finite geometry, clamps parameter ranges and applies the shader's amplitude ceiling. Refresh it on resize or geometry changes. Keep the SVG and the section's real background in DOM; pass `poster: ''` to suppress the standalone fixture poster. SVGs inside an attachment need an explicit resolved height or in-flow content so an empty shadow slot cannot collapse the author layer. The demo assigns actual host dimensions on resize.

## An arc-length progress path

```ts
import progressLine, { progressLinePath } from '@mk7s/hologpu/effects/progress-line';
const params = {
  pointCount: 3,
  p0: [0.05, 0.8],
  p1: [0.5, 0.8],
  p2: [0.95, 0.2],
  progress: 0.4,
  width: 1.5,
  intensity: 0.25,
  tint: '#596684',
};
const surface = await attach(wrapper, progressLine, {
  layer: 'front',
  poster: '',
  playing: false,
  params,
});
path.setAttribute('d', progressLinePath(width, height, params));
path.setAttribute('pathLength', '1');
```

Edit 2…8 normalized points through `p0`…`p7` and `pointCount`. Their uniform-backed shader array measures each segment in actual CSS pixels. Progress consumes arc length, so unequal or diagonal segments advance at a consistent distance; resize recomputes lengths for the new aspect ratio. Round caps and a small bounded head glow appear only while progress is between zero and one. Progress zero is empty, one is complete without a lingering head, repeated points are safe and an entirely degenerate path stays transparent. Thin strokes render at scale one for DPR 1/2 accuracy.

The effect has no clock or pointer motion. Clean fields submit no unchanged GPU frames; reduced motion preserves the author's step. Keep step labels and instructions in DOM. The native SVG uses `stroke-dasharray: 1` and `stroke-dashoffset: calc(1 - var(--progress))`; hide it at progress zero to avoid a round-cap dot. Keep the same width, tint and opacity in both layers. `--hgpu-width`, `--hgpu-amplitude` and other numeric tokens take unitless numbers measured in CSS pixels, for example `--hgpu-width: 2`; parameter names preserve case (`--hgpu-headGlow`).

## Validation and timings

The focused suite passes 34 software cases at DPR 1/2 and 51 native cases across Chrome, headed Firefox and Playwright WebKit. Checks cover exact image identities, every reveal mode and direction, linear luminance after unpremultiplication, a convex RGBA blend oracle, noise seed/time replay, missing/aliased destination bindings, resized inputs and complete disposal. Divider tests compare SVG vertices and bounded interpolation against the analytic edge, CSS-pixel amplitude at both DPRs and scales 1/0.5, exact opaque bottom-row fill and time-zero reduced poses. Path tests cover unequal and diagonal segments, empty/full/degenerate paths, CSS-pixel stroke/glow, authored reduced poses and bounded idle settlement.

The integrated demo verifies native/manual progress, the available view timeline and portable geometry, resize, mode/motion controls, authored image accessibility and non-collapsed native fallback dimensions. All forced-fallback attachments contain no GPU fields and use real images/SVGs without fixture posters. Desktop/mobile snapshots at DPR 1/2 and a native fallback capture were inspected. Generated settled posters are bundled for all three catalogue effects. The 76 unit tests, catalogue discovery check, type checking and production build also pass.

Native timings use `HOLOGPU_BENCHMARK_RUNS=3 pnpm benchmark:v2-transitions chrome` and the corresponding `webkit` command, with `pnpm dev` already running. Real DOM attachments and original 1200×800 illustrations are measured at DPR 1. Singles use a 560×373 wipe, 1440×100 divider and 600×170 path. The mixed page contains all three above the fold at 1440×1000. Each capture excludes initialization and image upload, discards 30 warmup frames and records 80 completed forced active frames. This tests the advancing state; clean wipe/path fields settle in normal use.

| Field / own host size      | Chrome GPU p95 range, ms | WebKit GPU p95 range, ms |
| -------------------------- | -----------------------: | -----------------------: |
| Directional wipe / 560×373 |              0.393–0.524 |              0.312–0.574 |
| Noise wipe / 560×373       |              0.393–0.393 |              0.323–0.612 |
| Luminance wipe / 560×373   |              0.393–0.655 |              0.355–0.857 |
| Wave divider / 1440×100    |              0.328–0.655 |              0.484–1.097 |
| Progress line / 600×170    |              0.393–0.655 |              0.915–1.659 |

Each row contains three native captures, including effect and canvas resolve. Wipes and the mixed page use the final resource cache; divider/path results use the unchanged initial implementation. Final mixed-page completed-work p95 is **3.3 / 3.6 / 3.3 ms Chrome** and **5 / 5 / 6 ms WebKit**. Chrome meets the 4 ms page gate in all final captures; WebKit misses in all three. The 0.5 ms Chrome per-field gate also misses for the directional/luminance wipes, divider and path in at least one capture, and the WebKit path exceeds its 1.5 ms field gate. Section 3.5 is implemented and functionally verified, but strict performance acceptance remains open.

Initial mixed-page completion was 4 / 2.3 / 3.2 ms Chrome and 9 / 6 / 4 ms WebKit. The final cache avoids rebuilding wipe bind groups/views for progress changes, while replacing an input or changing its selected subresource refreshes the group. These are uncontrolled captures, so the timing difference is not a claimed cache speedup. No GPU validation errors occurred. Filtered followups use `HOLOGPU_BENCHMARK_SCENARIOS=section-wipe,section-wipe-noise,section-wipe-luminance,mixed-page` and preserve initial samples.

Records: [Chrome initial](benchmarks/v2-transitions-chrome-initial.json), [WebKit initial](benchmarks/v2-transitions-webkit-initial.json), [Chrome final wipe/mixed](benchmarks/v2-transitions-chrome-followup.json), [WebKit final wipe/mixed](benchmarks/v2-transitions-webkit-followup.json). CPU encode/submit, GPU pass timestamps and completed-work queue wall latency are separate observations. Machine load is uncontrolled, and Chrome's quantized pass timestamps can overlap or sum beyond measured queue wall latency; use completed-work wall latency for the 4 ms page gate. Baseline rendering requires no optional GPU features; timestamp queries are measurement-only.
