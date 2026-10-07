# Parallax stars and nebula (`starfield`)

## Question

Can layered, stateless stars remain stable while crossing lattice boundaries, and how does coordinate hashing affect their spatial distribution?

## Technique summary

Each layer defines a fixed world-space lattice, with a seeded point in every cell. An aspect-correct camera translates continuously at a layer-dependent speed. The shader evaluates a 3×3 neighbourhood, so a star remains visible when its centre lies across a cell boundary. Identity, position, colour, size, twinkle phase and frequency depend only on the signed cell coordinates, seed and layer; neither time nor frame index enters the hash. Twinkle uses a continuous sinusoid. The nebula translates more slowly and samples five octaves of continuous gradient noise, warped by two three-octave fields; its lattice seed also stays fixed.

The default `folded` mode multiplies x and y by different odd constants, mixes y separately, then avalanches the combined key. `xor` retains the shared hash's symmetric coordinate combination as an inspector comparison. With seed zero, its first layer has equal keys for `(x,y)` and `(y,x)` and a constant key on the diagonal. The default avoids that exact structural symmetry; it has not undergone a statistical RNG certification or the reference paper's full test suite. All finite 32-bit hashes still have collisions. The cloud uses the existing shared gradient-noise chunk, with distinct nonzero stream offsets; its hash quality is not established by the star comparison.

Star cores use a softened radial profile in physical target pixels. For subpixel radii, an approximate area factor attenuates the expanded footprint rather than increasing its energy. Halos taper to zero within 0.45 cell, and cores remain within 0.28 cell, so dropping a site outside the searched neighbourhood cannot clip a visible contribution. This is an analytic coverage approximation, not an exact disk integral or temporal antialiasing. Star size and coverage width are bounded to preserve the neighbourhood guarantee. Accumulated linear RGB receives the shared Reinhard tone map before the standard SDR resolve.

## References

