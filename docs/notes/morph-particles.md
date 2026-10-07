# Text and image particle morph (`morph-particles`)

## Question

Can local text and image masks define useful particle targets while GPU springs and pointer repulsion remain independent of future general input bindings?

## Technique summary

A 512×256 local canvas rasterizes a built-in word or image, samples every second pixel, and keeps non-dark luminance samples. A deterministic integer permutation assigns samples to particles, forming a vec4f target buffer (x, y, luminance, weight). Semi-implicit spring integration advances velocity, applies exponential damping and advances position. Pressing the pointer applies outward acceleration inside a smooth radial support. setInput("text", string) accepts arbitrary local text; setInput("image", CanvasImageSource) accepts decoded bitmap, canvas or image data sources. Set the target parameter to the corresponding mode, then reset for a seeded assembly. Inputs belong to each effect instance. The built-in image is a rasterized coloured elliptical ring; the custom image path uses supplied pixels. Luminance modulates particle brightness. Mask extraction is CPU work only when targets change; ongoing particle updates are GPU compute.

## References

[HTML canvas drawImage](https://html.spec.whatwg.org/multipage/canvas.html#dom-context-2d-drawimage) specifies the local raster source types. [WGSL storage layout](https://www.w3.org/TR/WGSL/#alignment-and-size) defines the target and particle records.

## Passes and resources

Simulation is fixed-step compute, with immutable per-step frame and parameter snapshots. The common baseline record uses two vec4f fields, 32 bytes. Flow, attractors and morph use two record buffers; emitters use one disjoint-update record buffer plus flags, stable scan scratch, live/free IDs and indirect arguments. Morph adds a 16-byte target per particle. Two rgba16float histories cost 16 bytes per display pixel. A decay dispatch, additive point or quad render and Reinhard tone-map display follow simulation. Display-only resizing reallocates history while preserving particle state. Count changes recreate and initialize particle storage. Disposal destroys owned buffers/textures and releases shader leases; taps expose current storage and HDR history. Memory reports logical allocation bytes.

Trail energy is retained once per newly displayed simulation index. Repeated unchanged renders at the same index only tone-map existing HDR, preserving paused and reduced-motion pixels. Changing parameters used by the compiled particle draw shaders (such as tint, size, mode or attractor rotation) clears and redraws the current pose immediately; exposure and background only update the resolve, and retention applies on the next displayed index. Batched updates display only their final pose, so deterministic pixel replay also specifies the sequence of displayed indices.

## WebGPU features used

Baseline storage buffers, compute, vertex storage reads and rgba16float render attachments with additive blending. Timestamp-query is optional through the session profiler, with an unavailable state when unsupported. Presentation remains baseline SDR tone mapping; extended-range canvases are a separate capability experiment. Reduced motion draws the seeded time-zero pose and the definition declares a CSS gradient fallback.

## Parameters (generated)

<!-- params:start -->

| Parameter  | Type  | Default   | Range / choices  | Group     | Description                                                                                         |
| ---------- | ----- | --------- | ---------------- | --------- | --------------------------------------------------------------------------------------------------- |
| count      | u32   | 32768     | 64…1048576       | Particles | Storage particle count; changing it restarts the seeded field.                                      |
| draw       | enum  | "quad"    | point, quad      | Rendering | One raster point or six-vertex instanced quad per particle.                                         |
| size       | f32   | 1.6       | 0.5…8            | Rendering | Quad diameter in display pixels; points remain one pixel.                                           |
| trail      | f32   | 0.94      | 0…0.995          | Rendering | Retained HDR energy per newly displayed simulation index; repeated paused renders preserve history. |
| exposure   | f32   | 0.8       | 0.01…4           | Rendering | Exposure before Reinhard HDR tone mapping.                                                          |
| tint       | color | "#72dcd3" | —                | Palette   | Additive particle colour.                                                                           |
| background | color | "#07111e" | —                | Palette   | Tone mapped empty-field background.                                                                 |
| mask       | enum  | "text"    | text, image      | Target    | Local raster text mask or image luminance targets; custom input accepted through field.setInput.    |
| word       | enum  | "GPU"     | GPU, HELLO, FLOW | Target    | Built-in text mask. setInput("text", string) replaces it with custom text.                          |
| spring     | f32   | 18        | 1…80             | Motion    | Spring acceleration toward the target point.                                                        |
| damping    | f32   | 5         | 0…12             | Motion    | Exponential velocity damping per second.                                                            |
| scatter    | f32   | 2         | 0…8              | Motion    | Pointer repulsion strength while pressed.                                                           |
| radius     | f32   | 0.35      | 0.05…1           | Motion    | Pointer scatter radius in normalized coordinates.                                                   |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded on the development Apple M1 Max / macOS 26.6.2 using the production preview and the same fixed-scenario runner as the Profiler drawer. Physical display is 512² at DPR 1, seed 7, fixed resolution/work quality. Defaults are retained except million-particle gate rows set count to exactly 1,000,000 and select point or instanced-quad drawing. Each of three runs discards 30 warm-up updates and measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion and timestamp readback.

| Browser              | Rendering / allocation controls            | CPU mean ms           | Completion p95 ms     | Summed GPU pass p95 ms | rAF median ms            | Million-particle gate | Record                               |
| -------------------- | ------------------------------------------ | --------------------- | --------------------- | ---------------------- | ------------------------ | --------------------- | ------------------------------------ |
| chrome 154.0.8037.98 | quad; count=32768, mask="text", word="GPU" | 0.221 / 0.307 / 0.218 | 5.000 / 5.700 / 4.000 | 1.769 / 1.901 / 1.835  | 16.700 / 16.700 / 16.700 | —                     | [JSON](../benchmarks/m3-chrome.json) |
| webkit 26.6          | quad; count=32768, mask="text", word="GPU" | 0.283 / 0.325 / 0.267 | 5.000 / 6.000 / 6.000 | 2.516 / 2.435 / 3.407  | 16.000 / 16.000 / 16.000 | —                     | [JSON](../benchmarks/m3-webkit.json) |

GPU columns use actual pass-boundary timestamp queries when available; values are implementation-defined and may be quantized. Pass intervals may overlap; their sum is a diagnostic rather than whole-frame execution time. These captures include summed intervals larger than queue-completion wall latency, so the columns must not be substituted for one another. CPU encode, queue-completion wall latency and rAF cadence remain separate. The million-particle gate verifies actual storage count, both draw paths, all 150 fixed updates and no GPU errors; M3 specifies particle count rather than a refresh-rate threshold. Machine load is uncontrolled. Logical allocations are not VRAM. Initialization/compilation are excluded. Small deterministic software snapshots and CPU-reference GPU tests establish separate numerical/lifecycle properties, not million-particle speed.

<!-- measurements:end -->

## Findings and validation

The numerical tests in `tests/browser/particles-core.spec.ts` check seeded storage replay, both rendering paths and finite HDR taps. Specific tests cover zero-speed/wrapping flow, Clifford and De Jong CPU equations, lifetime/death/free-list/count conservation with indirect arguments, and spring integration plus custom text/image inputs. Generic catalogue tests separately cover preset pixels, resize and disposal. See [particle contract ADR](../adr/008-particle-storage-and-hdr.md) for shared assumptions. These small fixtures establish correctness; the recorded hardware workload establishes throughput.

## Failure modes

Targets are sampled from a fixed 512×256 raster at a two-pixel stride. Small text details and dark image regions below the luminance threshold are discarded; an empty mask places targets at the origin. Text uses the available sans-serif font, single-line fillText shaping and maximum-width fitting, so target geometry can differ across operating systems. Images are stretched to the local mask and nearest-scaled; aspect-preserving fit, crop and colour-managed input handling are not general bindings yet. Raster extraction and target upload happen on the CPU when inputs or selection change and scale with target count; they are excluded from steady-state frame timing. Browser-tainted canvas sources cannot be read as masks. The damped spring is a visual assembly model, with positions clamped to a finite domain during scatter, rather than a collision-aware particle simulation. Very small point stamps alias; HDR count scaling and rounding change brightness. The static gradient fallback cannot reproduce the supplied text or image.

## Production readiness

General media bindings, explicit fit/crop modes, font selection/loading and higher-resolution or distance-field sampling belong in the input layer. Preserve per-instance source ownership and synchronous image copying so callers can release decoded bitmaps, and retain custom sources through shader rebuilds. A production text effect should keep meaningful text in the DOM for accessibility and provide a matching poster when GPU rendering is unavailable. Extend target tests to empty masks, dark/transparent images, loaded fonts and touch pressure, and measure source-change latency separately from steady-state GPU motion. Retain spring CPU checks, pointer scatter, immediate mask selection and custom text/image replay coverage.
