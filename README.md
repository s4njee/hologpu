# HoloGPU

A native WebGPU effects library and playground research project. M0 foundations, M1's shared runtime and Full-stage playground, all nine Family A procedural effects, and the M2 feedback/fluid implementation are available. See the [plan](plan.md), [M1 validation record](docs/m1.md), [T1 stretch validation](docs/t1-stretch.md), [M2 validation](docs/m2.md) and [frozen T1 contract](docs/adr/005-t1-effect-contract.md).

M3 adds six particle effects, four compute primitive demos, timestamp profiling, fixed-scenario benchmark exports and a live WGSL editor. See [M3 validation](docs/m3.md) for the implementation and current evidence.

M4 adds eight image filters, three distance/light effects, media inputs, filter chains, texture-backed parameters, Compare, screenshots and recording. M4 is complete on the development target: Chrome passes the 1080p video refresh gate in all three runs; WebKit passes correctness checks but misses that performance gate. See [M4 validation](docs/m4.md).

M5 adds DOM attachments and custom elements, six Family H effects, fluid obstacles, CSS/property/timeline drivers, and In page and Grid modes. Implementation and local validation are complete: the native six-effect refresh gate and matched software-adapter adaptation pass. Physical weaker-device validation remains for M8; see [M5 validation](docs/m5.md).

## Run

Requires Node 22.12+ and pnpm 11.15.1. The DOM demo includes a small vendored MIT-licensed HoloCSS motion stylesheet; its [provenance](apps/playground/src/vendor/holocss/README.md) is retained alongside the source.

```sh
pnpm install
pnpm exec playwright install chromium
pnpm dev
```

