# Buoyant smoke and self-shadow (`smoke`)

## Question

How do advected temperature and density change a projected fluid, and what is the extra cost of a bounded self-shadow display?

## Technique summary

`smoke` shares [`fluid`](./fluid.md)'s staggered-grid advection, implicit diffusion, vorticity confinement, divergence, Jacobi pressure and projection. Its material texture stores smoke density in R and temperature above ambient in G. Both fields advect through projected velocity. Density dissipates exponentially, while temperature relaxes to ambient through a separate cooling rate. The source and pointer inject both density and temperature.

Before projection, a vertical body force adds density-weighted downward motion and temperature-weighted upward motion. Screen Y increases downward, so positive buoyancy contributes negative Y velocity. Heating is therefore coupled to flow rather than only changing a colour. With no source, weight, vorticity or initial velocity, zero heat remains stationary; positive heat drives upward circulation through the pressure-projected field. Initial seeded smoke makes both the static reduced-motion frame and a reset immediately visible.

For each presentation, a compute pass samples density along a bounded screen-plane ray toward the light. Its Beer-Lambert transmittance is stored in a scalar shadow texture and bilinearly reconstructed for display. Local density sets opacity; shadow transmission modulates scattering colour, with a small temperature-dependent warm tint. The default march uses 12 samples over 0.45 stage-height units. Adaptive work quality reduces shadow samples, with a minimum of two. This is **two-dimensional screen-space self-shadowing**, not a 3D volume, multiple-scattering solution, fire/combustion simulation or physical smoke optical calibration.

## References

