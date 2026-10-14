# Indirect fireworks and spark emitters (`emitters`)

## Question

Can lifetime-driven births and deaths remain reproducible while live GPU counts drive rendering without a CPU count round trip?

## Technique summary

Each 32-byte record stores x/y, colour variation, remaining lifetime, x/y velocity and original lifetime. Disjoint invocations integrate drag, gravity and age. Stable scan compaction gathers dead IDs into a free list. Birth invocations take the first available free IDs, seeded by record identity and burst sequence. A difference of cumulative rate totals chooses the exact integer birth quota per fixed update. A second compaction gathers living IDs, and a one-invocation compute pass writes four indirect draw arguments. Point mode writes vertexCount=liveCount, instanceCount=1; quad mode writes vertexCount=6, instanceCount=liveCount. Fireworks use radial velocities and moving explosion centers; sparks use an upward fountain. A small seeded burst gives reduced motion a visible initial pose. The scan scratch is sized for the 262,144-record maximum so count changes can reallocate records synchronously without rebuilding pipelines.

## Occasional DOM fireworks

The `/fireworks-dom.html` demo opts into `burstInterval: 3.6`, `burstSize: 1536`, `bursts: 2`, `shape: 'mixed'`, `palette: 'vivid'`, and `wander: 0`. A fixed-step interval crossing births both 1,536-particle bursts at once, leaving a quiet gap after the particles expire. Each particle retains the burst's seven-color index (red, green, blue, yellow, cyan, magenta, orange) in its spare velocity component alongside its shape, so older trails are not recolored by later births. Discrete fireworks correct horizontal velocity for viewport aspect ratio. The default interval is zero and palette is `tint`, preserving the original continuous emitter and presets.

The demo measures visible foreground DOM rectangles before frames and places two origins behind separated elements. Round shells, narrow rings, and longer-lived willows rotate in mixed mode. Shape metadata persists per particle, with willow-specific drag and gravity; the selector can pin a style. Occlusion is ordinary HTML stacking above a fixed background canvas, not a fluid collision boundary. It reuses the fluid demo's float HDR presentation of the raw `hdr` tap, with SDR tone mapping when extended presentation is unavailable. The page stays usable without WebGPU and starts paused under reduced motion.

## References