Open [the playground](http://127.0.0.1:5175). Select an effect, adjust generated controls or presets, inspect composed WGSL and capabilities, and read its research note. The URL retains your state. Transport includes pause, step, reset, seed, resolution and reduced motion. Keyboard: arrows select effects, space pauses, `.` steps, `r` resets and `/` searches. Transport also supports time scale and optional adaptive quality. The Passes drawer captures raw intermediate textures with channel/range selection and false colour, and summarizes simulation buffers. Drag the stage while holding a pointer button to inject into interactive simulations. CPU timing excludes GPU execution. The [M0 foundations lab](http://127.0.0.1:5175/m0.html) retains the shared compute and multi-canvas experiments.

```ts
import { createEffect } from '@mk7s/hologpu';
import gradient from '@mk7s/hologpu/effects/gradient-oklch';

const field = await createEffect(canvas, gradient, { preset: 'lagoon', seed: 7 });
field.params.speed = 0.3;
field.pause();
field.step();
field.destroy();
```

## Author an effect

Use `fragmentEffect` with a schema and a WGSL `fn effect(uv: vec2f) -> vec4f` returning straight-alpha linear sRGB. The [19-line example](examples/bands.ts) includes both. Copy it into `packages/effects/src/bands/index.ts`, run `pnpm catalogue` and restart the dev server: the browser and generated inspector discover it without playground edits. Catalogue effect files import the internal `@mk7s/hologpu-core` package to keep dependencies acyclic; external consumers use the public facade. Core chunks (`hash`, `noise`, `colour`, `sdf`) compose through `chunks`. Individual exports retain parameter types.

T2 uses `feedbackEffect({ setup(context) })` with a program owning initialization, fixed-step compute passes and display. The [feedback ADR](docs/adr/007-feedback-compute-contract.md) explains queued uniform snapshots, resource ownership and texture taps. Use `field.reset(seed); field.advance(count)` for deterministic replay.

T3 uses `particleEffect` with the same fixed-step ownership contract and storage buffers. The [particle ADR](docs/adr/008-particle-storage-and-hdr.md) covers point/quad rendering, indirect draws and HDR histories; the [primitive ADR](docs/adr/009-compute-primitives.md) documents reusable scans, stable sorts, grids and mip generation. The Source drawer can compile, restore and export edits while keeping the last good pipeline on errors. Morph particles accept local custom text and image targets.

Schemas support scalars, vectors, booleans, enums, CSS colours, named texture inputs, curves and gradients. Curves and gradients bake into linear texture LUTs; texture selectors resolve named bound inputs. The [contract ADR](docs/adr/005-t1-effect-contract.md) specifies alignment, coordinate conventions, lifecycle and limitations. The [facade ADR](docs/adr/006-public-package-facade.md) explains public package paths and internal dependency boundaries.

## DOM fields (M5)

```ts
import { attach } from '@mk7s/hologpu/dom';
import border from '@mk7s/hologpu/effects/border-energy';

const attached = await attach(element, border, { layer: 'behind', seed: 7 });
attached.params.speed = 0.3;
attached.timeline(0.5); // external normalized clock; simulation stays paused
attached.destroy();
```

Import `@mk7s/hologpu/element` to register `<hgpu-field>` with the lazy catalogue resolver, or call `registerHGPUField()` from the DOM entry to supply a resolver or a custom tag name. The canvas lives in a shadow root; accessible text and controls remain slotted light-DOM children. Attachments share a device, resize with their hosts, sleep offscreen and in background tabs, respect reduced motion, and restore after device loss. They dispatch `hgpu-ready`, `hgpu-fallback`, `hgpu-lost`, `hgpu-restored` and `hgpu-quality`. An optional `poster` takes precedence over the effect's CSS fallback. `attachment.field` is nullable when GPU setup fails; the attachment and authored content remain usable.

```html
<hgpu-field effect="image-hover" style="--hgpu-progress: 0.4">
  <h2>Accessible content stays here</h2>
  <button>Still interactive</button>
</hgpu-field>
```

Uniforms can be driven through plain `params` assignments, opted-in typed non-inheriting `--hgpu-*` properties, or `timeline(progress)` with a finite 0–1 value. The CSS bridge reads one computed-style object per visible frame and caps each field at eight scalar, boolean or color bindings. Unset CSS leaves schema defaults and presets intact. Author explicit numeric endpoints for CSS transitions; CSS vectors, texture selectors and allocation controls are not supported. `bindProperties`, `bindCSSParameters` and `bindTimeline` expose disposable drivers for imperative fields. Property and timeline drivers report counters; failed author sources emit bounded `hgpu-error` events while healthy fields continue. An unchanged external clock preserves its settled image.

`fluid-obstacles` automatically consumes tagged `[data-hgpu-obstacle]` descendants through packed DOM rectangles. `DomRectsInput` is also available for explicit bindings; the caller owns and disposes that descriptor. Rectangles use transformed axis-aligned bounds rather than arbitrary DOM silhouettes. In page combines six effects with actual content, a HoloCSS image transition and a CSS view timeline. Grid makes repeated attachments; page conditions expose reduced motion, fallback, quality tiers and real device loss. The fixed overlay remains a research option; ordinary attachments use one in-flow canvas per element.

## Inputs and filter chains (M4)

`bindInput` accepts a media descriptor or another `EffectField`. Connecting a field borrows its latest linear, premultiplied HDR output, subscribes to changes, and orders the shared scheduler so the source renders before its consumer. The fields must share a GPU device; cycles are rejected. The source remains owned by its caller.

```ts
import { createEffect, chain, inputSource } from '@mk7s/hologpu';
import gradient from '@mk7s/hologpu/effects/gradient-oklch';
import blur from '@mk7s/hologpu/effects/blur';
import lens from '@mk7s/hologpu/effects/lens';
import colorGrade from '@mk7s/hologpu/effects/color-grade';
import dither from '@mk7s/hologpu/effects/dither';

const source = await createEffect(sourceCanvas, gradient, { playing: true });
const filtered = await createEffect(filterCanvas, blur);
await filtered.bindInput('image', source);
filtered.params.radius = 6;

const fourFilters = chain(blur, lens, colorGrade, dither);
const videoField = await createEffect(videoCanvas, fourFilters, {
  params: { s0_radius: 4, s1_grain: 0, s2_exposure: 0.25, s3_levels: 8 },
});
await videoField.bindInput('image', inputSource({ kind: 'video', source: videoElement }));

// Chain parameter names use the zero-based stage prefix s0_, s1_, and so on.
// Each intermediate stays linear HDR; the display resolves only the final output.
```

`chain` takes variadic definitions, beginning with a source effect or an image filter; subsequent stages must be T4 filters. Stage-local curve, gradient and texture parameters retain the same prefix as scalar controls. A Family E image filter without an image uses its private test card; distance and light effects use built-in mask scenes.

Media descriptors also accept owned image snapshots, live canvases, text masks and audio data:

```ts
await imageElement.decode();
const bitmap = await createImageBitmap(imageElement);
await filtered.bindInput('image', { kind: 'image', source: bitmap });
bitmap.close(); // bindInput has already retained its own snapshot.
await filtered.bindInput('image', { kind: 'canvas', source: canvasElement });
await filtered.bindInput('image', {
  kind: 'text',
  text: 'GPU',
  width: 512,
  height: 256,
  font: 'bold 96px sans-serif',
});
await filtered.bindInput('audio', { kind: 'audio', analyser });
// Deterministic fixtures can provide mutable FFT amplitude and signed waveform arrays.
await filtered.bindInput('audio', {
  kind: 'audio',
  fft: new Float32Array(512),
  waveform: new Float32Array(512),
});
await filtered.bindInput('image', null); // release this binding and use the effect fallback.

videoField.destroy();
filtered.destroy();
source.destroy();
```

Audio textures place FFT amplitude in row zero and the full signed waveform in row one; analyser textures use `fftSize` columns and zero-pad FFT bins beyond `frequencyBinCount`. Red stores the signal and alpha is one. Media become owned RGBA16 linear-premultiplied textures with complete mip chains. Video-frame callbacks avoid uploading a decoded frame twice and update paused consumers. Canvas callers invalidate after changes; the playground's animated canvas does this automatically.

The core does not request camera or microphone permission, stop caller tracks, pause caller video, or close caller audio contexts. Applications own those resources and release them after removing their bindings. The playground requests capture only from explicit start buttons and cleans up its tracks, audio contexts, object URLs, animation callbacks and secondary fields on switching sources or unmounting.

Chromium hardware samples actual external video textures. Current WebKit uses a canvas upload to correct an observed YUV external-texture color discrepancy; SwiftShader uses a CPU upload because browser media interop fails on that software adapter. `field.inputMediaPath` reports `external`, `canvas-copy` or `software-copy`, and measurements retain that distinction. See the [input ownership and color contract](docs/adr/013-texture-inputs.md), [filter-chain contract](docs/adr/011-filter-chain.md) and [distance/light contract](docs/adr/012-distance-fields-and-radiance-cascades.md).

## Verify and measure

```sh
pnpm check          # format, types, unit/discovery tests, builds, SwiftShader pixels at DPR 1 and 2
pnpm test:hardware  # installed Chrome, headed Playwright Firefox, Playwright WebKit
pnpm format
```

Hardware tests require the browsers (`pnpm exec playwright install firefox webkit`) and a graphical session for Firefox on this Mac. They are excluded from CI. Without WebGPU, the stage uses the declared CSS fallback and the page remains readable. Hardware tests compare repeatability within an engine, without cross-device snapshot comparisons.

For measurements, build and run a static preview in one terminal:

```sh
pnpm build
pnpm --filter @mk7s/hologpu-playground exec vite preview --host 127.0.0.1 --port 5176
```

Then in another:

```sh
HOLOGPU_URL=http://127.0.0.1:5176 pnpm benchmark:m1 chrome
HOLOGPU_URL=http://127.0.0.1:5176 pnpm benchmark:m1 webkit
HOLOGPU_URL=http://127.0.0.1:5176 HOLOGPU_BENCHMARK_LABEL=m1-stretch pnpm benchmark:m1 chrome truchet caustics starfield
HOLOGPU_URL=http://127.0.0.1:5176 HOLOGPU_BENCHMARK_LABEL=m1-stretch pnpm benchmark:m1 webkit truchet caustics starfield
HOLOGPU_URL=http://127.0.0.1:5176 pnpm benchmark:m2 chrome
HOLOGPU_URL=http://127.0.0.1:5176 pnpm benchmark:m2 webkit
HOLOGPU_URL=http://127.0.0.1:5176 pnpm benchmark:m2 chrome --gate
HOLOGPU_URL=http://127.0.0.1:5176 pnpm benchmark:m2 webkit --gate
HOLOGPU_URL=http://127.0.0.1:5176 pnpm benchmark:m3 chrome
HOLOGPU_URL=http://127.0.0.1:5176 pnpm benchmark:m3 webkit
HOLOGPU_URL=http://127.0.0.1:5176 pnpm benchmark:m3 chrome --gate
HOLOGPU_URL=http://127.0.0.1:5176 pnpm benchmark:m3 webkit --gate
HOLOGPU_URL=http://127.0.0.1:5176 pnpm benchmark:m4 chrome
HOLOGPU_URL=http://127.0.0.1:5176 pnpm benchmark:m4 webkit
HOLOGPU_URL=http://127.0.0.1:5176 pnpm benchmark:m4 chrome --gate
HOLOGPU_URL=http://127.0.0.1:5176 pnpm benchmark:m4 webkit --gate
node scripts/notes.mjs
```

M1 records three runs per effect at 512×320, DPR 1, defaults and seed 7, with 30 warm-up and 120 measured frames. It reports CPU encoding/submission and rAF cadence, not GPU execution time or actual VRAM. Device state and load are uncontrolled. Records save to `docs/benchmarks`; `scripts/notes.mjs` regenerates parameter and measurement tables from built effect definitions and JSON records. Rebuild after updating notes to include them in the static app.

M2 measures one fixed update per rAF at a 512² display with default simulation grids; `--gate` measures actual 1024² simulation and display for reaction diffusion and fluids. It awaits queue completion each frame and records wall latency separately from CPU encoding. [M2 validation](docs/m2.md) describes the numerical checks and gate.

M3 uses the Profiler drawer's runner, adding optional GPU pass timestamps and checking that all 150 fixed updates complete. Its gate draws exactly one million flow particles through both point and instanced-quad paths. Benchmarks temporarily enable motion and restore the original preference; changing the measured scenario cancels the run. [M3 validation](docs/m3.md) records actual buffer counts and timing limitations.

M4 records three runs per new effect. Its gate uses an actual decoded 1920×1080 60fps video through blur, lens, color grade and dither, preserving the media upload path in the record. Chrome passes all three refresh-rate runs; WebKit’s canvas-upload path misses the gate. [M4 validation](docs/m4.md) records the workload, measurements and compatibility limit.

M0 scenarios remain available with `pnpm benchmark chrome`, `pnpm benchmark firefox --headed`, `pnpm benchmark webkit` and `node scripts/probe.mjs` against the development server. They record one/six float or direct canvases, DPR 2 and scrolling.

## Research

- [Compatibility and verified assumptions](docs/compatibility.md)
- [M0 validation and ADRs](docs/m0.md)
- [M1 validation](docs/m1.md)
- [M2 validation](docs/m2.md)
- [M3 validation](docs/m3.md)
- [M4 validation](docs/m4.md)
- [M5 validation](docs/m5.md)
- [T1 stretch validation](docs/t1-stretch.md)
- [Effect notes and template](docs/notes/_template.md)

`pnpm build` emits package JS/types and the deployable static app in `apps/playground/dist`. Packages are private; remote hosting and registry publication are not configured.
