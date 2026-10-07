# Pigment deposition on paper (`ink`)

## Question

Can a stationary paper deposit preserve the history of a moving fluid wash, and how much extra state and work does that material model cost?

## Technique summary

`ink` uses the same staggered-grid velocity solver, implicit diffusion, vorticity confinement, Jacobi pressure and projection as [`fluid`](./fluid.md). Suspended material stores two pigment concentrations and water in an `rgba32float` texture. Persistent pigment and paper use f32 storage to avoid systematic repeated half-float narrowing. Pigment and water advect through projected velocity. Water evaporates exponentially; suspended pigment has a separate dissipation control, zero by default.

After transport, a seeded paper-grain field modulates an irreversible deposition rate. Drying increases that rate. The transfer is `pigment × (1 − exp(−rate × dt))`: one pass adds exactly that computed transfer to stationary deposits, and another subtracts it from suspended pigment. Both sample the same pre-transfer material, keeping local pigment balance apart from f32 arithmetic rounding and the explicit concentration guards. Deposited pigment never advects, dissipates or evaporates. It persists until reset or a real simulation-grid change. Grain is fixed in simulation-cell coordinates rather than presentation-pixel coordinates.

The display combines suspended and deposited pigment optical thickness, using negative logarithms of the two pigment reflectance colours as absorption coefficients. Beer-Lambert transmittance modulates the paper colour in linear RGB. This is a small artistic subtractive model. It is **not** a Kubelka-Munk scattering solver, shallow-water model, capillary transport model, spectral pigment calibration or a reproduction of the full Curtis watercolor algorithm. The `sumi` preset provides the dark wash referenced in the project plan; `watercolor` uses slower absorption and chromatic pigments.

Drag injects pigment, water and momentum. Reset seeds a reproducible initial wash. Reduced motion displays that static wash. Changing presentation scale keeps deposits if the simulation grid is unchanged; changing actual grid size clears all material rather than inventing a resampling/conservation policy.

## References

