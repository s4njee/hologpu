# Grid horizon (`grid-horizon`)

A transparent, low-alpha perspective floor. Rays from a fixed camera intersect a horizontal plane. The plane coordinates form a regular grid, with line coverage derived from `fwidth` so the projected line weight is expressed in CSS pixels. High-frequency lines fade before they become unresolved; exponential distance fog and a soft horizon gate prevent a bright or shimmering vanishing point. Derivatives execute uniformly across the fragment pass.

The default is stationary, with intensity 0.18. Set `speed` for optional slow forward travel; reduced motion freezes a tuned time-zero pose. Both `tint` and `intensity` accept CSS bindings. The empty upper field and inter-line space stay transparent, allowing an ordinary DOM page background and copy to remain visible.

One baseline fullscreen fragment pass; no additional texture inputs, feedback, or optional features. The declared fallback is an embedded static SVG using the same default camera geometry, a fog mask, and 1 px lines at its reference size. It stretches to its host; for exact geometry or non-default parameters use the generated reduced-motion poster. The `quiet`, `dusk`, and `ember` presets remain restrained backgrounds.

Suggested verification: DPR 1/2 at fixed CSS size and scales 1/0.5; compare near-field projected line widths; inspect horizon frames with `speed: 0.1` for aliasing; verify stationary reduced-motion readbacks over time; inspect transparent output over light/dark backgrounds and no-WebGPU SVG fallback. Budget target: ≤0.2 ms GPU per field, measured through the section 3.1 page benchmark.
