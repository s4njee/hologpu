# Experimental DOM backdrop glass (`backdrop-glass`)

## Question

Can HTML-in-canvas copy real DOM paint into a refracting WebGPU effect, and what happens without the experiment?

## Technique summary

An explicitly supplied direct child of a drawable source canvas is captured on paint into an sRGB texture. The adapter requests straight alpha; the shader decodes sRGB and premultiplies before interpolation, applies lens-normal offsets, RGB dispersion and a cross blur, and composites the lens region. The normal playground defaults to an explicitly labeled owned texture preview.

## References

- [Primary technique reference](https://developer.chrome.com/blog/html-in-canvas-ot-changes)
- [WebGPU specification](https://gpuweb.github.io/gpuweb/)

## Passes and resources

The caller owns source DOM. createElementCapture owns only its texture and paint listener; it supports the 150–154 copy dictionaries and the newer drawable-content/draw dictionaries. The effect accepts setInput("element", element); the playground has an opt-in live text fixture. Capture input is durable across device reconstruction; teardown preserves the caller DOM.

## WebGPU features used

Native storage/compute/render pipelines and float data. No optional GPU feature is required for the portable rendering path. Backdrop DOM capture additionally requires the experimental queue API, detected separately from GPUFeatureName.

## Parameters (generated)

<!-- params:start -->

| Parameter  | Type | Default | Range / choices | Group | Description                                                           |
| ---------- | ---- | ------- | --------------- | ----- | --------------------------------------------------------------------- |
| refraction | f32  | 0.035   | 0…0.12          | Glass | Screen-space normal offset; zero gives an exact texture pass-through. |
| frost      | f32  | 1.5     | 0…8             | Glass | Five-tap cross blur radius in source texels.                          |
| radius     | f32  | 0.27    | 0.1…0.48        | Glass | Circular glass lens radius in normalized coordinates.                 |
| dispersion | f32  | 0.012   | 0…0.06          | Glass | RGB channel separation along the refracted direction.                 |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded on the development Apple M1 Max / macOS 26.6.2 using the production preview. Typed defaults, seed 7, physical 512² output, DPR 1 and fixed quality. Three runs per engine; each discards 30 warm-up updates and measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion and timestamp readback. The actual defaults are 1024 material points on a 32² grid, 256 PBF particles with three constraint iterations, 96² D2Q9 with four ticks, one path/pixel/update through seven spheres, and 2048 sorted Gaussian splats. Backdrop glass uses the explicitly labeled owned texture preview; these rows exclude experimental DOM capture.

| Browser              | CPU mean ms           | Completion p95 ms     | Summed GPU pass p95 ms | rAF median ms            | Record                               |
| -------------------- | --------------------- | --------------------- | ---------------------- | ------------------------ | ------------------------------------ |
| chrome 154.0.8037.98 | 0.207 / 0.197 / 0.176 | 2.800 / 2.200 / 2.100 | 1.180 / 1.049 / 1.049  | 16.700 / 16.700 / 16.700 | [JSON](../benchmarks/m7-chrome.json) |
| webkit 26.6          | 0.342 / 0.342 / 0.217 | 4.000 / 5.000 / 6.000 | 1.681 / 2.034 / 2.132  | 17.000 / 17.000 / 17.000 | [JSON](../benchmarks/m7-webkit.json) |

CPU encoding, queue-completion latency, summed GPU timestamps and rAF cadence have different boundaries. Timestamp precision and overlapping intervals limit interpretation; the sum is not whole-frame elapsed time. Initialization/compilation and a separate untimed 150-update numerical reproduction are excluded from timings. That reproduction checks every f32 tap value for finiteness. Machine load is uncontrolled and logical allocations are not VRAM. These are bounded research workloads, not a refresh guarantee on other devices. See [M7 validation](../m7.md) for numerical references, browser gaps and remaining stretches.

<!-- measurements:end -->

## Failure modes

Flag or origin-trial support is required; Firefox/WebKit and unflagged local Chrome expose the texture preview with capture disabled. Arbitrary existing page elements cannot be captured directly: they must already belong to a drawable canvas subtree. This is not automatic CSS backdrop-filter replacement. Only the local Chrome 154 copy dialect is hardware validated; the newer draw dialect still needs browser validation. Capture is CSS-pixel sized and does not promise retina text quality.

## Production readiness

Research prototype. See [M7 validation](../m7.md) for numerical references, deterministic snapshots, device-loss checks, workload measurements and deferred stretches.
