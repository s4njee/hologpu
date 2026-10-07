# Margolus sand, water and fire (`falling-sand`)

## Question

Can moving materials remain race-free while their block neighborhood changes every subiteration?

## Technique summary

Even-coordinate invocations own disjoint 2×2 blocks. Alternating pipelines offset the partition by zero or one cell in both axes; wrap maps each partition bijectively onto the even-sized toroidal grid. An invocation reads its four old values, applies sequential swaps locally, then writes exactly those four next cells. No other invocation owns these destinations. Sand sinks into empty, water or fire cells; water falls and optionally shuffles horizontally; fire rises into empty cells and loses one lifetime tick. Walls do not move. Pointer painting occurs inside each owned block after transport.

The uint state low byte is 0 empty, 1 sand, 2 water, 3 fire, 4 wall. Fire lifetime occupies bits 8 and above. The phase counter resets with the seed, so batched and individual fixed updates use the same partitions. Sand, water and walls should conserve counts when painting is off; fire is explicitly nonconservative because it expires. This is a material block CA rather than a physically calibrated granular/fluid solver.

## References

[Toffoli and Margolus: Cellular Automata Machines](https://mitpress.mit.edu/9780262526319/cellular-automata-machines/) describes partitioned block cellular automata. The material transition rules in this effect are authored for the playground rather than copied from a scientific sand model.

## Passes and resources

Two r32uint state textures cost 8·N² bytes. Two compute pipelines share the rule body with compile-time block phases. Dispatch uses 8×8 workgroups, but only even-coordinate invocations execute block transport. Display uses nearest integer material loads. Shader and pipeline leases share the device cache. Reset initializes both histories and counters; changing the internal grid recreates state, while display-only resize preserves it. Disposal destroys owned textures and buffers and releases all leases. Memory figures are logical allocation sizes, not driver VRAM.

## WebGPU features used

Baseline compute, explicit bind group layouts, storage resources and float presentation. Each queued fixed update receives a distinct immutable frame/parameter uniform snapshot. Reduced motion preserves the seeded time-zero pose; CSS provides the declared fallback when WebGPU is unavailable.

## Parameters (generated)

<!-- params:start -->

| Parameter  | Type  | Default   | Range / choices                | Group       | Description                                                         |
| ---------- | ----- | --------- | ------------------------------ | ----------- | ------------------------------------------------------------------- |
| grid       | u32   | 256       | 32…1024                        | Simulation  | Square simulation grid; changing it restarts the seeded field.      |
| steps      | u32   | 2         | 1…16                           | Simulation  | Solver iterations per fixed simulation update.                      |
| material   | enum  | "sand"    | sand, water, fire, wall, erase | Interaction | Material drawn by a pressed pointer.                                |
| brush      | f32   | 0.04      | 0.01…0.15                      | Interaction | Brush radius as a fraction of simulation extent.                    |
| fireLife   | u32   | 80        | 8…240                          | Rules       | Initial fire lifetime in block updates; fire rises and expires.     |
| waterFlow  | bool  | true      | —                              | Rules       | Permit water to shuffle horizontally inside each alternating block. |
| sand       | color | "#efcb8c" | —                              | Palette     | Sand color.                                                         |
| water      | color | "#489ce2" | —                              | Palette     | Water color.                                                        |
| background | color | "#111b2c" | —                              | Palette     | Empty background.                                                   |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded 2026-10-07 on Apple M1 Max / macOS 26.6.2 using a production preview. Defaults and seed 7; gate runs override only the actual simulation grid to 1024. Resolution scale and DPR are 1, adaptive quality is disabled. Each of three runs discards 30 warm-up frames and measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion before the next frame.

| Browser              | Display / simulation         | CPU mean ms (three runs) | Submit-to-completion p95 ms | rAF median ms            | 1024² gate | Record                               |
| -------------------- | ---------------------------- | ------------------------ | --------------------------- | ------------------------ | ---------- | ------------------------------------ |
| chrome 154.0.8037.98 | 512² display / 256×256 state | 0.229 / 0.225 / 0.229    | 9.100 / 8.700 / 7.800       | 16.700 / 16.700 / 16.700 | —          | [JSON](../benchmarks/m2-chrome.json) |
| webkit 26.6          | 512² display / 256×256 state | 0.242 / 0.308 / 0.283    | 8.000 / 11.000 / 10.000     | 16.000 / 16.000 / 16.000 | —          | [JSON](../benchmarks/m2-webkit.json) |

CPU encoding/submission and submission-to-queue-completion wall latency are separate observations. Completion latency includes queue wait, browser and driver overhead; neither is GPU timestamp timing. The gate requires full-sized state and display, at least 95% completions and median rAF cadence within 110% of the separately measured idle rAF period. Device state and system load are uncontrolled. Logical allocation bytes are not VRAM. Compilation and initialization are excluded from measured frames. GPU timestamp profiling remains M3 work. Deterministic snapshots use grid 32, eight fixed updates, and seed 7 at DPR 1 and 2; separate numerical tests exercise algorithm invariants.

<!-- measurements:end -->

CPU encoding and queue-completion latency are separate from a GPU timestamp measurement. Logical bytes are not VRAM.

## Failure modes

The torus is initialized with fixed side and bottom walls so materials do not wrap through the visible container; an erase brush can remove them. Water transport is a local shuffle, not incompressibility. Fire has buoyancy and expiration but no fuel or heat equation. Two-phase directional updates can leave lattice artifacts and pinned configurations. Grid sizes are rounded to an even extent so partitions remain disjoint.

## Production readiness

The effect is a research demonstration. Choose grid and iteration counts for the target device, verify the fixed-step trajectory and interaction at the intended scale, and inspect the named state taps before changing stability or representation assumptions.
