# Uniform spatial grid (`spatial-hash`)

## Question

Can a uniform grid construct stable neighbor ranges without dropping particles at cell boundaries or in empty cells?

## Technique summary

Normalized packed vec4 positions become integer cell keys. The builder counts cells atomically, stably sorts key/row pairs using the radix primitive, and scans counts into exclusive ranges. The extra final offset equals the particle count. xy mode ignores packed velocity channels; xyz mode builds a volume grid. Grid dimensions can change synchronously within a declared maximum cell capacity. The demo shows counts, generated keys, and sorted row IDs.

## References

[Green, NVIDIA CUDA particles sample and spatial subdivision](https://developer.download.nvidia.com/assets/cuda/files/particles.pdf), [GPU Gems 3 scan](https://developer.nvidia.com/gpugems/gpugems3/part-vi-gpu-computing/chapter-39-parallel-prefix-sum-scan-cuda). Algorithms are adapted to explicit WebGPU compute passes and owned resources; shader code is written for this repository.

## Passes and resources

Clear counts, key/ID assignment with atomic histogram, stable radix sorting, count scan, range copy, then display. Public buffers include sorted keys, sorted indices, cell counts, and cell offsets. Packed input positions are caller-owned. Private sort/scan storage and immutable grid arguments are disposed with the builder.

## WebGPU features used

Baseline compute shaders, workgroup barriers, storage buffers or storage textures, and copy/readback for explicit inspection. No required optional GPU feature. Runtime timestamp queries are optional. The effect declares a time-zero reduced-motion pose and CSS fallback.

## Parameters (generated)

<!-- params:start -->

| Parameter  | Type  | Default   | Range / choices        | Group      | Description                                                                          |
| ---------- | ----- | --------- | ---------------------- | ---------- | ------------------------------------------------------------------------------------ |
| count      | u32   | 4096      | 16…1048576             | Workload   | Number of unsigned elements or grid points; changing the workload reseeds it.        |
| threshold  | f32   | 0.5       | 0…1                    | Workload   | Nonzero selection probability for scan/compaction, or extent of generated sort keys. |
| view       | enum  | "result"  | result, input, indices | Inspection | Show algorithm output, original input, or associated sorted/compacted row IDs.       |
| tint       | color | "#c2e8a6" | —                      | Palette    | Algorithm result accent color.                                                       |
| background | color | "#12202b" | —                      | Palette    | Opaque comparison panel background.                                                  |
| grid       | u32   | 32        | 4…64                   | Workload   | Uniform grid dimensions along both normalized position axes.                         |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded on the development Apple M1 Max / macOS 26.6.2 using the production preview and the same fixed-scenario runner as the Profiler drawer. Physical display is 512² at DPR 1, seed 7, fixed resolution/work quality. Defaults are retained except million-particle gate rows set count to exactly 1,000,000 and select point or instanced-quad drawing. Each of three runs discards 30 warm-up updates and measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion and timestamp readback.

| Browser              | Rendering / allocation controls | CPU mean ms           | Completion p95 ms      | Summed GPU pass p95 ms   | rAF median ms            | Million-particle gate | Record                               |
| -------------------- | ------------------------------- | --------------------- | ---------------------- | ------------------------ | ------------------------ | --------------------- | ------------------------------------ |
| chrome 154.0.8037.98 | compute; count=4096, grid=32    | 0.445 / 0.332 / 0.472 | 6.400 / 4.900 / 5.800  | 6.881 / 7.274 / 6.881    | 16.700 / 16.700 / 16.700 | —                     | [JSON](../benchmarks/m3-chrome.json) |
| webkit 26.6          | compute; count=4096, grid=32    | 0.525 / 0.525 / 0.700 | 8.000 / 8.000 / 10.000 | 10.601 / 10.736 / 10.290 | 16.000 / 16.000 / 16.000 | —                     | [JSON](../benchmarks/m3-webkit.json) |

GPU columns use actual pass-boundary timestamp queries when available; values are implementation-defined and may be quantized. Pass intervals may overlap; their sum is a diagnostic rather than whole-frame execution time. These captures include summed intervals larger than queue-completion wall latency, so the columns must not be substituted for one another. CPU encode, queue-completion wall latency and rAF cadence remain separate. The million-particle gate verifies actual storage count, both draw paths, all 150 fixed updates and no GPU errors; M3 specifies particle count rather than a refresh-rate threshold. Machine load is uncontrolled. Logical allocations are not VRAM. Initialization/compilation are excluded. Small deterministic software snapshots and CPU-reference GPU tests establish separate numerical/lifecycle properties, not million-particle speed.

<!-- measurements:end -->

The M3 benchmark records the exact workload, browser/device, logical resource bytes and timing method. CPU encoding and queue completion are distinct from optional GPU timestamp measurements.

## Failure modes

The builder clamps external coordinates; periodic callers wrap their own query coordinates. Large occupancy can make an exact neighbor query expensive despite a correct grid. Capacity and maximum grid cells are explicit and bounded by storage/dispatch limits.

## Production readiness

M3 numerical coverage compares GPU results with CPU references, including boundary sizes and adversarial values, independently of deterministic visual snapshots and two presets. All resources have explicit ownership and disposal. Hardware measurements accompany this milestone; broader multi-device catalogue compatibility remains in M8.