[WebGPU indirect drawing](https://www.w3.org/TR/webgpu/#dom-gpurendercommandsmixin-drawindirect) defines the four argument words. The local [prefix-sum primitive](../../packages/core/src/primitives/prefix-sum.ts) provides stable compaction; exact algorithm sources are available in the Passes drawer.

## Passes and resources

Simulation is fixed-step compute, with immutable per-step frame and parameter snapshots. The common baseline record uses two vec4f fields, 32 bytes. Flow, attractors and morph use two record buffers; emitters use one disjoint-update record buffer plus flags, stable scan scratch, live/free IDs and indirect arguments. Morph adds a 16-byte target per particle. Two rgba16float histories cost 16 bytes per display pixel. A decay dispatch, additive point or quad render and Reinhard tone-map display follow simulation. Display-only resizing reallocates history while preserving particle state. Count changes recreate and initialize particle storage. Disposal destroys owned buffers/textures and releases shader leases; taps expose current storage and HDR history. Memory reports logical allocation bytes.

Trail energy is retained once per newly displayed simulation index. Repeated unchanged renders at the same index only tone-map existing HDR, preserving paused and reduced-motion pixels. Changing parameters used by the compiled particle draw shaders (such as tint, size, mode or attractor rotation) clears and redraws the current pose immediately; exposure and background only update the resolve, and retention applies on the next displayed index. Batched updates display only their final pose, so deterministic pixel replay also specifies the sequence of displayed indices.

## WebGPU features used

Baseline storage buffers, compute, vertex storage reads and rgba16float render attachments with additive blending. Timestamp-query is optional through the session profiler, with an unavailable state when unsupported. Presentation remains baseline SDR tone mapping; extended-range canvases are a separate capability experiment. Reduced motion draws the seeded time-zero pose and the definition declares a CSS gradient fallback.

## Parameters (generated)

<!-- params:start -->

| Parameter  | Type  | Default     | Range / choices   | Group     | Description                                                                                         |
| ---------- | ----- | ----------- | ----------------- | --------- | --------------------------------------------------------------------------------------------------- |
| count      | u32   | 32768       | 64…262144         | Particles | Storage particle count; changing it restarts the seeded field.                                      |
| draw       | enum  | "quad"      | point, quad       | Rendering | One raster point or six-vertex instanced quad per particle.                                         |
| size       | f32   | 1.6         | 0.5…8             | Rendering | Quad diameter in display pixels; points remain one pixel.                                           |
| trail      | f32   | 0.94        | 0…0.995           | Rendering | Retained HDR energy per newly displayed simulation index; repeated paused renders preserve history. |
| exposure   | f32   | 0.8         | 0.01…4            | Rendering | Exposure before Reinhard HDR tone mapping.                                                          |
| tint       | color | "#72dcd3"   | —                 | Palette   | Additive particle colour.                                                                           |
| background | color | "#07111e"   | —                 | Palette   | Tone mapped empty-field background.                                                                 |
| kind       | enum  | "fireworks" | fireworks, sparks | Emitter   | Radial explosions or a continuous upward spark fountain.                                            |
| rate       | f32   | 6000        | 0…60000           | Emitter   | Desired births per second, limited by the deterministic free list capacity.                         |
| lifetime   | f32   | 2           | 0.1…8             | Emitter   | Particle lifetime in seconds; dead records return to the stable free list.                          |
| speed      | f32   | 0.6         | 0.05…2            | Emitter   | Initial normalized velocity magnitude.                                                              |
| gravity    | f32   | 0.25        | 0…2               | Emitter   | Downward acceleration in normalized units per second squared.                                       |
| drag       | f32   | 0.2         | 0…5               | Emitter   | Exponential velocity drag per second.                                                               |
| origin     | vec2  | [0,-0.45]   | -0.9…0.9          | Emitter   | Emitter location in clip coordinates.                                                               |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded on the development Apple M1 Max / macOS 26.6.2 using the production preview and the same fixed-scenario runner as the Profiler drawer. Physical display is 512² at DPR 1, seed 7, fixed resolution/work quality. Defaults are retained except million-particle gate rows set count to exactly 1,000,000 and select point or instanced-quad drawing. Each of three runs discards 30 warm-up updates and measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion and timestamp readback.

| Browser              | Rendering / allocation controls | CPU mean ms           | Completion p95 ms     | Summed GPU pass p95 ms | rAF median ms            | Million-particle gate | Record                               |
| -------------------- | ------------------------------- | --------------------- | --------------------- | ---------------------- | ------------------------ | --------------------- | ------------------------------------ |
| chrome 154.0.8037.98 | quad; count=32768               | 0.352 / 0.374 / 0.346 | 6.500 / 7.000 / 5.600 | 1.245 / 1.114 / 1.049  | 16.700 / 16.700 / 16.700 | —                     | [JSON](../benchmarks/m3-chrome.json) |
| webkit 26.6          | quad; count=32768               | 0.608 / 0.350 / 0.567 | 6.000 / 6.000 / 7.000 | 1.781 / 1.824 / 1.726  | 16.000 / 16.000 / 16.000 | —                     | [JSON](../benchmarks/m3-webkit.json) |

GPU columns use actual pass-boundary timestamp queries when available; values are implementation-defined and may be quantized. Pass intervals may overlap; their sum is a diagnostic rather than whole-frame execution time. These captures include summed intervals larger than queue-completion wall latency, so the columns must not be substituted for one another. CPU encode, queue-completion wall latency and rAF cadence remain separate. The million-particle gate verifies actual storage count, both draw paths, all 150 fixed updates and no GPU errors; M3 specifies particle count rather than a refresh-rate threshold. Machine load is uncontrolled. Logical allocations are not VRAM. Initialization/compilation are excluded. Small deterministic software snapshots and CPU-reference GPU tests establish separate numerical/lifecycle properties, not million-particle speed.

<!-- measurements:end -->

## Findings and validation

The numerical tests in `tests/browser/particles-core.spec.ts` check seeded storage replay, both rendering paths and finite HDR taps. Specific tests cover zero-speed/wrapping flow, Clifford and De Jong CPU equations, lifetime/death/free-list/count conservation with indirect arguments, and spring integration plus custom text/image inputs. Generic catalogue tests separately cover preset pixels, resize and disposal. See [particle contract ADR](../adr/008-particle-storage-and-hdr.md) for shared assumptions. These small fixtures establish correctness; the recorded hardware workload establishes throughput.

## Failure modes

The requested birth rate is clipped to available free slots; large rate×lifetime combinations saturate capacity and discard excess births. A GPU count of zero is a valid empty indirect draw, while existing trails remain until subsequent displayed indices decay them. Stable compaction avoids atomic ordering differences but requires several full-buffer scans per update; this cost scales with capacity and can dominate sparse scenes. Scan scratch is allocated for the 262,144-record maximum even for a small selected count. Cumulative f32 time/rate arithmetic eventually loses birth-quota precision in very long sessions, although living/free conservation remains exact for the actual quota. Off-screen particles retain slots until death, and no collision geometry is modeled. Half-float trails and count-scaled emission limit colour accuracy; the fallback is a static gradient rather than simulated fireworks.

## Production readiness

A production emitter should expose dropped-birth and off-screen occupancy counters, use an integer fixed-tick birth accumulator for long runs, and choose between stable compaction and alternative allocators based on measured sparsity. Scratch capacity should follow a negotiated memory budget while preserving resize safety and indirect argument ownership. Add long-run capacity reuse and varied rate/lifetime tests, without replacing the existing exact live/free/indirect-count checks. Optional collisions, multiple independently controlled emitters and richer lifetime curves would extend the visual model; they are not represented by the current single-source fireworks/sparks controls.
