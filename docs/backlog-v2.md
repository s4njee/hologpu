# Backlog v2 — subtle WebGPU effects for product launch pages

**Created:** 2026-10-07
**Scope:** Effects, presets and runtime work that make `@mk7s/hologpu` useful on an ordinary marketing or launch page: hero, headline, feature cards, product imagery, pricing, footer. Everything here is meant to be _noticed second_: it should improve the page's presentation without competing with the copy.
**Relation to v1:** [plan.md](../plan.md) section 6 is the v1 catalogue. It optimised for technique breadth. This backlog optimises for the opposite: a small number of cheap, quiet, production-shaped effects, plus the runtime gaps that stop the existing catalogue being dropped into a real page.

## 1. Review: what the project already gives a launch page

### 1.1 Runtime that is already production-shaped

| Capability                                                              | Where                                      | Why it matters for a launch page                                                        |
| ----------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------- |
| `attach(host, effect, {layer, poster, params})` and `<hgpu-field>`      | `packages/dom/src/attach.ts`, `element.ts` | Content stays in the light DOM; canvas is `aria-hidden`, `pointer-events: none`         |
| Offscreen and hidden-tab sleep, no resubmit when uniforms are unchanged | `packages/core/src/runtime.ts`             | A page of ten fields costs nothing while scrolled past                                  |
| `prefers-reduced-motion` pose per effect                                | effect `reducedMotion.time`                | Legally and ethically required on marketing pages                                       |
| Poster or CSS fallback when WebGPU is missing                           | `AttachOptions.poster`, effect `fallback`  | Firefox, old Android and corporate Chrome still see a finished page                     |
| CSS custom property bridge, eight `--hgpu-*` bindings per field         | `packages/dom/src/bridges.ts`              | Designers drive uniforms from CSS transitions, hover states and scroll timelines, no JS |
| `timeline(progress)` and `bindTimeline`                                 | same                                       | Scroll-driven reveals from any animation library                                        |
| Field to field `bindInput`                                              | `packages/core`                            | A card can refract the hero behind it without capturing DOM pixels                      |
| Adaptive quality, eight-budget stall guard                              | scheduler                                  | Weak GPUs degrade to a blurry version rather than a stutter                             |

Measured basis (Apple M1 Max, Chrome 154 / WebKit 26.6, 512², DPR 1, [m5](m5.md)): six DOM attachments at 264×220 complete in p95 6.3 ms Chrome / 7 ms WebKit. A single T1 fragment effect costs ~0.15–0.3 ms CPU and under 0.5 ms GPU in Chrome, ~1.5 ms GPU in WebKit. Those numbers set the budget rules in section 2.

### 1.2 Catalogue effects that are already usable, with preset work only

| Effect                                 | Launch-page use                                        | What is missing                                                                                 |
| -------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `gradient-oklch`                       | Hero background, section backdrops                     | Brand-token presets; lower default speed; wide-gamut colours currently go through sRGB Canvas2D |
| `spotlight`                            | Cursor highlight across a card grid                    | Rotated or perspective hosts unsupported; otherwise done                                        |
| `border-energy`                        | Hover-traced card and CTA borders                      | Per-corner radii; padded host so the exterior glow is not clipped                               |
| `image-hover`                          | Hover and scroll crossfades between two product images | Crop and object-fit modes                                                                       |
| `scroll-scene`                         | Scroll-scrubbed layered backdrop                       | Works; needs a quieter default preset                                                           |
| `text-dissolve`, `morph-particles`     | Logo or headline assembly on first view                | "Assemble, then hold" preset; a matching poster                                                 |
| `starfield`                            | Dark-mode hero background                              | Lower density preset; long-run f32 drift fix                                                    |
| `bloom`, `color-grade`, `lens`, `blur` | Glow on app screenshots, grading on hero video         | WebKit misses the 1080p video gate; use for images or ≤720p video                               |
| `displace`                             | Hover ripple on imagery                                | Border modes at the canvas edge                                                                 |
| `glass`                                | Refractive hero object                                 | Never mentions reduced motion or fallback; add both                                             |

### 1.3 Catalogue effects that should **not** be used on a launch page

