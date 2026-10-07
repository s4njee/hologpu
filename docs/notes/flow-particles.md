# Million curl-noise particles (`flow-particles`)

## Question

Can one million independently advected storage particles sustain a usable visual update, and how much do points and instanced quads change rendering cost?

## Technique summary

Seeded particles initialize uniformly in clip space. A central finite difference of two-dimensional simplex noise defines a curl velocity: v=(dN/dy,-dN/dx). Four noise evaluations per particle produce velocity, forward Euler advances by speed times the fixed delta, and periodic wrapping keeps x/y in [-1,1). The noise field translates over time. Velocity remains in the storage tap for inspection. Count defaults to 1,048,576, with separate point and quad branches. The retention parameter adds trails through the shared HDR histories. Zero speed is an exact stationary invariant up to normalized-coordinate arithmetic.

## References

[Bridson, Houriham and Nordenstam, Curl-noise for procedural fluid flow](https://doi.org/10.1145/1276377.1276435) motivates divergence-free procedural flow; this implementation uses a two-dimensional scalar potential and finite differences.

## Passes and resources

Simulation is fixed-step compute, with immutable per-step frame and parameter snapshots. The common baseline record uses two vec4f fields, 32 bytes. Flow, attractors and morph use two record buffers; emitters use one disjoint-update record buffer plus flags, stable scan scratch, live/free IDs and indirect arguments. Morph adds a 16-byte target per particle. Two rgba16float histories cost 16 bytes per display pixel. A decay dispatch, additive point or quad render and Reinhard tone-map display follow simulation. Display-only resizing reallocates history while preserving particle state. Count changes recreate and initialize particle storage. Disposal destroys owned buffers/textures and releases shader leases; taps expose current storage and HDR history. Memory reports logical allocation bytes.

Trail energy is retained once per newly displayed simulation index. Repeated unchanged renders at the same index only tone-map existing HDR, preserving paused and reduced-motion pixels. Changing parameters used by the compiled particle draw shaders (such as tint, size, mode or attractor rotation) clears and redraws the current pose immediately; exposure and background only update the resolve, and retention applies on the next displayed index. Batched updates display only their final pose, so deterministic pixel replay also specifies the sequence of displayed indices.

## WebGPU features used

Baseline storage buffers, compute, vertex storage reads and rgba16float render attachments with additive blending. Timestamp-query is optional through the session profiler, with an unavailable state when unsupported. Presentation remains baseline SDR tone mapping; extended-range canvases are a separate capability experiment. Reduced motion draws the seeded time-zero pose and the definition declares a CSS gradient fallback.

## Parameters (generated)

<!-- params:start -->

| Parameter  | Type  | Default   | Range / choices | Group     | Description                                                                                         |
| ---------- | ----- | --------- | --------------- | --------- | --------------------------------------------------------------------------------------------------- |
| count      | u32   | 1048576   | 64…1048576      | Particles | Storage particle count; changing it restarts the seeded field.                                      |
| draw       | enum  | "point"   | point, quad     | Rendering | One raster point or six-vertex instanced quad per particle.                                         |
| size       | f32   | 1.6       | 0.5…8           | Rendering | Quad diameter in display pixels; points remain one pixel.                                           |
| trail      | f32   | 0.94      | 0…0.995         | Rendering | Retained HDR energy per newly displayed simulation index; repeated paused renders preserve history. |
| exposure   | f32   | 0.8       | 0.01…4          | Rendering | Exposure before Reinhard HDR tone mapping.                                                          |
| tint       | color | "#72dcd3" | —               | Palette   | Additive particle colour.                                                                           |
| background | color | "#07111e" | —               | Palette   | Tone mapped empty-field background.                                                                 |
| speed      | f32   | 0.14      | 0…0.8           | Flow      | Curl velocity in normalized units per second.                                                       |
| frequency  | f32   | 2         | 0.2…8           | Flow      | Spatial frequency of the simplex curl field.                                                        |
| evolution  | f32   | 0.08      | 0…0.5           | Flow      | Translation of the noise field per second.                                                          |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded on the development Apple M1 Max / macOS 26.6.2 using the production preview and the same fixed-scenario runner as the Profiler drawer. Physical display is 512² at DPR 1, seed 7, fixed resolution/work quality. Defaults are retained except million-particle gate rows set count to exactly 1,000,000 and select point or instanced-quad drawing. Each of three runs discards 30 warm-up updates and measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion and timestamp readback.

| Browser              | Rendering / allocation controls | CPU mean ms           | Completion p95 ms        | Summed GPU pass p95 ms   | rAF median ms            | Million-particle gate | Record                                    |
| -------------------- | ------------------------------- | --------------------- | ------------------------ | ------------------------ | ------------------------ | --------------------- | ----------------------------------------- |
| chrome 154.0.8037.98 | point; count=1048576            | 0.230 / 0.251 / 0.273 | 8.100 / 9.700 / 8.600    | 13.107 / 13.500 / 13.500 | 16.700 / 16.700 / 16.700 | —                     | [JSON](../benchmarks/m3-chrome.json)      |
| chrome 154.0.8037.98 | point; count=1000000            | 0.208 / 0.213 / 0.253 | 7.800 / 7.900 / 8.000    | 12.648 / 12.583 / 12.583 | 16.700 / 16.700 / 16.700 | 3/3 runs pass         | [JSON](../benchmarks/m3-gate-chrome.json) |
| chrome 154.0.8037.98 | quad; count=1000000             | 0.252 / 0.216 / 0.225 | 15.300 / 14.500 / 14.900 | 26.739 / 29.295 / 27.656 | 16.700 / 16.700 / 16.700 | 3/3 runs pass         | [JSON](../benchmarks/m3-gate-chrome.json) |
| webkit 26.6          | point; count=1000000            | 0.242 / 0.325 / 0.242 | 9.000 / 11.000 / 10.000  | 12.997 / 13.740 / 12.550 | 16.000 / 16.000 / 16.000 | 3/3 runs pass         | [JSON](../benchmarks/m3-gate-webkit.json) |
| webkit 26.6          | quad; count=1000000             | 0.317 / 0.350 / 0.350 | 17.000 / 17.000 / 16.000 | 30.074 / 30.720 / 28.675 | 24.000 / 24.000 / 24.000 | 3/3 runs pass         | [JSON](../benchmarks/m3-gate-webkit.json) |
| webkit 26.6          | point; count=1048576            | 0.300 / 0.267 / 0.233 | 9.000 / 10.000 / 8.000   | 13.405 / 13.304 / 13.354 | 16.000 / 16.000 / 16.000 | —                     | [JSON](../benchmarks/m3-webkit.json)      |

GPU columns use actual pass-boundary timestamp queries when available; values are implementation-defined and may be quantized. Pass intervals may overlap; their sum is a diagnostic rather than whole-frame execution time. These captures include summed intervals larger than queue-completion wall latency, so the columns must not be substituted for one another. CPU encode, queue-completion wall latency and rAF cadence remain separate. The million-particle gate verifies actual storage count, both draw paths, all 150 fixed updates and no GPU errors; M3 specifies particle count rather than a refresh-rate threshold. Machine load is uncontrolled. Logical allocations are not VRAM. Initialization/compilation are excluded. Small deterministic software snapshots and CPU-reference GPU tests establish separate numerical/lifecycle properties, not million-particle speed.

<!-- measurements:end -->

## Findings and validation

The numerical tests in `tests/browser/particles-core.spec.ts` check seeded storage replay, both rendering paths and finite HDR taps. Specific tests cover zero-speed/wrapping flow, Clifford and De Jong CPU equations, lifetime/death/free-list/count conservation with indirect arguments, and spring integration plus custom text/image inputs. Generic catalogue tests separately cover preset pixels, resize and disposal. See [particle contract ADR](../adr/008-particle-storage-and-hdr.md) for shared assumptions. These small fixtures establish correctness; the recorded hardware workload establishes throughput.

## Failure modes

The default 1,048,576 particles require 64 MiB for the two 32-byte state buffers before HDR textures and uniforms. Four simplex evaluations per curl sample make compute cost scale linearly with count; quad rendering additionally runs six vertices per particle and increases fragment overlap with diameter. Lowering display resolution reduces trail and raster work without reducing particle simulation work. Points are one physical pixel and can alias or disappear at low density. The velocity potential is not tiled: positions wrap periodically, but velocity can change across that seam. Finite-difference curl and forward Euler are an artistic advection model rather than a converged incompressible-fluid solver. High speed/frequency can cross narrow features in one tick. Half-float accumulation rounds small contributions, and count-dependent emission scaling above the energy bound deliberately changes brightness. GPU timestamp availability and quantization depend on the browser; the CSS gradient remains a static fallback without GPU simulation.

## Production readiness

Use the million-record results as a development-machine throughput measurement, not a default budget for every device. A production allocator should negotiate count and aggregate memory across fields, offer explicit point/quad quality presets, and benchmark mobile/integrated adapters before selecting a workload. A periodic potential would remove wrap seams; smaller or adaptive advection steps and trajectory comparisons would establish an accuracy target. Preserve seeded buffer replay, pause stability, finite HDR bounds and separate compute/draw timing coverage. A half-storage variant needs independent precision and optional-feature validation before replacing this baseline f32 record.
