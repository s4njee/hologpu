# Four additive HDR attractors (`attractors`)

## Question

Can differential and iterated-map chaotic systems share particle storage and additive HDR presentation without hiding their numerical differences?

## Technique summary

Lorenz uses sigma=10, rho=28 and beta=8/3; Aizawa uses a=.95, b=.7, c=.6, d=3.5, e=.25 and f=.1 in the displayed derivative source. Differential systems use one fourth-order Runge–Kutta step per fixed tick with a simulation-rate multiplier. Clifford takes x′=sin(a y)+c cos(a x), y′=sin(b x)+d cos(b y); De Jong takes x′=sin(a y)-cos(b x), y′=sin(c x)-cos(d y). The maps take one iteration per tick. Projection rotates 3D differential trajectories, scales them to the display and centers Lorenz around z=24; maps use their two coordinates directly. HDR histories preserve repeated visits and tone mapping controls bright accumulation. A finite-domain guard restarts an escaped differential record instead of propagating invalid state.

## References

[Lorenz, Deterministic Nonperiodic Flow](https://journals.ametsoc.org/doi/pdf/10.1175/1520-0469%281963%29020%3C0130%3ADNF%3E2.0.CO%3B2) is the source of the Lorenz system. Other equations are stated explicitly here and in the inspectable shader for reproducibility.

## Passes and resources

Simulation is fixed-step compute, with immutable per-step frame and parameter snapshots. The common baseline record uses two vec4f fields, 32 bytes. Flow, attractors and morph use two record buffers; emitters use one disjoint-update record buffer plus flags, stable scan scratch, live/free IDs and indirect arguments. Morph adds a 16-byte target per particle. Two rgba16float histories cost 16 bytes per display pixel. A decay dispatch, additive point or quad render and Reinhard tone-map display follow simulation. Display-only resizing reallocates history while preserving particle state. Count changes recreate and initialize particle storage. Disposal destroys owned buffers/textures and releases shader leases; taps expose current storage and HDR history. Memory reports logical allocation bytes.

Trail energy is retained once per newly displayed simulation index. Repeated unchanged renders at the same index only tone-map existing HDR, preserving paused and reduced-motion pixels. Changing parameters used by the compiled particle draw shaders (such as tint, size, mode or attractor rotation) clears and redraws the current pose immediately; exposure and background only update the resolve, and retention applies on the next displayed index. Batched updates display only their final pose, so deterministic pixel replay also specifies the sequence of displayed indices.

## WebGPU features used

Baseline storage buffers, compute, vertex storage reads and rgba16float render attachments with additive blending. Timestamp-query is optional through the session profiler, with an unavailable state when unsupported. Presentation remains baseline SDR tone mapping; extended-range canvases are a separate capability experiment. Reduced motion draws the seeded time-zero pose and the definition declares a CSS gradient fallback.

## Parameters (generated)

<!-- params:start -->

| Parameter  | Type  | Default   | Range / choices                  | Group     | Description                                                                                         |
| ---------- | ----- | --------- | -------------------------------- | --------- | --------------------------------------------------------------------------------------------------- |
| count      | u32   | 65536     | 64…1048576                       | Particles | Storage particle count; changing it restarts the seeded field.                                      |
| draw       | enum  | "quad"    | point, quad                      | Rendering | One raster point or six-vertex instanced quad per particle.                                         |
| size       | f32   | 1.6       | 0.5…8                            | Rendering | Quad diameter in display pixels; points remain one pixel.                                           |
| trail      | f32   | 0.94      | 0…0.995                          | Rendering | Retained HDR energy per newly displayed simulation index; repeated paused renders preserve history. |
| exposure   | f32   | 0.8       | 0.01…4                           | Rendering | Exposure before Reinhard HDR tone mapping.                                                          |
| tint       | color | "#72dcd3" | —                                | Palette   | Additive particle colour.                                                                           |
| background | color | "#07111e" | —                                | Palette   | Tone mapped empty-field background.                                                                 |
| system     | enum  | "lorenz"  | lorenz, aizawa, clifford, dejong | Attractor | Differential Lorenz/Aizawa or iterated Clifford/De Jong system.                                     |
| rate       | f32   | 0.6       | 0.05…2                           | Attractor | Differential-system simulation rate; maps take one iteration per fixed tick.                        |
| a          | f32   | -1.4      | -3…3                             | Attractor | First map coefficient; Lorenz sigma and Aizawa coefficients retain canonical values.                |
| b          | f32   | 1.6       | -3…3                             | Attractor | Second map coefficient.                                                                             |
| c          | f32   | 1         | -3…3                             | Attractor | Third map coefficient.                                                                              |
| d          | f32   | 0.7       | -3…3                             | Attractor | Fourth map coefficient.                                                                             |
| rotation   | f32   | 0.25      | -3.14…3.14                       | View      | Rotation of the projected three-dimensional attractor.                                              |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded on the development Apple M1 Max / macOS 26.6.2 using the production preview and the same fixed-scenario runner as the Profiler drawer. Physical display is 512² at DPR 1, seed 7, fixed resolution/work quality. Defaults are retained except million-particle gate rows set count to exactly 1,000,000 and select point or instanced-quad drawing. Each of three runs discards 30 warm-up updates and measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion and timestamp readback.

| Browser              | Rendering / allocation controls | CPU mean ms           | Completion p95 ms     | Summed GPU pass p95 ms | rAF median ms            | Million-particle gate | Record                               |
| -------------------- | ------------------------------- | --------------------- | --------------------- | ---------------------- | ------------------------ | --------------------- | ------------------------------------ |
| chrome 154.0.8037.98 | quad; count=65536               | 0.232 / 0.258 / 0.258 | 5.200 / 5.300 / 4.700 | 3.211 / 3.146 / 3.736  | 16.700 / 16.700 / 16.700 | —                     | [JSON](../benchmarks/m3-chrome.json) |
| webkit 26.6          | quad; count=65536               | 0.275 / 0.392 / 0.242 | 6.000 / 6.000 / 5.000 | 4.059 / 3.493 / 3.459  | 16.000 / 16.000 / 16.000 | —                     | [JSON](../benchmarks/m3-webkit.json) |

GPU columns use actual pass-boundary timestamp queries when available; values are implementation-defined and may be quantized. Pass intervals may overlap; their sum is a diagnostic rather than whole-frame execution time. These captures include summed intervals larger than queue-completion wall latency, so the columns must not be substituted for one another. CPU encode, queue-completion wall latency and rAF cadence remain separate. The million-particle gate verifies actual storage count, both draw paths, all 150 fixed updates and no GPU errors; M3 specifies particle count rather than a refresh-rate threshold. Machine load is uncontrolled. Logical allocations are not VRAM. Initialization/compilation are excluded. Small deterministic software snapshots and CPU-reference GPU tests establish separate numerical/lifecycle properties, not million-particle speed.

<!-- measurements:end -->

## Findings and validation

The numerical tests in `tests/browser/particles-core.spec.ts` check seeded storage replay, both rendering paths and finite HDR taps. Specific tests cover zero-speed/wrapping flow, Lorenz/Aizawa RK4 CPU derivatives and Clifford/De Jong CPU equations, lifetime/death/free-list/count conservation with indirect arguments, and spring integration plus custom text/image inputs. Generic catalogue tests separately cover preset pixels, resize and disposal. See [particle contract ADR](../adr/008-particle-storage-and-hdr.md) for shared assumptions. These small fixtures establish correctness; the recorded hardware workload establishes throughput.

One-step map comparisons allow 0.001 absolute error: their sine/cosine arguments are bounded to ±1.6 in the fixture, and WGSL permits approximate transcendental evaluation. The observed software discrepancy before that allowance was 0.000350. Differential-system polynomial arithmetic retains a 0.000005 bound; the map tolerance does not apply to RK4 tests.

## Failure modes

Chaotic differential trajectories amplify f32 and transcendental differences, so long trajectories are not promised to match across adapters. The CPU comparisons establish one-step formulas and RK4 updates rather than a converged long-time orbit. Larger differential rates can escape the numerical domain; the finite guard restarts a record, which preserves valid storage but changes the trajectory. Map coefficients can collapse to fixed points or move the projected orbit outside the view, and changing systems requires a reset to obtain the corresponding seeded initial domain. Additive half-float history is a quantized occupancy image, not a calibrated invariant-density estimator. Emission is count-scaled to avoid worst-case overlap overflow; trail retention and exposure can saturate visible detail. A million quads remain a costly rendering workload even when the orbit occupies a small area. Extended-range canvas presentation is not required or enabled here; unsupported GPU rendering falls back to the declared static gradient.

## Production readiness

Add differential timestep-convergence studies and a visible reset/escape counter before using these trajectories for numerical analysis. Longer-run tests should compare bounded statistics rather than cross-device chaotic coordinates. A calibrated density renderer would normalize by samples and record the history window, use a suitable accumulation format, and separate colour mapping from occupancy. Production controls should pair each system with an appropriate initial domain and camera scale, expose deliberate system resets, and choose particle count from measured device budgets. Keep both map references, both RK4 references, paused rotation/tint editing and finite HDR history in the regression suite.