| Effect                                                            | Reason (measured)                                                                             |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `fluid-obstacles`, `fluid` page-wide                              | 11.5–12 ms GPU Chrome, 25–27 ms WebKit per instance; six-fluid stress never passed            |
| `flow-particles` at default 1M                                    | 27–31 ms GPU as quads; WebKit rAF drops to 24 ms; 64 MiB of buffers                           |
| `radiance-cascades`                                               | 8–8.5 ms GPU on WebKit; light leaks                                                           |
| `lenia`, `reaction-diffusion`, `life`, `falling-sand`, `physarum` | 7–11 ms completion; extinction or saturation are valid outcomes, so the page can end up blank |
| `caustics` behind text                                            | Note warns of shimmer against type                                                            |
| `attractors`, `n-body`, `boids`                                   | Trajectories diverge across adapters; unpredictable composition                               |
| `sort`, `spatial-hash` dependants                                 | ~10 ms on WebKit for 4K elements                                                              |

### 1.4 Techniques the demos invented that are not yet catalogue effects

From the [LCD](../apps/playground/src/lcd.ts) and [fluid-dom](../apps/playground/src/fluid-dom.ts) demos: a masked composite of a filtered output over the original, a pointer-driven normal/flow map as a hidden second field, bright-region extraction before `bloom`, depth-masked procedural rain, render-only-on-interaction, and hand-traced Path2D masks. Several backlog items below productise these.

## 2. Rules for everything in this backlog

1. **Looks finished at time zero.** Every effect declares a `reducedMotion` pose and that pose is a good design on its own. The static frame is the design; motion is a bonus.
2. **Budget.** Per field: ≤ 0.5 ms GPU Chrome and ≤ 1.5 ms GPU WebKit at the element's own size, at DPR 1. Per page: ≤ 4 ms completed-work p95 with every above-the-fold field live. Measured with `scripts/benchmark-m5-page.mjs` style page runs, not standalone 512² runs.
3. **Baseline WebGPU only.** No required optional features. No `float32-filterable`, no `shader-f16`, no HDR canvas.
4. **Poster first.** Every effect ships with a script-generated poster of its settled frame; the no-WebGPU path renders that poster. Typography uses the text-aware CSS fallback specified below for authored DOM copy, because a built-in text-fixture poster would display different words; an explicit author poster takes precedence. Shape-dependent cards use the specified CSS glass/shadow fallback, and press feedback needs no visual fallback; generated settled posters remain available for standalone previews. Authored product imagery and video retain their native light-DOM media; screenshot glow uses an explicit baked overlay, so a catalogue fixture never replaces the author’s asset. Authored section wipes keep native image crossfades; wave dividers and progress paths use matching resized SVGs with explicit `poster: ''` overrides.
5. **One stateful effect per page.** Feedback and particle effects are allowed only element-local, at ≤ 128² state, render-on-interaction, and at most one instance.
6. **Brand-drivable.** Colours are `color` params with `css: true` so `--hgpu-*` tokens theme them. Intensity has a 0 to 1 range whose default sits at 0.3 or below.
7. **No pointer dependence for meaning.** Pointer input enriches; touch devices with no hover get the same design.
8. **Accessibility unchanged.** Text stays in the light DOM; canvases never carry information.

## 3. Backlog items

Effort: **S** under a day (T1 fragment, under 80 lines), **M** one to three days (filter or feedback with inputs), **L** a week (new input kinds or runtime changes). Priority: **P0** build first, **P1** next, **P2** when asked for.

### 3.1 Hero and section backgrounds

**Implementation status (2026-10-07):** all six effects and the starfield update are implemented, exported and covered by browser tests and generated posters. Functional and visual checks pass; strict GPU/page timing gates remain open after repeated measurements. See [section 3.1 validation](v2-backgrounds.md) for the recorded misses, test coverage and reproduction commands. This section is not fully accepted until those budgets pass.

#### `aurora-veil` — P0, S

