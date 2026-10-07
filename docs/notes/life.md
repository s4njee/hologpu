# Life and life-like rules (`life`)

## Question

Can synchronous integer cellular rules remain exact across reset, batching and storage-texture access modes?

## Technique summary

The Moore neighborhood counts eight living neighbors on a torus. Birth and survival are integer bitmasks. Included rules are Conway B3/S23, HighLife B36/S23, Seeds B2/S and Day & Night B3678/S34678; custom nine-bit masks expose the same rule space. Each texel is exactly 0 or 1. Seeded density is applied on reset and a pressed pointer paints live cells. Display uses nearest integer loads so filtering cannot invent living cells.

When the device exposes the WGSL language feature readonly_and_readwrite_storage_textures, the compute source uses r32uint read_write storage access. It reads the previous texture while a distinct write-only storage texture receives the synchronous next generation; in-place neighborhood mutation would race. On engines without that language feature, sampled integer loads read the previous r32uint texture. Both paths retain integer-exact rules and the state tap exposes one uint per cell. A horizontal blinker must become vertical and return in two updates.

## References

[LifeWiki: Life-like rules](https://conwaylife.com/wiki/Life-like_cellular_automaton) defines the outer-totalistic rule family. [WGSL storage textures](https://www.w3.org/TR/WGSL/#storage-texture-type) defines the access modes and language feature.

## Passes and resources

Two r32uint state textures cost 8·N² bytes. Initialization and rule updates use 8×8 workgroups. Display samples only the latest side. Shader and pipeline leases share the device cache. Reset initializes both histories and counters; changing the internal grid recreates state, while display-only resize preserves it. Disposal destroys owned textures and buffers and releases all leases. Memory figures are logical allocation sizes, not driver VRAM.

## WebGPU features used

Baseline compute, explicit bind group layouts, storage resources and float presentation. Each queued fixed update receives a distinct immutable frame/parameter uniform snapshot. Reduced motion preserves the seeded time-zero pose; CSS provides the declared fallback when WebGPU is unavailable.

## Parameters (generated)

<!-- params:start -->

| Parameter    | Type  | Default   | Range / choices                          | Group          | Description                                                                             |
| ------------ | ----- | --------- | ---------------------------------------- | -------------- | --------------------------------------------------------------------------------------- |
| grid         | u32   | 256       | 32…1024                                  | Simulation     | Square simulation grid; changing it restarts the seeded field.                          |
| steps        | u32   | 1         | 1…16                                     | Simulation     | Solver iterations per fixed simulation update.                                          |
| rule         | enum  | "life"    | life, highlife, seeds, day-night, custom | Rules          | Conway B3/S23, HighLife B36/S23, Seeds B2/S, Day & Night B3678/S34678, or custom masks. |
| birthMask    | u32   | 8         | 0…511                                    | Rules          | Custom birth mask: bit n enables birth with n live neighbours.                          |
| survivalMask | u32   | 12        | 0…511                                    | Rules          | Custom survival mask: bit n enables survival with n live neighbours.                    |
| density      | f32   | 0.25      | 0…0.7                                    | Initialization | Seeded initial live-cell density; applied on the next reset.                            |
| tint         | color | "#a4f5a1" | —                                        | Palette        | Living cell color.                                                                      |
| background   | color | "#092021" | —                                        | Palette        | Dead cell color.                                                                        |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded 2026-10-07 on Apple M1 Max / macOS 26.6.2 using a production preview. Defaults and seed 7; gate runs override only the actual simulation grid to 1024. Resolution scale and DPR are 1, adaptive quality is disabled. Each of three runs discards 30 warm-up frames and measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion before the next frame.

| Browser              | Display / simulation         | CPU mean ms (three runs) | Submit-to-completion p95 ms | rAF median ms            | 1024² gate | Record                               |
| -------------------- | ---------------------------- | ------------------------ | --------------------------- | ------------------------ | ---------- | ------------------------------------ |
| chrome 154.0.8037.98 | 512² display / 256×256 state | 0.223 / 0.192 / 0.225    | 9.100 / 7.000 / 8.000       | 16.700 / 16.700 / 16.700 | —          | [JSON](../benchmarks/m2-chrome.json) |
| webkit 26.6          | 512² display / 256×256 state | 0.350 / 0.433 / 0.333    | 11.000 / 10.000 / 9.000     | 16.000 / 16.000 / 16.000 | —          | [JSON](../benchmarks/m2-webkit.json) |

CPU encoding/submission and submission-to-queue-completion wall latency are separate observations. Completion latency includes queue wait, browser and driver overhead; neither is GPU timestamp timing. The gate requires full-sized state and display, at least 95% completions and median rAF cadence within 110% of the separately measured idle rAF period. Device state and system load are uncontrolled. Logical allocation bytes are not VRAM. Compilation and initialization are excluded from measured frames. GPU timestamp profiling remains M3 work. Deterministic snapshots use grid 32, eight fixed updates, and seed 7 at DPR 1 and 2; separate numerical tests exercise algorithm invariants.

<!-- measurements:end -->

CPU encoding and queue-completion latency are separate from a GPU timestamp measurement. Logical bytes are not VRAM.

## Failure modes

A random initial soup is not a catalogue of constructed oscillators. Toroidal wrap affects patterns approaching edges. Density changes apply at reset. Read-write storage availability is a language capability, not an adapter GPUFeatureName; the chosen source remains visible in the Source drawer.

## Production readiness

The effect is a research demonstration. Choose grid and iteration counts for the target device, verify the fixed-step trajectory and interaction at the intended scale, and inspect the named state taps before changing stability or representation assumptions.
