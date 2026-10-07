# Fluid around DOM rectangles (`fluid-obstacles`)

## Question

Can a projected fluid interact with accessible page headings through their browser bounding boxes, without rasterizing the page or hiding the content in a canvas?

## Technique summary

The M2 staggered MAC solver is extended with a read-only storage buffer of local rectangle bounds. `DomRectsInput` reads elements tagged `data-hgpu-obstacle` in document order. Browser `getBoundingClientRect()` includes CSS transforms; subtraction of the rendering-box viewport origin followed by division by its dimensions produces normalized coordinates. Direct sources default to the container bounds. Attachments use the actual shadow canvas as `coordinateTarget`, so host padding and borders do not shift the obstacle mask. Boxes clip to this rendering box and omit hidden or empty elements. A resize observer, subtree mutation observer and capture-phase scroll listener invalidate geometry; the attachment's before-frame hook refreshes animated transforms and layout in the existing scheduler frame.

Cell centres inside rectangles are solid. The right and bottom velocity faces are exactly zero when either adjacent cell is solid, both during advection/forcing and pressure projection. Divergence uses these same blocked faces. Jacobi pressure excludes solid neighbors, giving a Neumann boundary consistent with the face-gradient operator rather than merely painting a hole over the output. Pressure and dye are zero inside solids. Dye's semi-Lagrangian backtrace intersects the rectangle slabs and stops at the first solid entry, preventing a characteristic spanning several cells from crossing a thin heading. Bilinear interpolation still diffuses concentration near boundaries.

Moving boxes rerasterize the diagnostic mask and clear newly occupied material/velocity. A changed geometry also triggers a fresh pressure projection during display, including when the timeline is paused. Newly uncovered cells start from the retained zero material and face state. Moving geometry is an instantaneous free-slip wall update: no moving-wall momentum, displaced-fluid mass conservation, rotational shape collision or cut cells are claimed. The input is axis-aligned browser bounds, including the larger axis-aligned bound of a rotated element.

`snapshot()` returns the last immutable observed boxes without style/layout work. `refresh()` synchronizes layout, and `buffer(device)` uploads cached geometry only when it changes. Direct callers outside `attach()` should register `field.onBeforeFrame(() => source.refresh())` and subscribe to geometry changes to invalidate a paused field. This avoids repeating layout reads for each fluid catch-up step.

Without a bound DOM source, two deterministic heading-sized rectangles provide catalogue diagnostics. `field.setInput('obstacles', new DomRectsInput(container))` binds a borrowed source; `null` restores those reference rectangles. The DOM attachment owns its automatically constructed source and disposes it with the attachment. Light DOM headings remain accessible and selectable above the independent graphics layer.

## References