- **Visual:** two or three very soft, slowly drifting bands of brand colour over a flat base, like a blurred aurora. Low contrast, low saturation. Think of the wash behind most 2024–26 dev-tool hero sections.
- **Technique:** T1. Domain-warped two-octave fBm from the `noise` chunk selects between OKLCH stops from the `colour` chunk. Render at `resolutionScale 0.25` and let the bilinear upscale do the blur; this is the whole trick and makes it nearly free.
- **Builds on:** `noise-lab`, `gradient-oklch` chunks.
- **Inputs:** none required; optional pointer bias of ±2 % of the field.
- **Reduced motion:** time frozen at a tuned pose. **Fallback:** CSS multi-stop gradient generated from the same stops.
- **Risk:** banding on 8-bit displays at low contrast. Reuse `gradient-oklch`'s dither.
- **Done when:** 1440×900 field renders ≤ 0.3 ms GPU Chrome at 0.25 scale; snapshot test; brand preset JSON with three palettes.

#### `grain-overlay` — P0, S

- **Visual:** fine animated film grain or paper texture at 3–6 % opacity over the whole hero. Adds texture to flat gradients and hides banding.
- **Technique:** T1 transparent premultiplied output. Hash-based or tiled blue-noise value, optional luminance-weighted response when an `image` input is bound. Frame-rate limited to 12–24 updates per second via a `rate` control so it reads as film, not as noise.
- **Builds on:** `hash` chunk, `dither`'s blue-noise texture, `lens`'s grain model.
- **Reduced motion:** static grain. **Fallback:** a tiny repeating PNG noise tile.
- **Risk:** screen-recording compression; keep opacity default at 0.04.
- **Done when:** full-viewport field ≤ 0.2 ms GPU; visually verified over light and dark backgrounds; `rate` honoured.

#### `dot-matrix-field` — P0, S

- **Visual:** a regular grid of small dots whose radius and brightness swell slightly under the cursor and breathe with slow noise. The common "technical" background.
- **Technique:** T1. `fract` grid in CSS pixels (so dot pitch is a real CSS length), analytic anti-aliased circle from the `sdf` chunk, pointer falloff, noise modulation of ±15 %.
- **Inputs:** pointer (optional).
- **Reduced motion:** no breathing; pointer response stays at half strength.
- **Fallback:** CSS `radial-gradient` repeating background at the same pitch.
- **Done when:** pitch and dot size specified in CSS px and stable across DPR 1/2; ≤ 0.3 ms GPU.

#### `topographic-lines` — P1, S

- **Visual:** thin contour lines of a slowly evolving height field, like a topographic map, at 10–20 % contrast.
- **Technique:** T1. fBm height, isolines via `fract` and `fwidth` anti-aliasing (the `sdf-2d` isoline approach). Line weight in CSS px.
- **Reduced motion:** frozen. **Fallback:** poster.
- **Risk:** moiré at high line density; cap `spacing` minimum at 12 CSS px.

#### `grid-horizon` — P0, S

- **Visual:** perspective floor grid receding to a horizon with distance fog, lines at low alpha. A staple of launch pages.
- **Technique:** T1. Ray a plane, analytic line AA via derivatives, exponential fog to transparent, optional slow forward scroll.
- **Reduced motion:** stationary grid. **Fallback:** a static SVG of the same grid.
- **Done when:** no shimmer at DPR 1 at the horizon (derivative-based line width); ≤ 0.2 ms GPU.

#### `light-sweep` — P0, S

- **Visual:** a single soft specular band that sweeps across the hero once on load and again when `--hgpu-progress` changes (for example on scroll into view). Apple-style sheen.
- **Technique:** T1. Angled Gaussian band in UV, position driven by `progress` (`css: true`), optional `image` input for a masked product sheen.
- **Inputs:** `progress` via CSS or `timeline`.
- **Reduced motion:** band parked at its final position, so the sweep simply does not happen.
- **Fallback:** none needed; the page is unchanged without it.
- **Done when:** one `transition: --hgpu-progress 1.2s` in CSS produces the sweep; snapshot at progress 0, 0.5, 1.

#### `starfield` subtle preset — P1, S

- Add a `dusk` preset with a third of the default density and nebula off; fix the long-run integer world origin so an all-night tab does not drift.

### 3.2 Typography

