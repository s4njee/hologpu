# 2D radiance cascades (`radiance-cascades`)

## Question

Can a distance/angular hierarchy provide immediate 2D indirect light with inspectable memory and merge behavior?

## Technique summary

[Sannikov's original paper source](https://github.com/Raikiri/RadianceCascadesPaper/blob/main/RadianceCascades.tex) motivates hierarchical radiance intervals with spatial and angular resolution selected according to distance. This implementation is a small, deterministic 2D realization of that idea.

Cascade zero places one probe per four mask pixels, with four directional sectors. Each subsequent level doubles probe spacing and quadruples angular sectors. Level L covers the disjoint interval `[interval × (4^L−1)/3, interval × (4^(L+1)−1)/3]`. A texel stores RGB radiance and scalar transmittance. Rays trace the signed-distance scene over their own interval, stop at opaque/emissive cells, and accumulate environment light when they leave the domain.

Descending from the outermost level, four angular child rays are averaged and coarse probes are bilinearly interpolated. The merge is `(nearRadiance + nearTransmittance × farRadiance, nearTransmittance × farTransmittance)`. Four base sectors integrate into an irradiance texture. One to three complete hierarchy sweeps run in a single render; later sweeps add previous irradiance times diffuse albedo at a wall hit. Every render starts with a sweep that ignores history, so paused, seeded and reduced-motion output remains deterministic.

## References

[Alexander Sannikov, Radiance Cascades paper source](https://github.com/Raikiri/RadianceCascadesPaper/blob/main/RadianceCascades.tex). This implementation uses ordinary bilinear probe merging; it does not implement the paper's more advanced interpolation/leak correction variants.

## Passes and resources

A mask/emission pass combines connected alpha/luminance masks or deterministic blocks/text with two coloured emissive disks. Rectangle and local text hooks match `shadows-2d`. Empty and solid fixtures omit the disks. The shared JFA+1 produces the signed distance field.

Four rgba16float cascade atlases hold probes along the vertical axis and probe×direction slots along the horizontal axis. For grid G, level L uses `max(1, (G/4)>>L)` probes per axis and `4×4^L` directions; each level has the same ray count over the allowed grid sizes. All four atlases are allocated so level edits require no asynchronous rebuild. Two full-grid rgba16float irradiance textures support deterministic diffuse sweeps. Each sweep dispatches active levels from coarse to fine, followed by one integrate pass. Scene, nearest, distance, all four cascade atlases and both irradiance textures are exposed as raw taps. The fullscreen pass applies exposure and Reinhard tone mapping.

## WebGPU features used

Baseline compute and float sampled/storage textures with explicit pass boundaries. No optional feature is required. Logical memory includes all atlas and scratch allocations, uniforms and rectangles. Grid edits resize synchronously; disposal releases every owned object. Display quality changes presentation rather than dropping angular rays. Reduced motion is a static recomputation and the CSS fallback has two coloured radial lights.

## Parameters (generated)

<!-- params:start -->

| Parameter   | Type  | Default   | Range / choices            | Group    | Description                                                                                                |
| ----------- | ----- | --------- | -------------------------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| grid        | u32   | 128       | 32…256                     | Quality  | Square pixel-space mask and distance-field resolution.                                                     |
| scene       | enum  | "blocks"  | text, blocks, empty, solid | Scene    | Built-in deterministic mask when no image or text-mask input is connected.                                 |
| channel     | enum  | "alpha"   | alpha, luminance           | Scene    | Connected mask occupancy from alpha or premultiplied linear luminance.                                     |
| threshold   | f32   | 0.5       | 0…1                        | Scene    | Mask occupancy threshold after input resampling.                                                           |
| tint        | color | "#efb77b" | —                          | Palette  | Linear light or outline colour.                                                                            |
| background  | color | "#101829" | —                          | Palette  | Linear unlit background colour.                                                                            |
| view        | enum  | "light"   | light, radiance, distance  | Display  | Tone-mapped diffuse light, integrated radiance, or signed-distance diagnostic.                             |
| levels      | u32   | 4         | 1…4                        | Cascades | Hierarchy depth; each level halves spatial probes and quadruples angular rays and interval length.         |
| interval    | f32   | 4         | 1…8                        | Cascades | First distance interval length; farther disjoint intervals grow by four.                                   |
| bounces     | u32   | 2         | 1…3                        | Cascades | Deterministic radiance sweeps; later sweeps add diffuse wall response from the preceding irradiance field. |
| albedo      | f32   | 0.65      | 0…0.9                      | Material | Diffuse wall reflectance applied once per additional sweep.                                                |
| environment | color | "#080c16" | —                          | Light    | Linear boundary/environment radiance.                                                                      |
| exposure    | f32   | 1.5       | 0.1…6                      | Display  | Exposure before bounded Reinhard presentation.                                                             |

<!-- params:end -->

The low preset uses three levels and one sweep. The bounce preset increases grid resolution, hierarchy depth and diffuse sweeps.

## Measurements

<!-- measurements:start -->

Recorded on the development Apple M1 Max / macOS 26.6.2 using the production preview. Defaults, seed 7, physical 512² display, DPR 1 and fixed resolution/work quality. Each of three runs discards 30 warm-up updates then measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion and timestamp readback. Filter defaults use their owned deterministic linear HDR test card; lighting uses its documented scene and grid.

| Browser              | CPU mean ms           | Completion p95 ms      | Summed GPU pass p95 ms | rAF median ms            | Record                               |
| -------------------- | --------------------- | ---------------------- | ---------------------- | ------------------------ | ------------------------------------ |
| chrome 154.0.8037.98 | 0.506 / 0.543 / 0.569 | 5.700 / 4.800 / 6.000  | 3.539 / 3.080 / 5.702  | 16.700 / 16.700 / 16.700 | [JSON](../benchmarks/m4-chrome.json) |
| webkit 26.6          | 0.600 / 0.642 / 0.425 | 7.000 / 9.000 / 10.000 | 8.010 / 8.526 / 8.318  | 17.000 / 17.000 / 17.000 | [JSON](../benchmarks/m4-webkit.json) |

CPU encode, queue-completion wall latency and rAF cadence measure different boundaries. GPU columns are sums of actual pass timestamps when supported; quantization and overlapping intervals can make their sum exceed completion latency. They are a diagnostic rather than whole-frame elapsed time. Initialization and compilation are excluded, machine load is uncontrolled, and allocation sizes are logical rather than VRAM. The separate [M4 video-chain gate](../m4.md) uses a genuinely decoded 1920×1080 clip, four filters and full-size intermediates, with a measured idle-refresh baseline. Small software snapshots and CPU-reference hardware tests verify numerical/lifecycle properties separately from speed.

<!-- measurements:end -->

## Failure modes

Four base directions alias small lights, ordinary coarse-probe bilinear interpolation can leak through nearby barriers, and the approximate JFA field can skip thin geometry. Far probes use domain-clamped spatial interpolation. Radiance is bounded to 16 per channel; this intentional finite cap sacrifices extreme HDR energy. Diffuse sweeps are a finite iteration approximation rather than a converged transport solve. Tests prove constant-environment preservation at all levels, interval/atlas dimensions, zero response without sources, reduced red-light transport across a full-height wall, increased energy with additional diffuse sweeps and finite bounded nonconstant emitter response; they do not establish an unbiased physical solution.

## Production readiness

This is an actual hierarchical interval/angular radiance implementation with transmittance merging and diffuse iteration, not a screen-space blur. Higher angular quadrature, rigorous visibility/leak tests and reference-render error studies would be needed before a production GI claim. The exposed atlases and independent interval/level controls make those trade-offs measurable.
