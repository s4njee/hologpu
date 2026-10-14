# Backlog v2: section 3.2

Three typography effects and two assembly presets are implemented. The catalogue now has 65 effects. Functional and visual checks pass; strict GPU/page timing acceptance remains open after repeated native captures. The measurements below retain the misses.

| Effect              | Delivered behavior                                                                                                                                                                                                                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text-shimmer`      | A premultiplied OKLCH highlight through real glyphs, one 1.2-second sweep by default, CSS/hover and normalized timeline control, a static reduced-motion gradient and a CSS text gradient fallback.                                                                                             |
| `text-outline-glow` | Cached jump-flood distances, an exterior glow/outline/both display pass, CSS-pixel widths, optional subtle breathing and pointer brightening, a fixed reduced-motion glow and CSS text-shadow fallback.                                                                                         |
| `heading-reveal`    | A front-layer opaque page-colour cover over glyphs, erased by progress with stable noise; reduced motion and no-WebGPU show the complete original headline.                                                                                                                                     |
| `text-dissolve`     | An `assemble-and-hold` preset with 8,192 grid particles, reversed progress so zero scatters and one assembles, deterministic scrubbing, reduced-motion final pose and a generated preset poster.                                                                                                |
| `morph-particles`   | An `assemble-and-hold` preset with 8,192 particles and analytic interpolation from seeded scatter to raster targets. It bypasses spring updates and viewport-sized feedback, holds without continued GPU draws and ships a generated preset poster. Older spring presets retain their behavior. |

The three new effects require baseline WebGPU, accept CSS palette tokens, and default to intensity at or below 0.25. Shimmer and reveal retain scale 1 for crisp glyphs. Real text and controls stay in the light DOM, while canvases remain decorative and ignore pointer input. A finished shimmer/reveal and both assembly modes stop GPU rendering until a parameter, input, layout or other invalidation changes their output.

## Attach a headline

```ts
import { attach } from '@mk7s/hologpu/dom';
import shimmer from '@mk7s/hologpu/effects/text-shimmer';

const heading = document.querySelector<HTMLElement>('.headline')!;
const decoration = await attach(heading, shimmer, { layer: 'front' });
// The default sweep finishes after 1.2 seconds.
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

Explicit `progress` 0…1 overrides the automatic clock. Hover-out reverses the transition; the per-effect note explains forward-only replay. For an animation-library or scroll clock, select the `timeline` preset and call `decoration.timeline(progress)`. Shimmer's timeline preset sets duration to 1. Assembly presets use explicit progress; advance it from zero to one with CSS or parameter updates, then leave it at one. Use at most one particle field per page.

Attach glow behind text with enough host padding for its exterior halo. Attach reveal in front and set `params.page` or `--hgpu-page` to the exact flat background colour. Reveal is suitable only for a flat background: it cannot reconstruct gradients, images or content behind the headline. Its default progress is 1, so the page starts with readable text; use explicit zero to opt into a reveal.

## Text masks and fallback

The attachment builds an immutable RGBA snapshot of laid-out DOM text lines, including wrapping, inline fonts, letter/word spacing, text transform, padding and borders. It uses the field's DPR and refreshes on content/style/ancestor changes, host resize, window resize and font loading. Identical layout signatures keep the existing GPU input; ordinary time and palette updates never re-upload the mask. Each font-loading readiness cycle also advances a font-content revision, so equal-metrics font replacements still refresh their outlines. The loading/readiness path covers the installed WebKit build, which omits `loadingdone` for JavaScript FontFaces. Textures and field outputs expose content revisions, allowing glow to reuse its jump-flood result until source content or subresources change.

The generated posters show the standalone catalogue's built-in text fixture. For actual attached copy, the three new effects instead use their declared text-aware fallback: CSS background-clipped gradient, text shadow, or the original fully revealed text. This avoids displaying the fixture's letters over a different headline. An explicit author `poster` still takes precedence. The two existing effects automatically choose their assembly-preset poster; an explicit author poster remains selected across preset changes.

The DOM rasterizer targets ordinary horizontal text. Complex bidirectional shaping across styled nodes, vertical writing and transformed hosts need separate alignment verification.