[Jos Stam, Stable Fluids (SIGGRAPH 1999)](https://www.dgp.toronto.edu/people/stam/reality/Research/pdf/ns.pdf) supplies the split advection/diffusion/projection framework. [Robert Bridson, Fluid Simulation notes](https://www.cs.ubc.ca/~rbridson/fluidsimulation/fluids_notes.pdf) describes face velocities and obstacle pressure boundaries. See the original [fluid note](fluid.md) for the shared solver's units, forcing, diffusion and convergence limitations. The rectangle storage, blocked-face implementation and fixtures here are original.

## Passes and resources

The existing velocity/dye/pressure ping-pong targets, curl, pre/post divergence and diffusion RHS remain. An additional `r32float` `obstacleMask` tap exposes the actual solver solid classification. `obstacles` is a buffer tap with a 16-byte header (`u32 count`, three padding words), then `vec4f(left,top,right,bottom)` bounds; coordinates are normalized fractions of the rendering box, independent of DPR and grid resolution.

The default grid is 256 cells on the longest dimension and 32 Jacobi pressure iterations. Every fixed update performs the original MAC solve with rectangle-aware operators. Display computes the mask and enforces solid state; changed geometry adds a zero-pressure initialization, divergence, the configured pressure iteration budget, projection and residual calculation. State texture storage is 64 bytes per simulation cell plus the 8-byte neutral texel, excluding the presentation target. The two default boxes own a 48-byte storage buffer. Caller-owned DOM storage is reported by `DomRectsInput.bufferBytes`, separate from effect-owned memory.

The default DOM source cap is 128 rectangles; callers may choose 1–4096. The cap truncates tagged elements in document order before omitting hidden or empty boxes, with explicit limits rather than silent unbounded allocations. Storage capacity grows by powers of two. Superseded buffers on the same device remain owned until disposal so previously encoded commands cannot reference destroyed storage. On replacement devices, storage rebuilds from current DOM state, and old-device resources release. Disposal disconnects every observer/listener and destroys all current and retired buffers. Effects borrow the input and never dispose caller DOM objects.

## WebGPU features used

Baseline storage buffers, sampled textures and write-only storage textures, with 8×8 compute workgroups. No optional features, browser page rasterization, external textures or JFA are required. Rectangles are tested analytically in solver passes, costing proportional to rectangle count; this is a reference bounded-rectangle implementation. The seeded initial state and CSS fallback support reduced motion and unavailable WebGPU.

## Parameters (generated)

<!-- params:start -->

| Parameter       | Type  | Default    | Range / choices                                | Group         | Description                                                                                                    |
| --------------- | ----- | ---------- | ---------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------- |
| grid            | u32   | 256        | 32…1024                                        | Solver        | Actual longest simulation dimension in cells; aspect ratio follows the stage. Changing it restarts all fields. |
| iterations      | u32   | 32         | 2…80                                           | Solver        | Jacobi pressure iterations per fixed step; adaptive quality may cap this count.                                |
| boundary        | enum  | "closed"   | closed, periodic                               | Solver        | Impermeable free-slip walls or a wrapping domain.                                                              |
| viscosity       | f32   | 0.02       | 0…1                                            | Solver        | Implicit velocity diffusion strength in squared grid cells per second; four Jacobi iterations.                 |
| drag            | f32   | 0.15       | 0…3                                            | Solver        | Exponential velocity damping, separate from viscosity.                                                         |
| vorticity       | f32   | 0.5        | 0…3                                            | Solver        | Grid-scaled vorticity confinement restoring small swirls lost to advection.                                    |
| dissipation     | f32   | 0.1        | 0…3                                            | Material      | Exponential loss of suspended dye or smoke density.                                                            |
| source          | f32   | 0.8        | 0…3                                            | Injection     | Continuous autonomous dye or smoke injection rate; zero disables the emitter.                                  |
| force           | f32   | 0.3        | 0…2                                            | Injection     | Autonomous jet strength and pointer drag impulse scale.                                                        |
| radius          | f32   | 0.045      | 0.01…0.2                                       | Injection     | Gaussian emitter radius as a fraction of stage height.                                                         |
| initial         | enum  | "vortices" | vortices, rest, uniform, compression           | Initial state | Seeded vortices, stationary material, periodic constant flow, or a divergent convergence probe.                |
| initialVelocity | vec2  | [0.18,0]   | -0.5…0.5                                       | Initial state | Constant face velocity in stage-height units per second for the uniform initial state.                         |
| initialAmount   | f32   | 1.5        | 0…4                                            | Initial state | Initial dye or smoke amount; zero creates a completely empty material field.                                   |
| view            | enum  | "material" | material, velocity, pressure, divergence, curl | Diagnostics   | Material display or solver fields. Divergence shows the post-projection residual.                              |
| dyeA            | color | "#35bacf"  | —                                              | Palette       | First dye colour; ink interprets it as pigment reflectance.                                                    |
| dyeB            | color | "#ef795e"  | —                                              | Palette       | Second dye colour or smoke scattering colour.                                                                  |
| background      | color | "#101623"  | —                                              | Palette       | Opaque stage background, or the paper reflectance for ink.                                                     |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded on the development Apple M1 Max / macOS 26.6.2 using the production preview. All current typed defaults, seed 7, physical 512² display, DPR 1 and fixed resolution/work quality. Each of three runs discards 30 warm-up updates then measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion and timestamp readback. Standalone image, text and audio effects use their documented owned fixtures: two HDR cards, a text coverage mask, and a two-sine waveform with its actual DFT. Fluid obstacles uses two packed rectangles with its default 256² grid and 32 pressure iterations.

| Browser              | CPU mean ms           | Completion p95 ms        | Summed GPU pass p95 ms   | rAF median ms            | Record                               |
| -------------------- | --------------------- | ------------------------ | ------------------------ | ------------------------ | ------------------------------------ |
| chrome 154.0.8037.98 | 0.501 / 0.481 / 0.532 | 8.800 / 9.200 / 9.900    | 11.534 / 11.862 / 12.124 | 16.700 / 16.700 / 16.700 | [JSON](../benchmarks/m5-chrome.json) |
| webkit 26.6          | 0.342 / 0.400 / 0.350 | 13.000 / 13.000 / 12.000 | 26.462 / 26.923 / 25.500 | 17.000 / 17.000 / 17.000 | [JSON](../benchmarks/m5-webkit.json) |

CPU encode, encoding-through-queue-completion wall latency, summed pass timestamps and rAF cadence measure different boundaries. Timestamp precision and overlapping intervals limit interpretation; the summed GPU column is not whole-frame elapsed time. Compilation and initialization are excluded, machine load is uncontrolled, and allocation sizes are logical rather than VRAM. These standalone measurements exclude live media, DOM geometry, CSS polling and attachment costs. The separate [M5 page measurements](../m5.md) cover six actual DOM attachments, visible uniform bridges and the overlay experiment. Numerical references, deterministic software snapshots and device-loss tests establish correctness separately from performance.

<!-- measurements:end -->

## Failure modes

Low pressure iteration counts leave measurable compressibility. Thin rectangles smaller than a grid cell may have no solid cell centre; choose a grid that resolves the intended heading. The actual boundary is the rectangular grid-cell approximation to the browser box. Rotated/rounded text, individual glyphs and irregular shapes are deliberately bounded by rectangles. Overlapping boxes combine as solid unions. The solver uses instantaneous stationary walls and removes material covered by a moving box; it does not conserve volume during geometry changes. Semi-Lagrangian interpolation dissipates dye. DOM layout reads are bounded by the source cap but must still be measured on the target page and adapter. Detached sources need caller disposal.

## Production readiness

Numerical tests read actual GPU rectangle storage and state taps, verify zero normal velocity across every blocked face, zero dye in solid cells, pressure residual reduction, and exactly moved/removed masks from a CSS-transformed heading. Catalogue fixtures replay the default pose and both presets at DPR 1 and 2 with a 64-cell test grid. The standalone benchmark rows separately validate the actual typed defaults, including the 256-cell grid and 32 pressure iterations. The page integration validates lifetime and device restoration alongside the DOM attachment contract. Use the pressure residual and stage/grid distinction when selecting an iteration budget.
