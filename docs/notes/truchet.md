# Truchet, hex and quasi-crystal contours (`truchet`)

## Question

Can signed cell coordinates, unsigned bit operations, and a seed create connected tile motifs without a texture or topology buffer? How does a quasiperiodic contour field differ from an actual aperiodic tiling?

## Technique summary

Square mode selects one of two Smith–Truchet orientations with the low bit of a coordinate hash. Two radius-one-half circles centered at opposite corners create arcs joining the four edge midpoints. Hex mode converts Cartesian positions to axial coordinates and rounds in cube coordinates, correcting the component with the largest rounding error. Each selected hex has three radius-one-half arcs centered on alternate vertices. The same bit selects one of the two vertex sets; both connect all six edge midpoints. Adjacent tiles therefore meet at fixed endpoints regardless of their selected orientation.

The coordinate hash bitcasts signed integer coordinates to unsigned bits, rotates the second coordinate by sixteen bits with shifts and OR, multiplies the axes by distinct odd constants, then mixes both coordinates and the seed using XOR and the shared avalanche hash. The orientation mask uses AND, and hex vertex indices use a left shift. These operations determine visible geometry, rather than serving as a separate diagnostic.

Quasi-crystal mode sums five or eight equally spaced cosine plane waves and draws a selected level contour. Their incommensurate direction components produce a quasiperiodic field; seed changes its translation and time pans all modes. This is an interference approximation with no polygon adjacency, matching rules, Penrose rhombi, or topology guarantee. The five-wave zero-phase field has tenfold symmetry about its untranslated origin; the eight-wave field has eightfold symmetry. A seed translation usually moves that origin outside the viewport. Antialiasing evaluates both coordinate and signed interference derivatives after all branches. Arcs use the length of the coordinate's derivative footprint as a conservative distance-space smoothing width, avoiding derivative collapse across an absolute-distance centerline or a nearest-circle tie. Interference contours use the signed field derivative before taking its absolute value. Colors mix in linear RGB and the ink alpha blends over an opaque ground.

## References

