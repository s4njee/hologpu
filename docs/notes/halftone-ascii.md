# Halftone and glyph-atlas ASCII (`halftone-ascii`)

## Question

Can image density map to real glyph coverage instead of procedural pseudo-text?

## Technique summary

A CPU Canvas2D rasterizes a fixed monospace character set into 16×20 cells, measures summed coverage and sorts glyphs from sparse to dense. The resulting real R8 atlas is sampled by cell-local UVs selected from input luminance. Halftone mode rotates the sampling grid and maps luminance to circular-dot area using a square-root radius and a pixel-width edge transition. Both modes use the sampled source alpha and either source-coloured or fixed ink over paper.

## References

[Canvas2D text rasterization](https://html.spec.whatwg.org/multipage/canvas.html#text-styles)

[WebGPU texture loads](https://www.w3.org/TR/WGSL/#textureload)

## Passes and resources

One fullscreen pass plus an owned R8 glyph atlas, 16×20×22 = 7,040 logical bytes. Setup rasterization uses the local monospace font; no text network download is required. The atlas is exposed as a texture tap. Cell centres sample the source once per cell while atlas coverage determines the pixel output.

## WebGPU features used

Baseline render pipelines, sampled float texture loads, RGBA16 render targets and uniform buffers. No optional feature is required. Manual bilinear sampling also accepts RGBA32 data without `float32-filterable`. Inputs are borrowed from the runtime provider; destroy releases owned resources and pipeline leases. Reduced motion freezes at the declared pose; unavailable WebGPU uses the declared CSS fallback.

## Parameters (generated)

<!-- params:start -->

| Parameter | Type  | Default   | Range / choices | Group   | Description                                           |
| --------- | ----- | --------- | --------------- | ------- | ----------------------------------------------------- |
| mode      | enum  | "ascii"   | halftone, ascii | Filter  | Area-coded dots or density-sorted raster glyph atlas. |
| cell      | u32   | 10        | 4…32            | Grid    | Output cell width and height in pixels.               |
| contrast  | f32   | 1         | 0.2…3           | Grid    | Luminance-to-density gain.                            |
| angle     | f32   | 0.5       | -3.14…3.14      | Grid    | Halftone sampling screen rotation in radians.         |
| coloured  | bool  | true      | —               | Palette | Use source colour for ink.                            |
| ink       | color | "#f1cc92" | —               | Palette | Monochrome ink colour.                                |
| paper     | color | "#101b29" | —               | Palette | Paper/background colour.                              |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded on the development Apple M1 Max / macOS 26.6.2 using the production preview. Defaults, seed 7, physical 512² display, DPR 1 and fixed resolution/work quality. Each of three runs discards 30 warm-up updates then measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion and timestamp readback. Filter defaults use their owned deterministic linear HDR test card; lighting uses its documented scene and grid.

| Browser              | CPU mean ms           | Completion p95 ms     | Summed GPU pass p95 ms | rAF median ms            | Record                               |
| -------------------- | --------------------- | --------------------- | ---------------------- | ------------------------ | ------------------------------------ |
| chrome 154.0.8037.98 | 0.258 / 0.278 / 0.273 | 2.900 / 3.400 / 3.500 | 0.721 / 0.393 / 0.328  | 16.700 / 16.700 / 16.700 | [JSON](../benchmarks/m4-chrome.json) |
| webkit 26.6          | 0.258 / 0.350 / 0.325 | 5.000 / 5.000 / 4.000 | 0.299 / 0.635 / 1.460  | 17.000 / 17.000 / 17.000 | [JSON](../benchmarks/m4-webkit.json) |

CPU encode, queue-completion wall latency and rAF cadence measure different boundaries. GPU columns are sums of actual pass timestamps when supported; quantization and overlapping intervals can make their sum exceed completion latency. They are a diagnostic rather than whole-frame elapsed time. Initialization and compilation are excluded, machine load is uncontrolled, and allocation sizes are logical rather than VRAM. The separate [M4 video-chain gate](../m4.md) uses a genuinely decoded 1920×1080 clip, four filters and full-size intermediates, with a measured idle-refresh baseline. Small software snapshots and CPU-reference hardware tests verify numerical/lifecycle properties separately from speed.

<!-- measurements:end -->

## Failure modes

GPU output contains actual antialiased glyph coverage rather than a repeated solid block; brighter halftone input increases total dot coverage. Platform font rasterization can change glyph shape and sorting, so hardware snapshots are not cross-platform references. Square ASCII cells scale the 16:20 font raster and can distort glyph proportions.

## Production readiness

Bundle an explicit licensed font or fixed generated atlas, expose cell aspect ratio, and improve halftone screen overlap near high coverage.
