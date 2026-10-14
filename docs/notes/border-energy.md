# Rounded rectangle border energy (`border-energy`)

## Question

Can an effect follow the geometry of a real element without a tessellated border mesh?

## Technique summary

The default effect retains its original physical-pixel rounded-rectangle shader, emission, alpha and scalar radius. The opt-in `border-trace` preset sets `trace: true` and intensity 0: the entire stroke and glow are exactly transparent at rest. Increasing CSS `--hgpu-intensity` to 1 reveals a quieter travelling pulse. Both intensity and tint accept CSS bindings. Trace alpha includes intensity; the legacy emission control keeps its original behavior, including a visible border when legacy intensity is 0.

DOM attachments supply the host border box relative to the effect canvas, including optional exterior padding. The shared geometry schema exposes normalized `rect`, scalar CSS-pixel `radius`, and `radiiX`/`radiiY` vectors in top-left, top-right, bottom-right, bottom-left order. Vector defaults of -1 preserve the scalar radius; all eight nonnegative radii enable the elliptical-corner branch. The DOM resolves all four computed CSS corner radii and normalizes overlapping radius sums. The shader also normalizes authored vectors and handles legal asymmetric radii larger than half an edge. Ellipse distance uses its local gradient near the rim, with derivative-antialiased stroke coverage. Width, falloff and corner radii retain their CSS size across DPR and render-resolution changes.

```ts
import { attach } from '@mk7s/hologpu-dom';
import borderEnergy from '@mk7s/hologpu-effects/border-energy';
await attach(document.querySelector('.card')!, borderEnergy, {
  preset: 'border-trace',
  layer: 'front',
  padding: 32,
});
```

```css
.card {
  --hgpu-intensity: 0;
  --hgpu-tint: #d9e5f2;
  transition: --hgpu-intensity 160ms ease;
  border-radius: 24px 12px 32px 8px / 18px 24px 16px 8px;
}
.card:hover,
.card:focus-within {
  --hgpu-intensity: 1;
}
```

Reduced motion freezes the trace pulse at time 0 while retaining intentional CSS hover/focus opacity changes. Use the authored card itself as the quiet trace fallback; the legacy decorative gradient/poster remains appropriate to the original effect.

## References

