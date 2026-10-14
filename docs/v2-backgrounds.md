# Backlog v2: section 3.1

The six background effects and starfield changes are implemented. The catalogue now has 62 effects. Visual, functional and fallback requirements pass local browser checks; strict performance acceptance remains open. The captures below include misses, so this section is not marked fully accepted in the backlog.

| Effect              | Delivered behavior                                                                                                                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aurora-veil`       | Domain-warped two-octave fBm, three OKLCH stops, static SDR dither, quarter-resolution default, three brand palettes in JSON and a matching CSS gradient.                                                              |
| `grain-overlay`     | Transparent premultiplied grain, 4% default opacity, optional image luminance, actual 12–24 Hz scheduled draws, static poster and a 64² PNG tile. Unused pointer movement does not defeat the rate cap.                |
| `dot-matrix-field`  | CSS-pixel pitch/radius across DPR and resolution changes, bounded ±15% breathing, optional pointer response at half strength under reduced motion, repeating CSS dots.                                                 |
| `topographic-lines` | Two-octave contours, derivative coverage for subpixel strokes, CSS-pixel weight and spacing with a 12px minimum, frozen poster.                                                                                        |
| `grid-horizon`      | Derivative-antialiased perspective grid, unresolved-line suppression and transparent distance fog, optional forward motion, static SVG fallback.                                                                       |
| `light-sweep`       | One 1.2s load sweep, CSS progress and normalized timeline, optional image alpha mask, initial/final transparent poses and reduced-motion final pose. Settled frames stop GPU rendering until an external change.       |
| `starfield`         | `dusk` preset with density 26/3 and nebula disabled; JS integer origins and fractional offsets preserve camera motion when f32 elapsed time loses frame precision. Existing default/preset snapshots remain unchanged. |

Every new effect requires baseline WebGPU only and has a generated settled-frame poster. Colour parameters accept CSS tokens; default intensities are at most 0.3. Attachments preserve authored light-DOM text and controls. Transparent posters replace the CSS background after loading, avoiding duplicate decorative layers; a failed or removed poster restores the CSS fallback. Device loss hides the old canvas until recovery. The playground also removes the CSS fallback while its GPU canvas is ready.

The runtime's new `defaultResolutionScale`, `poster` and `renderRate` metadata preserve existing defaults for other effects. The final unused lane of the 64-byte frame block now carries a reduced-motion flag without moving other offsets. An optional instance render gate lets a one-off effect retain its settled frame. Explicit capture and dirty parameter/input changes still render immediately.

## Validation

`tests/browser/v2-backgrounds.spec.ts` covers deterministic defaults, all presets, reduced motion, alpha, zero intensity, disposal, CSS dot geometry, actual grain rates with continuous pointer events, image luminance and six loaded fallback posters. The moving-grid test samples 24 poses over 1.6 seconds at 1440×900: the first 20 CSS pixels below the horizon reached at most 1/255 alpha with no observed temporal delta at DPR 1 and 2; the near plane remains visible. This bounds that distant strip rather than claiming all parameter combinations are shimmer-free.

`v2-light-sweep.spec.ts` checks load/manual/timeline poses, masking, a real CSS 1.2s transition, reduced motion and snapshots at progress 0, 0.5 and 1. `v2-starfield.spec.ts` checks deterministic motion at 2²⁴ seconds and continuity across an integer-origin boundary. `v2-poster.spec.ts` checks poster replacement, failure and removal while preserving keyboard-accessible controls. Existing starfield tests cover its unchanged older presets and the new dusk snapshots.

SwiftShader image baselines cover DPR 1 and 2, including grain over light and dark backgrounds. Hardware checks use numerical/functional assertions rather than cross-adapter image comparisons. Build and typechecking validate all generated public exports; the effects build copies bundled PNG/JSON assets into the package output.

Local checks passed: 74 unit tests, the new browser suite at DPR 1/2, existing starfield snapshots, DOM fallback/recovery regressions, and functional coverage in Chrome, headed Firefox and WebKit. Grain's test checks an upper render-rate cap and unique time buckets, rather than requiring a minimum throughput from a busy GPU. Firefox's queue-completion cadence limited observed throughput to about 11 draws during each 1.1-second observation; all configured rates still respected their cap. The library's default one-outstanding-batch policy is unchanged. Light-sweep stays idle through unused pointer events and redraws when its CSS progress changes.

## Performance

Measurements are in [Chrome JSON](benchmarks/v2-backgrounds-chrome.json) and [WebKit JSON](benchmarks/v2-backgrounds-webkit.json), generated by `scripts/benchmark-v2-backgrounds.mjs`. They use installed Chrome and Playwright WebKit on this development Mac, DPR 1, fixed quality, seed 7, 30 warm-up frames and 120 measured frames. Shader compilation and input initialization are excluded. Source modules are served by the Vite development server; this capture is not a production-site measurement.

Full-viewport cases use 1440×900 CSS pixels, with aurora at its default 0.25 scale and other effects at scale 1. Additional isolated element cases match the page's actual host sizes. The six-field page has aurora and grain at 1440×500, dots/contours/sweep at 400×180, and grid at 1440×220; all fields are above the fold and share one device/submission. The runner forces all six draws every measured update, including grain at 60Hz and a visible sweep held at progress 0.5. This is a conservative rendering stress case; normal grain scheduling is 18Hz and a completed sweep sleeps.

CPU encoding/submission, queue-completion wall latency, summed GPU pass timestamps and rAF intervals are separate measurements. Total GPU columns include canvas resolve; effect-only columns exclude it. Timestamp intervals may be quantized or overlap, and their sum is not whole-frame wall time. Queue completion includes browser/driver overhead. Other GPU work on this shared Mac was uncontrolled; the repeated captures do not isolate device load or prove a portable ceiling. Missing timestamps are never replaced with CPU timings.

<!-- timing:start -->

| Effect / CSS size             | Chrome effect-only p95 ms | Chrome total p95 ms   | Chrome budget ms | WebKit total p95 ms   | WebKit budget ms |
| ----------------------------- | ------------------------- | --------------------- | ---------------- | --------------------- | ---------------- |
| `aurora-veil` / 1440×900      | 0.197 / 0.197 / 0.197     | 0.393 / 0.393 / 0.393 | 0.3              | 1.694 / 1.762 / 1.741 | 1.5              |
| `grain-overlay` / 1440×900    | 0.262 / 0.328 / 0.328     | 0.459 / 0.590 / 0.590 | 0.2              | 1.377 / 1.372 / 1.422 | 1.5              |
| `dot-matrix-field` / 400×180  | 0.328 / 0.590 / 0.131     | 0.590 / 1.180 / 0.262 | 0.3              | 1.028 / 1.261 / 1.075 | 1.5              |
| `topographic-lines` / 400×180 | 0.590 / 0.262 / 0.262     | 1.180 / 0.459 / 0.655 | 0.5              | 3.838 / 2.287 / 0.965 | 1.5              |
| `grid-horizon` / 1440×220     | 0.197 / 0.197 / 0.262     | 0.459 / 0.524 / 0.590 | 0.2              | 0.960 / 0.551 / 0.660 | 1.5              |
| `light-sweep` / 400×180       | 0.524 / 0.459 / 0.393     | 1.114 / 0.918 / 0.786 | 0.5              | 0.462 / 1.285 / 1.239 | 1.5              |

Each cell lists three runs. Strict total-pass GPU targets fail in at least one Chrome run for every effect. WebKit clears the 1.5ms total-pass target for grain, dots, grid and sweep, but aurora and contours miss it. Aurora’s effect-only Chrome pass is 0.197ms in every run; adding the shared canvas resolve raises the total to 0.393ms, above its 0.3ms item target. Full-viewport grain also misses its 0.2ms target.

| Six-field page       | Completion p95 ms (three runs) | ≤4ms runs |
| -------------------- | ------------------------------ | --------- |
| chrome 154.0.8037.98 | 4.0 / 4.7 / 4.4                | 1/3       |
| webkit 26.6          | 23.0 / 42.0 / 11.0             | 0/3       |

Chrome half-scale diagnostics did not establish an improvement under this variable load; they are not acceptance runs. WebKit reported one ResizeObserver notification warning after capture; it is retained in the JSON. All measured scenarios have 120 complete timestamp profiles, verified dimensions, no unexpected page errors and no session GPU errors.

<!-- timing:end -->

Do not close the performance gates based on the successful visual tests or the exploratory page run. Further work needs isolated production measurements and optimization of any remaining full-field/resolve costs; half-resolution diagnostics are recorded separately and do not change the shipped defaults.

## Reproduce

```sh
pnpm dev
# In another terminal:
pnpm poster aurora-veil default 640x400
node scripts/poster.mjs grain-overlay default 64x64 packages/effects/src/grain-overlay/noise-tile.png
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright test tests/browser/v2-backgrounds.spec.ts tests/browser/v2-light-sweep.spec.ts tests/browser/v2-starfield.spec.ts tests/browser/v2-poster.spec.ts
pnpm exec playwright test --config playwright.hardware.config.ts tests/browser/v2-backgrounds.spec.ts tests/browser/v2-light-sweep.spec.ts tests/browser/v2-starfield.spec.ts tests/browser/v2-poster.spec.ts
HOLOGPU_BENCHMARK_RUNS=3 pnpm benchmark:v2-backgrounds chrome
HOLOGPU_BENCHMARK_RUNS=3 pnpm benchmark:v2-backgrounds webkit
```

Firefox hardware tests require a graphical session. Run browser tests and benchmarks sequentially to avoid introducing competing GPU work from this task. Posters represent default parameters; supply an author poster when a different brand/static pose is needed. Palette JSON is at `packages/effects/src/aurora-veil/brand-presets.json`. Per-effect usage and parameter tables are in `docs/notes/`.
