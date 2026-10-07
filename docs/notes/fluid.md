# Projected fluid and dye (`fluid`)

## Question

How much pressure convergence can a reference multi-pass fluid solver buy per frame at an actual 1024×1024 simulation grid, while a DOM page continues to render?

## Technique summary

This is a persistent, two-dimensional incompressible flow solve, rather than a procedural animation. Velocity uses a staggered MAC arrangement: each RG texel stores the right-face horizontal velocity and the bottom-face vertical velocity. Velocities are expressed in stage-height units per second. The simulation follows the stage aspect ratio independently of presentation resolution; `grid` specifies its longest dimension, including a real 1024-cell option. A 1024×1024 canvas with grid 256 is explicitly a smaller solver presented at 1024, and does not establish the 1024² solver exit gate.

Each fixed 1/60 s update backtraces face positions through the interpolated velocity, bilinearly samples the previous velocity, applies exponential drag, and performs four Jacobi iterations of implicit viscous diffusion when viscosity is nonzero. A separate immutable right-hand-side texture makes this an implicit solve, not repeated blurring. Viscosity is in squared grid cells per second, so its physical strength varies with grid density. Curl and its magnitude gradient produce grid-scaled vorticity confinement. Autonomous and pointer forces are added before projection. Normal velocity is zero at closed walls, with clamped tangential samples approximating free slip; periodic boundaries wrap both sampling and differences.

Backward face divergence and forward cell-pressure gradients compose into the same nearest-neighbour Laplacian. The pressure Jacobi pass solves that Poisson system with Neumann walls or periodic neighbours. Pressure is warm-started, and its additive constant is irrelevant to velocity. Projection subtracts pressure differences from face velocity. A separate post-projection divergence tap makes the finite-iteration residual visible. Dye is then semi-Lagrangian advected by the projected flow, exponentially dissipated, and replenished by sources. Colours mix as linear RGB concentrations, then a bounded exponential display maps them onto the opaque background.

Initialization offers seeded vortices, rest, a uniform periodic flow, and a sinusoidal compression probe. Seed controls vortex placement and initial dye positions. Drag the stage to inject material and momentum. Reset/replay recreates the same state for the same seed and fixed step count. Initial-state parameters apply on reset. A changed simulation grid restarts the fields; presentation-only changes preserve them if the actual grid shape remains unchanged. `grid` is a CPU allocation control, excluded from shader uniforms. Its change triggers resize and clears pending old-grid updates before initialization or display encodes any passes.

## References

