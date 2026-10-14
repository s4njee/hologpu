# Indexed height field with fog (`terrain`)

## Question

How much terrain detail can vertex-stage noise displacement provide with a minimal camera and index buffer?

## Technique summary

A compute pass generates seeded five-octave value noise in an r32float height texture. A second pass loads and stores each cell independently, blending noise with a smoothstep remap before scaling by height. This exercises race-free read/write storage; when the WGSL language feature is absent, generation fuses the identical remap into a write-only pass. An indexed xz grid samples that height texture for vertex displacement. Central differences estimate normals in world units. Elevation and slope select the material; exponential distance fog blends into the background. The camera orbits deterministically from the runtime clock.

## References

- [WebGPU specification](https://gpuweb.github.io/gpuweb/)

## Passes and resources

Height generation/remap runs only after geometry, seed, height, sculpt or frequency changes, followed by one mesh pass and the runtime SDR resolve. The grid reallocates when segments changes; single/4x depth and colour attachments resize with the field. Mesh buffers and camera are inspectable. All owned buffers and targets are destroyed on detach.

## WebGPU features used

r32float storage with feature-detected read/write access, vertex texture sampling, index buffers, vertex-stage displacement, depth, 4x MSAA, HDR targets. No optional feature required.

## Reduced motion and fallback

The declared page-planning estimate is 4 ms at a 640×400 physical-pixel target. This is a conservative authored estimate for development warnings, not a measured guarantee or an assertion that this research effect meets the launch-page GPU gate.

Reduced motion presents the seeded height field at time zero, from the tuned 0.5-radian camera angle. Height generation remains cached until its geometry, seed or terrain parameters change. Automatic rendering stops after dirty work settles; parameter changes and resize still redraw the fixed view. Camera `speed: 0` also stops automatic redraws.

The bundled `poster.png` is the script-generated default settled pose (seed 7). `attach` uses it when WebGPU is unavailable; the declared CSS gradient remains a last resort if the image cannot load. Native light-DOM content remains readable and interactive, and both GPU canvas and poster are decorative. Generate an author poster with `node scripts/poster.mjs terrain <preset> <width>x<height> <output.png>` for a different theme or geometry, then pass that URL as the attachment's `poster` option.

## Parameters (generated)

<!-- params:start -->

| Parameter | Type  | Default   | Range / choices | Group      | Description                                                           |
| --------- | ----- | --------- | --------------- | ---------- | --------------------------------------------------------------------- |
| speed     | f32   | 0.25      | 0…2             | Camera     | Camera orbit speed in radians per second.                             |
| msaa      | enum  | "4x"      | off, 4x         | Rendering  | Single sample or four-sample depth-tested rendering with HDR resolve. |
| tint      | color | "#56c7dd" | —               | Material   | Linearized base material colour.                                      |
| segments  | u32   | 128       | 8…256           | Geometry   | Indexed height-field cells per side; reallocates only when changed.   |
| height    | f32   | 2.2       | 0…5             | Geometry   | Terrain elevation amplitude.                                          |
| sculpt    | f32   | 0.3       | 0…1             | Geometry   | Blend raw noise with a smoothstep height remap.                       |
| frequency | f32   | 2.5       | 0.2…8           | Geometry   | Seeded fractal-noise spatial frequency.                               |
| fog       | f32   | 0.06      | 0…0.3           | Atmosphere | Exponential distance fog density.                                     |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded on the development Apple M1 Max / macOS 26.6.2 using the production preview. Typed defaults, seed 7, physical 512² display, DPR 1, 4x MSAA and fixed quality. Each of three runs discards 30 warm-up updates then measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion and timestamp readback. Instances uses 4096 cubes, a render bundle and both occlusion probes; terrain uses a 128²-cell indexed grid; material-ball uses owned 64² GGX environment cubes; glass captures and composites a full-size scene. Initial environment convolution and terrain height generation are excluded from the steady-state sample window.

| Browser              | CPU mean ms           | Completion p95 ms     | Summed GPU pass p95 ms | rAF median ms            | Record                               |
| -------------------- | --------------------- | --------------------- | ---------------------- | ------------------------ | ------------------------------------ |
| chrome 154.0.8037.98 | 0.238 / 0.233 / 0.213 | 4.600 / 3.100 / 2.900 | 1.311 / 0.655 / 0.459  | 16.700 / 16.700 / 16.700 | [JSON](../benchmarks/m6-chrome.json) |
| webkit 26.6          | 0.258 / 0.250 / 0.250 | 3.000 / 4.000 / 5.000 | 1.334 / 1.123 / 1.440  | 17.000 / 17.000 / 17.000 | [JSON](../benchmarks/m6-webkit.json) |

CPU encoding, encoding-through-queue-completion wall latency, summed GPU pass timestamps and observed rAF cadence are separate measurements. Timestamp quantization and overlapping intervals limit interpretation; summed GPU time is not whole-frame elapsed time. Machine load is uncontrolled (other validation work may be running), logical allocations are not VRAM, and these measurements establish no cross-device refresh guarantee. The M6 exit is baseline capability coverage, not a speed threshold. Deterministic snapshots, CPU references and lifecycle tests establish separate correctness properties; see [M6 validation](../m6.md).

<!-- measurements:end -->

## Failure modes

256² cells require many noise evaluations when regenerated; resolution scaling reduces fragment work but not vertex work. A fixed grid aliases high spatial frequencies.

## Production readiness

LOD, edge stitching and input-driven camera movement remain out of scope.
