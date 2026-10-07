# Derivative water caustics (`caustics`)

## Question

Can fragment derivatives turn a seeded procedural water surface into stable, bounded focusing patterns without a simulation or an extra render pass?

## Technique summary

Eight directional sine waves form a height-field slope. Directions rotate with the seed; independent seeded phases and frequency-dependent velocities animate the surface. Coordinates preserve aspect ratio and scale by the stage height. Analytic wave slopes form a normal; WGSL `refract` bends vertically incident light with an air-to-water index ratio of 1/1.333, then projects the ray onto a flat receiver plane.

`dpdx` and `dpdy` estimate the local area of the projected map and the original map. Dividing the two signed determinants gives a dimensionless Jacobian area ratio that preserves orientation and avoids a direct resolution-dependent brightness factor. Inverse absolute area becomes a focusing proxy. The minimum determinant uses a user floor plus a bounded `fwidth` slope footprint, concentration caps at 12, and an exponential response bounds output. A denominator guard protects tiny pixel footprints. Diagnostic modes show signed compression/folds and surface normals.

This is an optical approximation rendered in source coordinates. It does not invert the ray map, splat photons onto receiver coordinates, sum overlapping ray branches, conserve energy, solve water dynamics, or model wave height in the projection distance. Refraction is physically motivated; the displayed concentration field is an artistic diagnostic rather than a physical irradiance solution. Colours are mixed in linear RGB. Output alpha comes from the light tint.

## References

[NVIDIA GPU Gems, chapter 2: Rendering Water Caustics](https://developer.nvidia.com/gpugems/gpugems/part-i-natural-effects/chapter-2-rendering-water-caustics) motivates wave normals, refraction, and projected focusing. The implementation uses an original bounded derivative area-ratio approximation, rather than the chapter's receiver tracing algorithm.

[WGSL specification: derivative built-in functions](https://www.w3.org/TR/WGSL/#derivative-builtin-functions) defines `dpdx`, `dpdy`, `fwidth`, and their uniformity requirements. [WGSL `refract`](https://www.w3.org/TR/WGSL/#refract-builtin) defines the refraction operation.

## Passes and resources

One fullscreen triangle writes premultiplied linear colour to an `rgba16float` target, followed by the shared SDR resolve. Bindings are the standard 64-byte frame uniform and aligned parameter uniform. No textures or simulation buffers belong to the effect. At 512×320 the target contains 1,310,720 logical bytes. Shader modules and async pipelines use shared reference-counted leases; field destruction releases uniforms, target, and leases, and readback frees its temporary texture and staging buffer.

## WebGPU features used

Baseline fragment `dpdx`, `dpdy`, `fwidth`, and `refract`, uniform buffers, float render attachments, and canvas presentation. All derivative calls execute before diagnostic branches in uniform control flow; no diagnostic suppression is requested. No optional adapter features are required. Reduced motion freezes at time zero. The declared radial-gradient fallback renders without WebGPU.

## Parameters (generated)

<!-- params:start -->

| Parameter  | Type  | Default   | Range / choices          | Group       | Description                                                               |
| ---------- | ----- | --------- | ------------------------ | ----------- | ------------------------------------------------------------------------- |
| view       | enum  | "light"   | light, jacobian, normals | Diagnostics | Bounded light concentration, signed ray-map area ratio, or wave normals.  |
| scale      | f32   | 7         | 1…20                     | Water       | Aspect-correct wave-domain span across the stage height.                  |
| amplitude  | f32   | 1.3       | 0…1.5                    | Water       | Slope amplitude of the eight seeded directional waves.                    |
| depth      | f32   | 5         | 0…5                      | Optics      | Receiver-plane distance in wave-domain units; controls focusing strength. |
| softness   | f32   | 0.06      | 0.02…0.5                 | Optics      | Minimum absolute Jacobian determinant before inverse-area amplification.  |
| exposure   | f32   | 0.25      | 0.05…2                   | Optics      | Exposure of the bounded exponential light response.                       |
| speed      | f32   | 0.6       | 0…2                      | Motion      | Wave phase speed; zero freezes all waves.                                 |
| tint       | color | "#99e8ec" | —                        | Palette     | Linear-RGB focused light colour and output alpha.                         |
| background | color | "#062d4b" | —                        | Palette     | Linear-RGB receiver colour underneath the focused light.                  |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded 2026-10-07 on Apple M1 Max / macOS 26.6.2. Default parameters, seed 7, 512×320 physical pixels, DPR 1, resolution scale 1. Three runs; each discards 30 warm-up frames then measures 120 explicit encode/submit calls at fixed 1/60 s in rAF. CPU timings exclude GPU execution; rAF cadence is not a GPU timer. Device state and load are uncontrolled. Logical allocation sizes are not VRAM.

| Browser              | CPU mean ms (three runs) | rAF mean ms (three runs) | Record                                       |
| -------------------- | ------------------------ | ------------------------ | -------------------------------------------- |
| chrome 154.0.8037.98 | 0.149 / 0.173 / 0.172    | 16.667 / 16.667 / 16.666 | [JSON](../benchmarks/m1-stretch-chrome.json) |
| webkit 26.6          | 0.350 / 0.233 / 0.242    | 15.767 / 15.733 / 15.900 | [JSON](../benchmarks/m1-stretch-webkit.json) |

Shader compilation is excluded. Optional GPU timestamp queries are deferred to M3. The SwiftShader pixel tests verify repeatability and disposal at DPR 1 and 2, both presets, every enum mode, and no compilation warnings. Hardware engines use the same compile/readback/disposal tests without cross-device image comparison.

<!-- measurements:end -->

## Failure modes

The default uses amplitude 1.3 and depth 5 to expose folds clearly. Lagoon reduces both for gentler focusing; pool raises spatial frequency and changes the receiver palette. These are illustrative parameter choices rather than calibrated water properties.

Inverse determinants would diverge near folds; the floor and concentration cap avoid singular brightness at the cost of biasing apparent energy. A slope-footprint floor only softens focusing and is not an analytic antialiasing solution. Fine waves and thin folds can shimmer or change with DPR and resolution scale because derivatives use adjacent fragment invocations. Quad derivative precision and implementation choice can differ across browsers, so image comparisons remain engine-specific. Large scale and amplitude can alias even though the result remains finite. Negative determinants identify folded source regions but do not reconstruct their multiple receiver contributions. Very large elapsed time eventually loses f32 phase precision. Tint alpha applies to all diagnostic modes; background alpha is ignored.

## Production readiness

The T1 experiment supports bounded artistic caustics and derivative inspection. A physical receiver solution needs forward deposition or inverse ray tracing, branch accumulation, energy-normalized reconstruction, and receiver geometry. Temporal filtering and footprint-aware wave filtering deserve measurement before using very fine animated patterns behind text. Review the static fallback and reduced-motion frame against the actual page palette and contrast.
