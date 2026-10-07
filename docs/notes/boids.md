# Boids (`boids`)

## Question

Can a GPU sort and prefix-sum uniform grid reduce neighbor candidates while preserving every periodic boid interaction and the resulting steering update?

## Technique summary

Reynolds' separation, alignment and cohesion rules act on nearby agents; see the [original author’s explanation and paper](https://www.red3d.com/cwr/boids/). This implementation uses two-dimensional periodic positions and a sorted GPU uniform grid to find those neighbors.

Every fixed update assigns one row-major cell key per agent, performs a stable full-width radix key/value sort and an exclusive prefix sum of cell populations, then visits only the neighboring cells within `ceil(radius × grid)` of each agent. Exact minimum-image displacement and squared-radius tests determine membership. Cells wrap on the torus. The schema limits radius to 0.25, so no cell is visited twice, even at the minimum grid resolution.

For neighbors with displacement d and velocity v, cohesion is mean d, alignment is mean v minus current velocity, and separation is mean `−d / max(dot(d,d), 0.0001)`. Weighted acceleration updates velocity with fixed-step semi-implicit Euler; maxSpeed limits velocity magnitude and position wraps with fract. Pointer attraction uses the same periodic displacement while pressed. State is vec4f(position xy, velocity xy), with immutable read/write buffers so the update is synchronous.

## References

