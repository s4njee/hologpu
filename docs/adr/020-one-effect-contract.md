# ADR-020: One effect contract for the whole collection

Accepted 2026-10-13 for M3, after the story 3.1 spike.

## Context

The four projects have three contracts:

- **HoloGPU** (`EffectDefinition`): `createEffect(canvas, definition, options)` and `attach`,
  with a `ParamStore`, presets, seeds, pause/step, reduced-motion poses, posters, device-loss
  recovery and per-effect exports. The instance is
  `{ resize([w, h]), update(frame), render(frame, encoder, target), reset(seed), dispose(), … }`.
- **Fire Temple and Water Temple** (`defineEffect({ meta, params, presets, create })`): the
  instance is `{ resize(w, h, dpr), frame(time, encoder, target), destroy() }`, parameters are a
  plain object, and the gallery shell owns the device, encoder and target.
- **Light Temple**: a factory returning `{ frame, resize?, dispose }`, with parameters declared
  imperatively by building a DOM panel.

Backlog decision **D3** proposes HoloGPU's API as the one public API, with the temples adapting
to it. Story 3.1 asked whether HoloGPU's instance shape can host a temple effect, before
committing to D3.

## Decision

Adopt the HoloGPU contract as the single public API. A temple effect is presented as an
`EffectDefinition` whose `create(ctx)` wraps the temple's `create`, and whose `render(frame,
encoder, target)` forwards to the temple's `frame(time, encoder, target)`. The temples do not
grow their own `mount()`; they adapt. The shared temple core (ADR to follow, story 3.5) and the
per-project library entries (3.3, 3.4, 3.7) are built against this decision.

## Spike evidence (story 3.1)

`spikes/temple-adapter` in the holofx superproject wraps Fire Temple's `candle` as a HoloGPU
`EffectDefinition` and drives it with `createEffect(canvas, templeEffect(candle, canvas), {
preset: 'tea light' })`. Run with `node spikes/temple-adapter/run.mjs`; it serves the page with
Vite and loads it with Playwright on a real WebGPU adapter.

Result: the field mounted, `resize` ran once and `render` ran on every frame (90 in a 1.5 s
run), no shader or validation errors were raised, and the rendered candle matches the Fire
Temple gallery. The instance shapes are therefore compatible at the encode boundary: the
temple's `frame(time, encoder, target)` slots directly into HoloGPU's `render(frame, encoder,
target)`.

## What had to bend

The spike found these mismatches. Each needs a runtime change, an adapter rule, or an explicit
limitation.

1. **No canvas in the effect context.** HoloGPU's `EffectContext` has `session`, `device`,
   `params`, buffers and `format` but **no canvas**. Fire Temple's `create` needs the canvas for
   `trackPointers(canvas)`. The spike closes over the canvas, which only works because the
   adapter is built per canvas. The runtime should expose the canvas (or an `observeTarget`) on
   `EffectContext`.
2. **Parameter schema and value shapes.** Temple `number | boolean | color | select` must map to
   HoloGPU `f32 | bool | color | enum`. Temple colors are linear `[r, g, b]`; HoloGPU colors are
   CSS strings. The adapter converts both ways, which loses exact color round-tripping. Light
   Temple adds `text`, which HoloGPU has no native type for (the runtime uses a text input and a
   generated mask, ADR-016/017).
3. **Plain-object params vs `ParamStore`.** Temple effects read a live plain object; HoloGPU
   holds a `ParamStore`. The adapter re-pulls a snapshot and rewrites the plain object every
   frame, so parameter changes are one frame late and the temple's copy is not the source of
   truth.
4. **`resize` has no DPR.** HoloGPU calls `resize([w, h])`; the temple wants `resize(w, h, dpr)`.
   DPR is only available on the next `FrameInfo`, so the first resize uses a guessed DPR. Candle
   ignores DPR, but effects that use it will be one frame off.
5. **No `reset` on the temple instance.** HoloGPU has deterministic `reset(seed)`. The spike's
   `reset` is a no-op; a real adapter must dispose and recreate, which is not equivalent for seed
   determinism.
6. **Separate `update` and `render` are unused.** Temple effects do all their work in `frame`.
   HoloGPU's `update`/`render` split buys nothing for them; the adapter does nothing in `update`
   and everything in `render`.
7. **Profiler shape differs.** The temple wants `{ pass(label): GPURenderPassTimestampWrites |
   undefined }`; HoloGPU's profiler is a different type. Per-pass GPU timings are dropped unless
   a bridge is written.
8. **No `sources`, `diagnostics`, `textureTaps`, `bufferTaps` or `memory`.** The temple instance
   exposes none of these, so HoloGPU's Source drawer, Passes drawer and memory accounting do not
   work for wrapped temple effects without new temple-side accessors.
9. **HDR opt-in differs.** The temple tail takes an `hdr` boolean; HoloGPU learns HDR from the
   target `format`. The adapter infers `hdr` from `format`, which cannot express a caller's
   preference on an SDR-ish target.
10. **Metadata models differ.** Temple `meta` has `epic` and an `A/B/C` tier and a prose
    `scorecard.fallback`; HoloGPU needs `family`, a `T1…T5` tier, a CSS `fallback`, `features`
    and `inputs`. The mapping is lossy (epic has no HoloGPU equivalent; `A→T1, B→T2, C→T5`).
11. **Resolution scale.** HoloGPU has `quality.resolutionScale`; temple effects scale through a
    shell-level render scale. The adapter cannot yet connect them generically.
12. **Accessibility lives in the temple shell.** Reduced motion, pause-when-hidden, the brightness
    cap and flash warnings are shell behaviour in Fire and Water, so a wrapped effect loses them
    until story 3.8 moves them into the runtime.

## Consequences

- The public API stays HoloGPU's; no fourth contract is introduced.
- A shared adapter/`@mk7s/hologpu-temple-core` package is the right home for rules 1–11, so each
  temple's library entry is thin.
- Rules 1, 5, 8 and 12 are runtime or contract gaps in HoloGPU that must be closed in M3
  (stories 3.8, 3.11 and the adapter), not worked around per effect.
- Story 3.3 (library entries), 3.4 (shader packaging), 3.5 (shared core) and 3.7 (Light Temple)
  proceed on this decision.