**Implementation status (2026-10-07):** three new effects and both `assemble-and-hold` presets are implemented and exported, with generated posters and DOM text-aware fallbacks. The shared text mask now follows actual laid-out lines, font loading and DPR, and cached glow invalidates only on mask changes. Functional and visual checks pass; strict GPU/page timing gates remain open after repeated native captures. See [section 3.2 validation](v2-typography.md) for browser coverage, constraints and recorded misses. This section is not fully accepted until those budgets pass.

#### `text-shimmer` — P0, S

- **Visual:** a gradient highlight that passes through the glyphs of a headline, once or on hover. Text remains real DOM text.
- **Technique:** T1 with the existing `text` mask input (attach builds it from `host.textContent` and computed font). Mask alpha gates a moving OKLCH gradient; output is premultiplied so it layers `front` over the real text as a highlight.
- **Builds on:** `text-dissolve`'s mask pipeline, `_dom/common.ts`.
- **Reduced motion:** static gradient fill. **Fallback:** CSS `background-clip: text` gradient.
- **Risk:** font shaping differs across OS, so the mask re-rasterises on load and on `MutationObserver`; already handled.
- **Done when:** headline wraps and re-rasterises on resize; highlight aligns to glyphs at DPR 2.

#### `text-outline-glow` — P1, M

- **Visual:** a soft halo around headline glyphs that breathes very slowly, or brightens on hover. Also gives a crisp outline mode.
- **Technique:** `jump-flood` on the text mask to a distance field, then a T1 display pass mapping distance to glow with an exponential falloff in CSS px. Recompute the JFA only when the mask changes, not per frame.
- **Builds on:** `jump-flood`, text input.
- **Cost basis:** JFA 1.4–1.8 ms Chrome, 5–6 ms WebKit at 512², which is why it must be cached rather than per frame.
- **Reduced motion:** fixed glow. **Fallback:** CSS `text-shadow`.
- **Done when:** JFA runs once per mask change; steady state ≤ 0.3 ms GPU.

#### `heading-reveal` — P1, S

- **Visual:** a headline that resolves from a blur or from scattered noise into crisp text as it scrolls into view. Driven by `progress`.
- **Technique:** T1 over the text mask: blend from a noise-eroded mask to the full mask as progress goes 0 to 1. The real text sits underneath; the field renders `front` with an opaque page-colour cover that erodes away, so no extra blur pass is needed.
- **Reduced motion:** progress forced to 1.
- **Risk:** only works over a flat page colour; document that constraint.

#### `text-dissolve` and `morph-particles` "assemble and hold" preset — P2, S

- Preset that assembles once from `progress` and holds, with particle count capped at 8K, plus a generated poster.

### 3.3 Cards, CTAs and controls

**Implementation status (2026-10-07):** all three new effects and both quiet presets are implemented and exported. DOM attachment adds exterior padding, four elliptical CSS corners, shared page-pointer plumbing, bounded press feedback and aligned hero binding. The `/cards.html` demo shows the full recipe. Functional checks pass at software DPR 1/2 and in native Chrome, Firefox and WebKit. Strict GPU/page timing gates remain open after repeated native captures; this section is not fully accepted until they pass. See [section 3.3 validation](v2-cards.md) for constraints, browser checks and recorded misses.

#### `card-spotlight` preset for `spotlight` — P0, S

- A quieter preset: radius 320 CSS px, intensity 0.15, white or brand tint, applied `behind` a grid of cards with a shared page pointer. Document the "one effect across many hosts" pattern as the recommended card treatment. Add the host-transform inverse (open item) only if a customer page needs tilted cards.

#### `border-trace` preset for `border-energy` — P0, S

- Hover-only variant: `intensity` 0 at rest, CSS transition to 1 on `:hover` via `--hgpu-intensity`. Finish the open items it needs: per-corner radii read from all four computed radii, and a `padding` attach option so the exterior glow is not clipped by the host box.

#### `panel-refraction` — P1, M