[Jos Stam, Stable Fluids (SIGGRAPH 1999)](https://www.dgp.toronto.edu/people/stam/reality/Research/pdf/ns.pdf) motivates the split advection, implicit diffusion and projection method. [Robert Bridson, Fluid Simulation course notes](https://www.cs.ubc.ca/~rbridson/fluidsimulation/fluids_notes.pdf) describes staggered velocities, divergence and pressure projection. [NVIDIA GPU Gems, chapter 38](https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-38-fast-fluid-dynamics-simulation-gpu) provides the GPU multi-pass context and vorticity-confinement extension. The WGSL implementation and diagnostic fixtures here are original.

## Passes and resources

Default pressure count is 16. One default fixed step encodes 28 compute passes: velocity advection, RHS copy, four viscous iterations, curl, force, divergence, 16 pressure iterations, projection, residual divergence and dye advection. Viscosity zero omits the copy and four diffusion passes. Pressure iterations scale with adaptive work quality, with a minimum of two; fixed simulation time steps stay unchanged. One fullscreen material/diagnostic display writes the shared linear-premultiplied `rgba16float` target, followed by the runtime's SDR resolve.

Velocity and dye each own an `rgba16float` pair; pressure owns an `r32float` pair. Curl, pre/post divergence use one `r32float` texture each; the diffusion RHS is one `rgba16float` texture. Logical state storage is **60 bytes per cell plus 8 bytes** for an unused-bindings neutral texel: 62,914,568 bytes at 1024², excluding the display target. Uniform snapshots own 64-byte frame plus aligned parameter storage per queued update, with a separate display snapshot. Peak snapshot slots remain reusable until disposal. Shader modules and pipelines use shared reference-counted leases; textures, snapshots and bind-group caches are released on destruction.

Named taps are `velocity`, `dye`, `pressure`, `divergence`, `projectedDivergence`, `curl` and `diffusionRhs`. The last tap contains the immutable pre-diffusion velocity RHS from the last step using viscosity, and remains zero until that pass runs. Divergence taps store velocity differences per cell; multiply by grid height to express divergence per stage-height unit. Curl is already scaled by grid height. The curl tap is computed before forcing/projection in each step. Pressure diagnostics have an arbitrary additive gauge. All taps are copied and decoded on demand; readback staging is temporary.

## WebGPU features used

Baseline compute shaders with 8×8 workgroups, sampled and write-only storage textures, `rgba16float`/`r32float` state, uniform buffers and separate passes establishing read/write hazards. Bilinear sampling uses four `textureLoad` calls and works without `float32-filterable`. No optional adapter features are requested. Every queued step receives independent immutable uniform snapshots, including parameter changes, so multiple updates in one submission cannot alias the last frame's values. Reduced motion displays the seeded initial state without advancing. The declared CSS gradients provide a static fallback.

## Parameters (generated)

<!-- params:start -->

| Parameter       | Type  | Default    | Range / choices                                | Group         | Description                                                                                                    |
| --------------- | ----- | ---------- | ---------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------- |
| grid            | u32   | 256        | 32…1024                                        | Solver        | Actual longest simulation dimension in cells; aspect ratio follows the stage. Changing it restarts all fields. |
| iterations      | u32   | 16         | 2…80                                           | Solver        | Jacobi pressure iterations per fixed step; adaptive quality may cap this count.                                |
| boundary        | enum  | "closed"   | closed, periodic                               | Solver        | Impermeable free-slip walls or a wrapping domain.                                                              |
| viscosity       | f32   | 0.02       | 0…1                                            | Solver        | Implicit velocity diffusion strength in squared grid cells per second; four Jacobi iterations.                 |
| drag            | f32   | 0.15       | 0…3                                            | Solver        | Exponential velocity damping, separate from viscosity.                                                         |
| vorticity       | f32   | 0.5        | 0…3                                            | Solver        | Grid-scaled vorticity confinement restoring small swirls lost to advection.                                    |
| dissipation     | f32   | 0.1        | 0…3                                            | Material      | Exponential loss of suspended dye or smoke density.                                                            |
| source          | f32   | 0.65       | 0…3                                            | Injection     | Continuous autonomous dye or smoke injection rate; zero disables the emitter.                                  |
| force           | f32   | 0.3        | 0…2                                            | Injection     | Autonomous jet strength and pointer drag impulse scale.                                                        |
| radius          | f32   | 0.045      | 0.01…0.2                                       | Injection     | Gaussian emitter radius as a fraction of stage height.                                                         |
| initial         | enum  | "vortices" | vortices, rest, uniform, compression           | Initial state | Seeded vortices, stationary material, periodic constant flow, or a divergent convergence probe.                |
| initialVelocity | vec2  | [0.15,0]   | -0.5…0.5                                       | Initial state | Constant face velocity in stage-height units per second for the uniform initial state.                         |
| initialAmount   | f32   | 1.5        | 0…4                                            | Initial state | Initial dye or smoke amount; zero creates a completely empty material field.                                   |
| view            | enum  | "material" | material, velocity, pressure, divergence, curl | Diagnostics   | Material display or solver fields. Divergence shows the post-projection residual.                              |
| dyeA            | color | "#35bacf"  | —                                              | Palette       | First dye colour; ink interprets it as pigment reflectance.                                                    |
| dyeB            | color | "#ef795e"  | —                                              | Palette       | Second dye colour or smoke scattering colour.                                                                  |
| background      | color | "#101623"  | —                                              | Palette       | Opaque stage background, or the paper reflectance for ink.                                                     |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded 2026-10-07 on Apple M1 Max / macOS 26.6.2 using a production preview. Defaults and seed 7; gate runs override only the actual simulation grid to 1024. Resolution scale and DPR are 1, adaptive quality is disabled. Each of three runs discards 30 warm-up frames and measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion before the next frame.

| Browser              | Display / simulation            | CPU mean ms (three runs) | Submit-to-completion p95 ms | rAF median ms            | 1024² gate    | Record                                    |
| -------------------- | ------------------------------- | ------------------------ | --------------------------- | ------------------------ | ------------- | ----------------------------------------- |
| chrome 154.0.8037.98 | 512² display / 256×256 state    | 0.390 / 0.316 / 0.297    | 11.900 / 9.600 / 10.800     | 16.700 / 16.700 / 16.700 | —             | [JSON](../benchmarks/m2-chrome.json)      |
| chrome 154.0.8037.98 | 1024² display / 1024×1024 state | 0.293 / 0.261 / 0.304    | 13.600 / 12.600 / 14.800    | 16.700 / 16.700 / 16.700 | 3/3 runs pass | [JSON](../benchmarks/m2-gate-chrome.json) |
| webkit 26.6          | 1024² display / 1024×1024 state | 0.450 / 0.333 / 0.492    | 14.000 / 14.000 / 15.000    | 16.000 / 16.000 / 16.000 | 3/3 runs pass | [JSON](../benchmarks/m2-gate-webkit.json) |
| webkit 26.6          | 512² display / 256×256 state    | 0.767 / 0.458 / 0.550    | 13.000 / 11.000 / 12.000    | 16.000 / 16.000 / 16.000 | —             | [JSON](../benchmarks/m2-webkit.json)      |

CPU encoding/submission and submission-to-queue-completion wall latency are separate observations. Completion latency includes queue wait, browser and driver overhead; neither is GPU timestamp timing. The gate requires full-sized state and display, at least 95% completions and median rAF cadence within 110% of the separately measured idle rAF period. Device state and system load are uncontrolled. Logical allocation bytes are not VRAM. Compilation and initialization are excluded from measured frames. GPU timestamp profiling remains M3 work. Deterministic snapshots use grid 32, eight fixed updates, and seed 7 at DPR 1 and 2; separate numerical tests exercise algorithm invariants.

<!-- measurements:end -->

## Failure modes

A fixed Jacobi budget only approximates incompressibility. Low-frequency pressure error converges slowly as grid size grows, so 16 iterations at 1024² do not establish a tightly converged solve. The post-projection residual is measurable, and iteration count is a research control. Semi-Lagrangian interpolation loses detail and material mass, even at zero explicit dissipation. Four diffusion iterations converge poorly at high viscosity. Face forces sample smooth cell-centred source/confinement fields rather than exactly integrating face forces. Closed-boundary interpolation is an approximation, not a cut-cell or no-slip treatment. Half-float velocity/dye storage introduces rounding; f32 pressure does not undo that error.

Velocity components clamp to ±2 stage-height units/s and dye to 32 to bound extreme injections. These guards intentionally lose momentum or material beyond their bounds. Pointer force is bounded and pointer material injection requires a held button. No DOM obstacles, multigrid solve, adaptive time step, conservative dye transport, physical viscosity calibration or 3D flow is claimed. Large f32 elapsed times eventually lose emitter-phase precision.

## Production readiness

The reference solver exposes convergence, temporal replay and ownership for measurement. Numerical probes include consistent divergence reduction, exact stationary periodic uniform flow and fixed-seed reset replay. A production background should measure actual grid size and pressure residual on its target adapter, select an affordable iteration budget, and verify its static frame and contrast. High-fidelity fluid needs a stronger pressure solve and higher-order or conservative transport.
