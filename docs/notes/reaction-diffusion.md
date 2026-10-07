# Gray–Scott reaction diffusion (`reaction-diffusion`)

## Question

Can a fixed-step, floating-point stencil reproduce reaction fronts without reading a target being written?

## Technique summary

Each cell stores reagent A and B in the red and green channels. A weighted nine-point Laplacian uses -1 at the center, 0.2 at four axial neighbors, and 0.05 at diagonals. Diffusion coefficients are 1 and 0.5. Explicit Euler adds diffusion, the A·B² reaction, A feed, and B removal, then bounds concentrations to [0,1]. Toroidal boundaries preserve a constant field. Twelve seeded reagent patches initialize both histories; a pressed pointer adds B. The parameter-map switch sweeps feed horizontally from 0.01 to 0.08 and kill vertically from 0.045 to 0.075. This is spatially varying chemistry, not a precomputed image.

Four iterations per fixed update are the default. Grid size is independent of the display and can reach 1024². Every iteration reads one texture and writes the other in a separate compute pass. The state tap exposes [A,B,0,1]. The fixed point A=1, B=0 should remain invariant; a CPU stencil provides a direct one-step numerical reference.

## References

[Karl Sims: Reaction-Diffusion Tutorial](https://www.karlsims.com/rd.html) supplies the equations, stencil, coefficient conventions and coral/mitosis parameter pairs.

## Passes and resources

Two rgba16float state textures cost 16·N² bytes. Initialization writes both; update runs 8×8 compute groups and display samples the current side with manual bilinear interpolation. Shader and pipeline leases share the device cache. Reset initializes both histories and counters; changing the internal grid recreates state, while display-only resize preserves it. Disposal destroys owned textures and buffers and releases all leases. Memory figures are logical allocation sizes, not driver VRAM.

## WebGPU features used

Baseline compute, explicit bind group layouts, storage resources and float presentation. Each queued fixed update receives a distinct immutable frame/parameter uniform snapshot. Reduced motion preserves the seeded time-zero pose; CSS provides the declared fallback when WebGPU is unavailable.

## Parameters (generated)

<!-- params:start -->

| Parameter  | Type  | Default   | Range / choices | Group      | Description                                                                |
| ---------- | ----- | --------- | --------------- | ---------- | -------------------------------------------------------------------------- |
| grid       | u32   | 512       | 32…1024         | Simulation | Square simulation grid; changing it restarts the seeded field.             |
| steps      | u32   | 4         | 1…16            | Simulation | Solver iterations per fixed simulation update.                             |
| feed       | f32   | 0.0545    | 0…0.1           | Chemistry  | Rate of replenishing reagent A.                                            |
| kill       | f32   | 0.062     | 0…0.1           | Chemistry  | Additional removal rate of reagent B.                                      |
| map        | bool  | false     | —               | Chemistry  | Sweep feed horizontally and kill vertically across the domain.             |
| dt         | f32   | 1         | 0.1…1           | Simulation | Explicit integration interval; bounded for the weighted diffusion stencil. |
| tint       | color | "#f59e71" | —               | Palette    | High B concentration color.                                                |
| background | color | "#102e47" | —               | Palette    | Low B concentration color.                                                 |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded 2026-10-07 on Apple M1 Max / macOS 26.6.2 using a production preview. Defaults and seed 7; gate runs override only the actual simulation grid to 1024. Resolution scale and DPR are 1, adaptive quality is disabled. Each of three runs discards 30 warm-up frames and measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion before the next frame.

| Browser              | Display / simulation            | CPU mean ms (three runs) | Submit-to-completion p95 ms | rAF median ms            | 1024² gate    | Record                                    |
| -------------------- | ------------------------------- | ------------------------ | --------------------------- | ------------------------ | ------------- | ----------------------------------------- |
| chrome 154.0.8037.98 | 512² display / 512×512 state    | 0.167 / 0.200 / 0.231    | 5.700 / 6.400 / 7.100       | 16.700 / 16.700 / 16.700 | —             | [JSON](../benchmarks/m2-chrome.json)      |
| chrome 154.0.8037.98 | 1024² display / 1024×1024 state | 0.177 / 0.198 / 0.247    | 8.900 / 9.600 / 10.400      | 16.700 / 16.700 / 16.700 | 3/3 runs pass | [JSON](../benchmarks/m2-gate-chrome.json) |
| webkit 26.6          | 1024² display / 1024×1024 state | 0.433 / 0.442 / 0.375    | 11.000 / 11.000 / 10.000    | 16.000 / 17.000 / 17.000 | 3/3 runs pass | [JSON](../benchmarks/m2-gate-webkit.json) |
| webkit 26.6          | 512² display / 512×512 state    | 0.292 / 0.350 / 0.500    | 10.000 / 9.000 / 11.000     | 16.000 / 16.000 / 16.000 | —             | [JSON](../benchmarks/m2-webkit.json)      |

CPU encoding/submission and submission-to-queue-completion wall latency are separate observations. Completion latency includes queue wait, browser and driver overhead; neither is GPU timestamp timing. The gate requires full-sized state and display, at least 95% completions and median rAF cadence within 110% of the separately measured idle rAF period. Device state and system load are uncontrolled. Logical allocation bytes are not VRAM. Compilation and initialization are excluded from measured frames. GPU timestamp profiling remains M3 work. Deterministic snapshots use grid 32, eight fixed updates, and seed 7 at DPR 1 and 2; separate numerical tests exercise algorithm invariants.

<!-- measurements:end -->

CPU encoding and queue-completion latency are separate from a GPU timestamp measurement. Logical bytes are not VRAM.

## Failure modes

Half precision can quantize small concentration changes; bounds prevent unstable concentrations but do not prove physical accuracy. Emergent fronts need hundreds of updates. Parameter changes can cross into extinction or saturated regions; this is expected chemistry. The parameter-map axes differ from the orientation of Sims’ illustrated map.

## Production readiness

The effect is a research demonstration. Choose grid and iteration counts for the target device, verify the fixed-step trajectory and interaction at the intended scale, and inspect the named state taps before changing stability or representation assumptions.
