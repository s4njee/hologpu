# Backlog v2: cards, CTAs and controls

Section 3.3 adds three exported effects (`panel-refraction`, `press-ripple`, `hover-lift-shadow`) and two quiet presets (`spotlight/card-spotlight`, `border-energy/border-trace`). The catalogue now contains 68 effects. The original spotlight and border presets retain their rendering branches and reference images.

Open `/cards.html` in the playground for an aurora hero with three draggable glass cards, a shared spotlight across a grid, hover borders/shadows and a native button with press feedback. `/cards.html?reduce=1` freezes motion; `/cards.html?fallback=1` exercises CSS fallbacks. Drag handles also respond to arrow keys. Content, links and buttons stay in the light DOM.

## Recommended usage

Use **one spotlight attachment on the grid**, behind all cards, rather than a GPU surface per card. `card-spotlight` supplies a transparent white light with radius 320 CSS pixels and intensity 0.15. All page spotlights share one document pointer listener. Coordinate polling follows scrolling; settled quiet spotlights do not submit unchanged GPU frames.

```ts
await attach(grid, spotlight, { preset: 'card-spotlight', layer: 'behind' });
await attach(card, borderEnergy, { preset: 'border-trace', padding: 32 });
```

```css
.card {
  --hgpu-intensity: 0;
  transition: --hgpu-intensity 200ms;
}
.card:hover,
.card:focus-within {
  --hgpu-intensity: 1;
}
@media (prefers-reduced-motion: reduce) {
  .card {
    transition: none;
  }
}
```

`padding` expands only the decorative canvas in CSS pixels. It changes neither the host's layout nor its hit target; keep ancestor overflow visible for an exterior glow. All four computed corner radii, including elliptical percentages, follow CSS overlap normalization. The attachment maps the host's border box into its padded canvas before each frame. `setPadding()` and `<hgpu-field padding="32">` also work. Rotation and perspective require a future inverse-transform path; this release targets axis-aligned hosts and translation.

## Glass and press feedback

**Panel refraction samples HoloGPU backgrounds only. It does not capture or refract ordinary DOM content.** The matching CSS fallback uses `backdrop-filter` on an owned decorative overlay.

```ts
const hero = await attach(heroHost, auroraVeil, { preset: 'dusk' });
const panel = await attach(cardHost, panelRefraction);
await panel.bindBackdrop(hero);
```

`bindBackdrop` accepts an attachment or ready field on the same GPU device. It maps the card's border box to the hero canvas bounds, follows drag/resize/scroll and inherits the hero's reduced-motion setting. The hero owns its lifetime and motion; destroy cards before their source when tearing down a page. Cards borrow the live linear-premultiplied hero texture directly, with no per-card copy, conversion or mip generation. Ordinary media and generic filters retain their normalized mip path.

For ripple feedback, attach a front layer to a supported wrapper around a real button. Native buttons do not support `attachShadow`; the wrapper preserves button focus and keyboard activation. Pointer presses use canvas-normalized coordinates, including any padding. Enter/Space on a native control trigger centered feedback without changing the action itself. The public `field.press([x,y])` supports custom event adapters. The catalogue canvas also forwards presses, including while its procedural playback is paused.

Press feedback uses four FIFO analytic rings in an 80-byte uniform allocation and finishes in 600 ms. It has no simulation or feedback texture. Reduced motion uses one uniform fade without an expanding ring. A bounded interaction clock runs on the existing shared scheduler even while procedural motion is paused; it submits the final transparent frame and then stops. `drawAt(time)` provides a deterministic interaction clock for tests; reset/device restoration clears presses.

Hover shadow uses the same rounded geometry and CSS `--hgpu-elevation`, `--hgpu-intensity` and `--hgpu-tint`. Give it about 40 CSS pixels of canvas padding. Its fallback uses `box-shadow`; ripple needs no visual fallback. Shape-aware CSS card fallbacks take precedence over standalone fixture posters, while an explicitly supplied poster takes precedence over CSS fallback. Script-generated settled posters remain bundled for standalone previews.

