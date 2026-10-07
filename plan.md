# HoloGPU — WebGPU effects library and playground

**Status:** M0 and M1 complete (2026-10-07); all three Family A T1 stretches implemented. See [M0](docs/m0.md), [M1](docs/m1.md) and [T1 stretch validation](docs/t1-stretch.md).
**Created:** 2026-10-07
**Working package name:** `@mk7s/hologpu` (confirm availability before any release)
**Source:** item 1 of [research.md](../research.md), "WebGPU effects layer for the DOM"
**Purpose:** A research library of WebGPU effects that can be attached to DOM elements, plus a playground page for exploring, tuning, measuring and comparing them.

## 1. How to read this plan

- Sections 2–4 fix the direction, scope and decisions. Section 5 is the architecture. Section 6 is the effect catalogue. Section 7 is the playground. Sections 8–9 are milestones and validation.
- Browser and spec assumptions originally marked **(verify)** were reviewed in M0. See [docs/compatibility.md](docs/compatibility.md) for sources, platform limits and measured results; recheck before release.
- Section 12 lists the questions that need an answer from the user. None of them block M0.

## 2. Direction

### 2.1 What this is

A research project. The goal is to learn what WebGPU makes practical on a web page, and to end up with a reusable runtime and a wide catalogue of working effects. Breadth and technique diversity matter more than polish: an ugly effect that exercises a GPU technique nothing else in the catalogue covers is worth more than a tenth pretty gradient.

Each effect should answer a question, for example "can a 1024² fluid solver and a page of DOM content share a frame budget on an integrated GPU?" The playground is where those questions get answered and recorded.

### 2.2 Goals

1. **A small native WebGPU runtime** (no Three.js, same stance as `holochartv2`) that owns the device, canvases, frame loop, resources and quality scaling.
2. **An effect contract** that covers fragment-only, feedback, compute, geometry and post-process effects with one definition shape, so new effects are cheap to add.
3. **A broad catalogue**: 79 effects across 9 technique families (section 6), of which 47 are the core set and 32 are stretch.
4. **A DOM attachment layer**: `<hgpu-field effect="ink">` and an imperative API that keep a canvas in sync with an element's box, visibility and scroll position.
5. **A playground**: browse, tune, inspect, profile, record and share every effect; edit WGSL live.
6. **Uniforms that other libraries can drive**: HoloCSS motion, scroll progress, pointer, audio.
7. **A research log**: per-effect notes with technique, references, features used, measurements and open problems.

### 2.3 Non-goals

- A general 3D engine, scene graph or asset pipeline (no glTF loader, no material system beyond what a demo needs).
- A WebGL fallback renderer. Without WebGPU the element shows a static fallback (section 5.9).
- Production-ready visual design for the effects. Presets exist to show the parameter space, not to ship on a marketing page.
- npm publication in the first pass. Keep the package publishable but private.

### 2.4 Success criteria

- Every catalogue family has at least three working effects in the playground.
- Every WebGPU capability in the coverage matrix (section 6.11) is exercised by at least one effect.
- A page with six attached effects stays at display refresh rate on an Apple-silicon laptop and degrades automatically, without stalls, on a weaker device.
- A new fragment-tier effect takes under 50 lines including its parameter schema and appears in the playground with generated controls and no playground code changes.
- Each effect has a filled-in research note and a benchmark row.

## 3. Existing context

Inspected on 2026-10-07:

- `research/` contains only `research.md`. There is no Git repository here yet.
- Sibling projects use pnpm 11.15.1 workspaces, Node 22+, TypeScript, Vite, Vitest, Playwright, ESM, and the `@mk7s` scope.
- [`../../holochartv2`](../../holochartv2/README.md) is already native WebGPU and WGSL. It keeps WGSL in TypeScript modules (`packages/render/src/shaders.ts`), has device and resource management (`device.ts`, `resources.ts`, `loop.ts`), and runs Playwright against a software adapter with `--enable-unsafe-webgpu --use-angle=swiftshader`. Reuse the patterns, and read those files before writing the HoloGPU equivalents, but do not depend on the package: chart rendering and effect rendering have different needs.
- [`../../holocss`](../../holocss/README.md) is the CSS and motion library. Its runtime mixes CSS transitions, the Web Animations API and `requestAnimationFrame` drivers, with optional GSAP and anime bridges under `src/engines`, `src/gsap` and `src/anime`. This partly answers the open question at the end of `research.md`: uniform driving must work with both CSS-driven and rAF-driven sources (section 5.8).

## 4. Decisions and assumptions

| # | Decision | Reason |
| --- | --- | --- |
| D1 | Native WebGPU and WGSL, zero runtime dependencies in the core packages | Matches `holochartv2`; the point is to learn the API, not wrap an engine |
| D2 | pnpm workspace with separate `core`, `effects`, `dom` packages and a `playground` app | Effects must be tree-shakeable one by one; the DOM layer must be optional |
| D3 | One shared `GPUDevice` per page, one `<canvas>` per attached element | M0 confirms six canvases sharing a device, correct in-flow scrolling and material target memory cost; no unlimited context count is promised. See [ADR-001](docs/adr/001-shared-device-in-flow-canvases.md). An overlay-canvas mode is a research spike, not the default (section 5.3) |
| D4 | Parameter schema in TypeScript is the source of truth; the WGSL uniform struct, buffer layout and playground controls are generated from it | One definition, no WGSL parser dependency, and controls come for free |
| D5 | Effects render to `rgba16float` internally by default and resolve to the canvas format in a final pass | M0 confirms internal float targets across engines; HDR canvas support is separately gated (Firefox rejects it). See [ADR-002](docs/adr/002-internal-float-targets.md) |
| D6 | Simulations use a fixed timestep with a seeded GPU hash PRNG | Reproducible pixels for tests and for comparing parameter changes |
| D7 | Class and attribute prefix `hgpu-`, custom element `<hgpu-field>`, custom property prefix `--hgpu-` | Parallel to HoloCSS `hcss-`; custom element names need a hyphen, so `research.md`'s `<gpu-field>` becomes `<hgpu-field>` |
| D8 | Playground chrome is built with HoloCSS | Dogfoods the sibling library and keeps the playground from needing its own CSS. Depends on Q2 |
| D9 | Desktop Chromium is the development target; Safari and Firefox are validation targets | Best tooling and the widest feature set, including timestamp queries |

