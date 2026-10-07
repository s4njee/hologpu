# HoloGPU

A native WebGPU effects library and playground research project. M0 foundations, M1's shared runtime and Full-stage playground, and all nine Family A procedural effects are implemented. See the [plan](plan.md), [M1 validation record](docs/m1.md), [T1 stretch validation](docs/t1-stretch.md) and [frozen T1 contract](docs/adr/005-t1-effect-contract.md).

## Run

Requires Node 22.12+ and pnpm 11.15.1. The playground uses a local stylesheet while the HoloCSS linking decision remains open.

```sh
pnpm install
pnpm exec playwright install chromium
pnpm dev
```

Open [the playground](http://127.0.0.1:5175). Select an effect, adjust generated controls or presets, inspect composed WGSL and capabilities, and read its research note. The URL retains your state. Transport includes pause, step, reset, seed, resolution and reduced motion. Keyboard: arrows select effects, space pauses, `.` steps, `r` resets and `/` searches. CPU timing excludes GPU execution. The [M0 foundations lab](http://127.0.0.1:5175/m0.html) retains the shared compute and multi-canvas experiments.

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

T1 supports scalars, vectors, booleans, enums and CSS colours. Texture-backed schemas and input binding are later M4 work; DOM attachment and `<hgpu-field>` are M5. The [contract ADR](docs/adr/005-t1-effect-contract.md) specifies alignment, coordinate conventions, lifecycle and limitations. The [facade ADR](docs/adr/006-public-package-facade.md) explains public package paths and internal dependency boundaries.

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
node scripts/notes.mjs
```

M1 records three runs per effect at 512×320, DPR 1, defaults and seed 7, with 30 warm-up and 120 measured frames. It reports CPU encoding/submission and rAF cadence, not GPU execution time or actual VRAM. Device state and load are uncontrolled. Records save to `docs/benchmarks`; `scripts/notes.mjs` regenerates parameter and measurement tables from built effect definitions and JSON records. Rebuild after updating notes to include them in the static app.

M0 scenarios remain available with `pnpm benchmark chrome`, `pnpm benchmark firefox --headed`, `pnpm benchmark webkit` and `node scripts/probe.mjs` against the development server. They record one/six float or direct canvases, DPR 2 and scrolling.

## Research

- [Compatibility and verified assumptions](docs/compatibility.md)
- [M0 validation and ADRs](docs/m0.md)
- [M1 validation](docs/m1.md)
- [T1 stretch validation](docs/t1-stretch.md)
- [Effect notes and template](docs/notes/_template.md)

`pnpm build` emits package JS/types and the deployable static app in `apps/playground/dist`. Packages are private; remote hosting and registry publication are not configured.
