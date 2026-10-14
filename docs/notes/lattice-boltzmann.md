# D2Q9 lattice Boltzmann (`lattice-boltzmann`)

## Question

Can a second flow solver conserve mass in periodic mode while producing a driven cylinder wake?

## Technique summary

Nine f32 populations per node in storage buffers, pull streaming, BGK collision and half-way bounce-back at solid links. The channel uses an equilibrium inlet and a copied outlet; periodic mode is the closed mass-conservation reference. Displays derive speed, density or centered curl.

## References

- [Primary technique reference](https://arxiv.org/abs/comp-gas/9611001)
- [WebGPU specification](https://gpuweb.github.io/gpuweb/)

## Passes and resources

Population buffers alternate per lattice tick. A vec4f macroscopic buffer contains velocity xy, density and solid flag. Each collision updates all nine populations; display reads the resulting field. Changing lattice size rebuilds and seeds state.

## WebGPU features used

Native storage/compute/render pipelines and float data. No optional GPU feature is required for the portable rendering path. Backdrop DOM capture additionally requires the experimental queue API, detected separately from GPUFeatureName.

## Parameters (generated)

<!-- params:start -->

| Parameter | Type | Default     | Range / choices           | Group      | Description                                                             |
| --------- | ---- | ----------- | ------------------------- | ---------- | ----------------------------------------------------------------------- |
| grid      | u32  | 96          | 16…256                    | Workload   | D2Q9 square lattice; nine f32 distributions per cell.                   |
| tau       | f32  | 0.8         | 0.56…1.5                  | Simulation | BGK relaxation time; viscosity = (tau - 0.5) / 3 lattice units.         |
| flow      | f32  | 0.06        | 0…0.12                    | Simulation | Inlet velocity in lattice units (keep Mach number small).               |
| obstacle  | f32  | 0.1         | 0…0.22                    | Simulation | Cylinder radius as a fraction of the grid width.                        |
| steps     | u32  | 4           | 1…16                      | Workload   | Lattice stream/collision ticks per fixed update.                        |
| boundary  | enum | "channel"   | channel, periodic         | Simulation | Driven inlet/outlet channel or closed periodic mass-conservation probe. |
| display   | enum | "vorticity" | vorticity, speed, density | Display    | Centered curl, velocity magnitude, or density perturbation.             |
| gain      | f32  | 15          | 1…80                      | Display    | Field display contrast.                                                 |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded on the development Apple M1 Max / macOS 26.6.2 using the production preview. Typed defaults, seed 7, physical 512² output, DPR 1 and fixed quality. Three runs per engine; each discards 30 warm-up updates and measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion and timestamp readback. The actual defaults are 1024 material points on a 32² grid, 256 PBF particles with three constraint iterations, 96² D2Q9 with four ticks, one path/pixel/update through seven spheres, and 2048 sorted Gaussian splats. Backdrop glass uses the explicitly labeled owned texture preview; these rows exclude experimental DOM capture.

| Browser              | CPU mean ms           | Completion p95 ms     | Summed GPU pass p95 ms | rAF median ms            | Record                               |
| -------------------- | --------------------- | --------------------- | ---------------------- | ------------------------ | ------------------------------------ |
| chrome 154.0.8037.98 | 0.202 / 0.218 / 0.195 | 1.800 / 1.900 / 1.800 | 0.852 / 0.852 / 0.852  | 16.700 / 16.700 / 16.700 | [JSON](../benchmarks/m7-chrome.json) |
| webkit 26.6          | 0.358 / 0.350 / 0.275 | 4.000 / 5.000 / 4.000 | 1.459 / 2.990 / 2.586  | 17.000 / 17.000 / 17.000 | [JSON](../benchmarks/m7-webkit.json) |

CPU encoding, queue-completion latency, summed GPU timestamps and rAF cadence have different boundaries. Timestamp precision and overlapping intervals limit interpretation; the sum is not whole-frame elapsed time. Initialization/compilation and a separate untimed 150-update numerical reproduction are excluded from timings. That reproduction checks every f32 tap value for finiteness. Machine load is uncontrolled and logical allocations are not VRAM. These are bounded research workloads, not a refresh guarantee on other devices. See [M7 validation](../m7.md) for numerical references, browser gaps and remaining stretches.

<!-- measurements:end -->

## Failure modes

The simple equilibrium inlet/copied outlet is not a Zou–He implementation and does not conserve channel mass exactly. Keep velocity low and tau above 0.5. Wake formation requires hundreds of lattice ticks; short snapshots are not evidence of developed vortex shedding. Storage-buffer layout only; a texture comparison remains open.

## Production readiness

Research prototype. See [M7 validation](../m7.md) for numerical references, deterministic snapshots, device-loss checks, workload measurements and deferred stretches.