[Curtis, Anderson, Seims, Fleischer and Salesin, Computer-Generated Watercolor (SIGGRAPH 1997)](https://grail.cs.washington.edu/projects/watercolor/) separates flowing pigment from deposition on paper and motivates a material model beyond a fluid colour buffer. Its optical and capillary models are substantially more complete than this implementation. [Stam, Stable Fluids](https://www.dgp.toronto.edu/people/stam/reality/Research/pdf/ns.pdf) motivates the shared transport/projection split. The transfer equation, two-pigment parameterization and WGSL passes here are original simplified choices.

## Passes and resources

Relative to `fluid`, each fixed step adds two compute passes: stationary paper deposition and suspended-pigment removal. Default total is 30 compute passes per fixed update, then display and SDR resolve. Paper adds one `rgba32float` pair, or 32 logical bytes per cell. Promoting the material pair from `rgba16float` to `rgba32float` adds another 16 bytes per cell relative to `fluid`; velocity remains half-float. Total owned simulation textures are **108 bytes per cell plus 8 neutral bytes**: 113,246,216 bytes at 1024², excluding presentation target and uniform snapshots. Named taps are the shared solver fields, `dye` (R/G suspended pigments, B water) and `paper` (R/G stationary deposits). Resource destruction releases both paper sides along with shared solver textures, pipelines and reusable uniform snapshots.

## WebGPU features used

Baseline 8×8 compute dispatches, sampled and write-only storage textures, f32 pigment/paper and half-float velocity state, uniform snapshots and fullscreen display. Four-load bilinear interpolation needs no optional float-filtering feature. The CSS radial-gradient fallback is static and reduced motion freezes the initial wash. A fixed simulation step count and seed produce repeatable deposits on one engine/adapter; cross-adapter bitwise identity is not promised.

## Parameters (generated)

<!-- params:start -->

| Parameter       | Type  | Default    | Range / choices                                | Group         | Description                                                                                                    |
| --------------- | ----- | ---------- | ---------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------- |
| grid            | u32   | 256        | 32…1024                                        | Solver        | Actual longest simulation dimension in cells; aspect ratio follows the stage. Changing it restarts all fields. |
| iterations      | u32   | 16         | 2…80                                           | Solver        | Jacobi pressure iterations per fixed step; adaptive quality may cap this count.                                |
| boundary        | enum  | "closed"   | closed, periodic                               | Solver        | Impermeable free-slip walls or a wrapping domain.                                                              |
| viscosity       | f32   | 0.25       | 0…1                                            | Solver        | Implicit velocity diffusion strength in squared grid cells per second; four Jacobi iterations.                 |
| drag            | f32   | 0.6        | 0…3                                            | Solver        | Exponential velocity damping, separate from viscosity.                                                         |
| vorticity       | f32   | 0.2        | 0…3                                            | Solver        | Grid-scaled vorticity confinement restoring small swirls lost to advection.                                    |
| dissipation     | f32   | 0          | 0…3                                            | Material      | Exponential loss of suspended dye or smoke density.                                                            |
| source          | f32   | 0.25       | 0…3                                            | Injection     | Continuous autonomous dye or smoke injection rate; zero disables the emitter.                                  |
| force           | f32   | 0.3        | 0…2                                            | Injection     | Autonomous jet strength and pointer drag impulse scale.                                                        |
| radius          | f32   | 0.045      | 0.01…0.2                                       | Injection     | Gaussian emitter radius as a fraction of stage height.                                                         |
| initial         | enum  | "vortices" | vortices, rest, uniform, compression           | Initial state | Seeded vortices, stationary material, periodic constant flow, or a divergent convergence probe.                |
| initialVelocity | vec2  | [0.15,0]   | -0.5…0.5                                       | Initial state | Constant face velocity in stage-height units per second for the uniform initial state.                         |
| initialAmount   | f32   | 1.5        | 0…4                                            | Initial state | Initial dye or smoke amount; zero creates a completely empty material field.                                   |
| view            | enum  | "material" | material, velocity, pressure, divergence, curl | Diagnostics   | Material display or solver fields. Divergence shows the post-projection residual.                              |
| dyeA            | color | "#24445a"  | —                                              | Palette       | First dye colour; ink interprets it as pigment reflectance.                                                    |
| dyeB            | color | "#6c3a42"  | —                                              | Palette       | Second dye colour or smoke scattering colour.                                                                  |
| background      | color | "#f1eadb"  | —                                              | Palette       | Opaque stage background, or the paper reflectance for ink.                                                     |
| absorption      | f32   | 0.9        | 0…4                                            | Paper         | Irreversible transfer rate from suspended pigment to stationary paper deposits.                                |
| evaporation     | f32   | 0.35       | 0…3                                            | Paper         | Loss of transported water. Drying accelerates deposition.                                                      |
| grain           | f32   | 0.5        | 0…1                                            | Paper         | Seeded paper variation in absorption and reflectance; zero makes paper uniform.                                |
| opticalDensity  | f32   | 1.8        | 0.1…6                                          | Paper         | Beer-Lambert pigment optical thickness; an artistic subtractive model.                                         |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded 2026-10-07 on Apple M1 Max / macOS 26.6.2 using a production preview. Defaults and seed 7; gate runs override only the actual simulation grid to 1024. Resolution scale and DPR are 1, adaptive quality is disabled. Each of three runs discards 30 warm-up frames and measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion before the next frame.

| Browser              | Display / simulation         | CPU mean ms (three runs) | Submit-to-completion p95 ms | rAF median ms            | 1024² gate | Record                               |
| -------------------- | ---------------------------- | ------------------------ | --------------------------- | ------------------------ | ---------- | ------------------------------------ |
| chrome 154.0.8037.98 | 512² display / 256×256 state | 0.278 / 0.278 / 0.318    | 3.000 / 3.100 / 4.800       | 16.700 / 16.700 / 16.700 | —          | [JSON](../benchmarks/m2-chrome.json) |
| webkit 26.6          | 512² display / 256×256 state | 0.592 / 0.292 / 0.342    | 6.000 / 4.000 / 4.000       | 16.000 / 16.000 / 16.000 | —          | [JSON](../benchmarks/m2-webkit.json) |

CPU encoding/submission and submission-to-queue-completion wall latency are separate observations. Completion latency includes queue wait, browser and driver overhead; neither is GPU timestamp timing. The gate requires full-sized state and display, at least 95% completions and median rAF cadence within 110% of the separately measured idle rAF period. Device state and system load are uncontrolled. Logical allocation bytes are not VRAM. Compilation and initialization are excluded from measured frames. GPU timestamp profiling remains M3 work. Deterministic snapshots use grid 32, eight fixed updates, and seed 7 at DPR 1 and 2; separate numerical tests exercise algorithm invariants.

<!-- measurements:end -->

## Failure modes

Semi-Lagrangian transport is not globally mass-conservative. The deposition transfer is locally balanced, but f32 addition and subtraction still round independently. Hardware Chrome and WebKit on Metal exposed a systematic mass loss with the original half-float pigment/deposit storage: 1.1115% after 32 stationary steps and 2.2424% after 64. Every affected cell lost pigment. Using f32 material and deposits reduced the same 64-step relative mass error to 2.2×10⁻⁹ on both engines, without changing the transfer equation or test tolerance. This storage choice prevents that accumulated narrowing bias; it does not make advective transport conservative. Repeated very small f32 deposits can still round away against a large accumulated deposit. Suspended material clamps to 32 and deposits to 128. Above those limits pigment is intentionally discarded to bound state. Explicit pigment dissipation also loses mass. Water does not participate in a shallow-water height or wet-front solve, and dry cells do not block the incompressible velocity field. No lifting, capillary backruns, fibre transport, multilayer glaze ordering or chemical interaction is modeled.

Paper variation depends on cell coordinates, so changing grid density changes grain and absorption. The display grain is a small aesthetic reflectance modulation, not a physical geometry model. A low pressure iteration count retains residual compression; the same limitations as `fluid` apply. Pigment alpha is ignored because the paper-backed output is opaque. Arbitrary pigment colours can yield visually dark mixtures without implying measured real pigment spectra.

## Production readiness

Rest-state probes verify deposit growth, persistence and local mobile-plus-deposited balance within f32 arithmetic rounding. Fixed-seed replay and disposal cover the extra history textures. This is useful for illustrating absorption layered on a solver; a realistic watercolor tool would need measured pigment coefficients, a wet-area/capillary model, conservative transport and a deliberate history/resampling policy.
