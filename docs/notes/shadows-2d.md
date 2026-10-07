# SDF soft shadows (`shadows-2d`)

## Question

Can the same text/image distance field support bounded 2D shadow rays and a useful penumbra diagnostic?

## Technique summary

A mask receives the shared JFA+1 signed-distance transform. Each unoccupied receiver traces a segment toward a normalized point-light position. March length is clamped to 1–8 grid pixels, with a half-pixel hit threshold and a maximum of 256 iterations. A blocked ray returns zero visibility. An unfinished ray at the iteration limit conservatively returns zero, preventing an incomplete trace from reporting an unoccluded light.

Penumbra visibility accumulates `min(visibility, softness × max(distance,0) / rayTravel)`. This is an inexpensive geometric soft-shadow approximation; it is not an area-light integral. Inverse-quadratic normalized-distance falloff and linear light tint/intensity create the light field, followed by Reinhard presentation. The visibility mode bypasses colour attenuation so occlusion can be inspected directly in the raw light tap.

## References

The nearest-boundary propagation is based on [Rong and Tan's original JFA paper](https://www.comp.nus.edu.sg/~tants/jfa/i3d06-submitted.pdf). The segment tracer and penumbra bound above describe this repository's implementation choices.

## Passes and resources

Scene-mask creation accepts connected `image` or `text-mask` inputs and normalized rectangle arrays. The local text fallback can be replaced using `setInput('text', string)`. Up to 64 `[x,y,width,height]` rectangles can be supplied through `setInput('rects', rectangles)`; this is a data adapter, while live DOM tracking remains M5. Alpha/luminance occupancy and a threshold share the jump-flood schema.

The scene, nearest seed, signed distance and raw soft-shadow light taps are exposed. The shadow compute pass writes rgba16float linear colour (or visibility), and the fullscreen pass tone maps it. All work recomputes from the current mask, without temporal accumulation. Grid edits recreate mask/distance resources synchronously. Logical memory includes all owned scratch images, uniforms and the rectangle buffer; disposal releases textures, buffers and shader leases.

## WebGPU features used

Baseline compute, float storage and sampled textures, no optional features. Presentation quality spans 0.25–1; mask grid and ray steps independently control numerical work. Static and reduced-motion poses do not advance light state. The fallback is a CSS gradient.

## Parameters (generated)

<!-- params:start -->

| Parameter  | Type  | Default    | Range / choices             | Group   | Description                                                                            |
| ---------- | ----- | ---------- | --------------------------- | ------- | -------------------------------------------------------------------------------------- |
| grid       | u32   | 128        | 32…256                      | Quality | Square pixel-space mask and distance-field resolution.                                 |
| scene      | enum  | "text"     | text, blocks, empty, solid  | Scene   | Built-in deterministic mask when no image or text-mask input is connected.             |
| channel    | enum  | "alpha"    | alpha, luminance            | Scene   | Connected mask occupancy from alpha or premultiplied linear luminance.                 |
| threshold  | f32   | 0.5        | 0…1                         | Scene   | Mask occupancy threshold after input resampling.                                       |
| tint       | color | "#efb77b"  | —                           | Palette | Linear light or outline colour.                                                        |
| background | color | "#101829"  | —                           | Palette | Linear unlit background colour.                                                        |
| view       | enum  | "light"    | light, visibility, distance | Display | Tone-mapped point light, unoccluded soft-shadow factor, or signed-distance diagnostic. |
| light      | vec2  | [0.2,0.18] | 0…1                         | Light   | Normalized point-light position in the mask.                                           |
| intensity  | f32   | 3          | 0…12                        | Light   | Linear radiance of the point light.                                                    |
| falloff    | f32   | 5          | 0…30                        | Light   | Inverse-quadratic normalized distance attenuation.                                     |
| softness   | f32   | 8          | 1…64                        | Light   | Distance-to-ray ratio shadow bound; larger values give a sharper penumbra.             |
| steps      | u32   | 128        | 32…256                      | Quality | Maximum clamped SDF ray-march iterations per receiver pixel.                           |

<!-- params:end -->

Two presets provide a broad warm penumbra and a sharper cool block scene.

## Measurements

<!-- measurements:start -->

Recorded on the development Apple M1 Max / macOS 26.6.2 using the production preview. Defaults, seed 7, physical 512² display, DPR 1 and fixed resolution/work quality. Each of three runs discards 30 warm-up updates then measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion and timestamp readback. Filter defaults use their owned deterministic linear HDR test card; lighting uses its documented scene and grid.

| Browser              | CPU mean ms           | Completion p95 ms     | Summed GPU pass p95 ms | rAF median ms            | Record                               |
| -------------------- | --------------------- | --------------------- | ---------------------- | ------------------------ | ------------------------------------ |
| chrome 154.0.8037.98 | 0.396 / 0.400 / 0.392 | 4.100 / 3.900 / 4.800 | 2.621 / 2.163 / 2.621  | 16.700 / 16.700 / 16.700 | [JSON](../benchmarks/m4-chrome.json) |
| webkit 26.6          | 0.508 / 0.425 / 0.458 | 8.000 / 6.000 / 7.000 | 4.329 / 4.985 / 4.673  | 17.000 / 17.000 / 17.000 | [JSON](../benchmarks/m4-webkit.json) |

CPU encode, queue-completion wall latency and rAF cadence measure different boundaries. GPU columns are sums of actual pass timestamps when supported; quantization and overlapping intervals can make their sum exceed completion latency. They are a diagnostic rather than whole-frame elapsed time. Initialization and compilation are excluded, machine load is uncontrolled, and allocation sizes are logical rather than VRAM. The separate [M4 video-chain gate](../m4.md) uses a genuinely decoded 1920×1080 clip, four filters and full-size intermediates, with a measured idle-refresh baseline. Small software snapshots and CPU-reference hardware tests verify numerical/lifecycle properties separately from speed.

<!-- measurements:end -->

## Failure modes

The JFA field is approximate, so its distance can overestimate the nearest obstacle and skip sufficiently thin geometry. Clamping march length reduces this risk but does not prove an exact conservative sphere trace for every mask. Raster boundaries use pixel centers. Low step counts can conservatively darken a long unblocked segment. A light inside a filled obstacle is intentionally occluded. The numerical segment fixture separately checks a clear ray, a full-height blocker and a receiver on the light side of that blocker.

## Production readiness

This is a useful 2D point-light research baseline. Exact contour distance, analytic area-light validation, light-list batching and live DOM rect synchronization are further work. The supplied rectangle hook covers the Family F data input without claiming M5 observers.