M0 review: WebGPU ships on the cited primary desktop platforms, with Firefox macOS support scoped to Apple Silicon. Linux/Android coverage remains platform-dependent. Chromium ships `requestAdapter({ featureLevel: 'compatibility' })` for older Android GPUs; accepting the option in Firefox/WebKit does not prove reduced limits. See the [browser support matrix](docs/compatibility.md).

## 5. Architecture

### 5.1 Repository layout

```
hologpu/
  plan.md
  package.json  pnpm-workspace.yaml  tsconfig.base.json
  packages/
    core/        device, surfaces, scheduler, resources, params, wgsl chunks, passes
    effects/     one directory per effect; each is a separate export
    dom/         <hgpu-field>, attach(), layout sync, input sources, uniform bridges
  apps/
    playground/  Vite app: gallery, stage, inspector, editor, profiler
  docs/
    notes/       one research note per effect (rendered inside the playground)
    adr/         decision records
    benchmarks/  recorded results as JSON
  tests/
    browser/     Playwright pixel, lifecycle and device-loss tests
```

Package exports: `@mk7s/hologpu` (core), `@mk7s/hologpu/effects/<id>`, `@mk7s/hologpu/dom`, `@mk7s/hologpu/element` (side-effect import that registers the custom element).

### 5.2 Core runtime (`packages/core`)

| Module | Responsibility |
| --- | --- |
| `device` | Lazy singleton adapter and device. Requests optional features only when an effect declares them. Exposes a capability report (features, limits, adapter info, preferred canvas format). Handles `device.lost` and `uncapturederror` |
| `surface` | Wraps one canvas and its `GPUCanvasContext`: configure, resize, alpha mode, colour space, tone mapping |
| `scheduler` | One `requestAnimationFrame` loop for the page. Tracks which surfaces are visible, runs fixed-step simulation updates, submits one command buffer per frame where possible, measures frame time |
| `resources` | Keyed caches for shader modules, pipelines, samplers and bind group layouts. Pooled transient textures. Reference counting so a detached effect frees its GPU memory |
| `params` | Schema types, std140-style layout packing, uniform buffer writes with dirty tracking, WGSL struct generation |
| `wgsl` | A tagged-template composer with de-duplicated chunks: hash and PRNG, noise (value, gradient, simplex, Worley, curl), colour (sRGB, OKLab, OKLCH, tone mapping), SDF primitives, fullscreen-triangle vertex stage, sampling helpers |
| `passes` | Reusable building blocks: fullscreen pass, ping-pong target pair, compute dispatch helper, separable blur, mip chain, jump flood, blit and resolve |
| `quality` | Resolution scale, simulation grid scale, particle count scale, step-rate scale, driven by measured frame time and by tier overrides |
| `debug` | Labels on every GPU object, error scopes around pipeline creation, `getCompilationInfo` diagnostics mapped back to chunk and line, intermediate-texture taps for the playground |

Pipelines are created with `createRenderPipelineAsync` and `createComputePipelineAsync` so attaching an effect never blocks a frame. An effect is hidden until its pipelines resolve.

### 5.3 Canvas strategy

Default: each attached element gets its own in-flow canvas, sized from `ResizeObserver` using `devicePixelContentBoxSize` where available so the backing store is pixel-exact, and configured with `alphaMode: 'premultiplied'` so it composites over the page. All canvases share the device, so pipelines, shader modules and noise textures are shared.

Research spike (M5): a single `position: fixed` viewport canvas that draws every visible effect with viewport and scissor rects. It saves swap-chain memory and lets effects bleed across element boundaries, but the canvas is drawn on the main thread while scrolling happens on the compositor, so effects lag the page by a frame or more. Measure the drift and memory difference and record a decision in an ADR.

Second spike (M8): move rendering to a worker with `transferControlToOffscreen` and measure main-thread jank isolation against the cost of marshalling inputs.

### 5.4 Effect contract

```ts
export default defineEffect({
  id: 'reaction-diffusion',
  family: 'feedback',
  title: 'Reaction-diffusion (Gray-Scott)',
  features: [],                      // optional GPUFeatureName[]; effect is unavailable without them
  params: {
    feed:  { type: 'f32', default: 0.055, min: 0, max: 0.1, step: 0.0005 },
    kill:  { type: 'f32', default: 0.062, min: 0, max: 0.1, step: 0.0005 },
    tint:  { type: 'color', default: '#39f' },
    steps: { type: 'u32', default: 8, min: 1, max: 32, uniform: false },
  },
  inputs: ['pointer'],               // built-in sources the effect consumes
  presets: { coral: { feed: 0.0545, kill: 0.062 }, mitosis: { feed: 0.0367, kill: 0.0649 } },
  quality: { gridScale: [0.25, 1] }, // ranges the quality controller may move within
  create(ctx) {                      // allocate pipelines and resources; may be async
    return {
      resize(size) {},
      update(frame) {},              // fixed-step simulation; may run 0..n times per frame
      render(frame, target) {},      // draw into the surface's target
      reset(seed) {},
      dispose() {},
    };
  },
});
```

