# Backlog v2: ambient particles

Section 3.6 adds `particle-drift` and `constellation`, bringing the catalogue to 78 effects. Open `/ambient.html` for a dust study behind native copy and a faint linked grid. Both start settled. Moving over the dust study enables its local motion; leaving stops it after 600 ms. Touch interaction uses the same bounded interval. Play enables both studies explicitly, while Reduce motion returns to their settled poses. Ember, Dusk and Paper palettes and the intensity slider use CSS colour and intensity tokens.

## Dust drift

```ts
import { attach } from '@mk7s/hologpu/dom';
import particleDrift from '@mk7s/hologpu/effects/particle-drift';

const dust = await attach(section, particleDrift, {
  layer: 'behind',
  playing: false,
  seed: 7,
  params: { count: 512, size: 4, intensity: 0.18 },
});
// Start for an author interaction; pause again when that interaction ends.
dust.play();
dust.pause();
```

Use one element-local particle field per page. Count is bounded to 256–2048 and defaults to 512; the demo uses 1024. T3 storage is a single 16-byte record per mote, at most 32 KiB, plus a 16-byte bounded phase uniform. A compute pass writes seeded centres and an instanced quad pass draws Gaussian sprites additively. There are no trails, feedback textures, sorting, neighbour searches or optional WebGPU features.

The drift is analytic rather than cumulative: each mote stays within six CSS pixels of its seeded anchor, with gentle pointer repulsion capped at 32 CSS pixels (12 by default). The phase is reduced in JavaScript double precision before its float upload so a long-running tab retains motion. Quad size and pointer falloff use CSS pixels at DPR 1 and 2. The untouched scatter is the time-zero design; reduced motion ignores pointer and time and keeps that exact seeded scatter. Settled fields stop unchanged GPU submissions; CSS polling remains available for later theme changes. Pointer events can invalidate a reduced field through the shared runtime, but leave its rendered pose unchanged.

## Constellation

```ts
import constellation from '@mk7s/hologpu/effects/constellation';

await attach(panel, constellation, {
  layer: 'behind',
  playing: false,
  params: { pitch: 88, radius: 1.5, width: 0.7, intensity: 0.22 },
});
```

This is a stateless T1 field. Each hashed-jitter cell owns one point linked only to its eight neighbours. A fragment examines nine local points and twelve segments, including links crossing a cell without an endpoint inside it, so the grid has no cut seams. There are no particle buffers or spatial-hash passes. Point radius, pitch and line width are CSS lengths. Slow bounded drift and gentle dimming are optional; reduced motion, zero speed, or zero drift and twinkle preserve a settled pose. No pointer input is needed.

Both effects expose CSS `--hgpu-tint` and `--hgpu-intensity`. Their default intensity is below 0.3. Both default to resolution scale 0.5 for soft ambient rendering, using a quarter of the fragment pixels while retaining CSS geometry. Pass scale 1 for sharper constellation strokes. The transparent settled posters layer behind real DOM content without carrying information. `/ambient.html?reduce=1` demonstrates frozen designs and `/ambient.html?fallback=1` demonstrates loaded posters. For a different author theme, aspect ratio or seed, supply a matching generated poster.

## Validation

All 16 browser cases pass at software DPR 1/2 (32 runs) and in native Chrome, Firefox and Playwright WebKit (48 runs). Checks cover CPU-reference seeded storage, reversible local repulsion, bounded all-day drift, exact reduced-motion pixels, Gaussian alpha and transparency, default-scale geometry, DPR line geometry and cell-boundary continuity, visible control updates, responsive screenshots, settled idle work, loaded posters and ownership/disposal isolation. The four desktop/mobile snapshots were visually reviewed. Workspace/test type checking, all 76 unit tests, catalogue validation, production build, scoped formatting and diff checks pass.

Measured on Apple M1 Max, Chrome 154 and Playwright WebKit 26.6 at DPR 1, with one field at its own CSS size: dust 680×440, constellation 500×300. The final default scale is 0.5, producing 340×220 and 250×150 targets. Each of three captures discards 30 warmup frames and records 80 active frames. Each field's clock advances 1/60 s before pose compute/render; there is no cumulative feedback simulation or decoder. The mixed page has both fields above the fold, with one 1024-record dust field. Tests and compilation did not run during captures; machine load remains uncontrolled.

Summed GPU pass p95 in ms includes the display resolve. The per-field limits are 0.5 ms Chrome / 1.5 ms WebKit:

| Field              | Chrome, three captures | WebKit, three captures | Acceptance                   |
| ------------------ | ---------------------- | ---------------------- | ---------------------------- |
| Dust, 1024 records | 0.20 / 0.26 / 0.20     | 0.74 / 0.67 / 0.81     | Pass in both                 |
| Dust, maximum 2048 | 0.33 / 0.39 / 0.33     | 0.61 / 0.79 / 0.69     | Pass in both                 |
| Constellation      | 0.52 / 0.66 / 0.33     | 0.99 / 1.06 / 1.07     | Chrome misses; WebKit passes |

A second constellation capture group in Chrome records 0.66 / 0.52 / 0.59 ms GPU p95, retaining the miss. Timestamp intervals are quantized and can overlap; their sum is diagnostic rather than whole-frame elapsed time. CPU encode/submit and queue-completed wall latency are separate fields in the raw records.

The mixed page's completed-work p95 has a 4 ms limit:

| Engine | First final captures, ms | Follow-up captures, ms | Passes |
| ------ | ------------------------ | ---------------------- | ------ |
| Chrome | 4.20 / 5.20 / 4.10       | 4.00 / 3.50 / 4.20     | 2 of 6 |
| WebKit | 5.00 / 5.00 / 3.00       | 4.00 / 3.00 / 5.00     | 3 of 6 |

The same groups' summed GPU p95 are 0.52 / 1.84 / 0.72 and 0.72 / 0.79 / 0.66 ms in Chrome, and 2.73 / 2.45 / 2.34 and 1.99 / 1.94 / 1.68 ms in WebKit. Low GPU times do not establish the completed-work gate. Functional work is complete; strict performance acceptance remains open for Chrome constellation and both page gates.

Records: [Chrome](benchmarks/v2-ambient-chrome.json), [Chrome follow-up](benchmarks/v2-ambient-chrome-followup.json), [WebKit](benchmarks/v2-ambient-webkit.json), [WebKit follow-up](benchmarks/v2-ambient-webkit-followup.json). Earlier full-resolution captures are preserved in [Chrome initial](benchmarks/v2-ambient-chrome-initial.json) and [WebKit initial](benchmarks/v2-ambient-webkit-initial.json); they prompted the soft half-resolution defaults. These runs establish behaviour on this development machine, not phone, native Safari or integrated-GPU acceptance.

Reproduction:

```sh
pnpm exec playwright test tests/browser/v2-particle-drift.spec.ts tests/browser/v2-constellation.spec.ts tests/browser/v2-ambient-demo.spec.ts
pnpm exec playwright test --config playwright.hardware.config.ts tests/browser/v2-particle-drift.spec.ts tests/browser/v2-constellation.spec.ts tests/browser/v2-ambient-demo.spec.ts
node scripts/poster.mjs particle-drift default 680x440
node scripts/poster.mjs constellation default 500x300
node scripts/benchmark-v2-ambient.mjs chrome
node scripts/benchmark-v2-ambient.mjs webkit
```