[W. Patrick Hooper: Truchet tilings and renormalization](https://wphooper.com/docs/papers/random_truchet.pdf) defines square tiles decorated with connecting arcs and investigates their curves. This implementation uses the square arc construction, but independently hashes cells rather than implementing the paper's measures or renormalization.

[Wang et al.: Observation of localization of light in photonic quasicrystals of diverse symmetries](https://arxiv.org/abs/2412.18253) studies quasicrystals created by interfering plane waves. Our scalar cosine sum and level contours are a visual analogy, rather than a simulation of the paper's optical intensity, medium, or wave propagation.

[WGSL specification: integer arithmetic](https://www.w3.org/TR/WGSL/#integer-arithmetic) and [derivative built-ins](https://www.w3.org/TR/WGSL/#derivative-builtin-functions) specify the unsigned arithmetic and uniform-control-flow requirements used here.

## Passes and resources

One fullscreen effect pass writes opaque linear color to the surface's `rgba16float` target. The shared resolve presents sRGB to the canvas. The field owns a 64-byte frame uniform, an aligned parameter uniform, and the target; shader and pipeline leases belong to the shared device resource cache. No tile map, sampled image, vertex buffer, or persistent effect texture is allocated. At 512×320, the float target occupies 1,310,720 logical bytes. Runtime destruction releases effect leases, buffers, target, observers, and listeners; readback resources are temporary and released after each verification.

## WebGPU features used

Baseline fragment shaders, signed and unsigned integer conversion, bitcast, XOR, OR, AND, shifts, loops, uniform buffers, float attachment rendering, and derivatives. No optional adapter feature is required. Reduced motion freezes the pan at time zero. The declared CSS checkerboard supplies the playground fallback when WebGPU is unavailable.

## Parameters (generated)

<!-- params:start -->

| Parameter | Type  | Default   | Range / choices             | Group     | Description                                                                    |
| --------- | ----- | --------- | --------------------------- | --------- | ------------------------------------------------------------------------------ |
| mode      | enum  | "truchet" | truchet, hex, quasi-crystal | Algorithm | Square arcs, hexagonal arcs, or quasiperiodic interference contours.           |
| waves     | enum  | "five"    | five, eight                 | Algorithm | Plane-wave count in quasi-crystal mode; this does not construct Penrose tiles. |
| scale     | f32   | 14        | 3…40                        | Geometry  | Coordinate units along the short stage dimension; hexes span two units.        |
| width     | f32   | 0.065     | 0.01…0.2                    | Geometry  | Arc half-width in tile units; quasi-crystal uses a scaled field threshold.     |
| level     | f32   | 0         | -0.6…0.6                    | Geometry  | Normalized interference level traced by quasi-crystal contours.                |
| grid      | bool  | false     | —                           | Geometry  | Show square or hex cell boundaries; quasi-crystal has no cell grid.            |
| speed     | f32   | 0.15      | 0…1                         | Motion    | Pan speed in pattern-coordinate units per second.                              |
| ink       | color | "#f1b987" | —                           | Palette   | Arc or contour color; alpha controls coverage over the opaque ground.          |
| ground    | color | "#172333" | —                           | Palette   | Opaque ground color; its alpha is ignored.                                     |

<!-- params:end -->

## Measurements

<!-- measurements:start -->

Recorded 2026-10-07 on Apple M1 Max / macOS 26.6.2. Default parameters, seed 7, 512×320 physical pixels, DPR 1, resolution scale 1. Three runs; each discards 30 warm-up frames then measures 120 explicit encode/submit calls at fixed 1/60 s in rAF. CPU timings exclude GPU execution; rAF cadence is not a GPU timer. Device state and load are uncontrolled. Logical allocation sizes are not VRAM.

| Browser              | CPU mean ms (three runs) | rAF mean ms (three runs) | Record                                       |
| -------------------- | ------------------------ | ------------------------ | -------------------------------------------- |
| chrome 154.0.8037.98 | 0.149 / 0.180 / 0.169    | 16.666 / 16.666 / 16.666 | [JSON](../benchmarks/m1-stretch-chrome.json) |
| webkit 26.6          | 0.267 / 0.117 / 0.258    | 16.150 / 15.633 / 15.733 | [JSON](../benchmarks/m1-stretch-webkit.json) |

Shader compilation is excluded. Optional GPU timestamp queries are deferred to M3. The SwiftShader pixel tests verify repeatability and disposal at DPR 1 and 2, both presets, every enum mode, and no compilation warnings. Hardware engines use the same compile/readback/disposal tests without cross-device image comparison.

<!-- measurements:end -->

CPU encoding and rAF cadence are not GPU execution time. Logical resource bytes are not driver VRAM.

## Failure modes

Derivative smoothing is local coverage estimation, not full integration of subpixel motifs. Dense patterns and reduced resolution can lose thin arcs; interference derivatives approach zero at extrema, where the minimum antialias width prevents division-like singular behavior but does not restore lost detail. The quasi-crystal width is measured in normalized field values, so equal widths do not produce equal geometric thickness around stationary points. Arc and grid coverage use the same conservative coordinate footprint, which can soften edges more than their exact normal derivative would.

Floating-point cell selection loses exactness at large coordinates, and converting to 32-bit integers imposes a finite domain. Very long-running pan animation should be reset before coordinates exceed that domain. This is a visual research effect; its integer hash is not a source of cryptographic randomness. Quasi-crystal mode is a contour illustration rather than an exact aperiodic mesh. Ground alpha is intentionally ignored.

## Production readiness

Use the documented scale and resolution controls to keep strokes visible. Validate endpoint continuity and coverage at the intended device pixel ratio before using the tile patterns in small UI surfaces. Exact Penrose geometry, exported topology, and supersampling would require separate techniques beyond the frozen T1 helper.