Tiers, from least to most code. Helpers in `passes` make the lower tiers almost declarative:

| Tier | Shape | Helper |
| --- | --- | --- |
| T1 Fragment | One fullscreen fragment shader, no state | `fragmentEffect({ params, wgsl })` |
| T2 Feedback | Ping-pong textures updated by fragment or compute, then a display pass | `feedbackEffect({ state, step, display })` |
| T3 Compute particles | Storage buffers updated by compute, instanced or point draw | `particleEffect({ layout, simulate, draw })` |
| T4 Post-process | Input texture to output texture; chainable | `filterEffect({ wgsl })` and `chain(a, b, c)` |
| T5 Geometry / custom | Full control: depth, MSAA, multiple passes, indirect draws | `defineEffect` directly |

Every effect receives a standard frame uniform block: time, delta, frame index, resolution, device pixel ratio, pointer position, velocity and button state, scroll progress, element visibility ratio, and seed.

### 5.5 Parameters

Supported schema types: `f32`, `i32`, `u32`, `bool`, `vec2`, `vec3`, `vec4`, `color` (parsed with CSS colour syntax, converted to linear), `enum`, `curve` (baked to a 1D LUT texture), `gradient` (baked to a LUT texture), `texture` (bound input). Each entry carries a default, range, step, unit, group and description. Entries marked `uniform: false` are CPU-side controls, such as iteration counts or grid sizes, that trigger `resize` or pipeline changes instead of a buffer write.

The schema generates: the WGSL `Params` struct, the uniform buffer layout, the playground controls, the custom element's observed attributes, URL serialisation, and the parameter table in each research note.

### 5.6 Inputs

