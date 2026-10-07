# Prefix sum and stream compaction (`prefix-sum`)

## Question

Can an exclusive scan retain exact unsigned offsets across workgroup boundaries and provide deterministic particle allocation?

## Technique summary

The implementation scans 256-element workgroups in shared memory, recursively scans block sums, and adds block offsets. Arithmetic wraps modulo 2^32. A separate normalization pass maps every nonzero flag to one, followed by a stable scatter of original row IDs and a GPU-resident selected count. The demo compares original flags, cumulative offsets, and compacted IDs on a tiled field. This is a WGSL implementation of the hierarchical scan pattern, with Hillis–Steele local scans, rather than a CUDA port.

## References

[Harris, Sengupta and Owens, GPU Gems 3, chapter 39](https://developer.nvidia.com/gpugems/gpugems3/part-vi-gpu-computing/chapter-39-parallel-prefix-sum-scan-cuda). Algorithms are adapted to explicit WebGPU compute passes and owned resources; shader code is written for this repository.

## Passes and resources

Initialization, local scans at each hierarchy level, offset addition, flag normalization, compact scatter, and display. Caller-owned input feeds private output/sum/normalized-flag/index/count buffers. Uniform arguments are immutable per tuple; shader/pipeline leases and all buffers are released on disposal.

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

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded on the development Apple M1 Max / macOS 26.6.2 using the production preview and the same fixed-scenario runner as the Profiler drawer. Physical display is 512² at DPR 1, seed 7, fixed resolution/work quality. Defaults are retained except million-particle gate rows set count to exactly 1,000,000 and select point or instanced-quad drawing. Each of three runs discards 30 warm-up updates and measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion and timestamp readback.

| Browser              | Rendering / allocation controls | CPU mean ms           | Completion p95 ms     | Summed GPU pass p95 ms | rAF median ms            | Million-particle gate | Record                               |
| -------------------- | ------------------------------- | --------------------- | --------------------- | ---------------------- | ------------------------ | --------------------- | ------------------------------------ |
| chrome 154.0.8037.98 | compute; count=4096             | 0.272 / 0.241 / 0.313 | 3.900 / 3.500 / 4.200 | 3.342 / 1.835 / 2.490  | 16.700 / 16.700 / 16.700 | —                     | [JSON](../benchmarks/m3-chrome.json) |
| webkit 26.6          | compute; count=4096             | 0.550 / 0.583 / 0.350 | 5.000 / 6.000 / 4.000 | 3.536 / 3.650 / 3.635  | 16.000 / 16.000 / 16.000 | —                     | [JSON](../benchmarks/m3-webkit.json) |

GPU columns use actual pass-boundary timestamp queries when available; values are implementation-defined and may be quantized. Pass intervals may overlap; their sum is a diagnostic rather than whole-frame execution time. These captures include summed intervals larger than queue-completion wall latency, so the columns must not be substituted for one another. CPU encode, queue-completion wall latency and rAF cadence remain separate. The million-particle gate verifies actual storage count, both draw paths, all 150 fixed updates and no GPU errors; M3 specifies particle count rather than a refresh-rate threshold. Machine load is uncontrolled. Logical allocations are not VRAM. Initialization/compilation are excluded. Small deterministic software snapshots and CPU-reference GPU tests establish separate numerical/lifecycle properties, not million-particle speed.

<!-- measurements:end -->

The M3 benchmark records the exact workload, browser/device, logical resource bytes and timing method. CPU encoding and queue completion are distinct from optional GPU timestamp measurements.

## Failure modes

Unsigned sums intentionally wrap; consumers needing wider offsets must reject overflowing workloads. Repeated calls overwrite scratch/results. GPU selected counts stay on the GPU; buffer inspection reads them only on explicit capture.

## Production readiness

M3 numerical coverage compares GPU results with CPU references, including boundary sizes and adversarial values, independently of deterministic visual snapshots and two presets. All resources have explicit ownership and disposal. Hardware measurements accompany this milestone; broader multi-device catalogue compatibility remains in M8.
