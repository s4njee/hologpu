# Lenia continuous cellular automaton (`lenia`)

## Question

How costly is a continuous neighborhood rule when its radial kernel is stored in a LUT instead of recomputed for every sample?

## Technique summary

A 256-entry read-only storage LUT stores a radial Gaussian ring: exp(-0.5·((r-0.5)/0.15)²), with the outer endpoint zero. Each cell directly convolves offsets strictly inside the chosen integer radius, indexing floor(255·distance/radius). The weighted sum is normalized by the accumulated weights. Growth is 2·exp(-0.5·((U-mean)/sigma)²)-1; explicit Euler advances the bounded concentration. The circular kernel and toroidal domain implement a continuous-state Lenia rule without an FFT.

The tap channels are [concentration, normalized convolution, growth,1]. Initialization is a seeded, textured Gaussian cloud; the presets explore different growth responses. These are exploratory seeds, not reproductions of named stable organisms. A constant field tests convolution normalization and provides an exact growth-step reference.

## References

[Bert Wang-Chak Chan: Lenia — Biology of Artificial Life](https://arxiv.org/abs/1812.05433) describes continuous-state automata with convolution and growth mappings. This effect chooses one Gaussian-ring kernel and direct finite-grid convolution.

## Passes and resources

Two rgba16float histories cost 16·N² bytes; the fixed LUT is 1024 bytes. One direct convolution pass runs per iteration, followed by bilinear display. Shader and pipeline leases share the device cache. Reset initializes both histories and counters; changing the internal grid recreates state, while display-only resize preserves it. Disposal destroys owned textures and buffers and releases all leases. Memory figures are logical allocation sizes, not driver VRAM.

## WebGPU features used

Baseline compute, explicit bind group layouts, storage resources and float presentation. Each queued fixed update receives a distinct immutable frame/parameter uniform snapshot. Reduced motion preserves the seeded time-zero pose; CSS provides the declared fallback when WebGPU is unavailable.

## Parameters (generated)

<!-- params:start -->

| Parameter  | Type  | Default   | Range / choices | Group      | Description                                                            |
| ---------- | ----- | --------- | --------------- | ---------- | ---------------------------------------------------------------------- |
| grid       | u32   | 128       | 32…1024         | Simulation | Square simulation grid; changing it restarts the seeded field.         |
| steps      | u32   | 1         | 1…16            | Simulation | Solver iterations per fixed simulation update.                         |
| radius     | u32   | 8         | 2…16            | Kernel     | Circular convolution radius in cells; direct cost grows quadratically. |
| mean       | f32   | 0.15      | 0.05…0.4        | Growth     | Neighbourhood concentration at peak growth.                            |
| sigma      | f32   | 0.035     | 0.01…0.12       | Growth     | Width of the Gaussian growth response.                                 |
| dt         | f32   | 0.1       | 0.01…0.2        | Growth     | Explicit Euler increment per iteration.                                |
| tint       | color | "#a6e6cf" | —               | Palette    | High-density cell color.                                               |
| background | color | "#142339" | —               | Palette    | Empty field color.                                                     |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded 2026-10-07 on Apple M1 Max / macOS 26.6.2 using a production preview. Defaults and seed 7; gate runs override only the actual simulation grid to 1024. Resolution scale and DPR are 1, adaptive quality is disabled. Each of three runs discards 30 warm-up frames and measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion before the next frame.

| Browser              | Display / simulation         | CPU mean ms (three runs) | Submit-to-completion p95 ms | rAF median ms            | 1024² gate | Record                               |
| -------------------- | ---------------------------- | ------------------------ | --------------------------- | ------------------------ | ---------- | ------------------------------------ |
| chrome 154.0.8037.98 | 512² display / 128×128 state | 0.193 / 0.197 / 0.201    | 8.600 / 8.700 / 9.300       | 16.700 / 16.700 / 16.700 | —          | [JSON](../benchmarks/m2-chrome.json) |
| webkit 26.6          | 512² display / 128×128 state | 0.267 / 0.308 / 0.267    | 9.000 / 10.000 / 8.000      | 16.000 / 16.000 / 16.000 | —          | [JSON](../benchmarks/m2-webkit.json) |

CPU encoding/submission and submission-to-queue-completion wall latency are separate observations. Completion latency includes queue wait, browser and driver overhead; neither is GPU timestamp timing. The gate requires full-sized state and display, at least 95% completions and median rAF cadence within 110% of the separately measured idle rAF period. Device state and system load are uncontrolled. Logical allocation bytes are not VRAM. Compilation and initialization are excluded from measured frames. GPU timestamp profiling remains M3 work. Deterministic snapshots use grid 32, eight fixed updates, and seed 7 at DPR 1 and 2; separate numerical tests exercise algorithm invariants.

<!-- measurements:end -->

CPU encoding and queue-completion latency are separate from a GPU timestamp measurement. Logical bytes are not VRAM.

## Failure modes

Direct cost grows as grid area × radius². Radius 16 requires hundreds of loads per cell and is intentionally a large-kernel cost probe. Use a smaller grid before increasing radius. Half precision, a quantized LUT and finite Euler steps change trajectories; clipping prevents invalid states but does not ensure stable organisms. Extinction and saturation are valid outcomes.

## Production readiness

The effect is a research demonstration. Choose grid and iteration counts for the target device, verify the fixed-step trajectory and interaction at the intended scale, and inspect the named state taps before changing stability or representation assumptions.
