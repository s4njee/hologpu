# 2D and cube mip generation (`mipgen`)

## Question

Does GPU mip generation average every source texel, including odd dimensions, across 2D textures and all six cube faces?

## Technique summary

Each destination pixel integrates the area of source pixels covered by its normalized footprint. Overlap numerators use exact integer coordinates before float accumulation, avoiding fractional footprint rounding for odd dimensions. This matches ordinary 2×2 averaging for even dimensions and gives fractional boundary weights for odd dimensions. Successive levels run in separate compute passes, independently for each array layer. The demo compares level zero with a selected mip and can show all six cube faces. Filtering operates in the stored linear color space.

## References

[WebGPU texture and texture-view specification](https://www.w3.org/TR/webgpu/#textures). Algorithms are adapted to explicit WebGPU compute passes and owned resources; shader code is written for this repository.

## Passes and resources

Seeded checkerboard initialization writes level zero. The reusable mip primitive writes every lower level for each face, and display selects a level with integer texture loads. All levels/faces are texture taps. The primitive owns pipelines only; the demo owns and disposes the complete rgba16float mip chain.

## WebGPU features used

Baseline compute shaders, workgroup barriers, storage buffers or storage textures, and copy/readback for explicit inspection. No required optional GPU feature. Runtime timestamp queries are optional. The effect declares a time-zero reduced-motion pose and CSS fallback.

## Parameters (generated)

<!-- params:start -->

| Parameter  | Type  | Default   | Range / choices | Group      | Description                                                                        |
| ---------- | ----- | --------- | --------------- | ---------- | ---------------------------------------------------------------------------------- |
| size       | u32   | 256       | 16…512          | Texture    | Base texture dimensions; all levels down to 1×1 are generated on GPU.              |
| shape      | enum  | "2d"      | 2d, cube        | Texture    | A two-dimensional texture or all six independent faces of a cube-compatible array. |
| level      | u32   | 3         | 0…9             | Inspection | Mip level shown in the right comparison panel, clamped to the available chain.     |
| frequency  | f32   | 48        | 2…128           | Pattern    | Checkerboard spatial frequency, exposing how lower mips suppress aliasing.         |
| tint       | color | "#efcba0" | —               | Palette    | Checkerboard bright color.                                                         |
| background | color | "#123046" | —               | Palette    | Checkerboard dark color.                                                           |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded on the development Apple M1 Max / macOS 26.6.2 using the production preview and the same fixed-scenario runner as the Profiler drawer. Physical display is 512² at DPR 1, seed 7, fixed resolution/work quality. Defaults are retained except million-particle gate rows set count to exactly 1,000,000 and select point or instanced-quad drawing. Each of three runs discards 30 warm-up updates and measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion and timestamp readback.

| Browser              | Rendering / allocation controls | CPU mean ms           | Completion p95 ms     | Summed GPU pass p95 ms | rAF median ms            | Million-particle gate | Record                               |
| -------------------- | ------------------------------- | --------------------- | --------------------- | ---------------------- | ------------------------ | --------------------- | ------------------------------------ |
| chrome 154.0.8037.98 | compute; size=256, shape="2d"   | 0.317 / 0.267 / 0.265 | 4.900 / 4.100 / 4.400 | 1.638 / 1.114 / 1.311  | 16.700 / 16.700 / 16.700 | —                     | [JSON](../benchmarks/m3-chrome.json) |
| webkit 26.6          | compute; size=256, shape="2d"   | 0.458 / 0.250 / 0.458 | 7.000 / 5.000 / 6.000 | 3.720 / 3.745 / 4.020  | 16.000 / 16.000 / 16.000 | —                     | [JSON](../benchmarks/m3-webkit.json) |

GPU columns use actual pass-boundary timestamp queries when available; values are implementation-defined and may be quantized. Pass intervals may overlap; their sum is a diagnostic rather than whole-frame execution time. These captures include summed intervals larger than queue-completion wall latency, so the columns must not be substituted for one another. CPU encode, queue-completion wall latency and rAF cadence remain separate. The million-particle gate verifies actual storage count, both draw paths, all 150 fixed updates and no GPU errors; M3 specifies particle count rather than a refresh-rate threshold. Machine load is uncontrolled. Logical allocations are not VRAM. Initialization/compilation are excluded. Small deterministic software snapshots and CPU-reference GPU tests establish separate numerical/lifecycle properties, not million-particle speed.

<!-- measurements:end -->

The M3 benchmark records the exact workload, browser/device, logical resource bytes and timing method. CPU encoding and queue completion are distinct from optional GPU timestamp measurements.

## Failure modes

This box kernel does not implement cross-face seam filtering, sRGB conversion, or normal renormalization. Supported formats are explicitly linear storage formats. Half-float quantization remains visible at low contrast; CPU-reference tests use rgba32float to isolate averaging error.

## Production readiness

M3 numerical coverage compares GPU results with CPU references, including boundary sizes and adversarial values, independently of deterministic visual snapshots and two presets. All resources have explicit ownership and disposal. Hardware measurements accompany this milestone; broader multi-device catalogue compatibility remains in M8.
