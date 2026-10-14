# GGX material with cube lighting (`material-ball`)

## Question

Can the minimal mesh runtime provide convincing roughness-dependent image-based lighting without an asset pipeline?

## Technique summary

A unit UV sphere uses a metallic/roughness GGX BRDF, Schlick Fresnel, Smith visibility and an analytic split-sum DFG fit (Lazarov). An owned procedural linear HDR studio environment provides reproducible input. Specular cube mips use 64-sample GGX importance sampling, with roughness increasing by mip. A separate cosine-weighted convolution provides diffuse irradiance. Reinhard presentation maps the HDR lighting.

## References

- [WebGPU specification](https://gpuweb.github.io/gpuweb/)
- [Filament PBR reference](https://google.github.io/filament/Filament.html) — GGX, IBL convolution and split-sum approximation.
- [Epic Games: Real Shading in Unreal Engine 4](https://cdn2.unrealengine.com/Resources/files/2013SiggraphPresentationsNotes-26915738.pdf) — environment BRDF fit.

## Passes and resources

One-time compute writes all six source cube layers through a storage texture array; the shared mip generator creates area-weighted source mips. Compute convolves each specular mip and a separate 8² irradiance cube. One indexed sphere render pass samples cube views. All face/mip planes are inspectable; source/specular/irradiance textures, per-mip immutable uniforms, pipelines, camera and mesh are owned and disposed.

## WebGPU features used

Cube sampling, six-layer storage texture arrays, compute convolution, mip chains, indexed geometry, depth and MSAA. No optional feature required.

## Reduced motion and fallback

The declared page-planning estimate is 3 ms at a 640×400 physical-pixel target. This is a conservative authored estimate for development warnings, not a measured guarantee or an assertion that this research effect meets the launch-page GPU gate.

Reduced motion presents the time-zero sphere from its tuned 0.7-radian camera angle. The owned studio environment is generated once and cached. Automatic rendering stops after dirty work settles, while roughness, metalness, tint and resize still update the settled frame. Camera `speed: 0` also stops automatic redraws because the orbit is the only continuing animation.

The bundled `poster.png` is the script-generated default settled pose (seed 7). `attach` uses it when WebGPU is unavailable; the declared CSS gradient remains a last resort if the image cannot load. Native light-DOM content remains readable and interactive, and both GPU canvas and poster are decorative. Generate an author poster with `node scripts/poster.mjs material-ball <preset> <width>x<height> <output.png>` for a different theme or geometry, then pass that URL as the attachment's `poster` option.

## Parameters (generated)

<!-- params:start -->

| Parameter   | Type  | Default   | Range / choices | Group     | Description                                                           |
| ----------- | ----- | --------- | --------------- | --------- | --------------------------------------------------------------------- |
| speed       | f32   | 0.25      | 0…2             | Camera    | Camera orbit speed in radians per second.                             |
| msaa        | enum  | "4x"      | off, 4x         | Rendering | Single sample or four-sample depth-tested rendering with HDR resolve. |
| tint        | color | "#56c7dd" | —               | Material  | Linearized base material colour.                                      |
| roughness   | f32   | 0.25      | 0.04…1          | Material  | GGX roughness selects a prefiltered specular cube mip.                |
| metallic    | f32   | 0.85      | 0…1             | Material  | Blend dielectric F0 .04 with metallic base colour.                    |
| environment | f32   | 1         | 0…4             | Material  | HDR image-based lighting intensity.                                   |
| exposure    | f32   | 1         | 0.1…4           | Material  | Linear exposure before Reinhard presentation.                         |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded on the development Apple M1 Max / macOS 26.6.2 using the production preview. Typed defaults, seed 7, physical 512² display, DPR 1, 4x MSAA and fixed quality. Each of three runs discards 30 warm-up updates then measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion and timestamp readback. Instances uses 4096 cubes, a render bundle and both occlusion probes; terrain uses a 128²-cell indexed grid; material-ball uses owned 64² GGX environment cubes; glass captures and composites a full-size scene. Initial environment convolution and terrain height generation are excluded from the steady-state sample window.

| Browser              | CPU mean ms           | Completion p95 ms     | Summed GPU pass p95 ms | rAF median ms            | Record                               |
| -------------------- | --------------------- | --------------------- | ---------------------- | ------------------------ | ------------------------------------ |
| chrome 154.0.8037.98 | 0.236 / 0.236 / 0.244 | 2.600 / 1.800 / 2.500 | 0.393 / 0.524 / 0.655  | 16.700 / 16.700 / 16.700 | [JSON](../benchmarks/m6-chrome.json) |
| webkit 26.6          | 0.317 / 0.350 / 0.375 | 6.000 / 7.000 / 8.000 | 1.857 / 1.619 / 2.029  | 17.000 / 17.000 / 17.000 | [JSON](../benchmarks/m6-webkit.json) |

CPU encoding, encoding-through-queue-completion wall latency, summed GPU pass timestamps and observed rAF cadence are separate measurements. Timestamp quantization and overlapping intervals limit interpretation; summed GPU time is not whole-frame elapsed time. Machine load is uncontrolled (other validation work may be running), logical allocations are not VRAM, and these measurements establish no cross-device refresh guarantee. The M6 exit is baseline capability coverage, not a speed threshold. Deterministic snapshots, CPU references and lifecycle tests establish separate correctness properties; see [M6 validation](../m6.md).

<!-- measurements:end -->

## Failure modes

64-sample convolution and the analytic DFG are approximations. Finite texels and face-local source mip generation limit seams; source radiance is procedural rather than imported photography. The highest mip is roughness 1, not a diffuse substitute.

## Production readiness

Higher-quality offline convolution, measured HDR input, multiple-scattering compensation and seam-aware source mips would improve fidelity.