[WGSL texture loads and sampling](https://www.w3.org/TR/WGSL/#textureLoad)

## Passes and resources

One fullscreen T1 fragment pass. Frame and parameter uniform buffers are borrowed; the effect owns a shared pipeline lease and no custom textures. The runtime owns the HDR surface and final display resolve.

## WebGPU features used

Baseline sampled textures, uniform buffers and render pipelines. Linear-premultiplied HDR output is resolved through the shared runtime. Resolution quality ranges from 0.25 to 1. Reduced motion freezes the declared time pose; authored CSS progress remains an explicit input. The declared CSS fallback is available when WebGPU initialization fails.

## Parameters (generated)

<!-- params:start -->

| Parameter | Type  | Default               | Range / choices | Group    | Description                                                                                         |
| --------- | ----- | --------------------- | --------------- | -------- | --------------------------------------------------------------------------------------------------- |
| rect      | vec4  | [0.12,0.18,0.76,0.64] | 0…1             | Geometry | Local normalized border box: left, top, width, height.                                              |
| radius    | f32   | 24                    | 0…200           | Geometry | Legacy rounded corner radius in CSS pixels.                                                         |
| radiiX    | vec4  | [-1,-1,-1,-1]         | -1…4096         | Geometry | Horizontal CSS corner radii: top-left, top-right, bottom-right, bottom-left; -1 retains radius.     |
| radiiY    | vec4  | [-1,-1,-1,-1]         | -1…4096         | Geometry | Vertical CSS corner radii: top-left, top-right, bottom-right, bottom-left; -1 retains radius.       |
| trace     | bool  | false                 | —               | Light    | Hover trace whose entire stroke and glow fade with intensity; legacy rendering remains the default. |
| width     | f32   | 2                     | 0.5…24          | Geometry | Border stroke width in CSS pixels.                                                                  |
| glow      | f32   | 14                    | 1…100           | Light    | Exponential glow falloff distance in CSS pixels.                                                    |
| speed     | f32   | 0.4                   | 0…4             | Motion   | Energy pulse revolutions per second.                                                                |
| intensity | f32   | 1.5                   | 0…5             | Light    | Legacy emission; in trace mode, opacity of the complete stroke and glow.                            |
| tint      | color | "#92dfe7"             | —               | Palette  | Linear border emission colour.                                                                      |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded on the development Apple M1 Max / macOS 26.6.2 using the production preview. All current typed defaults, seed 7, physical 512² display, DPR 1 and fixed resolution/work quality. Each of three runs discards 30 warm-up updates then measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion and timestamp readback. Standalone image, text and audio effects use their documented owned fixtures: two HDR cards, a text coverage mask, and a two-sine waveform with its actual DFT. Fluid obstacles uses two packed rectangles with its default 256² grid and 32 pressure iterations.

| Browser              | CPU mean ms           | Completion p95 ms     | Summed GPU pass p95 ms | rAF median ms            | Record                               |
| -------------------- | --------------------- | --------------------- | ---------------------- | ------------------------ | ------------------------------------ |
| chrome 154.0.8037.98 | 0.228 / 0.303 / 0.270 | 4.400 / 4.000 / 5.200 | 0.262 / 0.328 / 0.328  | 16.700 / 16.700 / 16.700 | [JSON](../benchmarks/m5-chrome.json) |
| webkit 26.6          | 0.275 / 0.175 / 0.258 | 4.000 / 3.000 / 6.000 | 1.741 / 1.509 / 1.701  | 17.000 / 17.000 / 17.000 | [JSON](../benchmarks/m5-webkit.json) |

CPU encode, encoding-through-queue-completion wall latency, summed pass timestamps and rAF cadence measure different boundaries. Timestamp precision and overlapping intervals limit interpretation; the summed GPU column is not whole-frame elapsed time. Compilation and initialization are excluded, machine load is uncontrolled, and allocation sizes are logical rather than VRAM. These standalone measurements exclude live media, DOM geometry, CSS polling and attachment costs. The separate [M5 page measurements](../m5.md) cover six actual DOM attachments, visible uniform bridges and the overlay experiment. Numerical references, deterministic software snapshots and device-loss tests establish correctness separately from performance.

<!-- measurements:end -->

## Validation

The GPU reference checks glow alpha against the rounded-rectangle CPU distance at symmetric corners and the interior. Large radii remain finite. Legacy catalogue snapshots preserve the original presets and shader branch. Focused trace tests exercise independent ellipse-parametrized contour positions at DPR 1/2 and half render scale, all four asymmetric corners, radii larger than half the box width, zero alpha at rest and after fade, deterministic replay, a fixed reduced-motion pulse, shader diagnostics and disposal. An actual DOM card test checks typed CSS hover transitions, padded exterior glow, all four computed radii and child click handling.

## Failure modes

The pulse travels by polar angle rather than constant arc length, so apparent speed differs between long edges and corners. The ellipse distance is a near-rim approximation, not an exact Euclidean distance far from an eccentric corner; broad glows can expose falloff differences. A full-element glow clips at the canvas boundary unless the caller reserves padding. Ancestor overflow can still clip an oversized canvas. Arbitrary host-transform inversion is outside this attachment geometry contract.

## Production readiness

For the trace preset, reserve about four falloff lengths of padding (32 CSS px for the default 8 px falloff). Prefer resolutionScale 1 for narrow 1.5 px strokes; half scale is useful at DPR 2 after visual inspection. The effect is one baseline fragment pass with no feedback or simulation. The historical measurements above describe the legacy standalone branch, not the trace/DOM attachment overhead; new budget claims require dedicated captures.
