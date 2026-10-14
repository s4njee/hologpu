# Backlog v2: runtime and release tooling

The reference [launch page](../apps/playground/launch.html) combines the P0 effects over real copy with Ember, Dusk and Paper brand tokens. Cards, links, the product slider and palette controls remain native HTML. The product uses an authored image and red-channel depth map. A second [device check page](../apps/playground/device-check.html) produces a downloadable report in the browser being tested.

## Interaction playback

```ts
import { attach, configurePageBudget } from '@mk7s/hologpu/dom';
import border from '@mk7s/hologpu/effects/border-energy';

configurePageBudget({ milliseconds: 4 });
const decoration = await attach(document.querySelector<HTMLElement>('.card')!, border, {
  preset: 'border-trace',
  padding: 16,
  renderOn: 'interaction',
  idleAfter: 600,
});
```

`renderOn: 'interaction'` starts paused at the effect's declared settled pose. Pointer movement/press/release, touch pointer events, focus and keyboard activity resume motion without cancelling any native event. The field stops after `idleAfter` milliseconds without activity (default 600, accepted range 0–10000). Hidden documents and offscreen hosts stop interaction playback; reduced motion preserves the settled frame and allows ordinary parameter edits. The decorative canvas never captures the host's pointer.

`play()` explicitly pins continuous playback while visible. `pause()` clears the pin and stops until the next activity. Explicit `playing: true` also pins playback; omit it for the interaction default. `renderOn: 'always'` retains the existing default playback behavior. The custom element accepts `render-on="interaction"` and `idle-after="600"`.

The `padding` and scalar `mask` APIs are documented in [cards](v2-cards.md) and [products](v2-products.md). Their resize, geometry, source-revision and alpha/red/luminance coverage remains part of the existing regression suites.

## Declared page budget

Effects may declare `budget: { expectedMs: 0.5, referenceSize: [640, 400] }`. These are authored planning estimates at physical render-target dimensions, not measured guarantees for all parameter sets or adapters. The v2 launch effects and four Family G scenes declare estimates. The runtime scales cost linearly with framebuffer pixel area, including DPR, exterior padding and resolution scale. Fixed overhead, multiple passes and parameter-dependent work need actual measurements.

`attach` registers its field automatically. In Vite development, the default 4 ms page limit warns when the sum of visible, playing, non-reduced, ready fields exceeds the limit. Paused, disposed, fallback and offscreen attachments contribute zero. Legacy effects without declarations appear in `pageBudgetSnapshot().undeclared`, rather than receiving invented costs. `configurePageBudget({ enabled: true })` opts other development hosts into warnings; production warnings are disabled unless explicitly enabled. This diagnostic never changes quality or playback.

## First-frame readiness

`await attach(...)` and `hgpu-ready` now wait for a rendered frame, submission and GPU queue completion. Text masks and attachment-owned geometry inputs are bound before that initial frame. Callers that bind additional media after attachment must separately await their binding and draw; first-frame timing describes the initial attachment frame. Device restoration waits for its first completed replacement frame too. If initial queue completion rejects, readiness allows up to one second for a device-loss notification before treating it as an unexpected failure; abort and teardown cancel that wait. Device-loss callbacks observed in software-browser recovery testing arrived up to 556 ms after device destruction.

`attachment.timings` and `event.detail.timings` are frozen snapshots using the page's `performance.now()` clock: `startedAt`, `gpuReadyAt`, `firstFrameSubmittedAt`, `firstFrameCompletedAt`, `firstFrameMs`, `fallbackReadyAt`, `fallbackMs`. GPU and fallback paths have separate nullable fields. Queue completion establishes a readiness boundary; it cannot observe actual compositor presentation. The page benchmark records these fields separately from navigation wall time:

```sh
HOLOGPU_URL=http://127.0.0.1:5175 node scripts/benchmark-m5-page.mjs chrome page
```

## Posters