`morph-particles` retains its existing centered raster-target font and layout. Its assembly preset is element-local particle artwork, rather than a pixel-aligned substitute for an arbitrary styled DOM headline. Use shimmer, glow or reveal when alignment to the actual headline matters. Authored DOM content remains readable with every effect.

## Validation

<!-- validation:start -->

Fifty software-browser cases pass across SwiftShader DPR 1 and 2. The 25 cases were also checked in installed Chrome, headed Firefox and WebKit; all functional assertions pass after the targeted font/CSS regressions were fixed and rerun. Hardware runs skip adapter-specific PNG baselines while retaining independent DOM/GPU pixel comparisons.

- `v2-text-effects.spec.ts` verifies mask alpha, premultiplication, progress 0/0.5/1, normalized timelines, reduced motion, a real 1.2-second CSS transition, hover replay and settled GPU rendering.
- `v2-text-glow.spec.ts` instruments actual JFA encodes without requiring timestamps. It verifies unchanged-mask reuse, same-texture content revisions, array layers, resized masks, reduced motion and disposal.
- `v2-text-assembly.spec.ts` verifies the particle cap, quiet opacity, deterministic reversible poses, held frames, CSS control, accessible custom copy, old local input APIs and switching back to spring mode. CSS assertions wait for the observed bridge update rather than assuming two animation frames suffice under Firefox's queue-completion pacing.
- `v2-dom-text.spec.ts` compares native DOM pixels captured before attachment with GPU-only white glyphs. Wrapped Arial, italic inline text, padding/borders and collapsed spaces/newlines pass at DPR 1/2 and on all three hardware engines. The oracle requires greater than 0.8 pixel intersection-over-union, greater than 0.96 precision/recall within one physical pixel, and bounds within 1.5 physical pixels; it does not use the raster helper as its expected image.
- The same DOM suite verifies resize/style/content/ancestor changes, unchanged-mask upload stability, actual delayed font downloads at fixed host geometry, authored CSS fallback colors and glow radius/opacity, focus, explicit-poster priority, disposal during asynchronous capture, and rejection of stale captures including a return to the already-bound layout.
- `v2-typography-playground.spec.ts` checks resolution clamping when switching from quarter-scale aurora, low-tier controls and Compare, plus native front canvases within the research overlay and retained control interaction.

Existing text-dissolve and morph-particles PNG baselines, spring calculations, local input behavior, and image/raw/versioned texture normalization pass 14 focused checks across both DPRs. The new assembly modes have their own settled snapshots. Build and typechecking pass; all 74 unit tests pass. Generated public exports and packaged poster assets are included in the production build.

<!-- validation:end -->

## Performance

<!-- timing:start -->

Captures are in [Chrome JSON](benchmarks/v2-typography-chrome.json) and [WebKit JSON](benchmarks/v2-typography-webkit.json), generated with `scripts/benchmark-v2-typography.mjs` on this development Mac. They use real DOM attachments, Arial 48px headings, DPR 1, scale 1, fixed quality, seed 7, 30 warm-up renders and 120 measured renders per run. The mixed page contains shimmer and reveal at 640×160, glow at 480×120, and one morph assembly at 320×128; all four are above the fold. The two particle effects are measured separately, with only one present in the page scenario.

One initial capture covers every scenario. Two further captures retain and investigate the initial Chrome misses for reveal, glow and the page, and all WebKit scenarios. Cells list recorded runs in order; a single number means one run, not three identical results. No failed initial capture is discarded.