- **Visual:** a frosted-glass card that refracts and blurs the animated hero behind it, with a thin specular edge. The "glassmorphism" card done properly.
- **Technique:** Cannot capture DOM pixels (HTML-in-canvas is an unavailable origin trial). Instead the card field binds the hero field as its `image` input, offsets the sample by the card's rect within the hero, and applies `displace` with a normal map from the rounded-rect SDF plus a small `blur`. Both fields share the device so the bind is free.
- **Builds on:** field to field `bindInput`, `displace` glass mode, `sdf` chunk, `blur`.
- **Constraint:** only refracts hologpu-rendered backgrounds. Document loudly; the demo page shows a hero `aurora-veil` behind three cards.
- **Reduced motion:** inherits the hero's frozen pose. **Fallback:** CSS `backdrop-filter: blur()`.
- **Done when:** card drag over the hero stays aligned within 1 px at DPR 2; ≤ 0.6 ms GPU per card.

#### `press-ripple` — P1, S

- **Visual:** a soft circular wavefront from the pointer-down point across a button or card, fading in 600 ms. Material-style but softer.
- **Technique:** T1 analytic ring, no simulation. Up to four concurrent ripples stored in a small uniform array, written from `pointerdown` in the attach layer.
- **Inputs:** pointer buttons (already in the frame block); needs a tiny `onPointerDown` hook recording time and position.
- **Reduced motion:** a single fade with no ring. **Fallback:** none needed.

#### `hover-lift-shadow` — P2, S

- **Visual:** a soft, slightly coloured contact shadow under a card that deepens and spreads on hover.
- **Technique:** T1 rounded-rect SDF with Gaussian falloff; `elevation` is `css: true` so `:hover` drives it. Cheaper and prettier than stacked CSS `box-shadow` at large radii.
- **Fallback:** CSS `box-shadow`.

### 3.4 Product imagery and screenshots

**Implementation status (2026-10-07):** five catalogue effects, scalar mask inputs and both recipes are implemented, with two original aligned depth maps, product cutout, screenshot and native 720p video in `/products.html`. Functional, lifecycle, reduced-motion and fallback checks are covered. Strict GPU/page timing gates remain open after repeated native measurements; see [section 3.4 validation](v2-products.md). This section is not fully accepted until those budgets pass.

#### `depth-parallax` — P0, M

- **Visual:** a product shot or illustration that shifts subtly in depth with pointer or scroll, using an author-supplied depth map. Two or three millimetres of apparent parallax, no more.
- **Technique:** T4 filter: `image` plus a `depth` texture param; UV offset proportional to depth times pointer or `progress` displacement, with a one-tap inpainting fallback at disoccluded edges (clamp and slight blur).
- **Builds on:** `displace`, texture params.
- **Inputs:** `image`, `depth` (greyscale PNG), pointer or `progress`.
- **Reduced motion:** offset zero; the image is the image. **Fallback:** the plain `<img>` that already sits in the light DOM.
- **Risk:** stretched edges at large offsets; cap `amount` at 2 % of width.
- **Done when:** demo with two authored depth maps; edge artefacts invisible at the default amount.

#### `product-sheen` — P1, S

- `light-sweep` with an `image` input and its alpha as a mask, so the sheen passes only over the product cutout. Honours `progress`.

#### `screenshot-glow` — P1, S

- **Visual:** app screenshots get a soft glow only from their bright UI elements, like the LCD demo's street lights.
- **Technique:** `chain(threshold-mask, bloom)` with the threshold mask as a new tiny T4 (`bright-pass`) that takes a luminance threshold and an optional author mask, rendered at `resolutionScale 0.5` and composited with CSS `mix-blend-mode: screen`.
- **Builds on:** `bloom`, the `lcd-lights.ts` pattern.
- **Cost basis:** `bloom` 2–2.8 ms Chrome / 2.9–7.4 ms WebKit at 512²; at half resolution of a 600 px screenshot this fits the budget. Verify.
- **Reduced motion:** static glow (no flicker model). **Fallback:** poster with baked glow.

#### `masked-composite` and `pointer-map` as catalogue effects — P1, M

- Productise the LCD demo's two inline effects. `masked-composite(image, filtered, mask, blend)` mixes a filtered chain output back over the original through a mask. `pointer-map` renders a Gaussian normal or flow lens around the pointer into a linear float texture for `displace`.
- With these two, the "touch the device screen and it ripples" treatment becomes a documented recipe instead of 400 lines of demo code.
- Needs the `mask` input kind from section 4.

#### `hero-video-grade` recipe — P2, S

