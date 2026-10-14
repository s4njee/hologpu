# Noise-displaced instanced meshes (`instances`)

## Question

Can a reusable render bundle draw a large depth-tested field while changing noise displacement without re-encoding its draw commands?

## Technique summary

Indexed cube instancing with seeded value-noise height displacement in the vertex shader. A minimal perspective orbit camera uses right-handed world coordinates and WebGPU depth 0–1. Direct and bundled paths use the same mesh and live uniform buffers. Each mode supports single-sample and 4x MSAA HDR resolve.

## References

- [WebGPU specification](https://gpuweb.github.io/gpuweb/)

## Passes and resources

The mesh pass has an optional pair of baseline occlusion queries. The first counts visible samples; a repeated identical draw fails strict-less depth and returns zero. Query results are u64 buffer taps, not a culling algorithm. Bundles are rebuilt only for instance-count or sample-count changes. Camera, mesh, query set/results and size-dependent attachments are owned and disposed by the instance.

## WebGPU features used

Instancing, index buffers, depth32float, 4x MSAA, render bundles, occlusion queries. No optional feature required.

## Reduced motion and fallback

The declared page-planning estimate is 3 ms at a 640×400 physical-pixel target. This is a conservative authored estimate for development warnings, not a measured guarantee or an assertion that this research effect meets the launch-page GPU gate.

Reduced motion freezes both seeded cube-height noise and the camera at time zero, using the tuned 0.65-radian starting angle. The instance stops automatic rendering after dirty work settles; count, materials and resize still redraw. Setting camera `speed` to zero does not stop the independent vertex-noise animation; enable reduced motion to settle the whole field.

The bundled `poster.png` is the script-generated default settled pose (seed 7). `attach` uses it when WebGPU is unavailable; the declared CSS gradient remains a last resort if the image cannot load. Native light-DOM content remains readable and interactive, and both GPU canvas and poster are decorative. Generate an author poster with `node scripts/poster.mjs instances <preset> <width>x<height> <output.png>` for a different theme or geometry, then pass that URL as the attachment's `poster` option.

## Parameters (generated)

<!-- params:start -->

| Parameter | Type  | Default   | Range / choices | Group     | Description                                                                                      |
| --------- | ----- | --------- | --------------- | --------- | ------------------------------------------------------------------------------------------------ |
| speed     | f32   | 0.25      | 0…2             | Camera    | Camera orbit speed in radians per second.                                                        |
| msaa      | enum  | "4x"      | off, 4x         | Rendering | Single sample or four-sample depth-tested rendering with HDR resolve.                            |
| tint      | color | "#56c7dd" | —               | Material  | Linearized base material colour.                                                                 |
| count     | u32   | 4096      | 1…65536         | Geometry  | Actual indexed mesh instance count, arranged on a square grid.                                   |
| height    | f32   | 1.8       | 0…4             | Geometry  | Seeded vertex-stage noise displacement amplitude.                                                |
| scale     | f32   | 0.15      | 0.02…0.4        | Geometry  | Half size of each cube.                                                                          |
| draw      | enum  | "bundle"  | direct, bundle  | Rendering | Direct indexed instancing or reusable render bundle encoding.                                    |
| occlusion | bool  | true      | —               | Rendering | Query visible samples and a second identical depth-occluded draw; results appear in buffer taps. |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded on the development Apple M1 Max / macOS 26.6.2 using the production preview. Typed defaults, seed 7, physical 512² display, DPR 1, 4x MSAA and fixed quality. Each of three runs discards 30 warm-up updates then measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion and timestamp readback. Instances uses 4096 cubes, a render bundle and both occlusion probes; terrain uses a 128²-cell indexed grid; material-ball uses owned 64² GGX environment cubes; glass captures and composites a full-size scene. Initial environment convolution and terrain height generation are excluded from the steady-state sample window.

| Browser              | CPU mean ms           | Completion p95 ms     | Summed GPU pass p95 ms | rAF median ms            | Record                               |
| -------------------- | --------------------- | --------------------- | ---------------------- | ------------------------ | ------------------------------------ |
| chrome 154.0.8037.98 | 0.225 / 0.209 / 0.202 | 2.600 / 1.700 / 1.900 | 0.524 / 0.393 / 0.655  | 16.700 / 16.700 / 16.700 | [JSON](../benchmarks/m6-chrome.json) |
| webkit 26.6          | 0.267 / 0.250 / 0.283 | 5.000 / 5.000 / 4.000 | 1.702 / 2.055 / 1.320  | 17.000 / 17.000 / 17.000 | [JSON](../benchmarks/m6-webkit.json) |

CPU encoding, encoding-through-queue-completion wall latency, summed GPU pass timestamps and observed rAF cadence are separate measurements. Timestamp quantization and overlapping intervals limit interpretation; summed GPU time is not whole-frame elapsed time. Machine load is uncontrolled (other validation work may be running), logical allocations are not VRAM, and these measurements establish no cross-device refresh guarantee. The M6 exit is baseline capability coverage, not a speed threshold. Deterministic snapshots, CPU references and lifecycle tests establish separate correctness properties; see [M6 validation](../m6.md).

<!-- measurements:end -->

## Failure modes

Draw cost and overdraw increase with actual count; the repeated query draw doubles vertex work when enabled. Logical attachment accounting excludes query-set driver storage.

## Production readiness

Frustum culling and native touch camera controls remain future research.