[Craig Reynolds, Boids and the original SIGGRAPH 1987 paper](https://www.red3d.com/cwr/boids/) describes the separation, alignment and cohesion behaviors. The exact grid search, periodic domain and integration choices here are stated explicitly above.

## Passes and resources

Passes expose particles, sorted keys/indices, cell counts and prefix offsets. Per-agent statistics expose exact neighbor count, candidate count and acceleration. The numerical test includes agents across the x seam, compares counts and updated state against all-pairs CPU evaluation, proves the sorted permutation and cell partitions, and verifies that candidates are genuinely reduced. Large, dense flocks can still degenerate toward quadratic local work; the grid does not cap neighbors or drop interactions.

Instanced quads accumulate linearly into rgba16float HDR trails, then exposure and Reinhard tone mapping produce the display. Count/grid changes restart both state buffers. A fixed seed and fixed number of simulation steps reproduce particle buffers. Trail energy is retained once per newly displayed simulation index; trail pixels depend on which indices are displayed, while numerical determinism is assessed on simulation buffers. Reduced motion shows the initialized pose. Resolution quality affects HDR targets; particle count and neighbor work stay intact. Device feature requirements are ordinary WebGPU storage buffers and compute.

Particle emission is scaled by `min(1, 10000 / count)` above 10,000 particles. The HDR trail cap reserves 10,000 units for the next additive draw, so coincident particles at the largest valid workload cannot overflow a half-float color channel. Repeated unchanged presentation of the same frame index resolves existing HDR without accumulating again; paused and reduced-motion poses remain fixed. Parameters referenced by the compiled draw shaders clear/redraw history when changed, so paused tint/size edits appear immediately. Exposure/background only resolve existing HDR; retention changes apply on the next displayed index.

Two vec4f state buffers consume 32 bytes per particle, with a 16-byte diagnostic record per particle and 16 bytes per configured grid cell for the shared grid metadata. Sort, prefix-sum and grid construction own separate scratch buffers; memory totals include those allocations and immutable uniform snapshots. Disposal destroys owned buffers and HDR textures and releases every shader lease.

## WebGPU features used

Baseline WebGPU compute/storage buffers, workgroup memory, integer atomics in grid counts, vertex storage reads, instanced quad drawing and additive rgba16float attachments. No optional feature is required by the effect; timestamp-query profiling is requested only when the session supports it. Pointer is the declared input. Resolution quality spans 0.25–1 and does not remove neighbors or particles. Reduced motion renders the seeded pose, and the CSS fallback is `radial-gradient(ellipse,#89dccb,#07101c)`.

## Parameters (generated)

<!-- params:start -->

| Parameter  | Type  | Default   | Range / choices | Group       | Description                                                                                  |
| ---------- | ----- | --------- | --------------- | ----------- | -------------------------------------------------------------------------------------------- |
| count      | u32   | 4096      | 16…65536        | Simulation  | Number of equal-weight storage-buffer particles; changing it restarts.                       |
| grid       | u32   | 16        | 8…64            | Simulation  | Uniform spatial grid cells per axis, built with GPU radix sort and exclusive prefix sum.     |
| speed      | f32   | 0.15      | 0.01…1          | Simulation  | Initial particle speed in normalized scene units per second.                                 |
| size       | f32   | 3         | 1…12            | Display     | Particle radius in physical display pixels.                                                  |
| trail      | f32   | 0.82      | 0…0.98          | Display     | Retained HDR energy per newly displayed simulation index; zero shows only current particles. |
| exposure   | f32   | 1.2       | 0.1…5           | Display     | Exposure of additive linear HDR accumulation before tone mapping.                            |
| tint       | color | "#89dccb" | —               | Display     | Linear-light particle emission tint.                                                         |
| background | color | "#07101c" | —               | Display     | Scene background beneath particle emission.                                                  |
| radius     | f32   | 0.06      | 0.01…0.25       | Flocking    | Exact periodic neighbor distance; all intersecting grid cells are searched.                  |
| separation | f32   | 0.18      | 0…2             | Flocking    | Repulsion strength weighted by inverse squared separation.                                   |
| alignment  | f32   | 2         | 0…8             | Flocking    | Steering toward mean neighbor velocity.                                                      |
| cohesion   | f32   | 2         | 0…8             | Flocking    | Steering toward periodic mean neighbor displacement.                                         |
| maxSpeed   | f32   | 0.25      | 0.02…1          | Flocking    | Velocity magnitude limit after steering.                                                     |
| pointer    | f32   | 1         | 0…4             | Interaction | Pointer attraction while pressed; uses periodic displacement.                                |

<!-- params:end -->

The `murmuration` and `shoal` presets adjust weights, range and palette.

## Measurements

<!-- measurements:start -->

Recorded on the development Apple M1 Max / macOS 26.6.2 using the production preview and the same fixed-scenario runner as the Profiler drawer. Physical display is 512² at DPR 1, seed 7, fixed resolution/work quality. Defaults are retained except million-particle gate rows set count to exactly 1,000,000 and select point or instanced-quad drawing. Each of three runs discards 30 warm-up updates and measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion and timestamp readback.

| Browser              | Rendering / allocation controls | CPU mean ms           | Completion p95 ms     | Summed GPU pass p95 ms | rAF median ms            | Million-particle gate | Record                               |
| -------------------- | ------------------------------- | --------------------- | --------------------- | ---------------------- | ------------------------ | --------------------- | ------------------------------------ |
| chrome 154.0.8037.98 | compute; count=4096, grid=16    | 0.441 / 0.435 / 0.400 | 7.400 / 7.100 / 7.200 | 2.621 / 3.015 / 2.884  | 16.700 / 16.700 / 16.700 | —                     | [JSON](../benchmarks/m3-chrome.json) |
| webkit 26.6          | compute; count=4096, grid=16    | 0.500 / 0.458 / 0.475 | 8.000 / 8.000 / 9.000 | 4.067 / 3.877 / 3.947  | 16.000 / 16.000 / 16.000 | —                     | [JSON](../benchmarks/m3-webkit.json) |

GPU columns use actual pass-boundary timestamp queries when available; values are implementation-defined and may be quantized. Pass intervals may overlap; their sum is a diagnostic rather than whole-frame execution time. These captures include summed intervals larger than queue-completion wall latency, so the columns must not be substituted for one another. CPU encode, queue-completion wall latency and rAF cadence remain separate. The million-particle gate verifies actual storage count, both draw paths, all 150 fixed updates and no GPU errors; M3 specifies particle count rather than a refresh-rate threshold. Machine load is uncontrolled. Logical allocations are not VRAM. Initialization/compilation are excluded. Small deterministic software snapshots and CPU-reference GPU tests establish separate numerical/lifecycle properties, not million-particle speed.

<!-- measurements:end -->

## Failure modes

Dense neighborhoods can approach quadratic local interaction cost. Small grid cells require more neighboring-cell visits, while large cells increase candidates. Neither case permits dropping neighbors. Separation has a finite squared-distance floor; coincident agents do not acquire a random escape direction. Pixel trails depend on the displayed-index sequence even when particle state follows identical fixed ticks. The CPU reference covers both periodic seams and velocity capping; it does not prove flock stability for every parameter combination.

## Production readiness

A production flock would need sustained large-count occupancy/performance studies, measured neighbor-work budgets, obstacle/scene boundaries and an explicit choice between exact neighbors and approximation. Multi-device performance and long-running detach/device-loss testing remain later milestones. Current validation separately covers CPU-reference steering, fixed replay, both presets, allocation changes, finite taps and resource cleanup.
