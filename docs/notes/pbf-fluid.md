# Position based fluid constraints (`pbf-fluid`)

## Question

How much work does rebuilding exact sorted neighbors add to each density constraint iteration?

## Technique summary

Predict positions under gravity/pointer forces; build a sorted spatial grid; compute positive SPH density constraints and regularized lambdas; apply Jacobi corrections in a separate buffer; reconstruct velocities. Kernels use normalized 2D poly6 density and spiky gradients. Free surfaces use compression-only constraints.

## References

- [Primary technique reference](https://mmacklin.com/pbf_sig_preprint.pdf)
- [WebGPU specification](https://gpuweb.github.io/gpuweb/)

## Passes and resources

Each iteration rebuilds radix-sort/prefix-sum cell ranges for its current predicted positions. Neighbor queries visit nine cells, whose width is at least the support radius. CPU dimensions reproduce the shader f32 division before flooring. Exposed taps contain lambda, density, constraint error and neighbor counts. Additive density splats feed a screen-space surface.

## WebGPU features used

Native storage/compute/render pipelines and float data. No optional GPU feature is required for the portable rendering path. Backdrop DOM capture additionally requires the experimental queue API, detected separately from GPUFeatureName.

## Parameters (generated)

<!-- params:start -->

| Parameter   | Type  | Default   | Range / choices | Group      | Description                                            |
| ----------- | ----- | --------- | --------------- | ---------- | ------------------------------------------------------ |
| count       | u32   | 256       | 16…2048         | Workload   | Fixed number of fluid particles.                       |
| support     | f32   | 0.065     | 0.025…0.15      | Simulation | SPH support radius and spatial hash cell width.        |
| restDensity | f32   | 1800      | 100…12000       | Simulation | Target number density in normalized domain units.      |
| iterations  | u32   | 3         | 1…8             | Workload   | Jacobi density constraint iterations per fixed update. |
| gravity     | f32   | 1.5       | 0…5             | Simulation | Downward acceleration.                                 |
| relaxation  | f32   | 0.001     | 0.00001…0.01    | Simulation | Lambda denominator regularizer.                        |
| radius      | f32   | 0.021     | 0.004…0.06      | Display    | Density splat radius for the screen-space surface.     |
| tint        | color | "#4cc2e8" | —               | Display    | Linearized surface colour.                             |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded on the development Apple M1 Max / macOS 26.6.2 using the production preview. Typed defaults, seed 7, physical 512² output, DPR 1 and fixed quality. Three runs per engine; each discards 30 warm-up updates and measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion and timestamp readback. The actual defaults are 1024 material points on a 32² grid, 256 PBF particles with three constraint iterations, 96² D2Q9 with four ticks, one path/pixel/update through seven spheres, and 2048 sorted Gaussian splats. Backdrop glass uses the explicitly labeled owned texture preview; these rows exclude experimental DOM capture.

| Browser              | CPU mean ms           | Completion p95 ms        | Summed GPU pass p95 ms | rAF median ms            | Record                               |
| -------------------- | --------------------- | ------------------------ | ---------------------- | ------------------------ | ------------------------------------ |
| chrome 154.0.8037.98 | 0.544 / 0.502 / 0.495 | 9.200 / 9.700 / 9.500    | 5.767 / 5.833 / 6.160  | 16.700 / 16.700 / 16.700 | [JSON](../benchmarks/m7-chrome.json) |
| webkit 26.6          | 0.567 / 0.433 / 0.392 | 13.000 / 14.000 / 13.000 | 8.025 / 8.266 / 7.801  | 17.000 / 17.000 / 17.000 | [JSON](../benchmarks/m7-webkit.json) |

CPU encoding, queue-completion latency, summed GPU timestamps and rAF cadence have different boundaries. Timestamp precision and overlapping intervals limit interpretation; the sum is not whole-frame elapsed time. Initialization/compilation and a separate untimed 150-update numerical reproduction are excluded from timings. That reproduction checks every f32 tap value for finiteness. Machine load is uncontrolled and logical allocations are not VRAM. These are bounded research workloads, not a refresh guarantee on other devices. See [M7 validation](../m7.md) for numerical references, browser gaps and remaining stretches.

<!-- measurements:end -->

## Failure modes

Rest density must match particle spacing/count. Corrections and velocities are limited; there is no vorticity confinement, artificial tensile pressure, calibrated viscosity or particle emission. Hash rebuilding has considerable pass and CPU encoding cost.

## Production readiness

Research prototype. See [M7 validation](../m7.md) for numerical references, deterministic snapshots, device-loss checks, workload measurements and deferred stretches.
