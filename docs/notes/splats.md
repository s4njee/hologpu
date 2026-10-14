# GPU sorted anisotropic Gaussian splats (`splats`)

## Question

Does the GPU sort primitive produce correct transparency on projected anisotropic 3D data?

## Technique summary

A seeded procedural 3D helix supplies means, colors and three covariance axes. A perspective Jacobian projects each covariance; the inverse conic controls a 3-sigma Gaussian footprint. Positive view-depth bits are inverted and stably radix-sorted so premultiplied source-over draws run back to front.

## References

- [Primary technique reference](https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/)
- [WebGPU specification](https://gpuweb.github.io/gpuweb/)

## Passes and resources

Initialization writes 80-byte world splats. Per presentation, compute writes projected means, conics, colors and extents, builds depth keys, sorts key/value pairs, then draws alpha-over instanced quads. Source-order mode intentionally exposes compositing errors. Taps expose source/projected data and sorted keys/IDs.

## WebGPU features used

Native storage/compute/render pipelines and float data. No optional GPU feature is required for the portable rendering path. Backdrop DOM capture additionally requires the experimental queue API, detected separately from GPUFeatureName.

## Parameters (generated)

<!-- params:start -->

| Parameter | Type | Default  | Range / choices | Group     | Description                                                                        |
| --------- | ---- | -------- | --------------- | --------- | ---------------------------------------------------------------------------------- |
| count     | u32  | 2048     | 16…16384        | Workload  | Procedural 3D Gaussian samples (no trained asset loader).                          |
| size      | f32  | 1        | 0.3…3           | Display   | World-space covariance scale.                                                      |
| opacity   | f32  | 0.4      | 0.02…0.95       | Display   | Peak Gaussian alpha, before overlap compositing.                                   |
| speed     | f32  | 0.2      | 0…1             | Camera    | Camera orbit speed in radians per second.                                          |
| angle     | f32  | 0        | -3.14…3.14      | Camera    | Additional yaw.                                                                    |
| order     | enum | "sorted" | sorted, source  | Rendering | GPU back-to-front depth sorting versus source order to expose transparency errors. |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded on the development Apple M1 Max / macOS 26.6.2 using the production preview. Typed defaults, seed 7, physical 512² output, DPR 1 and fixed quality. Three runs per engine; each discards 30 warm-up updates and measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion and timestamp readback. The actual defaults are 1024 material points on a 32² grid, 256 PBF particles with three constraint iterations, 96² D2Q9 with four ticks, one path/pixel/update through seven spheres, and 2048 sorted Gaussian splats. Backdrop glass uses the explicitly labeled owned texture preview; these rows exclude experimental DOM capture.

| Browser              | CPU mean ms           | Completion p95 ms      | Summed GPU pass p95 ms | rAF median ms            | Record                               |
| -------------------- | --------------------- | ---------------------- | ---------------------- | ------------------------ | ------------------------------------ |
| chrome 154.0.8037.98 | 0.288 / 0.291 / 0.280 | 3.500 / 4.800 / 4.800  | 1.769 / 3.539 / 3.473  | 16.700 / 16.700 / 16.700 | [JSON](../benchmarks/m7-chrome.json) |
| webkit 26.6          | 0.300 / 0.467 / 0.458 | 7.000 / 10.000 / 8.000 | 2.992 / 3.323 / 3.254  | 17.000 / 17.000 / 17.000 | [JSON](../benchmarks/m7-webkit.json) |

CPU encoding, queue-completion latency, summed GPU timestamps and rAF cadence have different boundaries. Timestamp precision and overlapping intervals limit interpretation; the sum is not whole-frame elapsed time. Initialization/compilation and a separate untimed 150-update numerical reproduction are excluded from timings. That reproduction checks every f32 tap value for finiteness. Machine load is uncontrolled and logical allocations are not VRAM. These are bounded research workloads, not a refresh guarantee on other devices. See [M7 validation](../m7.md) for numerical references, browser gaps and remaining stretches.

<!-- measurements:end -->

## Failure modes

This is a procedural Gaussian viewer, not trained radiance-field reconstruction: no PLY loader, spherical harmonics, tiled binning or differentiable optimization. Sorting only by center depth cannot resolve intersecting extents exactly. Pixel footprint regularization prevents singular conics.

## Production readiness

Research prototype. See [M7 validation](../m7.md) for numerical references, deterministic snapshots, device-loss checks, workload measurements and deferred stretches.
