# N-body (`n-body`)

## Question

How do exact workgroup-tiled gravitational forces compare with a GPU grid that resolves nearby bodies individually and approximates distant cells by their center of mass?

## Technique summary

The exact mode reuses workgroup tiles of 64 positions across 64 target bodies, following the GPU all-pairs strategy described in [NVIDIA GPU Gems 3, Fast N-Body Simulation](https://developer.nvidia.com/gpugems/gpugems3/part-v-physics-simulation/chapter-31-fast-n-body-simulation-cuda). All lanes participate in both barriers, including inactive lanes in the final partial tile.

Equal body masses sum to one. Acceleration is `gravity × Σ mass × displacement / (distance² + softening²)^(3/2)`, with Plummer softening preventing a singularity at coincident positions. Semi-implicit Euler updates velocity, applies optional exponential damping and advances position. Walls reflect positions and the normal velocity component. This is a visual two-dimensional bounded model, not an astronomical integrator: walls, drag and finite timestep can change energy; neither mode claims exact energy conservation.

The grid mode performs a GPU radix key/value sort and exclusive cell-population prefix sum. It calculates each occupied cell's center of mass and total mass, evaluates individual bodies in the target cell and its immediate neighbors, and uses a single softened center-of-mass interaction for every other occupied cell. Complexity is O(N × cellCount + localPairs), plus grid construction, instead of all-pairs O(N²). This approximation improves as cells get smaller relative to distant separations. It is not a Barnes–Hut tree and has no adaptive opening-angle criterion. Far-cell aggregation does not preserve pairwise antisymmetry, so momentum can drift; use tiled mode when that invariant matters. Both paths retain every body and normalized total mass.

## References

[NVIDIA GPU Gems 3, Chapter 31: Fast N-Body Simulation](https://developer.nvidia.com/gpugems/gpugems3/part-v-physics-simulation/chapter-31-fast-n-body-simulation-cuda) explains reuse of a workgroup tile for all-pairs forces. The cell-center approximation is a separate implementation choice described here; it is not attributed to that chapter.

## Passes and resources

The `galaxy` preset selects grid acceleration at larger count; `clusters` selects exact tiled forces. Passes expose positions/velocities, acceleration/speed, sorted indices and keys, cell counts/offsets and cell center/mass/count aggregates. Grid taps show the most recently indexed input state; exact tiled steps skip grid reconstruction, so those taps retain the initial or last grid-mode index until grid mode is selected. Instanced quads emit into rgba16float HDR trails with exposure/Reinhard resolve. Fixed simulation steps and seed reproduce particle buffers; presentation trails retain energy once per newly displayed simulation index and depend on which indices are displayed. Reduced motion initializes a static pose, and resolution quality changes the HDR display rather than force work. No optional WebGPU feature is required.

Particle emission is scaled by `min(1, 10000 / count)` above 10,000 particles. The HDR trail cap reserves 10,000 units for the next additive draw, so coincident particles at the largest valid workload cannot overflow a half-float color channel. Repeated unchanged presentation of the same frame index resolves existing HDR without accumulating again; paused and reduced-motion poses remain fixed. Parameters referenced by the compiled draw shaders clear/redraw history when changed, so paused tint/size edits appear immediately. Exposure/background only resolve existing HDR; retention changes apply on the next displayed index.

Both modes use two vec4f particle buffers and per-body acceleration/speed diagnostics. Exact mode dispatches the tiled force update directly. Grid mode dispatches key assignment/sort/prefix construction, cell aggregation and force evaluation. Grid scratch is retained when exact mode is selected; reported logical memory includes retained buffers, immutable uniforms and two rgba16float HDR histories. Count/grid changes recreate the seeded storage, while display resizing preserves simulation buffers. Disposal destroys owned resources and releases pipeline/module leases.

## WebGPU features used

Baseline compute/storage buffers, workgroup memory and barriers, integer atomics in cell counts, vertex storage reads, instanced drawing and additive rgba16float attachments. No optional effect feature or external input is required. Session timestamp-query profiling is optional. Quality resolution spans 0.25–1 without reducing force work. Reduced motion shows the initialized static pose; the CSS fallback is `radial-gradient(ellipse,#89dccb,#07101c)`.

## Parameters (generated)

<!-- params:start -->

| Parameter  | Type  | Default   | Range / choices | Group      | Description                                                                                  |
| ---------- | ----- | --------- | --------------- | ---------- | -------------------------------------------------------------------------------------------- |
| count      | u32   | 2048      | 16…16384        | Simulation | Number of equal-weight storage-buffer particles; changing it restarts.                       |
| grid       | u32   | 16        | 8…64            | Simulation | Uniform spatial grid cells per axis, built with GPU radix sort and exclusive prefix sum.     |
| speed      | f32   | 0.08      | 0.01…1          | Simulation | Initial particle speed in normalized scene units per second.                                 |
| size       | f32   | 3         | 1…12            | Display    | Particle radius in physical display pixels.                                                  |
| trail      | f32   | 0.82      | 0…0.98          | Display    | Retained HDR energy per newly displayed simulation index; zero shows only current particles. |
| exposure   | f32   | 1.2       | 0.1…5           | Display    | Exposure of additive linear HDR accumulation before tone mapping.                            |
| tint       | color | "#89dccb" | —               | Display    | Linear-light particle emission tint.                                                         |
| background | color | "#07101c" | —               | Display    | Scene background beneath particle emission.                                                  |
| method     | enum  | "tiled"   | tiled, grid     | Gravity    | Exact tiled pair force, or near-exact/far-cell center-of-mass grid approximation.            |
| gravity    | f32   | 0.025     | 0…0.2           | Gravity    | Gravitational strength; equal mass is normalized to total mass one.                          |
| softening  | f32   | 0.025     | 0.005…0.2       | Gravity    | Plummer softening length, preventing singular coincident-body forces.                        |
| damping    | f32   | 0         | 0…2             | Gravity    | Optional exponential velocity drag; zero preserves conservative force dynamics.              |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded on the development Apple M1 Max / macOS 26.6.2 using the production preview and the same fixed-scenario runner as the Profiler drawer. Physical display is 512² at DPR 1, seed 7, fixed resolution/work quality. Defaults are retained except million-particle gate rows set count to exactly 1,000,000 and select point or instanced-quad drawing. Each of three runs discards 30 warm-up updates and measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion and timestamp readback.

| Browser              | Rendering / allocation controls | CPU mean ms           | Completion p95 ms     | Summed GPU pass p95 ms | rAF median ms            | Million-particle gate | Record                               |
| -------------------- | ------------------------------- | --------------------- | --------------------- | ---------------------- | ------------------------ | --------------------- | ------------------------------------ |
| chrome 154.0.8037.98 | compute; count=2048, grid=16    | 0.257 / 0.282 / 0.262 | 4.800 / 5.600 / 5.200 | 1.769 / 1.573 / 1.507  | 16.700 / 16.700 / 16.700 | —                     | [JSON](../benchmarks/m3-chrome.json) |
| webkit 26.6          | compute; count=2048, grid=16    | 0.517 / 0.275 / 0.358 | 7.000 / 6.000 / 7.000 | 2.081 / 2.181 / 2.140  | 16.000 / 16.000 / 16.000 | —                     | [JSON](../benchmarks/m3-webkit.json) |

GPU columns use actual pass-boundary timestamp queries when available; values are implementation-defined and may be quantized. Pass intervals may overlap; their sum is a diagnostic rather than whole-frame execution time. These captures include summed intervals larger than queue-completion wall latency, so the columns must not be substituted for one another. CPU encode, queue-completion wall latency and rAF cadence remain separate. The million-particle gate verifies actual storage count, both draw paths, all 150 fixed updates and no GPU errors; M3 specifies particle count rather than a refresh-rate threshold. Machine load is uncontrolled. Logical allocations are not VRAM. Initialization/compilation are excluded. Small deterministic software snapshots and CPU-reference GPU tests establish separate numerical/lifecycle properties, not million-particle speed.

<!-- measurements:end -->

## Failure modes

Large softening suppresses close interactions; small softening and large gravity can demand a shorter integration step. Tiled mode is quadratic even though memory reuse reduces loads. Grid aggregation can drift in momentum and energy, particularly near the near/far-cell boundary. Reflective walls and drag also prevent global conservation. Fine grids increase the per-body cell loop, while coarse grids make the approximation less accurate.

The CPU-reference tests compare both update paths and accelerations on an 80-body fixture (including a partial tile), verify total body count and cell mass, and prove exact-mode momentum conservation for one step away from walls with zero drag. The grid fixture also confirms that its approximation differs from the exact result, so agreement with its own CPU reference does not claim physical equivalence. Separate tests exercise wall reflection and deterministic reallocation/reset.

## Production readiness

A quantitative physics application would need convergence/error studies, an adaptive timestep or a validated symplectic integrator, stronger conservation tests and a documented approximation criterion such as a tree opening angle. Sustained large-count/device-class timing and long-running device-loss/leak tests remain later milestones. Current research validation proves each chosen discrete update against its CPU reference, not astronomical accuracy.
