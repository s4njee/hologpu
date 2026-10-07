# HoloGPU

A native WebGPU effects library and playground research project. **M0 is implemented**: workspace foundations, browser compatibility research, and four GPU spikes. The public effect/runtime contract starts in M1; `packages/effects` and `packages/dom` are reserved scaffolds.

## Run

Requires Node 22.12+ and pnpm 11.15.1. The development page uses a small local stylesheet while the HoloCSS linking decision remains open.

```sh
pnpm install
pnpm exec playwright install chromium
pnpm dev
```

Open <http://127.0.0.1:5175>. Choose one or six canvases and either an internal float target with a final resolve or a direct canvas target. Run, step, verify compute/pixels, and measure while scrolling. Export the JSON to retain a result. All canvases share one device and one storage buffer. The left half is 50% alpha, composited over white; the right half is opaque.

```sh
pnpm check          # formatting, types, unit tests, builds, SwiftShader browser tests
pnpm test:hardware  # installed Chrome, headed Playwright Firefox, Playwright WebKit
pnpm format
```

Hardware tests require the browsers (`pnpm exec playwright install firefox webkit`) and a graphical session for Firefox on this Mac. Hardware performance is intentionally excluded from CI. Missing WebGPU leaves the page content intact.

To record the fixed M0 scenarios, leave `pnpm dev` running and use:

```sh
pnpm benchmark chrome
pnpm benchmark firefox --headed
pnpm benchmark webkit
node scripts/probe.mjs
```

The benchmark records three runs each of one float canvas, six float canvases, and six direct canvases: 1200×900 viewport, DPR 2, 30 warm-up frames, 180 measured frames, fixed seed, and scrolling. It measures CPU encoding and rAF cadence, not per-pass GPU execution time or actual driver VRAM. Keep the test page visible; the interactive runner rejects a stalled frame clock. Results save to `docs/benchmarks/`.

## Findings and layout

- [Plan and milestone status](plan.md)
- [Browser compatibility and verified assumptions](docs/compatibility.md)
- [M0 validation record](docs/m0.md)
- [D3: shared device and in-flow canvases](docs/adr/001-shared-device-in-flow-canvases.md)
- [D5: internal float targets](docs/adr/002-internal-float-targets.md)
- [Compute-to-render ordering](docs/adr/003-compute-to-render.md)
- [Deterministic software-adapter pixels](docs/adr/004-swiftshader-pixel-readback.md)

`packages/core/src/spikes.ts` is an isolated experimental harness, exposed as `@mk7s/hologpu/spikes`. It is not the M1 runtime API. The Vite app consumes that public experimental export. `pnpm build` emits package JS/types and the deployable static app in `apps/playground/dist`; no remote hosting or package publication is configured.
