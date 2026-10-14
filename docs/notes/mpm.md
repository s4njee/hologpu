# Material point transfers (`mpm`)

## Question

Can portable WebGPU run particle/grid material transfers without float atomics?

## Technique summary

Quadratic B-spline particle-to-grid gathering, APIC affine momentum, grid forces/walls, then grid-to-particle gathering and deformation updates. Liquid uses an isotropic weak-compressibility pressure; jelly uses compressible neo-Hookean stress. Snow clips elastic volume and carries plastic volume: this is a reduced volumetric approximation, not full SVD snow plasticity.

## References

- [Primary technique reference](https://yuanming.taichi.graphics/publication/2019-mpm-tutorial/)
- [WebGPU specification](https://gpuweb.github.io/gpuweb/)

## Passes and resources

Each substep reads one 64-byte particle buffer, gathers each grid node into velocity/mass, gathers back into the alternate particle buffer and swaps. Density quads feed a screen-space normal/lighting resolve. All allocations and snapshot slots are owned and disposed.

## WebGPU features used

Native storage/compute/render pipelines and float data. No optional GPU feature is required for the portable rendering path. Backdrop DOM capture additionally requires the experimental queue API, detected separately from GPUFeatureName.

## Parameters (generated)

<!-- params:start -->

| Parameter | Type  | Default   | Range / choices     | Group      | Description                                                                                       |
| --------- | ----- | --------- | ------------------- | ---------- | ------------------------------------------------------------------------------------------------- |
| count     | u32   | 1024      | 16…4096             | Workload   | Material samples, each carrying position, velocity, affine momentum and deformation.              |
| grid      | u32   | 32        | 16…64               | Workload   | Square background grid resolution. Gather P2G avoids non-portable float atomics.                  |
| material  | enum  | "liquid"  | liquid, jelly, snow | Material   | Weakly compressible liquid, compressible elastic jelly, or volumetric plastic snow approximation. |
| bulk      | f32   | 30        | 0…100               | Simulation | Bulk stiffness; lower values permit greater compression.                                          |
| gravity   | f32   | 2         | 0…5                 | Simulation | Downward acceleration in normalized domain units.                                                 |
| dt        | f32   | 0.002     | 0.0005…0.004        | Simulation | Time per transfer substep, independent of display refresh.                                        |
| steps     | u32   | 4         | 1…8                 | Workload   | Transfer substeps per fixed update.                                                               |
| radius    | f32   | 0.011     | 0.002…0.04          | Display    | Screen-space density splat radius.                                                                |
| tint      | color | "#4cc2e8" | —                   | Display    | Linearized surface colour.                                                                        |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded on the development Apple M1 Max / macOS 26.6.2 using the production preview. Typed defaults, seed 7, physical 512² output, DPR 1 and fixed quality. Three runs per engine; each discards 30 warm-up updates and measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion and timestamp readback. The actual defaults are 1024 material points on a 32² grid, 256 PBF particles with three constraint iterations, 96² D2Q9 with four ticks, one path/pixel/update through seven spheres, and 2048 sorted Gaussian splats. Backdrop glass uses the explicitly labeled owned texture preview; these rows exclude experimental DOM capture.

| Browser              | CPU mean ms           | Completion p95 ms        | Summed GPU pass p95 ms | rAF median ms            | Record                               |
| -------------------- | --------------------- | ------------------------ | ---------------------- | ------------------------ | ------------------------------------ |
| chrome 154.0.8037.98 | 0.242 / 0.222 / 0.199 | 5.800 / 6.000 / 5.700    | 4.522 / 4.719 / 4.391  | 16.700 / 16.700 / 16.700 | [JSON](../benchmarks/m7-chrome.json) |
| webkit 26.6          | 0.325 / 0.183 / 0.258 | 11.000 / 11.000 / 12.000 | 5.616 / 5.684 / 5.616  | 17.000 / 17.000 / 17.000 | [JSON](../benchmarks/m7-webkit.json) |

CPU encoding, queue-completion latency, summed GPU timestamps and rAF cadence have different boundaries. Timestamp precision and overlapping intervals limit interpretation; the sum is not whole-frame elapsed time. Initialization/compilation and a separate untimed 150-update numerical reproduction are excluded from timings. That reproduction checks every f32 tap value for finiteness. Machine load is uncontrolled and logical allocations are not VRAM. These are bounded research workloads, not a refresh guarantee on other devices. See [M7 validation](../m7.md) for numerical references, browser gaps and remaining stretches.

<!-- measurements:end -->

## Failure modes

Gather P2G costs O(grid cells × particle count); it is deterministic but slower than float-atomic scatter. Boundary clamps and velocity limits are deliberately stabilizing and dissipative. Large stiffness/dt combinations may become unstable. No shear plasticity or production material calibration.

## Production readiness

Research prototype. See [M7 validation](../m7.md) for numerical references, deterministic snapshots, device-loss checks, workload measurements and deferred stretches.