- `chain(color-grade, grain-overlay)` on a muted looping hero video with a documented 720p ceiling for WebKit, since WebKit misses the 1080p chain gate. Recipe and preset only.

### 3.5 Scroll, transitions and dividers

**Implementation status (2026-10-07):** all three effects are implemented and exported, with a scroll/manual demo at `/transitions.html`, generated posters and matching author SVG helpers. Functional checks pass at software DPR 1/2 and in native Chrome, Firefox and WebKit. The final three-field page meets the 4 ms gate in Chrome and misses in WebKit; per-field gates also have recorded misses. Strict performance acceptance remains open. See [section 3.5 usage and validation](v2-transitions.md).

#### `section-wipe` — P1, M

- **Visual:** on scroll, one poster image dissolves into the next through a shader wipe (noise-threshold, directional soft wipe, or luminance reveal).
- **Technique:** T4 with two `image` inputs and `progress` from a view timeline. This is v1's stretch `transition-wipe` minus the View Transitions capture; author supplies the two images.
- **Reduced motion:** hard cut at progress 0.5. **Fallback:** CSS opacity crossfade.

#### `wave-divider` — P0, S

- **Visual:** a section divider whose edge is a slowly undulating wave or noise line, replacing the static SVG wave every template uses. Fills the lower side with the next section's colour.
- **Technique:** T1 analytic AA edge from the `sdf` chunk; one or two sine plus noise terms; amplitude in CSS px.
- **Reduced motion:** still. **Fallback:** an SVG path generated from the same function at progress 0.
- **Done when:** seam-free against the adjacent section colour at DPR 1/2.

#### `progress-line` — P2, S

- A thin rule that draws itself along a path as `progress` increases, with a small glow at its head. T1 over a polyline in uniform array. Good for step-by-step "how it works" sections.

### 3.6 Ambient particles

**Implementation status (2026-10-08):** both effects are implemented and exported, with generated settled posters and a native-content demo at `/ambient.html`. The demo uses one bounded dust field, interaction-only or explicit motion, CSS palettes and reduced-motion poses. Half-resolution defaults retain CSS geometry. All 32 software DPR 1/2 cases and 48 native Chrome, Firefox and WebKit cases pass, as do type checking, 76 unit tests and the build. Dust passes the per-field GPU limits in both engines; Chrome constellation and the mixed-page completed-work gates retain misses across repeated captures. Strict performance acceptance remains open. See [section 3.6 usage and validation](v2-ambient.md).

#### `particle-drift` — P1, M

- **Visual:** a few hundred soft bokeh dust motes drifting slowly, gently repelled by the pointer. Additive, low alpha.
- **Technique:** T3 with the `emitters` or `flow-particles` scaffolding at 256 to 2048 records, quads with a Gaussian sprite, no trails.
- **Cost basis:** `emitters` at 32K records is 1.0–1.2 ms Chrome; at 1K records this is well under budget.
- **Reduced motion:** a settled scatter rendered once. **Fallback:** poster.
- **Rule 5 applies:** one instance per page.

#### `constellation` — P2, M

- Points joined by faint lines to near neighbours. Do **not** build on `boids`/`spatial-hash` (10 ms on WebKit). Use a T1 hashed-jitter grid where each cell holds one point and links only to its eight neighbours; stateless and cheap.

## 4. Runtime and tooling work the launch-page use needs

These block real adoption more than any single effect.