## Validation and timing

Focused tests exercise asymmetric and oversized elliptical corners, DPR 1/2, padded glow and real CSS hover; premultiplied glass samples and drag/scroll/resize alignment; borrowed source identity and lifetime; ripple FIFO, origin, expiry, reduced motion and keyboard presses; and fallback content/interaction.

With `pnpm dev` running, timing is captured with `pnpm benchmark:v2-cards chrome` and `pnpm benchmark:v2-cards webkit`. The script uses real DOM attachments at DPR 1, fixed own sizes, 30 warmup frames and 80 completed samples per scenario. CPU geometry/CSS polling, canvas resolve and queue completion are included. A single panel holds a 960 × 460 hero; the mixed page renders that hero at half resolution, three 280 × 220 panels and live spotlight/border/shadow/button fields. GPU pass timestamps and completed-work wall latency are separate boundaries; the latter governs the page's 4 ms p95 gate. Results exclude compilation and initialization and reflect uncontrolled machine load.

The final focused suite passes 44 software cases at DPR 1/2 and 66 native cases across Chrome, headed Firefox and WebKit. A further 70 software cases cover the existing DOM effects, reference images, attachment lifecycle, CSS bridges, poster priority, input normalization and asynchronous ownership. The unit suite passes 76 tests, and type checking and production builds pass. Desktop and mobile screenshots were inspected, with checks for full-width columns, readable copy and horizontal overflow.

Geometry polling caches unchanged canvas styles and normalized corner uniforms. An owned resize observer tracks exterior canvas space, including resized press wrappers and later padding changes. Strict timing gates remain open after repeated native captures; no budget is inferred from the functional checks.

| Field / own host size                           | Chrome GPU p95 range, ms | WebKit GPU p95 range, ms |
| ----------------------------------------------- | -----------------------: | -----------------------: |
| `spotlight` / 960 × 180                         |              0.262–2.621 |              0.197–1.626 |
| `border-energy` / 280 × 140 + 16 px padding     |              0.262–2.949 |              0.366–1.292 |
| `panel-refraction` / 280 × 220                  |              0.524–2.163 |              0.449–2.052 |
| `press-ripple` / 240 × 48                       |              0.262–2.490 |              1.054–2.669 |
| `hover-lift-shadow` / 280 × 140 + 40 px padding |              0.328–1.966 |              0.255–2.118 |

Whole-field GPU values include the effect and canvas resolve. Pass-level timing, CPU encoding, backing sizes, source identity and samples are retained in each record. The independent panel pass reached 0.262–1.114 ms Chrome and 0.223–1.022 ms WebKit; its specific 0.6 ms gate also misses in at least one capture. The mixed-page completed-work p95 was **2.8 / 6.3 / 7.4 ms Chrome** and **5 / 25 / 10 ms WebKit**. Only the initial Chrome capture met the 4 ms page gate.

These three captures comprise one initial run and two runs after caching unchanged geometry/styles and adding host resize tracking. They are not a controlled comparison: machine load and driver scheduling changed between captures, so the cache change is not claimed to improve the measured timing. No GPU validation errors occurred. Chrome pass timestamps are quantized; summed pass intervals can exceed measured queue-completion latency (for example 27.46 ms versus 7.4 ms on the final mixed page), so they must not be substituted for whole-frame elapsed time. Strict per-field and page budgets remain open; section 3.3 is implemented and functionally verified but not fully accepted.

Records: [Chrome initial](benchmarks/v2-cards-chrome-initial.json), [Chrome after geometry cache](benchmarks/v2-cards-chrome-after-geometry-cache.json), [Chrome repeat](benchmarks/v2-cards-chrome.json); [WebKit initial](benchmarks/v2-cards-webkit-initial.json), [WebKit after geometry cache](benchmarks/v2-cards-webkit-after-geometry-cache.json), [WebKit repeat](benchmarks/v2-cards-webkit.json).
