# Jump-flood distance fields (`jump-flood`)

## Question

Can a reusable GPU mask-to-distance transform serve outlines, Voronoi inspection and 2D lighting without readback?

## Technique summary

[Rong and Tan's original JFA paper](https://www.comp.nus.edu.sg/~tants/jfa/i3d06-submitted.pdf) introduces approximate nearest-seed propagation with successively smaller jumps. This implementation uses JFA+1: a nine-neighbor candidate search at power-of-two strides followed by an extra stride-one pass. Equal squared distances choose the smallest row-major seed coordinate, making ties reproducible.

The reusable `createJumpFlood(session, [width,height])` helper borrows a sampled float mask. In boundary mode both sides of every eight-neighbor occupancy transition seed the field; pixels outside the texture count as empty. Occupied-seed mode seeds every filled pixel. Nearest seed coordinates occupy rg32float, invalid coordinates are (-1,-1), and signed Euclidean pixel distance occupies r32float. Negative distance denotes occupied pixels. An empty seed set uses the finite texture diagonal as distance. Distances are to boundary pixel centers rather than a subpixel contour.

## References

[Rong and Tan, Jump Flooding in GPU with Applications to Voronoi Diagram and Distance Transform (2006)](https://www.comp.nus.edu.sg/~tants/jfa/i3d06-submitted.pdf).

## Passes and resources

A scene-mask pass resamples a connected linear-premultiplied `image` or `text-mask` input using alpha or luminance. Without one, a CPU-rasterized HGPU text mask and deterministic block/empty/solid fixtures are available. `setInput('text', string)` rerasterizes the local fallback; `setInput('rects', [[x,y,width,height], ...])` merges up to 64 normalized obstacles. The reusable helper then seeds, jumps between two rg32float textures and resolves signed distance. The fullscreen display selects outline/glow, signed distance or hashed nearest-seed Voronoi colors. Intermediate scene, nearest and distance taps are inspectable.

The helper owns 20 bytes per grid pixel: two eight-byte nearest textures and one four-byte distance texture. It also owns bounded per-stride uniform buffers and shader leases. Encode once per helper per submitted workload because outputs and argument storage are reused. Input textures remain borrowed. Grid changes synchronously resize the helper and owned mask resources; disposal is idempotent and reports zero owned bytes.

## WebGPU features used

Baseline compute, rgba16float scene storage, rg32float/r32float storage textures and sampled texture loads. No optional feature is required. Resolution quality affects presentation, while the explicit grid parameter controls distance work. Paused and reduced-motion rendering is a static recomputation without feedback. A radial CSS gradient supplies the fallback.

## Parameters (generated)

<!-- params:start -->

| Parameter  | Type  | Default   | Range / choices            | Group   | Description                                                                          |
| ---------- | ----- | --------- | -------------------------- | ------- | ------------------------------------------------------------------------------------ |
| grid       | u32   | 128       | 32…256                     | Quality | Square pixel-space mask and distance-field resolution.                               |
| scene      | enum  | "text"    | text, blocks, empty, solid | Scene   | Built-in deterministic mask when no image or text-mask input is connected.           |
| channel    | enum  | "alpha"   | alpha, luminance           | Scene   | Connected mask occupancy from alpha or premultiplied linear luminance.               |
| threshold  | f32   | 0.5       | 0…1                        | Scene   | Mask occupancy threshold after input resampling.                                     |
| tint       | color | "#efb77b" | —                          | Palette | Linear light or outline colour.                                                      |
| background | color | "#101829" | —                          | Palette | Linear unlit background colour.                                                      |
| view       | enum  | "outline" | outline, distance, voronoi | Display | Boundary outline/glow, signed pixel distance, or nearest-boundary Voronoi colouring. |
| width      | f32   | 1         | 0…16                       | Display | Outline half-width in mask-grid pixels.                                              |
| glow       | f32   | 4         | 0.1…32                     | Display | Exponential glow falloff distance.                                                   |

<!-- params:end -->

Two presets select a compact teal outline and a higher-resolution block Voronoi view.

## Measurements

<!-- measurements:start -->

Recorded on the development Apple M1 Max / macOS 26.6.2 using the production preview. Defaults, seed 7, physical 512² display, DPR 1 and fixed resolution/work quality. Each of three runs discards 30 warm-up updates then measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion and timestamp readback. Filter defaults use their owned deterministic linear HDR test card; lighting uses its documented scene and grid.

| Browser              | CPU mean ms           | Completion p95 ms     | Summed GPU pass p95 ms | rAF median ms            | Record                               |
| -------------------- | --------------------- | --------------------- | ---------------------- | ------------------------ | ------------------------------------ |
| chrome 154.0.8037.98 | 0.415 / 0.443 / 0.342 | 4.200 / 4.100 / 4.500 | 1.769 / 1.376 / 1.638  | 16.700 / 16.700 / 16.700 | [JSON](../benchmarks/m4-chrome.json) |
| webkit 26.6          | 0.450 / 0.550 / 0.500 | 8.000 / 8.000 / 7.000 | 5.252 / 5.497 / 6.140  | 17.000 / 17.000 / 17.000 | [JSON](../benchmarks/m4-webkit.json) |

CPU encode, queue-completion wall latency and rAF cadence measure different boundaries. GPU columns are sums of actual pass timestamps when supported; quantization and overlapping intervals can make their sum exceed completion latency. They are a diagnostic rather than whole-frame elapsed time. Initialization and compilation are excluded, machine load is uncontrolled, and allocation sizes are logical rather than VRAM. The separate [M4 video-chain gate](../m4.md) uses a genuinely decoded 1920×1080 clip, four filters and full-size intermediates, with a measured idle-refresh baseline. Small software snapshots and CPU-reference hardware tests verify numerical/lifecycle properties separately from speed.

<!-- measurements:end -->

## Failure modes

JFA is approximate, including JFA+1; isolated configurations can select a non-nearest seed. Brute-force fixture comparisons cover odd dimensions, empty/full masks, signed boundaries and deterministic ties, rather than proving exactness for every mask. Pixel-center boundaries produce a one-pixel band of zero distance and do not represent analytic antialiasing. Nearest input resampling deliberately preserves occupancy rather than smoothing tiny mask features.

## Production readiness

This helper is reusable by both lighting effects. A production exact-distance requirement would need an exact transform or a quantified error bound. DOM element tracking remains M5; the normalized rectangle data hook does not attach observers to real DOM nodes.