| Item                                       | Priority | Effort | Detail                                                                                                                                                                                                                                                                                  |
| ------------------------------------------ | -------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Poster generation script                   | P0       | S      | Implemented: `scripts/poster.mjs <effect> <preset> <w>x<h> [output.png\|output.webp]`; generated/default poster declarations and authored-content recipe exceptions in [runtime tooling](v2-runtime.md)                                                                                 |
| `renderOn: 'interaction'` attach option    | P0       | S      | Implemented: settled initial draw, native activity, bounded `idleAfter`, manual play/pause, visibility and reduced-motion cleanup; custom-element attributes                                                                                                                            |
| `padding` attach option                    | P0       | S      | Implemented in 3.3: exterior CSS-pixel space, four-corner geometry, resize tracking, `setPadding` and custom-element attribute; regression coverage retained                                                                                                                            |
| `mask` input kind                          | P1       | M      | Implemented in 3.4: SVG/image/canvas scalar `r8unorm`, alpha/red/luminance selectors and caller ownership; regression coverage retained                                                                                                                                                 |
| Per-effect declared budget and page budget | P1       | M      | Implemented: authored reference-size estimates for v2/Family G, visible animated-field aggregation and dev warnings, production opt-in and disposal; unknown legacy estimates remain explicit                                                                                           |
| Bundle size measurement                    | P1       | S      | Implemented: independent minified public entries, gzip sizes and separate assets in [bundle report](benchmarks/bundle-size.json) and [method](bundle-size.md)                                                                                                                           |
| Brand tokens recipe                        | P1       | S      | Implemented: `/launch.html` combines P0 hero, real-copy shimmer, cards, authored depth image, wave and horizon with shared Ember/Dusk/Paper tokens and native fallbacks; [recipe](v2-runtime.md)                                                                                        |
| Phone and integrated-GPU runs              | P1       | L      | Device harness implemented at `/device-check.html`; paired iPhone 13 Pro / iOS 27.0.1 passes ten P0 GPU checks and real product scrubbing; remaining manual checks await reconnection. Android, Intel Windows and exact Safari 26 access remain pending; [matrix](device-validation.md) |
| Firefox default-path check                 | P1       | M      | Measured three captures per bound: ~9.6 completed fps at 1 vs 118–122 at 8 on this Mac. Automatic Firefox T1-only/dependency-safe bound 8 implemented; mixed/unknown sessions use 1 and explicit overrides persist. [Decision and raw report](firefox-submissions.md)                   |
| First-frame latency                        | P2       | S      | Implemented: immutable attach-start/compiled/submitted/completed timings; `hgpu-ready` waits for initial GPU completion, handles early loss/abort/failure, and page benchmark records latency separately from navigation                                                                |
| Native Safari pass for the P0 set          | P1       | M      | Native Safari 27.0 on this Mac passes ten P0 fixtures, reduced/idle/error/cleanup checks and manual launch-page appearance/control/fallback inspection; [evidence](device-validation.md). Exact Safari 26 remains open                                                                  |
| Reduced-motion and fallback for Family G   | P2       | S      | Implemented: explicit frozen shader/camera time, unchanged-frame gates, generated posters and native accessible fallback for `glass`, `instances`, `material-ball`, `terrain`                                                                                                           |

All code/tooling items in this section are implemented. Physical-device coverage is tracked separately and is not implied by Playwright WebKit or the local Mac reports. The actual launch-page stress capture misses the 4 ms completed-work p95 gate in both Chrome and WebKit; strict performance acceptance remains open. See [release measurements](v2-runtime.md#release-measurements).

## 5. Suggested order

1. **Infrastructure first, one day:** poster script, `renderOn`, `padding`.
2. **P0 effects, roughly a week:** `grain-overlay`, `aurora-veil`, `dot-matrix-field`, `grid-horizon`, `light-sweep`, `wave-divider`, `text-shimmer`, `depth-parallax`, plus the `card-spotlight` and `border-trace` presets.
3. **A reference launch page** under `apps/playground/launch.html` using only the P0 set over real copy: hero with `aurora-veil` + `grain-overlay`, `text-shimmer` headline, three cards with `card-spotlight` and `border-trace`, a `depth-parallax` product shot, a `wave-divider`, `grid-horizon` footer. Gate it like the LCD page: Playwright at DPR 1 and 2, reduced motion, forced fallback, and the page budget from rule 2. Publish it with `pnpm publish:mk7s` next to the existing demos.
4. **P1** in the order listed, each with its own note in `docs/notes/` and a benchmark row.
5. **P2** on request.

## 6. Explicitly out of scope for this backlog

- A WebGL fallback renderer. Posters are the fallback.
- Refraction of arbitrary DOM content behind an element. HTML-in-canvas remains a Chromium origin trial.
- Page-wide fluid, cellular or million-particle backgrounds. They remain research demos in the playground.
- A worker or compositor rendering path. Measure first in M8; if scroll-linked effects lag visibly on phones, revisit.
