# Wave history and refraction (`wave`)

## Question

Can two time levels support a stable two-dimensional wave update and an interactive refracted display?

## Technique summary

The red channel is current displacement h and green is previous displacement. A five-point Laplacian advances h_next = h + damping·(h-h_previous) + courant²·laplacian(h). The next texel stores [h_next,h,0,1], so the ping-pong pair preserves both levels without a third history texture. Clamped neighbor coordinates impose a reflecting zero-normal-gradient edge. A seeded Gaussian bump initializes both levels with zero velocity. A pressed pointer adds a localized Gaussian force.

The Courant parameter is constrained to 0.68. For this velocity-damped stencil, the worst spatial Fourier mode requires courant² ≤ (1+damping)/4; the bound stays safe even at minimum damping 0.9. With damping 1, this reduces to the usual limit 1/√2. Display uses central height differences to distort a procedural checker and light the surface; height and velocity diagnostic views expose the actual histories. It is a height-field refraction illustration, not refracted scene geometry. A zero history with no pointer must remain zero.

## References

[MIT: Finite Difference Methods for Wave Equations](https://ocw.mit.edu/courses/18-325-topics-in-applied-mathematics-waves-and-imaging-fall-2015/resources/mit18_325f15_appendix_b/) provides the numerical PDE context. The stated damping-dependent Courant bound is derived from the characteristic roots of the five-point stencil used here.

## Passes and resources

Two rgba16float targets cost 16·N² bytes. The two time levels share R/G; each 8×8 compute iteration reads one target and writes the other. Display bilinearly reads the current state. Shader and pipeline leases share the device cache. Reset initializes both histories and counters; changing the internal grid recreates state, while display-only resize preserves it. Disposal destroys owned textures and buffers and releases all leases. Memory figures are logical allocation sizes, not driver VRAM.

## WebGPU features used

Baseline compute, explicit bind group layouts, storage resources and float presentation. Each queued fixed update receives a distinct immutable frame/parameter uniform snapshot. Reduced motion preserves the seeded time-zero pose; CSS provides the declared fallback when WebGPU is unavailable.

## Parameters (generated)

<!-- params:start -->

| Parameter  | Type  | Default   | Range / choices           | Group       | Description                                                                                             |
| ---------- | ----- | --------- | ------------------------- | ----------- | ------------------------------------------------------------------------------------------------------- |
| grid       | u32   | 256       | 32…1024                   | Simulation  | Square simulation grid; changing it restarts the seeded field.                                          |
| steps      | u32   | 1         | 1…16                      | Simulation  | Solver iterations per fixed simulation update.                                                          |
| courant    | f32   | 0.45      | 0.05…0.68                 | Simulation  | Wave speed × timestep / cell spacing; ≤ 0.68 satisfies c² ≤ (1+damping)/4 throughout the damping range. |
| damping    | f32   | 0.995     | 0.9…1                     | Simulation  | Velocity retention per iteration.                                                                       |
| strength   | f32   | 0.15      | 0.01…0.5                  | Interaction | Pressed-pointer disturbance height per iteration.                                                       |
| refraction | f32   | 0.06      | 0…0.2                     | Display     | Gradient distortion of the procedural bottom pattern.                                                   |
| view       | enum  | "refract" | refract, height, velocity | Display     | Refracted checker, signed height, or two-time-level velocity.                                           |
| tint       | color | "#63d6ed" | —                         | Palette     | Water surface highlight color.                                                                          |
| background | color | "#063c68" | —                         | Palette     | Dark water color.                                                                                       |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded 2026-10-07 on Apple M1 Max / macOS 26.6.2 using a production preview. Defaults and seed 7; gate runs override only the actual simulation grid to 1024. Resolution scale and DPR are 1, adaptive quality is disabled. Each of three runs discards 30 warm-up frames and measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion before the next frame.

| Browser              | Display / simulation         | CPU mean ms (three runs) | Submit-to-completion p95 ms | rAF median ms            | 1024² gate | Record                               |
| -------------------- | ---------------------------- | ------------------------ | --------------------------- | ------------------------ | ---------- | ------------------------------------ |
| chrome 154.0.8037.98 | 512² display / 256×256 state | 0.213 / 0.187 / 0.217    | 9.600 / 7.100 / 6.800       | 16.700 / 16.700 / 16.700 | —          | [JSON](../benchmarks/m2-chrome.json) |
| webkit 26.6          | 512² display / 256×256 state | 0.275 / 0.375 / 0.417    | 8.000 / 11.000 / 8.000      | 17.000 / 17.000 / 16.000 | —          | [JSON](../benchmarks/m2-webkit.json) |

CPU encoding/submission and submission-to-queue-completion wall latency are separate observations. Completion latency includes queue wait, browser and driver overhead; neither is GPU timestamp timing. The gate requires full-sized state and display, at least 95% completions and median rAF cadence within 110% of the separately measured idle rAF period. Device state and system load are uncontrolled. Logical allocation bytes are not VRAM. Compilation and initialization are excluded from measured frames. GPU timestamp profiling remains M3 work. Deterministic snapshots use grid 32, eight fixed updates, and seed 7 at DPR 1 and 2; separate numerical tests exercise algorithm invariants.

<!-- measurements:end -->

CPU encoding and queue-completion latency are separate from a GPU timestamp measurement. Logical bytes are not VRAM.

## Failure modes

Per-iteration damping changes decay when steps change. Forcing is per iteration and can drive large heights; the implementation bounds h to ±4 to guard overflow. Half precision alters long-lived waves. Courant stability covers the linear homogeneous stencil, not arbitrary persistent forcing or floating-point loss. The display pattern is procedural, without a scene texture.

## Production readiness

The effect is a research demonstration. Choose grid and iteration counts for the target device, verify the fixed-step trajectory and interaction at the intended scale, and inspect the named state taps before changing stability or representation assumptions.
