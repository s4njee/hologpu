# Wave divider (`wave-divider`)

One baseline T1 fragment pass fills the lower side of a gently moving two-sine edge. `amplitude` is measured in CSS pixels through the effective frame DPR, so DPR and resolution scale leave its geometry unchanged. The default amplitude is 18 px, baseline is half the host height, primary frequency is 1.15 cycles across the width, and speed is 0.12 radians per second. The second term has 0.35 amplitude, twice the frequency, and a fixed 1.3-radian phase offset. No texture input, feedback, history, or additional allocation is needed.

`fill` accepts a CSS colour; use the next section's **opaque** background colour. There is no opacity/intensity control because this surface joins another opaque surface. Alpha is used only to antialias the edge; the bottom backing-pixel row receives the full authored fill, including at reduced resolution. A translucent authored fill retains its authored alpha and cannot make an opaque seam. `amplitude`, `baseline`, `cycles`, `phase`, and `speed` also accept CSS bindings. Amplitude is limited to leave 2 CSS px of top/bottom clearance (one quarter of the height for small hosts), preventing the wave from leaving its host. Derivative AA uses the shared SDF chunk's warped-box edge and the local slope. Reduced motion explicitly freezes shader time at zero even when callers use `drawAt`.

The effect fallback is transparent. Keep an author-owned SVG in the ordinary DOM and attach the GPU canvas over it; set `poster: ''` to suppress a fixture poster. Import `waveDividerPath(width, height, params?)` from the same effect module, put its result into a closed SVG `<path>`, set `viewBox="0 0 width height"`, and use the same opaque fill CSS variable as the adjacent section. Refresh the path when the host dimensions or geometry parameters change. The optional geometry parameters are `amplitude`, `baseline`, `cycles`, and `phase`; speed does not affect the time-zero fallback. The helper validates finite positive dimensions and finite numeric parameters, and clamps parameters to the effect's declared ranges. Both implementations use shared constants/defaults and the same amplitude ceiling. SVG has no analytic sine path command, so vertices evaluate the exact time-zero function, with curvature-bounded subdivisions limiting straight-segment interpolation error to 0.01 CSS px.

Place the canvas and SVG as block layers with no inline baseline gap, no bottom margin, and the next section immediately below. Prefer 64–128 px divider height and modest frequency. Keep the adjacent section background in DOM so readable content and the SVG shape remain available without WebGPU. Example CSS bindings: `--hgpu-fill: var(--section-fill); --hgpu-amplitude: 18; --hgpu-speed: .12`.

Suggested checks: compare measured 50% edge positions with the analytic function and SVG vertices at DPR 1/2 and scales 1/0.5; check an oversized amplitude on a shallow host; verify all bottom-row pixels equal the section fill; read reduced poses at several explicit times; resize the SVG fallback and confirm its closed lower corners meet the next section.

## Parameters

<!-- params:start -->

| Parameter | Type  | Default   | Range / choices                      | Group    | Description                                                          |
| --------- | ----- | --------- | ------------------------------------ | -------- | -------------------------------------------------------------------- |
| fill      | color | "#11191c" | —                                    | Palette  | Use the next section’s opaque background colour for a seamless join. |
| amplitude | f32   | 18        | 0…64                                 | Geometry | Wave height in CSS pixels; limited to fit the host without clipping. |
| baseline  | f32   | 0.5       | 0.25…0.75                            | Geometry | Resting edge position as a fraction of divider height.               |
| cycles    | f32   | 1.15      | 0.25…4                               | Geometry | Primary sine cycles across the divider width.                        |
| phase     | f32   | 0         | -3.141592653589793…3.141592653589793 | Geometry | Phase offset shared with the static SVG path.                        |
| speed     | f32   | 0.12      | 0…0.4                                | Motion   | Gentle phase travel; zero holds the time-zero shape.                 |

<!-- params:end -->

Browser coverage and captured native timing gates are recorded in [section 3.5 validation](../v2-transitions.md).