| Effect / CSS size             | Chrome effect-only p95 ms | Chrome total p95 ms   | WebKit effect-only p95 ms | WebKit total p95 ms   |
| ----------------------------- | ------------------------- | --------------------- | ------------------------- | --------------------- |
| `text-shimmer` / 640×160      | 0.197                     | 0.393                 | 1.742 / 1.439 / 1.299     | 3.511 / 2.902 / 2.964 |
| `heading-reveal` / 640×160    | 0.262 / 0.131 / 0.131     | 0.590 / 0.328 / 0.262 | 1.793 / 1.196 / 1.014     | 3.632 / 2.416 / 2.022 |
| `text-outline-glow` / 480×120 | 0.721 / 0.131 / 0.131     | 1.442 / 0.262 / 0.328 | 1.741 / 0.738 / 1.011     | 3.613 / 1.504 / 2.003 |
| `text-dissolve` / 320×128     | 0.131                     | 0.262                 | 1.734 / 0.767 / 0.856     | 3.598 / 1.407 / 1.722 |
| `morph-particles` / 320×128   | 0.262                     | 0.459                 | 1.605 / 1.337 / 1.068     | 3.219 / 2.710 / 2.094 |

The general field targets are ≤0.5ms Chrome and ≤1.5ms WebKit, including the shared canvas resolve. Chrome shimmer and both assembly presets pass their single captures. Reveal and glow miss their first captures but clear the general field target in both repeats. The stronger 0.3ms glow item target passes effect-only timing in 2/3 Chrome captures and timing including resolve in 1/3. WebKit misses the general target in every capture except text-dissolve run 2; its cached glow also misses 0.3ms. These observations leave strict section acceptance open.

| Four-field page      | Completion p95 ms     | ≤4ms runs |
| -------------------- | --------------------- | --------- |
| chrome 154.0.8037.98 | 5.600 / 2.100 / 3.100 | 2/3       |
| webkit 26.6          | 6.000 / 4.000 / 5.000 | 1/3       |

The runner explicitly forces all four fields to render at progress 0.5 and submits them together once per measured update. This bypasses the shipped idle gates for a conservative all-live workload; finished shimmer/reveal and held assembly fields normally sleep. It does not put two particle effects on one page.

The first valid-mask render is separate from steady rendering. Its isolated glow JFA GPU timestamps are chrome: 1.966 / 0.721 / 0.786 ms; webkit: 4.854 / 3.131 / 3.643 ms. Each glow field encodes exactly one seed/distance build, then zero JFA passes throughout warm-up and all 120 measured renders. The distance revision remains unchanged. First-render completion also includes input normalization and canvas resolve; attachment/compilation/startup timing is recorded separately in JSON.

All recorded samples have complete GPU timestamp profiles, no dropped profiles, no unexpected page errors and no session GPU errors. CPU encoding, summed effect/resolve GPU timestamps, and encode-start-to-queue-completion wall time are separate measurements. Timestamp sums are not whole-frame wall latency. These captures serve Vite development source modules rather than a production bundle. No competing GPU work was intentionally started by this task during capture; machine-wide load and GPU power state remain uncontrolled. The variance does not establish a portable ceiling or justify changing crisp-text defaults to pass one favorable run.

Further performance acceptance needs isolated production measurements and investigation of the remaining render/resolve costs. Functional tests and cached JFA behavior do not close those timing gates.

<!-- timing:end -->

## Reproduce

```sh
pnpm dev
# In another terminal:
pnpm poster text-shimmer default 640x400
pnpm poster text-outline-glow default 640x400
pnpm poster heading-reveal default 640x400
pnpm poster text-dissolve assemble-and-hold 640x400
pnpm poster morph-particles assemble-and-hold 640x400
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright test tests/browser/v2-text-effects.spec.ts tests/browser/v2-text-glow.spec.ts tests/browser/v2-text-assembly.spec.ts tests/browser/v2-dom-text.spec.ts tests/browser/v2-typography-playground.spec.ts
pnpm exec playwright test --config playwright.hardware.config.ts tests/browser/v2-text-effects.spec.ts tests/browser/v2-text-glow.spec.ts tests/browser/v2-text-assembly.spec.ts tests/browser/v2-dom-text.spec.ts tests/browser/v2-typography-playground.spec.ts
HOLOGPU_BENCHMARK_RUNS=3 pnpm benchmark:v2-typography chrome
HOLOGPU_BENCHMARK_RUNS=3 pnpm benchmark:v2-typography webkit
```

Run GPU tests and benchmarks sequentially. Hardware Firefox requires a graphical session. Per-effect usage and parameter tables live in `docs/notes/`.
