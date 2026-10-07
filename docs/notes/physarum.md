# Physarum agents and atomic trail (`physarum`)

## Question

Can independent agents sense a diffusing trail and deposit into shared cells without order-dependent write races?

## Technique summary

Each 16-byte storage-buffer agent contains normalized x/y, heading and an integer seed. Three sensors bilinearly read the previous trail at forward and angular-offset positions. The heading turns toward the stronger sensor, moves at a cell-scale speed, and wraps positions into [0,1). Each agent atomically adds 1024 to a uint deposit buffer at its destination cell. A separate compute pass blends the existing trail with a 3×3 box average, applies decay, adds the summed deposits scaled by deposit/1024, and writes the next trail. The atomic buffer is cleared before each agent dispatch. Independent integer addition makes deposition race-safe and exact within the configured count bound.

The trail tap contains concentration in red. Buffer taps expose agent records and the latest fixed-point deposits; summing deposits before decay should equal 1024·agentCount. Agent initialization forms a seeded annulus with inward headings. Agents sense only a completed prior trail, so no invocation sees partial deposits from its peers. This is a simplified trail-following model, without collision occupancy or biological transport physics.

## References

[Jeff Jones: Pattern Formation and Evolution in Approximations of Physarum Transport Networks](https://uwe-repository.worktribe.com/preview/980585/artl.2010.16.2.pdf) motivates sensor/motor agents coupled to a diffusing trail. [WGSL atomic built-ins](https://www.w3.org/TR/WGSL/#atomic-builtin-functions) defines the integer race-safe accumulation.

## Passes and resources

Two rgba16float trail textures cost 16·N² bytes. Agents cost 16·count bytes; deposits cost 4·N². Each iteration clears deposits, dispatches agents in groups of 64, dispatches diffusion in 8×8 groups, swaps trail and displays it. Shader and pipeline leases share the device cache. Reset initializes both histories and counters; changing the internal grid recreates state, while display-only resize preserves it. Disposal destroys owned textures and buffers and releases all leases. Memory figures are logical allocation sizes, not driver VRAM.

## WebGPU features used

Baseline compute, explicit bind group layouts, storage resources and float presentation. Each queued fixed update receives a distinct immutable frame/parameter uniform snapshot. Reduced motion preserves the seeded time-zero pose; CSS provides the declared fallback when WebGPU is unavailable.

## Parameters (generated)

<!-- params:start -->

| Parameter      | Type  | Default   | Range / choices | Group      | Description                                                                                 |
| -------------- | ----- | --------- | --------------- | ---------- | ------------------------------------------------------------------------------------------- |
| grid           | u32   | 256       | 32…1024         | Simulation | Square simulation grid; changing it restarts the seeded field.                              |
| steps          | u32   | 1         | 1…16            | Simulation | Solver iterations per fixed simulation update.                                              |
| agents         | u32   | 8192      | 256…65536       | Simulation | Independent storage-buffer agents; changing the count restarts.                             |
| sensorDistance | f32   | 12        | 1…50            | Agents     | Distance of three trail sensors in cells.                                                   |
| sensorAngle    | f32   | 0.7       | 0.1…1.5         | Agents     | Angular sensor offset in radians.                                                           |
| turn           | f32   | 0.3       | 0.02…1          | Agents     | Steering angle per iteration.                                                               |
| speed          | f32   | 1.2       | 0.1…4           | Agents     | Distance moved in cells per iteration.                                                      |
| deposit        | f32   | 0.3       | 0.01…2          | Trail      | Trail concentration added per agent; fixed-point integer atomic additions sum races safely. |
| diffusion      | f32   | 0.8       | 0…1             | Trail      | Blend between trail and 3×3 box diffusion.                                                  |
| decay          | f32   | 0.97      | 0.85…0.999      | Trail      | Trail retention per iteration.                                                              |
| tint           | color | "#a0edcb" | —               | Palette    | Bright trail color.                                                                         |
| background     | color | "#10192d" | —               | Palette    | Dark empty field.                                                                           |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded 2026-10-07 on Apple M1 Max / macOS 26.6.2 using a production preview. Defaults and seed 7; gate runs override only the actual simulation grid to 1024. Resolution scale and DPR are 1, adaptive quality is disabled. Each of three runs discards 30 warm-up frames and measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion before the next frame.

| Browser              | Display / simulation         | CPU mean ms (three runs) | Submit-to-completion p95 ms | rAF median ms            | 1024² gate | Record                               |
| -------------------- | ---------------------------- | ------------------------ | --------------------------- | ------------------------ | ---------- | ------------------------------------ |
| chrome 154.0.8037.98 | 512² display / 256×256 state | 0.180 / 0.180 / 0.206    | 6.700 / 7.600 / 6.400       | 16.700 / 16.700 / 16.700 | —          | [JSON](../benchmarks/m2-chrome.json) |
| webkit 26.6          | 512² display / 256×256 state | 0.383 / 0.642 / 0.283    | 11.000 / 11.000 / 9.000     | 16.000 / 16.000 / 16.000 | —          | [JSON](../benchmarks/m2-webkit.json) |

CPU encoding/submission and submission-to-queue-completion wall latency are separate observations. Completion latency includes queue wait, browser and driver overhead; neither is GPU timestamp timing. The gate requires full-sized state and display, at least 95% completions and median rAF cadence within 110% of the separately measured idle rAF period. Device state and system load are uncontrolled. Logical allocation bytes are not VRAM. Compilation and initialization are excluded from measured frames. GPU timestamp profiling remains M3 work. Deterministic snapshots use grid 32, eight fixed updates, and seed 7 at DPR 1 and 2; separate numerical tests exercise algorithm invariants.

<!-- measurements:end -->

CPU encoding and queue-completion latency are separate from a GPU timestamp measurement. Logical bytes are not VRAM.

## Failure modes

Trail concentration is capped at 64 to bound half-float accumulation. Sensors wrap all four bilinear samples across the periodic domain. Headings wrap into one turn to bound long-running angular coordinates. The atomic sum is safe at at most 65536 agents (67,108,864 fixed-point units). The model omits agent exclusion and nutrient sources; results are illustrative networks rather than a validated biological simulation.

## Production readiness

The effect is a research demonstration. Choose grid and iteration counts for the target device, verify the fixed-step trajectory and interaction at the intended scale, and inspect the named state taps before changing stability or representation assumptions.
