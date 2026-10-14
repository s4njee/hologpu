# Progressive BVH path tracer (`path-tracer`)

## Question

How does compute-only progressive rendering fit the fixed-step contract and paused DOM surfaces?

## Technique summary

A seven-sphere scene uses a median-split CPU BVH packed into storage buffers. GPU stack traversal finds analytic sphere intersections. Seeded subpixel jitter, cosine-weighted Lambertian scattering, one ideal mirror and emissive/sky light contribute radiance. Each pixel stores an f32 radiance sum and path count.

## References

- [Primary technique reference](https://pbr-book.org/4ed/Light_Transport_I_Surface_Reflection/A_Simple_Path_Tracer)
- [WebGPU specification](https://gpuweb.github.io/gpuweb/)

## Passes and resources

Compute dispatches add paths only on initialization or fixed updates. A fullscreen resolve divides by exact sample count and tone maps. Camera/material/bounce changes clear accumulated paths; exposure changes retain them. Size changes and device recovery rebuild storage. A separate unjittered-primary-hit tap supports a brute-force CPU reference.

## WebGPU features used

Native storage/compute/render pipelines and float data. No optional GPU feature is required for the portable rendering path. Backdrop DOM capture additionally requires the experimental queue API, detected separately from GPUFeatureName.

## Parameters (generated)

<!-- params:start -->

| Parameter | Type | Default | Range / choices | Group    | Description                                                         |
| --------- | ---- | ------- | --------------- | -------- | ------------------------------------------------------------------- |
| samples   | u32  | 1       | 1…4             | Workload | Paths added per pixel per fixed update.                             |
| bounces   | u32  | 4       | 1…8             | Workload | Maximum diffuse/specular path segments.                             |
| angle     | f32  | 0       | -3.14…3.14      | Camera   | Static camera yaw; changing the camera clears accumulated radiance. |
| material  | enum | "mixed" | mixed, diffuse  | Material | Ideal mirror on the right sphere, or all Lambertian spheres.        |
| exposure  | f32  | 1.2     | 0.1…4           | Display  | Exposure after averaging; changing it retains the accumulation.     |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded on the development Apple M1 Max / macOS 26.6.2 using the production preview. Typed defaults, seed 7, physical 512² output, DPR 1 and fixed quality. Three runs per engine; each discards 30 warm-up updates and measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion and timestamp readback. The actual defaults are 1024 material points on a 32² grid, 256 PBF particles with three constraint iterations, 96² D2Q9 with four ticks, one path/pixel/update through seven spheres, and 2048 sorted Gaussian splats. Backdrop glass uses the explicitly labeled owned texture preview; these rows exclude experimental DOM capture.

| Browser              | CPU mean ms           | Completion p95 ms     | Summed GPU pass p95 ms | rAF median ms            | Record                               |
| -------------------- | --------------------- | --------------------- | ---------------------- | ------------------------ | ------------------------------------ |
| chrome 154.0.8037.98 | 0.184 / 0.208 / 0.194 | 2.400 / 2.500 / 2.400 | 2.884 / 2.753 / 2.753  | 16.700 / 16.700 / 16.700 | [JSON](../benchmarks/m7-chrome.json) |
| webkit 26.6          | 0.325 / 0.267 / 0.258 | 6.000 / 5.000 / 5.000 | 5.888 / 4.524 / 5.759  | 17.000 / 17.000 / 17.000 | [JSON](../benchmarks/m7-webkit.json) |

CPU encoding, queue-completion latency, summed GPU timestamps and rAF cadence have different boundaries. Timestamp precision and overlapping intervals limit interpretation; the sum is not whole-frame elapsed time. Initialization/compilation and a separate untimed 150-update numerical reproduction are excluded from timings. That reproduction checks every f32 tap value for finiteness. Machine load is uncontrolled and logical allocations are not VRAM. These are bounded research workloads, not a refresh guarantee on other devices. See [M7 validation](../m7.md) for numerical references, browser gaps and remaining stretches.

<!-- measurements:end -->

## Failure modes

No next-event estimation, MIS, denoising, mesh loading or hardware ray-tracing API. Finite bounce truncation and a small scene keep the experiment bounded. Initialization contributes one samples-sized batch even when paused; reduced motion shows that deterministic initial estimate.

## Production readiness

Research prototype. See [M7 validation](../m7.md) for numerical references, deterministic snapshots, device-loss checks, workload measurements and deferred stretches.