| Source | Mechanism |
| --- | --- |
| Pointer | Pointer Events with `getCoalescedEvents()`; position, velocity, pressure, buttons; splat list for sims |
| Scroll | Element progress through the viewport, and page scroll velocity |
| Time | Scheduler clock; scrubbable and pausable from the playground |
| Image | `createImageBitmap` then `copyExternalImageToTexture`, with generated mips |
| Video and webcam | `importExternalTexture` per frame; `requestVideoFrameCallback` to avoid redundant uploads |
| Canvas | Another canvas, including a Holochart canvas, copied as a texture |
| Text | Rasterised through a 2D canvas for masks; an SDF path later, borrowing from `holochartv2`'s `sdf.ts` |
| Audio | `AnalyserNode` FFT and waveform written to a small texture each frame |
| DOM rects | Bounding boxes of elements tagged `data-hgpu-obstacle`, packed into a storage buffer and optionally rasterised to an SDF by jump flood, so simulations collide with page layout |
| DOM pixels | Experimental HTML-in-canvas origin trial; `GPUQueue.copyElementImageToTexture` in Chrome 150–154, renamed in the newer 155 API generation ([M0 review](docs/compatibility.md#html-in-canvas-section-56)); feature-detected, off by default, Chromium only |

The DOM-rects input is the most distinctive piece of the "effects layer for the DOM" idea and deserves its own early spike: fluid that flows around headings needs only rectangles, not DOM rasterisation.

### 5.7 DOM layer (`packages/dom`)

```html
<hgpu-field effect="ink" preset="sumi" style="--hgpu-viscosity: 0.4">
  <h1>Content stays in the light DOM and stays accessible</h1>
</hgpu-field>
```

```ts
import { attach } from '@mk7s/hologpu/dom';
import ink from '@mk7s/hologpu/effects/ink';

const field = await attach(element, ink, { params: { viscosity: 0.4 }, layer: 'behind' });
field.params.viscosity = 0.8;   // plain property, drivable by any tween engine
field.pause(); field.reset(); field.destroy();
```

Behaviour:

- The canvas is inserted in a shadow root behind or in front of slotted content, marked `aria-hidden`, with `pointer-events: none` unless the effect takes pointer input. Light-DOM content is never moved or replaced.
- `ResizeObserver` drives backing-store size. `IntersectionObserver` pauses rendering and simulation off-screen, with a margin so effects are warm when they scroll in. `visibilitychange` pauses everything in a background tab.
- Effects are loaded with dynamic `import()` by id, so a page pays only for what it uses.
- `prefers-reduced-motion`: time-driven motion stops, the effect renders one settled frame, and pointer-driven response stays available at reduced intensity. Each effect can declare a better reduced-motion pose.
- Lifecycle events: `hgpu-ready`, `hgpu-fallback`, `hgpu-lost`, `hgpu-restored`, `hgpu-quality`.

### 5.8 Driving uniforms from other libraries

Three bridges, cheapest first:

1. **Properties.** `field.params.x = value`. Works with any rAF tween engine, GSAP, anime and HoloCSS's engine bridges.
2. **CSS custom properties.** Parameters opted in with `css: true` are registered through `CSS.registerProperty` as typed, non-inheriting properties and read from computed style once per frame while the element is visible. This lets CSS transitions, keyframes and scroll-driven animations (`animation-timeline: view()`) drive shader uniforms with no JavaScript. Measure the per-frame style read cost in M5 and cap the number of bound parameters.
3. **Timeline.** `field.timeline(progress)` accepts an external 0–1 clock, which is the hook for the unified timeline described at the end of `research.md`.

### 5.9 Quality, fallback and failure

- **Quality controller.** Keeps a moving average of frame time. When over budget it lowers, in order: render resolution scale, simulation steps per frame, simulation grid scale, particle count. It raises them again with hysteresis. Effects declare the ranges they tolerate. Where the Compute Pressure API exists (Chromium 125+; CPU pressure only, feature- and policy-gated ([M0 review](docs/compatibility.md#compute-pressure-section-59))), it is a second signal.
- **Device pixel ratio cap** of 2 by default, lower under pressure.
- **No WebGPU, no adapter, or a required feature missing:** the element gets `data-hgpu-state="fallback"` and shows, in order of preference, an author-supplied poster image, an effect-supplied CSS fallback (usually a gradient), or nothing. Content is unaffected.
- **Device loss:** stop the loop, show the last presented frame or the poster, request a new device, rebuild pipelines and resources, reset simulations, resume. The playground has a button that calls `device.destroy()` to test this path.
- **Memory budget:** the resource manager tracks approximate texture and buffer bytes per effect and refuses or downscales allocations above a page budget.

## 6. Effect catalogue

Organised by GPU technique, not by look. **Core** effects are the first-pass target; **stretch** effects are built if time allows or if a research question calls for them. Column "probes" is the question or capability the effect exists to exercise.

### 6.1 Family A — Procedural fields (T1)

| Id | Effect | Probes | |
| --- | --- | --- | --- |
| `gradient-oklch` | Animated multi-stop mesh gradient in OKLCH | Colour-space maths, dithering against banding | Core |
| `noise-lab` | Value, gradient, simplex, Worley and curl noise with fBm and domain warping, switchable | The shared noise chunk library; cost per octave | Core |
| `voronoi` | Cellular patterns with distance metrics and animated sites | Loop-heavy fragment cost | Core |
| `sdf-2d` | Metaballs and boolean SDF shapes with smooth union | SDF chunk library, analytic anti-aliasing | Core |
| `raymarch` | Sphere-traced 3D SDF scene with soft shadows and ambient occlusion | Per-pixel iteration budget, resolution scaling | Core |
| `fractal` | Julia and Mandelbrot with smooth colouring and zoom | Precision limits of `f32`; emulated double precision | Core |
| `truchet` | Truchet and hex arc tilings; quasi-crystal interference contours | Integer and bit operations in WGSL | Stretch — implemented |
| `caustics` | Procedural water caustics | Derivative functions | Stretch — implemented |
| `starfield` | Layered parallax star and nebula field | Hash quality, temporal stability | Stretch — implemented |

### 6.2 Family B — Feedback and cellular simulation (T2)

| Id | Effect | Probes | |
| --- | --- | --- | --- |
| `reaction-diffusion` | Gray-Scott with a feed/kill parameter map | Ping-pong float targets, multiple steps per frame | Core |
| `life` | Game of Life and other life-like rules | Integer textures, `r32uint` read-write storage | Core |
| `lenia` | Continuous cellular automaton with a kernel LUT | Large-kernel convolution cost | Core |
| `wave` | 2D wave equation with pointer drops and refraction display | Two-buffer history, stability limits | Core |
| `physarum` | Slime mould: agents in a storage buffer deposit into a trail texture that diffuses | Compute and feedback coupling, atomics or additive splatting | Core |
| `falling-sand` | Margolus-neighbourhood sand, water and fire | Race-free updates with block CA | Core |
| `fire` | Classic heat-propagation fire | Cheapest stateful effect; baseline measurement | Stretch |
| `ising` | Ising model with checkerboard updates | In-shader PRNG quality | Stretch |
| `sandpile` | Abelian sandpile | Integer-exact simulation | Stretch |
| `erosion` | Hydraulic erosion on a height field with shaded display | Multi-channel state, long-running stability | Stretch |

### 6.3 Family C — Fluids (T2, compute)

| Id | Effect | Probes | |
| --- | --- | --- | --- |
| `fluid` | Stable fluids: advection, divergence, Jacobi pressure, projection, vorticity confinement, dye | The reference multi-pass solver; iteration count against quality | Core |
| `ink` | `fluid` plus a pigment and paper-absorption model; the `research.md` example preset | Layering a material model on a solver | Core |
| `smoke` | Buoyancy and temperature fields with self-shadowed display | Extra coupled fields | Core |
| `fluid-obstacles` | `fluid` with DOM rects as solid boundaries | The DOM-rects input (section 5.6) | Core |
| `lattice-boltzmann` | D2Q9 lattice Boltzmann with vortex shedding | Storage-buffer layout against textures; a second solver family | Stretch |
| `shallow-water` | Height-field water with a normal-mapped surface | Simulation feeding a lit 3D surface | Stretch |
| `multigrid` | `fluid` with a multigrid pressure solve | Solver convergence per millisecond against Jacobi | Stretch |

### 6.4 Family D — Particles and agents (T3)

| Id | Effect | Probes | |
| --- | --- | --- | --- |
| `flow-particles` | One million points advected through curl noise with trails | Raw compute throughput; point against quad rendering | Core |
| `attractors` | Lorenz, Aizawa, Clifford and De Jong attractors with additive accumulation | HDR accumulation and tone mapping | Core |
| `boids` | Flocking with a uniform-grid neighbour search | Spatial hashing built from GPU sort and prefix sum (family I) | Core |
| `n-body` | Gravitational n-body, brute force then grid-accelerated | Quadratic compute scaling; workgroup tiling | Core |
| `emitters` | Lifetimes, spawn and death with a free list; fireworks and sparks | Dynamic counts, indirect draw | Core |
| `morph-particles` | Particles that assemble into text or an image and scatter on pointer | Text and image inputs as particle targets | Core |
| `pbf-fluid` | Position-based fluid in 2D with screen-space surface rendering | Constraint solving, neighbour search under load | Stretch |
| `cloth` | Verlet cloth and ropes with pins and pointer drag | Graph-coloured constraint passes | Stretch |
| `mpm` | Material point method: snow, jelly, liquid | Particle-to-grid and grid-to-particle transfers | Stretch |
| `ribbons` | Trail ribbons with generated geometry | Geometry built in compute | Stretch |

### 6.5 Family E — Image and post-process filters (T4)

All take a texture input (image, video, webcam, another effect) and can be chained.

| Id | Effect | Probes | |
| --- | --- | --- | --- |
| `blur` | Separable Gaussian, dual Kawase and box, switchable | Blur cost against radius; the shared blur pass | Core |
| `bloom` | Threshold, mip-chain down and up sampling, composite | Mip chain pass, HDR | Core |
| `color-grade` | 3D LUT, tone mapping operators, lift/gamma/gain | 3D textures | Core |
| `lens` | Chromatic aberration, barrel distortion, vignette, film grain | Cheap single-pass stack | Core |
| `dither` | Bayer, blue-noise and palette quantisation; CRT and scanline mode | Blue-noise texture generation | Core |
| `halftone-ascii` | Halftone dots and glyph-atlas ASCII rendering | Glyph atlas sampling | Core |
| `edges` | Sobel, toon and Kuwahara painterly filters | Neighbourhood filters, anisotropic variants | Core |
| `displace` | Refraction, liquid, ripple and glass distortion from a normal or flow map | Distortion driven by another effect's output | Core |
| `glitch` | Block shifting, channel split, datamosh-style motion smearing | Feedback inside a filter | Stretch |
| `pixel-sort` | Threshold-interval pixel sorting | Compute sort on image rows | Stretch |
| `slit-scan` | Temporal slit-scan and frame echo | Texture-array history buffer | Stretch |
| `optical-flow` | Flow estimation from video driving displacement or particles | Video as a simulation input | Stretch |
| `fft-filter` | Frequency-domain filtering with a compute FFT | The FFT primitive (family I) | Stretch |

### 6.6 Family F — Distance fields and 2D light (T2, T4)

| Id | Effect | Probes | |
| --- | --- | --- | --- |
| `jump-flood` | Jump flooding from a mask to a distance field, with outline, glow and Voronoi displays | The JFA pass used by other effects | Core |
| `shadows-2d` | Soft shadows and lights cast by DOM rects or a text mask | SDF ray marching in 2D | Core |
| `radiance-cascades` | 2D global illumination with radiance cascades | A recent technique; memory and quality trade-offs | Core |
| `stipple` | Weighted Voronoi stippling of an image | Iterative Lloyd relaxation on the GPU | Stretch |

### 6.7 Family G — Geometry and 3D (T5)

| Id | Effect | Probes | |
| --- | --- | --- | --- |
| `instances` | A large instanced field of meshes displaced by noise | Instancing, depth, MSAA, render bundles | Core |
| `terrain` | Height-field terrain with fog and a moving camera | Vertex-stage displacement, index buffers | Core |
| `material-ball` | A physically based material preview with image-based lighting | Cube maps, prefiltered environment mips | Core |
| `glass` | Refraction and dispersion through a mesh with a background capture | Multi-pass scene capture | Core |
| `marching-cubes` | 3D metaballs meshed in compute | Compute-generated geometry, indirect draw | Stretch |
| `volumetric` | Ray-marched clouds or fog with temporal reprojection | 3D noise textures, temporal accumulation | Stretch |
| `path-tracer` | Progressive compute path tracer for a small scene | Compute-only rendering, accumulation, BVH in buffers | Stretch |
| `splats` | Gaussian splat viewer with GPU depth sort | The sort primitive on real data | Stretch |
| `voxels` | Voxel grid ray casting with DDA | 3D texture traversal | Stretch |
| `culling` | GPU-driven frustum culling of many instances | Indirect multi-draw patterns, occlusion queries | Stretch |

### 6.8 Family H — DOM-coupled and input-driven (mixed tiers)

| Id | Effect | Probes | |
| --- | --- | --- | --- |
| `border-energy` | Animated border or glow that follows an element's rounded-rect shape | Element geometry as an analytic SDF | Core |
| `spotlight` | Pointer-following light and reveal across several elements | One effect spanning multiple surfaces | Core |
| `image-hover` | Image distortion and transition on hover or scroll | The CSS custom property bridge (section 5.8) | Core |
| `text-dissolve` | Text that dissolves into particles and reforms | Text mask input; accessible text left in the DOM | Core |
| `audio-spectrum` | Spectrum bars, oscilloscope and an FFT terrain | Audio input texture | Core |
| `scroll-scene` | An effect whose parameters are scrubbed by a CSS scroll timeline | Off-main-thread scroll driving uniforms | Core |
| `transition-wipe` | Shader wipes between two captured states, used with View Transitions | Capturing before and after images | Stretch |
| `backdrop-glass` | Refraction of real page content behind an element | HTML-in-canvas experiment; expected to be Chromium-only | Stretch |
| `chart-post` | Post-processing a Holochart canvas | Canvas-to-texture interop with `holochartv2` | Stretch |

### 6.9 Family I — Compute primitives (library code with visual demos)

These are building blocks. Each gets a playground page that visualises the algorithm and benchmarks it.

| Id | Primitive | Used by | |
| --- | --- | --- | --- |
| `prefix-sum` | Parallel prefix sum and stream compaction | `boids`, `emitters`, `pbf-fluid` | Core |
| `sort` | Radix sort and bitonic sort over key-value pairs | `boids`, `splats`, `pixel-sort` | Core |
| `spatial-hash` | Uniform grid construction from sort and prefix sum | `boids`, `n-body`, `pbf-fluid` | Core |
| `mipgen` | Mip generation for 2D and cube textures | `bloom`, `material-ball`, image inputs | Core |
| `histogram` | Image histogram and auto-exposure with atomics | `color-grade` | Stretch |
| `fft` | 2D FFT | `fft-filter`, ocean variants | Stretch |
| `blue-noise` | Void-and-cluster blue-noise generation | `dither`, temporal jitter | Stretch |

### 6.10 Counts

| Family | Core | Stretch |
| --- | --- | --- |
| A Procedural | 6 | 3 |
| B Feedback | 6 | 4 |
| C Fluids | 4 | 3 |
| D Particles | 6 | 4 |
| E Filters | 8 | 5 |
| F Distance and light | 3 | 1 |
| G Geometry | 4 | 6 |
| H DOM-coupled | 6 | 3 |
| I Primitives | 4 | 3 |
| **Total** | **47** | **32** |

Forty-seven core effects is a large first pass. Within each table the Core rows are in priority order, so if a milestone runs long, cut the last one or two core effects from a family. Do not cut a whole family: breadth across techniques is the point.

### 6.11 WebGPU capability coverage

Each capability must be exercised by at least one effect. Optional features are requested only when present, and the effect records what it does without them.

| Capability | Exercised by |
| --- | --- |
| Compute pipelines and storage buffers | Families C, D, I |
| Read-write storage textures (`r32float`, `r32uint`) | `life`, `wave` |
| Float render targets and ping-pong | Families B, C |
| Instancing, depth, MSAA | `instances`, `terrain` |
| Indirect draw | `emitters`, `marching-cubes`, `culling` |
| Render bundles | `instances` |
| 3D textures, cube maps, texture arrays | `color-grade`, `material-ball`, `slit-scan` |
| External textures (video) | Family E with video input, `optical-flow` |
| Atomics in WGSL | `physarum`, `histogram` |
| Timestamp queries (`timestamp-query`) | Playground profiler |
| Occlusion queries | `culling` |
| HDR canvas (`rgba16float` canvas with extended tone mapping, Display P3) | `attractors`, `bloom` ([M0 review](docs/compatibility.md#hdr-canvas-section-611); Firefox float canvas rejected, internal float textures work) |
| `float32-filterable` | `fluid` at high precision; fallback to `rgba16float` |
| `shader-f16` | `flow-particles` memory variant |
| Dual-source blending, clip distances, subgroups, texture format tiers | One experiment each in M8, only where the feature exists ([verified feature strings and local availability](docs/compatibility.md#optional-feature-names-and-availability-section-611)) |
| Compatibility feature level | Run the T1 and T4 effects under it in M8 ([M0 request/limit probe](docs/compatibility.md#compatibility-feature-level-sections-4-and-611)) |
| Worker rendering with `OffscreenCanvas` | M8 spike (section 5.3) |

## 7. Playground

A single Vite app at `apps/playground`, deployable as static files. It is the primary deliverable alongside the library, and every effect must be fully usable in it.

### 7.1 Layout

```
+-----------+---------------------------------------+---------------+
| Browser   | Stage                                 | Inspector     |
|  search   |  (canvas, or a mock page in DOM mode) |  presets      |
|  families |                                       |  parameters   |
|  tags     |                                       |  inputs       |
|  status   |                                       |  quality      |
+-----------+---------------------------------------+---------------+
| Drawer: Source | Passes | Profiler | Capabilities | Notes         |
+-------------------------------------------------------------------+
```

### 7.2 Features

**Effect browser**
- Grouped by family, with search and filter by tier, technique tag, required feature and Core or Stretch.
- Each entry shows availability on the current device: available, degraded (optional feature missing), or unavailable with the reason.
- Gallery view with live low-resolution thumbnails, capped to a few running at once, and captured posters for the rest.

**Stage**
- Modes: *Full* (one effect fills the stage), *In page* (a mock article with several `<hgpu-field>` elements, to test layout sync, scrolling and multiple instances), *Grid* (N copies, for multi-instance stress), *Compare* (two parameter sets or two effects side by side with a draggable split).
- Transport: play, pause, single step, time scale, reset, and a seed field.
- Resolution scale and device-pixel-ratio override; fixed-size presets for repeatable benchmarks.
- Background selector (transparent over a checkerboard, light, dark, image) to check alpha compositing.

**Inspector**
- Controls generated from the parameter schema: sliders, number fields, colour pickers, gradient and curve editors, enum selects, toggles. Grouped and searchable.
- Preset list with save, rename, export and import as JSON, and "copy as HTML" and "copy as JS" snippets for the current state.
- Input sources: sample images, sample video, webcam, microphone or audio file, text, pointer recording and playback.
- Randomise within ranges, and reset to default per parameter.
- Simulated conditions: reduced motion, forced quality tier, forced fallback, simulated device loss.

**Drawer**
- *Source:* the composed WGSL for each stage, with chunk boundaries shown. Editable; recompiles on change with diagnostics from `getCompilationInfo` shown inline, and keeps the last good pipeline running on error. Edits are local to the session and can be exported as a patch.
- *Passes:* a list or graph of the effect's passes and resources, with a tap to view any intermediate texture (channel select, range remap, false colour for float data) and buffer summaries.
- *Profiler:* CPU frame time, per-pass GPU time from timestamp queries where available, frame-time histogram, current quality settings, estimated GPU memory. A benchmark button runs a fixed scenario and appends a row to a results table that exports as JSON for `docs/benchmarks`.
- *Capabilities:* adapter info, features, limits, preferred format, and which catalogue effects each missing feature disables.
- *Notes:* the effect's research note rendered from `docs/notes/<id>.md`.

**Sharing and capture**
- The URL encodes effect, parameters, preset, seed and stage mode, so any state is a link.
- Screenshot to PNG and recording to video through `canvas.captureStream()` and `MediaRecorder`.

### 7.3 Implementation notes

- Chrome built with HoloCSS components (tabs, menus, dialogs, form controls, toasts) if Q2 confirms; otherwise a minimal local stylesheet. No UI framework is needed: the playground is a few custom elements and a small store.
- The WGSL editor starts as a `<textarea>` with a highlighted overlay. Adopt CodeMirror only if editing proves central to the workflow, and then load it lazily.
- The playground consumes the library only through public exports, so it doubles as an integration test of the API.
- Keyboard: arrow keys to move between effects, space to pause, `.` to step, `r` to reset, `/` to search.

### 7.4 Research notes

One Markdown file per effect in `docs/notes`, with a fixed template: question, technique summary, references, passes and resources, WebGPU features used, parameters (generated), measurements on each test device, failure modes, and what would make it production-ready. The template is created in M1 and a note is part of each effect's definition of done.

## 8. Milestones

Each milestone ends with the playground deployable and the listed exit criteria met.

### M0 — Foundations and spikes

**Completed 2026-10-07.** All four spikes are implemented and recorded in [ADRs](docs/m0.md). D3 and D5 are retained with the documented qualifications. `pnpm check`, hardware engine tests and the static app build pass; native Safari/Firefox smoke results and benchmark records are linked from the [validation record](docs/m0.md).

- Initialise Git, the pnpm workspace, TypeScript, Vite, Vitest, Playwright with the software-adapter flags used by `holochartv2`, Prettier and CI scripts (`pnpm check`).
- Verify every **(verify)** item in this plan and write the browser support matrix to `docs/compatibility.md`.
- Spike 1: fullscreen triangle on an in-flow canvas with resize, DPR and premultiplied alpha, in Chrome, Safari and Firefox.
- Spike 2: six canvases on one device, scrolled; measure memory and frame time.
- Spike 3: a compute pass writing a storage buffer that a render pass reads.
- Spike 4: Playwright pixel readback under SwiftShader, to confirm tests can be deterministic.
- **Exit:** spikes recorded in ADRs; D3 and D5 confirmed or revised.

### M1 — Core runtime, T1 tier, playground shell

**Completed 2026-10-07.** The shared runtime, six Family A effects and Full-stage shell are implemented. The [frozen T1 contract](docs/adr/005-t1-effect-contract.md), [19-line authoring example](examples/bands.ts), research notes and Chrome/WebKit measurements are linked from the [M1 validation record](docs/m1.md). `pnpm check` and both hardware-engine effect suites pass. Texture-backed schema types are reserved for M4's input/binding layer.

- `core`: device, surface, scheduler, resources, params with WGSL generation, the wgsl composer and the hash, noise, colour and SDF chunks, the fullscreen pass.
- `fragmentEffect` helper and the six Family A core effects.
- Playground: browser, Full stage, generated inspector, URL state, Source drawer (read-only), Capabilities drawer, CPU frame time.
- Research note template; notes for the Family A effects.
- **Exit:** the 50-line criterion in section 2.4 is met; the effect contract is frozen for T1.

### M2 — Feedback and fluids

- Ping-pong targets, fixed-step updates, the compute dispatch helper, `feedbackEffect`.
- Family B core, then Family C core except `fluid-obstacles`.
- Playground: transport controls, seed, Passes drawer with texture taps, pointer input.
- Quality controller, first version (resolution and step scaling).
- **Exit:** `reaction-diffusion` and `fluid` run at display refresh rate at 1024² on the development machine; pixel tests are deterministic for a fixed seed and step count.

### M3 — Compute particles and primitives

- `particleEffect`, storage buffer layouts, point and instanced-quad drawing, additive HDR accumulation and tone mapping.
- Family I core (`prefix-sum`, `sort`, `spatial-hash`, `mipgen`), each with unit-style GPU tests that compare against a CPU reference.
- Family D core.
- Playground: Profiler drawer with timestamp queries, benchmark runner, live WGSL editing.
- **Exit:** one million particles in `flow-particles` on the development machine; `boids` neighbour search verified against a CPU reference at small N.

### M4 — Inputs and filters

- Image, video, webcam, canvas, text-mask and audio inputs; mip generation for inputs.
- `filterEffect` and `chain`; Family E core; Family F core.
- Playground: input source picker, Compare mode, screenshot and recording.
- **Exit:** any filter can take any other effect's output as input; a four-filter chain on 1080p video holds refresh rate.

### M5 — DOM layer

- `attach()` and `<hgpu-field>`: shadow-root canvas, observers, lazy effect loading, lifecycle events, fallback and poster handling, reduced motion.
- DOM-rects input and `fluid-obstacles`; Family H core.
- The three uniform bridges (section 5.8), with a HoloCSS demo and a CSS scroll-timeline demo.
- Overlay-canvas spike and ADR (section 5.3).
- Device-loss recovery, end to end.
- Playground: In page and Grid stage modes, simulated conditions.
- **Exit:** the six-effect page criterion in section 2.4; device loss recovers without a reload; the page is usable with WebGPU disabled.

### M6 — Geometry and 3D

- Depth, MSAA, camera and matrix helpers (minimal), mesh primitives, cube maps.
- Family G core.
- **Exit:** every row of the capability matrix that does not depend on an optional feature is covered.

### M7 — Stretch effects

Family A’s three T1 stretches are implemented early at the user’s request; see [validation](docs/t1-stretch.md). Other stretch families remain outstanding.

- Stretch effects, chosen by which open research question they answer. Suggested first picks: `mpm`, `path-tracer`, `lattice-boltzmann`, `pbf-fluid`, `splats`, `backdrop-glass`.
- Remaining Family I primitives as their dependants need them.

### M8 — Hardening and write-up

- Safari and Firefox passes over the whole catalogue; fixes or documented gaps.
- Optional-feature experiments from the capability matrix; compatibility feature level run; worker-rendering spike.
- Memory budget enforcement, leak checks over attach and detach cycles, long-run stability.
- Benchmarks on at least three device classes (Q4), recorded in `docs/benchmarks`.
- A findings document: what worked, what WebGPU still makes hard, and a recommendation on whether and how to turn this into a product library, including how it should meet the unified timeline in `research.md`.

### Ordering and parallel work

M0 and M1 are sequential and should be done in one thread, because every later piece depends on the contract. After M1, effects within a family are independent of each other and of the playground features listed in the same milestone, so M2 onward can be split into up to four parallel workstreams (for example: two effect families, the playground features, and tests and notes). The primitives in Family I must land before the Family D effects that use them.

## 9. Testing and validation

| Layer | Tool | What it checks |
| --- | --- | --- |
| Unit | Vitest | Parameter layout packing and alignment, WGSL struct generation, the composer's chunk de-duplication, scheduler stepping, quality controller hysteresis, URL state round-trips |
| Shader compile | Playwright | Every effect's composed WGSL compiles with no errors or warnings in `getCompilationInfo`, across its parameter-driven variants |
| GPU correctness | Playwright | Compute primitives against CPU references; conservation checks for simulations where one exists (for example total dye mass, particle count) |
| Pixel | Playwright, software adapter | Fixed seed, fixed step count, fixed size; compare against stored images with a tolerance. One image per effect, per preset for core effects |
| Lifecycle | Playwright | Attach and detach, resize, scroll in and out of view, tab hide, device loss and recovery, WebGPU disabled, reduced motion |
| Performance | Playground benchmark runner, real hardware | Frame time and GPU pass time per effect per device class; not run in CI |
| Manual | Checklist per milestone | Safari and Firefox behaviour, HDR display behaviour, touch input |

Software-adapter pixel tests catch regressions but say nothing about hardware behaviour or speed. Hardware results are recorded by hand through the benchmark runner.

## 10. Definition of done for an effect

- Defined through the contract, exported individually, with a parameter schema that has ranges, groups and descriptions.
- At least two presets that show different regions of the parameter space.
- Declares its inputs, optional features and quality ranges; has a reduced-motion pose and a CSS or poster fallback.
- Disposes all GPU resources; passes the attach and detach leak test.
- Has a compile test and a deterministic pixel test.
- Has a completed research note and at least one benchmark row.

## 11. Risks

| Risk | Mitigation |
| --- | --- |
| Catalogue breadth crowds out runtime quality | The contract is frozen in M1 with real effects; Core before Stretch; cut effects, never families |
| Browser differences in WGSL compilers, limits and optional features | Chromium first; a compatibility pass in M8; optional features always have a fallback path |
| Software-adapter tests are slow or behave differently from hardware | Small fixed sizes and step counts; tolerances; correctness tests against CPU references rather than images where possible |
| Many canvases cost too much memory | Measured in M0 spike 2; off-screen surfaces release their targets; the overlay spike is the alternative |
| Reading custom properties every frame is slow | Opt-in per parameter, read only while visible, measured in M5; the property bridge is always available |
| Device loss and tab backgrounding leave simulations in a bad state | Simulations can always re-seed; recovery is tested in CI by destroying the device |
| HTML-in-canvas does not ship or changes shape | Only `backdrop-glass` depends on it, and it is a stretch effect; DOM rects cover the main DOM-coupling idea |
| Float texture precision or filtering is unavailable on some devices | `rgba16float` as the baseline; manual bilinear sampling where filtering is missing |
| Scope creep toward a 3D engine | Family G is capped; no scene graph, no loaders |
| Thermal throttling makes benchmarks unrepeatable | Fixed scenarios, warm-up period, record device state, several runs |

## 12. Open questions for the user

- **Q1. Location.** Should `hologpu` stay under `research/` or move beside `holocss` and `holochartv2` once it has code? This plan assumes it stays here for now.
- **Q2. HoloCSS for the playground UI.** HoloCSS is private and unpublished. Is linking it from `../../holocss` acceptable, or should the playground carry its own minimal styles to stay self-contained?
- **Q3. Sharing code with `holochartv2`.** Copy and adapt its device, resource and SDF text patterns (this plan's assumption), or extract a shared WebGPU base package that both use?
- **Q4. Test hardware.** Which devices are available for the M8 benchmarks? The plan wants at least one Apple-silicon Mac, one integrated-GPU Windows or Linux machine, and one phone.
- **Q5. Core size.** Section 6 lists 47 core effects. Is that the right ambition, or should the first pass stop at roughly four per family?
- **Q6. Publication.** Is the playground meant to be hosted publicly at some point? That affects sample media licensing and whether webcam and microphone inputs need a consent screen.