[NVIDIA GPU Gems 3, chapter 30: Real-Time Simulation and Rendering of 3D Fluids](https://developer.nvidia.com/gpugems/gpugems3/part-v-physics-simulation/chapter-30-real-time-simulation-and-rendering-3d-fluids) motivates advected temperature, buoyancy and smoke rendering. This experiment keeps a two-dimensional field and a bounded in-plane shadow proxy, rather than the chapter's three-dimensional renderer. [Stam, Stable Fluids](https://www.dgp.toronto.edu/people/stam/reality/Research/pdf/ns.pdf) motivates the shared velocity split. The screen-plane march and material display are original simplified choices.

## Passes and resources

The base solver remains 28 default compute passes per fixed update. Buoyancy is fused into the force pass; density and temperature share the dye-advection pass. One additional shadow compute pass executes per presented frame, including paused redraws, followed by the display and shared SDR resolve. Initialization also builds the initial shadow. Pressure iterations and shadow samples scale with adaptive work quality without changing fixed simulation time.

Density/temperature reuse the base `rgba16float` material pair. The shadow field adds one `r32float` texture, bringing owned simulation state to **64 bytes per cell plus 8 neutral bytes**: 67,108,872 bytes at 1024², excluding presentation target and uniforms. A separate reusable uniform snapshot supplies the shadow sample count so quality changes do not overwrite queued simulation uniforms. Named taps include the shared solver fields, `dye` (R density, G temperature) and `shadow` (R light transmittance, bounded 0…1). Reset clears both state sides and rebuilds the initial shadow; destruction releases every texture and snapshot.

## WebGPU features used

Baseline 8×8 compute dispatches, sampled/write-only storage textures, half-float vector state, f32 pressure/divergence/shadow state, immutable uniform snapshots and a fullscreen display. Manual bilinear interpolation avoids an optional `float32-filterable` dependency. No optional adapter features are required. The CSS fallback is a static smoke-coloured radial gradient. Reduced motion displays the initial seeded density with its shadow and does not step the thermal field.

## Parameters (generated)

<!-- params:start -->

| Parameter       | Type  | Default     | Range / choices                                | Group         | Description                                                                                                    |
| --------------- | ----- | ----------- | ---------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------- |
| grid            | u32   | 256         | 32…1024                                        | Solver        | Actual longest simulation dimension in cells; aspect ratio follows the stage. Changing it restarts all fields. |
| iterations      | u32   | 16          | 2…80                                           | Solver        | Jacobi pressure iterations per fixed step; adaptive quality may cap this count.                                |
| boundary        | enum  | "closed"    | closed, periodic                               | Solver        | Impermeable free-slip walls or a wrapping domain.                                                              |
| viscosity       | f32   | 0.02        | 0…1                                            | Solver        | Implicit velocity diffusion strength in squared grid cells per second; four Jacobi iterations.                 |
| drag            | f32   | 0.15        | 0…3                                            | Solver        | Exponential velocity damping, separate from viscosity.                                                         |
| vorticity       | f32   | 1.4         | 0…3                                            | Solver        | Grid-scaled vorticity confinement restoring small swirls lost to advection.                                    |
| dissipation     | f32   | 0.22        | 0…3                                            | Material      | Exponential loss of suspended dye or smoke density.                                                            |
| source          | f32   | 1.2         | 0…3                                            | Injection     | Continuous autonomous dye or smoke injection rate; zero disables the emitter.                                  |
| force           | f32   | 0.3         | 0…2                                            | Injection     | Autonomous jet strength and pointer drag impulse scale.                                                        |
| radius          | f32   | 0.045       | 0.003…0.2                                      | Injection     | Gaussian emitter radius as a fraction of stage height.                                                         |
| initial         | enum  | "vortices"  | vortices, rest, uniform, compression           | Initial state | Seeded vortices, stationary material, periodic constant flow, or a divergent convergence probe.                |
| initialVelocity | vec2  | [0.15,0]    | -0.5…0.5                                       | Initial state | Constant face velocity in stage-height units per second for the uniform initial state.                         |
| initialAmount   | f32   | 2           | 0…4                                            | Initial state | Initial dye or smoke amount; zero creates a completely empty material field.                                   |
| view            | enum  | "material"  | material, velocity, pressure, divergence, curl | Diagnostics   | Material display or solver fields. Divergence shows the post-projection residual.                              |
| dyeA            | color | "#c4d4df"   | —                                              | Palette       | First dye colour; ink interprets it as pigment reflectance.                                                    |
| dyeB            | color | "#edb49c"   | —                                              | Palette       | Second dye colour or smoke scattering colour.                                                                  |
| background      | color | "#111b29"   | —                                              | Palette       | Opaque stage background, or the paper reflectance for ink.                                                     |
| buoyancy        | f32   | 0.7         | 0…3                                            | Thermal       | Upward force proportional to temperature above ambient.                                                        |
| weight          | f32   | 0.08        | 0…1                                            | Thermal       | Downward force proportional to smoke density.                                                                  |
| heat            | f32   | 1.2         | 0…4                                            | Thermal       | Initial and emitted temperature above ambient.                                                                 |
| cooling         | f32   | 0.35        | 0…3                                            | Thermal       | Exponential temperature relaxation to ambient.                                                                 |
| extinction      | f32   | 3           | 0.1…8                                          | Lighting      | Beer-Lambert extinction for density and the screen-space shadow march.                                         |
| lightDirection  | vec2  | [-0.6,-0.8] | -1…1                                           | Lighting      | Screen-plane direction toward the light; zero uses straight upward.                                            |
| shadowSteps     | u32   | 12          | 2…32                                           | Lighting      | Density samples toward the light per simulated cell; adaptive quality may cap this count.                      |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded 2026-10-07 on Apple M1 Max / macOS 26.6.2 using a production preview. Defaults and seed 7; gate runs override only the actual simulation grid to 1024. Resolution scale and DPR are 1, adaptive quality is disabled. Each of three runs discards 30 warm-up frames and measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion before the next frame.

| Browser              | Display / simulation         | CPU mean ms (three runs) | Submit-to-completion p95 ms | rAF median ms            | 1024² gate | Record                               |
| -------------------- | ---------------------------- | ------------------------ | --------------------------- | ------------------------ | ---------- | ------------------------------------ |
| chrome 154.0.8037.98 | 512² display / 256×256 state | 0.334 / 0.348 / 0.295    | 11.600 / 11.700 / 10.700    | 16.700 / 16.700 / 16.700 | —          | [JSON](../benchmarks/m2-chrome.json) |
| webkit 26.6          | 512² display / 256×256 state | 0.500 / 0.633 / 0.283    | 10.000 / 12.000 / 7.000     | 16.000 / 16.000 / 16.000 | —          | [JSON](../benchmarks/m2-webkit.json) |

CPU encoding/submission and submission-to-queue-completion wall latency are separate observations. Completion latency includes queue wait, browser and driver overhead; neither is GPU timestamp timing. The gate requires full-sized state and display, at least 95% completions and median rAF cadence within 110% of the separately measured idle rAF period. Device state and system load are uncontrolled. Logical allocation bytes are not VRAM. Compilation and initialization are excluded from measured frames. GPU timestamp profiling remains M3 work. Deterministic snapshots use grid 32, eight fixed updates, and seed 7 at DPR 1 and 2; separate numerical tests exercise algorithm invariants.

<!-- measurements:end -->

## Failure modes

Finite Jacobi pressure iterations and half-float velocity retain residual divergence and rounding. Semi-Lagrangian density/temperature transport dissipates detail and is not energy- or mass-conservative. Buoyancy coefficients are artistic, not calibrated to an equation of state. Temperature and density clamp at 32, and velocities at ±2 stage-height units/s; extreme sources lose energy or mass at those guards.

A finite in-plane march misses out-of-plane light, density outside its 0.45-height extent, and illumination from other directions. Low shadow sample counts can band or under-estimate small structures. No multiple scattering or phase function is evaluated. The shadow tap changes when lighting parameters or work quality change, even while simulation is paused. A zero light-direction vector selects upward illumination. Opaque background presentation does not model a smoke volume composited with arbitrary DOM geometry. Grid changes restart the thermal and density history.

## Production readiness

The thermal probe compares an exactly stationary zero-heat fixture against heated upward motion with the same seed, while readbacks verify finite coupled fields and bounded shadow transmission. Measure solver and shadow cost independently at the intended actual grid, and tune thermal/source values and contrast for the page. A realistic volumetric effect needs three-dimensional state, calibrated extinction and a proper participating-media renderer.
