# HoloGPU

WebGPU visual effects for the web. HoloGPU is a runtime plus an effect library:
one API runs procedural shaders, feedback simulations, particles and small 3D
scenes on an ordinary page, with presets, seeds, pause/step, reduced-motion poses,
a poster fallback and device-loss recovery. It ships 78 effects across families
from gradients and fluids to geometry and HDR.

![HoloGPU effect previews](docs/media/hero.png)

Part of the [holofx collection](https://github.com/s4njee/holofx) alongside
[firetemple](https://github.com/s4njee/firetemple),
[watertemple](https://github.com/s4njee/watertemple) and
[lighttemple](https://github.com/s4njee/lighttemple).

## Install

```sh
npm install @mk7s/hologpu
```

Still pre-1.0: the API can change in `0.x` releases. Requires a WebGPU-capable
browser. Without WebGPU the effects fall back to a poster or the effect's
declared CSS, so the page stays readable.

## Use one effect

For progressive enhancement, use `attach` from `@mk7s/hologpu/dom`. It degrades to
the effect's poster or declared CSS when WebGPU is unavailable, so the page stays
readable (see [DOM fields](#dom-fields-m5) for the full API and the
`<hgpu-field>` custom element).

```ts
import { attach } from '@mk7s/hologpu/dom';
import gradient from '@mk7s/hologpu/effects/gradient-oklch';

const field = await attach(document.querySelector('.hero')!, gradient, {
  preset: 'lagoon',
  seed: 7,
});
field.params.speed = 0.3;
field.destroy();
```

If you manage your own canvas, use `createEffect`. It needs a WebGPU device and
throws `WebGPUUnavailableError` when there is none, rather than falling back:

```ts
import { createEffect } from '@mk7s/hologpu';

const field = await createEffect(canvas, gradient, { preset: 'lagoon', seed: 7 });
field.params.speed = 0.3;
field.pause();
field.step();
field.destroy();
```

## Run the playground

Requires Node 22.12+ and pnpm 11.15.1. The DOM demo includes a small vendored
MIT-licensed HoloCSS motion stylesheet; its
[provenance](apps/playground/src/vendor/holocss/README.md) is retained alongside
the source.

```sh
pnpm install
pnpm exec playwright install chromium
pnpm dev
```

Open [the playground](http://127.0.0.1:5175). Select an effect, adjust generated
controls or presets, inspect composed WGSL and capabilities, and read its research
note. The URL retains your state.

See [docs/changelog.md](docs/changelog.md) for what each milestone added.

### Playground controls

The M0 playground transport includes pause, step, reset, seed, resolution and reduced motion. Keyboard: arrows select effects, space pauses, `.` steps, `r` resets and `/` searches. Transport also supports time scale and optional adaptive quality. The Passes drawer captures raw intermediate textures with channel/range selection and false colour, and summarizes simulation buffers. Drag the stage while holding a pointer button to inject into interactive simulations. CPU timing excludes GPU execution. The [M0 foundations lab](http://127.0.0.1:5175/m0.html) retains the shared compute and multi-canvas experiments.

### Demo pages

The [LCD refraction demo](http://127.0.0.1:5175/lcd.html) applies the catalogue's normal / flow displacement filter to the transparent display in the supplied Gemini image. A traced surface mask preserves the bezel, hands and street. Move across the display to steer Ripple, Liquid, Glass or Refraction with a GPU-generated pointer map; change the map encoding or compare with the original. It defaults to Ripple at 10% intensity, renders only in response to interaction, and keeps the photograph visible if WebGPU is unavailable.

Six billboard displays retain the photograph's artwork and perspective while scrolling down independently through HoloCSS's registered `--hcss-number` and stagger timing. Their palette shifts to blue and cyan. **Pause signs** controls this motion separately from the mouse-only LCD; **View original** hides the animated signs as well as the refraction.

Three street fixtures flicker independently through a separate HoloGPU HDR bloom chain. Only their bright pixels feed the bloom pyramid, composited over the scene at half resolution. **Pause lights** freezes their flicker, and **View original** hides all added effects.

Three layers of GPU rain fall at different depths and speeds. A foreground mask keeps streaks behind the tablet, hands and nearby figure. Rain is paused by default; **Play rain** controls rainfall independently.

Build and stage the playground and LCD demo in the sibling mk7s site with `pnpm publish:mk7s`. Add `--deploy` to build mk7s and deploy the Cloudflare Pages production branch. The demo is served at `/hologpu/lcd.html`. Run `pnpm test:lcd` to check the production build at DPR 1 and 2.

The [DOM fluid demo](https://mk7s.dev/hologpu/fluid-dom.html) runs one viewport-sized fluid field around the actual bounding boxes of the page's headings, links, cards and fixed controls. Drag the floating card (or focus its handle and use arrow keys), stir the open space, scroll, resize, or rearrange the cards to update the solver's walls. Controls pause/reset the simulation, change dye palettes, disable collisions, or reveal the boxes. Reduced motion starts paused and WebGPU fallback preserves the interactive HTML. The boundaries use axis-aligned rectangles rather than glyph contours. `pnpm test:fluid-dom` verifies the built demo at DPR 1 and 2; `pnpm publish:mk7s --deploy` includes it in the Cloudflare deployment.

The DOM fireworks demo at `/fireworks-dom.html` uses the catalogue's `emitters` effect for pairs of red, green, blue, yellow, cyan, magenta, and orange fireworks every 3.6 seconds. Each pair launches from separate foreground elements. The default mix rotates round shells, rings, and cascading willows; the shape control can also hold a favorite style. Burst origins follow visible elevated headings and a draggable HTML card; opaque page elements naturally occlude the background canvas. Raw float particle trails feed the shared extended-range HDR presenter, with automatic SDR fallback, light/output controls, pause/replay, reduced-motion support, and a usable static page without WebGPU. Run `pnpm exec playwright test tests/browser/fireworks-dom.spec.ts` for cadence, seven-color birth state, HDR output, geometry, controls, and fallback checks at DPR 1 and 2.

The DOM attractor demo at `/attractor-dom.html` (linked from the playground) fills the viewport with 24,576 electric-blue additive HDR particles. Headings and cards repel them; the draggable card attracts them toward its outline with a tangential force that keeps them circulating. Reverse swaps the forces, Forces disables DOM steering, and Show boxes reveals the sources. Scroll, resize, drag, keyboard movement and rearrangement update the measured rectangles. This is a custom damped force field, separate from the catalogue's chaotic attractor equations; boundaries are soft rectangular influences, not collision walls or glyph contours. A bounded eight-submission queue avoids throttling Firefox on its delayed GPU completion notifications. The demo supports up to sixteen tagged elements of each polarity, gradually reseeds particles to keep the background populated, starts paused under reduced motion, and preserves the HTML without WebGPU. Run `pnpm exec playwright test tests/browser/attractor-dom.spec.ts` for GPU force direction, DOM geometry, controls and fallback checks at DPR 1 and 2.

Both DOM demos use Auto HDR and an 8× default Light boost, adjustable from 1× to 16×. On a display reporting high dynamic range, they request verified extended `rgba16float` presentation in Display P3 (or sRGB HDR); unsupported presentation uses a brighter, tone-mapped SDR version. The output menu also offers explicit HDR and SDR modes. The attractor presents its raw additive `hdr` trail tap before Reinhard compression, retaining the particle exposure setting and dark background. Light and output controls work while paused without changing particle positions or trail history, and presentation rebuilds after device loss. Shader/presentation code is shared with the fluid demo through `apps/playground/src/dom-light-presentation.ts`; neither demo adds a second animation loop. Accepted canvas configuration and numeric pixels above white verify the HDR rendering path, while actual luminance depends on display/browser/OS support. `?playing=false&output=hdr&brightness=8` gives a frozen comparison; the same options work on the fluid demo.

This full-page demo uses a 160-cell grid, 16 pressure iterations and a DPR-1 presentation at 75% resolution. DOM observers update stationary geometry without per-frame layout polling. It opts into a bounded eight-batch submission pipeline: headed Firefox 155 on the development Mac delivered even empty-queue completion callbacks at roughly 100 ms, so waiting for each callback limited animation to about 10 fps independently of solver size. The library's default remains one outstanding batch. This demo keeps solver quality fixed because completion-notification latency is not GPU execution time. The browser checks also run in headed Firefox (a graphical session is required).

The [Invisible ink demo](http://127.0.0.1:5175/ink-paper.html) deposits a finite crimson wash along the top of textured paper. Downward porous-paper transport reveals a cursive message whose wax mask blocks absorption. Change the message (use `/` for line breaks), adjust the pace, pause, or replay. It uses the catalogue `ink` effect with a 288-cell grid and a locally bundled OFL-licensed Parisienne font. Reduced motion waits for an explicit reveal; the simulation stops after the wash settles. `pnpm exec playwright test tests/browser/ink-paper.spec.ts` checks the top feed, zero permanent pigment on fully coated letters, message editing and mobile controls at DPR 1 and 2.

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

For a quiet hero, attach `aurora-veil` behind the content; its default resolution scale is 0.25. Attach `grain-overlay` in front of a separate content host at the default 4% opacity. Grain's `rate` limits time-driven draws to 12–24 Hz; parameter and image changes still refresh immediately. The six new effects ship generated settled-frame posters, automatically selected by `attach()` unless a caller supplies a poster. Regenerate one with `pnpm poster aurora-veil default 640x400` while the dev server is running. Aurora's four brand palettes also ship in `packages/effects/src/aurora-veil/brand-presets.json`.

`light-sweep` runs once over 1.2 seconds by default. To drive it with CSS instead, author `--hgpu-progress: 0; transition: --hgpu-progress 1.2s linear` on its host, then change the property to 1. Its `timeline` preset maps `attachment.timeline(0…1)` to the same sweep. Reduced motion keeps the final transparent pose. Dot pitch, dot radius and contour weight use CSS pixels across DPR and resolution changes.

`fluid-obstacles` automatically consumes tagged `[data-hgpu-obstacle]` descendants through packed DOM rectangles. `DomRectsInput` is also available for explicit bindings; the caller owns and disposes that descriptor. Rectangles use transformed axis-aligned bounds rather than arbitrary DOM silhouettes. In page combines six effects with actual content, a HoloCSS image transition and a CSS view timeline. Grid makes repeated attachments; page conditions expose reduced motion, fallback, quality tiers and real device loss. The fixed overlay remains a research option; ordinary attachments use one in-flow canvas per element.

## Geometry and HDR (M6)

Select the Geometry family in the playground to explore the four T5 effects. MSAA switches between single sample and 4x HDR resolve. `instances` compares direct draws with reusable render bundles and exposes visible/hidden u64 occlusion results. `terrain` samples a seeded r32float height field and offers an in-place smoothstep remap. `material-ball` samples six-face GGX specular mips and separate diffuse irradiance. `glass` refracts an owned background capture with separate RGB indices; its thickness is a screen-space approximation.

The core exports `perspective`, `lookAt`, `multiplyMat4`, `createCamera`, `cubeMesh`, `sphereMesh`, `planeMesh`, `uploadMesh`, `createGeometryTargets`, `createMeshPipeline` and `createEnvironment`. The [T5 contract](docs/adr/018-minimal-geometry-and-hdr.md) describes conventions and ownership.

`createHDRCanvas(session, canvas, colorSpace)` optionally presents a field's borrowed `output` to a separate, caller-sized opaque float canvas. It composites over black, converts linear sRGB to the selected gamut, and applies its transfer function while preserving values above one. It verifies extended tone mapping through `getConfiguration()` and rejects unsupported configurations (including this Mac's Firefox). Keep the ordinary field available for SDR presentation. Dispose the HDR presenter before destroying its device, and recreate it after device loss.

```ts
import { createHDRCanvas } from '@mk7s/hologpu';

hdrCanvas.width = field.output!.width;
hdrCanvas.height = field.output!.height;
const hdr = await createHDRCanvas(field.session, hdrCanvas, 'display-p3');
const encoder = field.session.device.createCommandEncoder();
hdr.draw(encoder, field.output!);
field.session.device.queue.submit([encoder.finish()]);
// Redraw after field updates; keep dimensions matched when resizing.
hdr.dispose();
```

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
HOLOGPU_URL=http://127.0.0.1:5176 pnpm benchmark:m6 chrome
HOLOGPU_URL=http://127.0.0.1:5176 pnpm benchmark:m6 webkit
pnpm benchmark:m7 chrome
pnpm benchmark:m7 webkit
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
- [M6 validation](docs/m6.md)
- [M7 validation](docs/m7.md)
- [T1 stretch validation](docs/t1-stretch.md)
- [Effect notes and template](docs/notes/_template.md)

`pnpm build` emits package JS/types and the deployable static app in `apps/playground/dist`. Packages are private; remote hosting and registry publication are not configured.