[Jarzynski and Olano: Hash Functions for GPU Rendering (JCGT 2020)](https://jcgt.org/published/0009/03/02/) motivates separating performance and statistical quality when judging a GPU hash. This effect uses the repository's existing integer avalanche with a coordinate-folding wrapper; it does not reproduce the paper's measured PCG implementation or claim equivalent quality.

[Ken Perlin: Improved Noise reference implementation (2002)](https://cs.nyu.edu/~perlin/noise/) supplies the quintic interpolation reference used by the shared gradient-noise chunk. This effect adds seeded two-dimensional lattice gradients, normalized octave sums and domain warping rather than porting the three-dimensional permutation-table implementation.

## Passes and resources

One fullscreen triangle writes premultiplied linear colour to an `rgba16float` target. A shared fullscreen resolve unpremultiplies, converts to sRGB, then premultiplies for the canvas. Each field owns the target, a 64-byte frame uniform and an aligned parameter uniform. Shader modules, bind layouts and async pipelines use device-scoped reference-counted leases. At 512×320 the target is 1,310,720 logical bytes. Readback allocates a temporary SDR texture and staging buffer, then frees both. Destroy releases listeners, observers, buffers, target and leases; the last field closes the device session. No star buffers, history textures or persistent simulation state are allocated.

## WebGPU features used

Baseline fragment shaders, uniform buffers, integer arithmetic, float colour attachment, texture loads and canvas presentation. No optional features required. Reduced motion freezes at time zero. Without WebGPU, the declared radial-gradient fallback supplies a static space-like background.

## Parameters (generated)

<!-- params:start -->

| Parameter  | Type  | Default   | Range / choices | Group     | Description                                                                              |
| ---------- | ----- | --------- | --------------- | --------- | ---------------------------------------------------------------------------------------- |
| layers     | u32   | 3         | 1…5             | Stars     | Independent star layers, with increasing size and parallax speed.                        |
| density    | f32   | 26        | 8…50            | Stars     | Far-layer lattice cells along the stage height; one candidate star per cell.             |
| size       | f32   | 1.15      | 0.3…3           | Stars     | Nominal far-layer radius in physical target pixels, before seeded size variation.        |
| hashMode   | enum  | "folded"  | folded, xor     | Algorithm | Role-separated integer coordinate folding, or the shared XOR hash for visual comparison. |
| speed      | f32   | 0.045     | 0…0.25          | Motion    | Continuous diagonal travel; world-space cell identities never include frame or time.     |
| twinkle    | f32   | 0.25      | 0…1             | Motion    | Smooth brightness modulation with a fixed per-star phase and frequency.                  |
| nebula     | f32   | 0.7       | 0…1.5           | Nebula    | Domain-warped, seeded gradient-noise cloud intensity.                                    |
| cloudScale | f32   | 2.8       | 0.5…8           | Nebula    | Nebula frequency in aspect-correct stage coordinates.                                    |
| cool       | color | "#438ddb" | —               | Palette   | Cool nebula and star tint, parsed to linear RGB.                                         |
| warm       | color | "#da62ad" | —               | Palette   | Warm nebula and star tint, parsed to linear RGB.                                         |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded 2026-10-07 on Apple M1 Max / macOS 26.6.2. Default parameters, seed 7, 512×320 physical pixels, DPR 1, resolution scale 1. Three runs; each discards 30 warm-up frames then measures 120 explicit encode/submit calls at fixed 1/60 s in rAF. CPU timings exclude GPU execution; rAF cadence is not a GPU timer. Device state and load are uncontrolled. Logical allocation sizes are not VRAM.

| Browser              | CPU mean ms (three runs) | rAF mean ms (three runs) | Record                                       |
| -------------------- | ------------------------ | ------------------------ | -------------------------------------------- |
| chrome 154.0.8037.98 | 0.137 / 0.154 / 0.148    | 16.666 / 16.666 / 16.666 | [JSON](../benchmarks/m1-stretch-chrome.json) |
| webkit 26.6          | 0.242 / 0.317 / 0.242    | 15.817 / 15.692 / 15.750 | [JSON](../benchmarks/m1-stretch-webkit.json) |

Shader compilation is excluded. Optional GPU timestamp queries are deferred to M3. The SwiftShader pixel tests verify repeatability and disposal at DPR 1 and 2, both presets, every enum mode, and no compilation warnings. Hardware engines use the same compile/readback/disposal tests without cross-device image comparison.

<!-- measurements:end -->

A CPU reference smoke probe on 2026-10-07 reproduced the unsigned 32-bit operations with `Math.imul`: 128 seed-zero diagonal cells from −64 through 63 produced 128 distinct folded keys and one XOR key. Among 1,056 ordered, off-diagonal mirrored pairs in the square [−16,16]², folded keys had zero equal pairs and XOR keys had 1,056. This checks the identified symmetry, not a general distribution, collision-rate or GPU-performance claim.

## Failure modes

The 3×3 search costs nine candidates per layer, up to 45 per fragment; nebula evaluation adds eleven gradient-noise samples. High layer count and large output targets increase cost. Dense grids or very small targets exceed the bounded coverage filter and can alias; the approximation is not suitable for resolving every star at arbitrarily low resolution. Physical-pixel radii change their apparent CSS size when resolution scale changes. At very long times, f32 camera coordinates lose subpixel precision; no time wrapping is used because a naive wrap would jump to a different world. Cells beyond signed 32-bit coordinate range exceed the hash conversion domain. Hash collisions remain possible. Changing density, layers or seed intentionally changes the field; temporal stability is promised for continuous motion with fixed parameters, not for those discrete edits.

## Production readiness

This is a stretch T1 technique and a useful stateless background, rather than a calibrated astronomical renderer. For a production camera, introduce a rebased integer world origin and a fractional local offset, validate hash distributions over more seeds, and compare exact pixel-integrated disks or temporal supersampling at low resolution. Brightness and colour are artistic. Both hash modes, seeded repeatability, cell-boundary continuity and preset disposal should remain covered by the integration tests.