```sh
pnpm --filter @mk7s/hologpu-playground dev
node scripts/poster.mjs aurora-veil default 640x400
node scripts/poster.mjs aurora-veil dusk 960x600 ./artifacts/aurora.webp
```

The script draws the effect's reduced-motion pose with seed 7, fixed quality and DPR 1 in headless Chromium, checks GPU errors, unpremultiplies readback and writes PNG or WebP according to the destination extension. Dimensions must be 1–4096 pixels per side. The default destination is the effect's `poster.png` or `poster-<preset>.png`. Existing effect declarations supply those posters automatically to `attach`; an explicit `poster` takes precedence. Text, card and image recipes retain their authored-content fallback instead of substituting a catalogue fixture. Input-dependent effects need authored media fixtures rather than an input-free command.

Family G (`glass`, `instances`, `material-ball`, `terrain`) now ships posters and explicit frozen shader/camera time for reduced motion, including explicit draws at other clock values. Their scene notes document the settled poses and estimates.

## Brand tokens

[launch.css](../apps/playground/src/launch.css) defines the brand palette on `body` and maps it onto each host's opted-in effect parameters. Put the `--hgpu-*` values on the attachment host: the typed uniforms are intentionally non-inheriting. The same `--accent`, `--base`, `--ink` and `--surface` tokens control native copy, focus outlines, cards and the wave's native SVG fallback. Hover elevation remains CSS; the shader follows the actual host geometry. Use coarse resolution for atmosphere and full resolution for glyph masks. The launch page caps DPR at 2 and leaves product scrubbing paused, with local pointer activity restoring the scrub mode on exit.

See [bundle measurement](bundle-size.md), [Firefox submissions](firefox-submissions.md), and [physical-device validation](device-validation.md) for reproducible release checks and their current evidence.

## Release measurements

Workspace production builds, workspace/test type checks and 82 unit tests pass. The native sweep passed 107 of 108 cases initially; the responsive device-fixture comparison was fixed, then all nine repeated device checks passed across Chrome, Firefox and WebKit. An additional failed-field playback/polling regression passed software DPR 1/2 and all three native engines. The final interaction/launch software rerun passes all 30 cases at DPR 1/2. Raw logs are retained under `artifacts/`.

The [Chrome first-frame capture](benchmarks/m5-page-chrome-page.json) retains three actual six-attachment page runs. Attachment-to-first-completed-frame p95 was 188.3, 86.3 and 98.8 ms; navigation-to-status-ready was 1084, 541 and 727 ms. The launch page also retains all ten initial attachment timings in its [Chrome](benchmarks/v2-launch-chrome.json) and [WebKit](benchmarks/v2-launch-webkit.json) reports. These measurements include compilation/input setup and queue completion, not compositor presentation.

Run `pnpm benchmark:v2-launch chrome` or `webkit` to measure the actual reference page at four scroll positions. This conservative stress run forces every viewport-intersecting field to draw each frame, including normally idle interaction fields and 12 Hz grain. It uses DPR 1, authored resolution scales, 30 warmup frames, 120 samples and actual CSS/input hooks. Completed work includes CPU encode/submit and the GPU completion callback. The strict 4 ms p95 page gate remains open: Chrome measured 6.4/8.7/6.4/4.9 ms and WebKit 35/35/13/23 ms for hero/cards/product/footer. Independent user projects may be active; machine-wide load is not controlled. Declared area estimates and functional checks do not close this measured gate or the earlier section 3 timing gates.

The verified Cloudflare [launch preview](https://8f674041.mk7s.pages.dev/hologpu/launch.html) and [device harness](https://8f674041.mk7s.pages.dev/hologpu/device-check.html) use the production `/hologpu/` base. Deployed smoke checks confirm ten ready attachments, native scrubbing/palettes/fallback, zero page/HTTP errors, real shadow-canvas cleanup, removal of empty fixtures, and mobile footer padding.
