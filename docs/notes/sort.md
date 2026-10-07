# Stable radix and bitonic sorting (`sort`)

## Question

Can both sorting algorithms preserve arbitrary associated values and original order for equal full-width unsigned keys?

## Technique summary

Radix sort performs eight four-bit passes. Each workgroup stably partitions its 256-element tile by four successive bits, writes a digit-major histogram, scans that histogram globally, and scatters its sorted tile into global offsets. Bitonic sorting pads to a power of two and compares key then original row index, including maximum-u32 real keys ahead of padding. The view selector shows input, sorted key, or associated row ID. Both algorithms produce ascending stable key/value pairs.

## References

[Kipfer and Westermann, GPU Gems 2, chapter 46](https://developer.nvidia.com/gpugems/gpugems2/part-vi-simulation-and-numerical-algorithms/chapter-46-improved-gpu-sorting), [GPU Gems 3 scan and radix discussion](https://developer.nvidia.com/gpugems/gpugems3/part-vi-gpu-computing/chapter-39-parallel-prefix-sum-scan-cuda). Algorithms are adapted to explicit WebGPU compute passes and owned resources; shader code is written for this repository.

## Passes and resources

Radix: local partition, recursive histogram scan, global scatter, repeated eight times. Bitonic: padded initialization and compare/exchange networks. Distinct scratch key/value sides and original-order indices avoid read/write aliasing. The visual demo owns both algorithm instances to switch without asynchronous rebuilding.

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
| algorithm  | enum  | "radix"   | radix, bitonic         | Workload   | Stable unsigned radix sort or padded bitonic sorting network.                        |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded on the development Apple M1 Max / macOS 26.6.2 using the production preview and the same fixed-scenario runner as the Profiler drawer. Physical display is 512² at DPR 1, seed 7, fixed resolution/work quality. Defaults are retained except million-particle gate rows set count to exactly 1,000,000 and select point or instanced-quad drawing. Each of three runs discards 30 warm-up updates and measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion and timestamp readback.

| Browser              | Rendering / allocation controls | CPU mean ms           | Completion p95 ms     | Summed GPU pass p95 ms   | rAF median ms            | Million-particle gate | Record                               |
| -------------------- | ------------------------------- | --------------------- | --------------------- | ------------------------ | ------------------------ | --------------------- | ------------------------------------ |
| chrome 154.0.8037.98 | compute; count=4096             | 0.450 / 0.377 / 0.393 | 5.800 / 5.100 / 5.000 | 5.046 / 5.243 / 5.112    | 16.700 / 16.700 / 16.700 | —                     | [JSON](../benchmarks/m3-chrome.json) |
| webkit 26.6          | compute; count=4096             | 0.542 / 0.592 / 0.567 | 9.000 / 9.000 / 8.000 | 10.192 / 10.096 / 10.171 | 16.000 / 16.000 / 16.000 | —                     | [JSON](../benchmarks/m3-webkit.json) |

GPU columns use actual pass-boundary timestamp queries when available; values are implementation-defined and may be quantized. Pass intervals may overlap; their sum is a diagnostic rather than whole-frame execution time. These captures include summed intervals larger than queue-completion wall latency, so the columns must not be substituted for one another. CPU encode, queue-completion wall latency and rAF cadence remain separate. The million-particle gate verifies actual storage count, both draw paths, all 150 fixed updates and no GPU errors; M3 specifies particle count rather than a refresh-rate threshold. Machine load is uncontrolled. Logical allocations are not VRAM. Initialization/compilation are excluded. Small deterministic software snapshots and CPU-reference GPU tests establish separate numerical/lifecycle properties, not million-particle speed.

<!-- measurements:end -->

The M3 benchmark records the exact workload, browser/device, logical resource bytes and timing method. CPU encoding and queue completion are distinct from optional GPU timestamp measurements.

## Failure modes

Bitonic pass count grows as log²N and its allocation rounds to a power of two. Radix is the particle-grid path. Equal keys remain stable, but associated values are opaque payloads rather than secondary sort keys.

## Production readiness

M3 numerical coverage compares GPU results with CPU references, including boundary sizes and adversarial values, independently of deterministic visual snapshots and two presets. All resources have explicit ownership and disposal. Hardware measurements accompany this milestone; broader multi-device catalogue compatibility remains in M8.
