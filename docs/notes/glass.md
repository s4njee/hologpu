# Captured-scene mesh refraction (`glass`)

## Question

Can a small multi-pass graph refract a captured background through actual geometry with chromatic dispersion?

## Technique summary

First capture a deterministic linear HDR tile/stripe scene. A depth-tested unit sphere samples that capture with separate RGB refraction vectors projected into screen space. Fresnel reflection and Beer-Lambert tint modify transmission. Composite the premultiplied mesh over the original scene. IOR 1, zero dispersion and zero absorption reproduce the captured background under the mesh.

## References

- [WebGPU specification](https://gpuweb.github.io/gpuweb/)

## Passes and resources

Background capture → single/4x sphere layer resolve → composite → runtime canvas resolve. The capture and transparent mesh layer are full-sized inspectable rgba16float textures. The sphere mesh, camera, pipeline leases and resized capture/layer/depth/MSAA textures belong to the instance.

## WebGPU features used

Multi-pass scene capture, texture sampling, indexed geometry, depth, MSAA and alpha compositing. No optional feature required.

## Reduced motion and fallback

The declared page-planning estimate is 6 ms at a 640×400 physical-pixel target. This is a conservative authored estimate for development warnings, not a measured guarantee or an assertion that this research effect meets the launch-page GPU gate.

Reduced motion freezes both the captured tile/stripe scene and the camera at time zero, with the sphere viewed from its tuned 0.2-radian starting angle. The instance stops automatic rendering after dirty work settles; material changes and resize still redraw that pose. Background parallax remains animated when camera `speed` is zero unless reduced motion is enabled.

The bundled `poster.png` is the script-generated default settled pose (seed 7). `attach` uses it when WebGPU is unavailable; the declared CSS gradient remains a last resort if the image cannot load. Native light-DOM content remains readable and interactive, and both GPU canvas and poster are decorative. Generate an author poster with `node scripts/poster.mjs glass <preset> <width>x<height> <output.png>` for a different theme or geometry, then pass that URL as the attachment's `poster` option.

## Parameters (generated)

<!-- params:start -->

| Parameter  | Type  | Default   | Range / choices | Group     | Description                                                           |
| ---------- | ----- | --------- | --------------- | --------- | --------------------------------------------------------------------- |
| speed      | f32   | 0.25      | 0…2             | Camera    | Camera orbit speed in radians per second.                             |
| msaa       | enum  | "4x"      | off, 4x         | Rendering | Single sample or four-sample depth-tested rendering with HDR resolve. |
| tint       | color | "#56c7dd" | —               | Material  | Linearized base material colour.                                      |
| ior        | f32   | 1.5       | 1…2.5           | Material  | Index of refraction; 1 has no bending.                                |
| dispersion | f32   | 0.035     | 0…0.15          | Material  | RGB refractive-index spread.                                          |
| thickness  | f32   | 0.7       | 0…2             | Material  | Screen-space ray travel through the sphere.                           |
| absorption | f32   | 0.15      | 0…2             | Material  | Beer-Lambert coloured absorption strength.                            |
| background | enum  | "tiles"   | tiles, stripes  | Scene     | Captured background scene with time-driven parallax.                  |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded on the development Apple M1 Max / macOS 26.6.2 using the production preview. Typed defaults, seed 7, physical 512² display, DPR 1, 4x MSAA and fixed quality. Each of three runs discards 30 warm-up updates then measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion and timestamp readback. Instances uses 4096 cubes, a render bundle and both occlusion probes; terrain uses a 128²-cell indexed grid; material-ball uses owned 64² GGX environment cubes; glass captures and composites a full-size scene. Initial environment convolution and terrain height generation are excluded from the steady-state sample window.

| Browser              | CPU mean ms           | Completion p95 ms     | Summed GPU pass p95 ms | rAF median ms            | Record                               |
| -------------------- | --------------------- | --------------------- | ---------------------- | ------------------------ | ------------------------------------ |
| chrome 154.0.8037.98 | 0.233 / 0.244 / 0.226 | 3.000 / 2.700 / 2.500 | 1.311 / 1.442 / 1.442  | 16.700 / 16.700 / 16.700 | [JSON](../benchmarks/m6-chrome.json) |
| webkit 26.6          | 0.292 / 0.325 / 0.333 | 5.000 / 6.000 / 5.000 | 4.032 / 5.027 / 4.153  | 17.000 / 17.000 / 17.000 | [JSON](../benchmarks/m6-webkit.json) |

CPU encoding, encoding-through-queue-completion wall latency, summed GPU pass timestamps and observed rAF cadence are separate measurements. Timestamp quantization and overlapping intervals limit interpretation; summed GPU time is not whole-frame elapsed time. Machine load is uncontrolled (other validation work may be running), logical allocations are not VRAM, and these measurements establish no cross-device refresh guarantee. The M6 exit is baseline capability coverage, not a speed threshold. Deterministic snapshots, CPU references and lifecycle tests establish separate correctness properties; see [M6 validation](../m6.md).

<!-- measurements:end -->

## Failure modes

This is screen-space refraction with an authored travel-distance approximation, not traced entry/exit geometry. Sampling clamps at the capture border, so off-screen rays cannot recover missing scene data. No real-page pixel capture is implied.

## Production readiness

A scene depth capture and back-face thickness pass would improve refraction. Nested transparent objects and multiple scattering remain future work.
