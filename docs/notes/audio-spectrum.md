# Real audio FFT and waveform rendering (`audio-spectrum`)

## Question

Does the visual respond to actual analyser amplitudes and signed waveform samples?

## Technique summary

The runtime audio texture has nonnegative FFT amplitude in red on row zero and signed waveform samples on row one. Spectrum bars take the maximum actual bin in each displayed frequency band, avoiding skipped narrow tones. The oscilloscope manually interpolates the waveform row and draws an antialiased trace. Terrain raymarches a height field whose elevations come from the FFT row; depth modulation and a world-space grid expose its shape. Gain is a linear amplitude multiplier. The owned fallback is a one-time DFT of a known two-sine waveform, never an invented time-varying spectrum.

## References

[WGSL texture loads and sampling](https://www.w3.org/TR/WGSL/#textureLoad)

[Web Audio analyser and FFT processing](https://www.w3.org/TR/webaudio/#AnalyserNode)

## Passes and resources

One T4 pass binds the audio texture. The fallback is a 256×2 RGBA32 texture with a known waveform and actual DFT amplitudes. Real analyser data is uploaded by the core input adapter. FFT band aggregation loops through the selected bins; terrain has an explicit bounded step budget. No optional GPU feature is required.

## WebGPU features used

Baseline sampled textures, uniform buffers and render pipelines. Linear-premultiplied HDR output is resolved through the shared runtime. Resolution quality ranges from 0.25 to 1. Reduced motion freezes the declared time pose; authored CSS progress remains an explicit input. The declared CSS fallback is available when WebGPU initialization fails.

## Parameters (generated)

<!-- params:start -->

| Parameter    | Type  | Default    | Range / choices                 | Group    | Description                                                          |
| ------------ | ----- | ---------- | ------------------------------- | -------- | -------------------------------------------------------------------- |
| mode         | enum  | "spectrum" | spectrum, oscilloscope, terrain | View     | FFT amplitude bars, signed waveform or perspective FFT height field. |
| bars         | u32   | 64         | 8…256                           | Spectrum | Number of sampled spectrum columns.                                  |
| range        | f32   | 0.5        | 0.02…1                          | Spectrum | Fraction of audio texture FFT row sampled across the display.        |
| gain         | f32   | 1.5        | 0…20                            | Audio    | Linear amplitude multiplier applied to the actual input.             |
| gap          | f32   | 0.2        | 0…0.9                           | Spectrum | Fraction of each bar reserved as a gap.                              |
| terrainSteps | u32   | 48         | 16…96                           | Terrain  | Maximum sampled-height raymarch steps for the FFT terrain.           |
| lineWidth    | f32   | 1.5        | 0.5…8                           | Waveform | Oscilloscope stroke half-width in physical pixels.                   |
| tint         | color | "#8fe0db"  | —                               | Palette  | Lit audio trace colour.                                              |
| background   | color | "#071826"  | —                               | Palette  | Background colour.                                                   |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded on the development Apple M1 Max / macOS 26.6.2 using the production preview. All current typed defaults, seed 7, physical 512² display, DPR 1 and fixed resolution/work quality. Each of three runs discards 30 warm-up updates then measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion and timestamp readback. Standalone image, text and audio effects use their documented owned fixtures: two HDR cards, a text coverage mask, and a two-sine waveform with its actual DFT. Fluid obstacles uses two packed rectangles with its default 256² grid and 32 pressure iterations.

| Browser              | CPU mean ms           | Completion p95 ms     | Summed GPU pass p95 ms | rAF median ms            | Record                               |
| -------------------- | --------------------- | --------------------- | ---------------------- | ------------------------ | ------------------------------------ |
| chrome 154.0.8037.98 | 0.304 / 0.311 / 0.324 | 5.800 / 4.900 / 5.700 | 0.393 / 0.393 / 0.328  | 16.700 / 16.700 / 16.700 | [JSON](../benchmarks/m5-chrome.json) |
| webkit 26.6          | 0.175 / 0.283 / 0.217 | 4.000 / 4.000 / 4.000 | 2.267 / 2.895 / 2.432  | 17.000 / 17.000 / 17.000 | [JSON](../benchmarks/m5-webkit.json) |

CPU encode, encoding-through-queue-completion wall latency, summed pass timestamps and rAF cadence measure different boundaries. Timestamp precision and overlapping intervals limit interpretation; the summed GPU column is not whole-frame elapsed time. Compilation and initialization are excluded, machine load is uncontrolled, and allocation sizes are logical rather than VRAM. These standalone measurements exclude live media, DOM geometry, CSS polling and attachment costs. The separate [M5 page measurements](../m5.md) cover six actual DOM attachments, visible uniform bridges and the overlay experiment. Numerical references, deterministic software snapshots and device-loss tests establish correctness separately from performance.

<!-- measurements:end -->

## Validation

Every bar and waveform pixel is compared with a constant-amplitude CPU reference. Changing actual FFT heights changes the terrain. The borrowed audio texture survives disposal. Reference peaks and waveform remain exposed as a raw inspection tap, and all three modes have finite/diagnostic checks.

## Failure modes

This visualization consumes an analyser FFT; it does not compute a live FFT on the GPU. Large FFT textures and very few bars increase the per-fragment band-scan cost. Terrain ray steps approximate a sampled height field and can miss very narrow ridges. Silent input produces a silent trace or flat terrain, rather than decorative motion.

## Production readiness

Consider a compute band-reduction pass for large analysers and add logarithmic frequency bands with explicit sample-rate labels.
