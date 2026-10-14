# Dot matrix field (`dot-matrix-field`)

A transparent technical backdrop with a regular CSS-pixel lattice. The default 24 px pitch and 1.15 px dot radius stay constant at DPR 1 and 2 and when resolution scale changes: the shader divides target resolution by the effective frame DPR. A signed-distance circle uses an analytic half-pixel edge. The shared value-noise chunk gently modulates radius and opacity by at most ±15%.

Pointer proximity adds a small radius and opacity boost; the regular lattice is already a complete design without interaction. Reduced motion removes breathing and halves pointer strength, using the frame's reduced-motion flag. CSS `--hgpu-tint` and `--hgpu-intensity` theme the field. The default intensity is 0.2. The fallback is a repeating CSS radial gradient with the default pitch and dot radius; custom themes and geometry should use a generated poster or author-supplied equivalent gradient.

One baseline fullscreen fragment pass; no textures, feedback, or optional WebGPU features. RGB is returned straight to `fragmentEffect`, which performs premultiplication. Prefer full scale for subpixel dots; half scale preserves geometry but softens dot edges. Use the generated reduced-motion poster in production attachments.

Suggested verification: render a 384×240 CSS field at DPR 1/2 and scales 1/0.5, compare dot-centre spacing and integrated dot footprints; compare reduced-motion frames at different times; compare pointer strength at the same coordinate with motion enabled/disabled; inspect over white and dark backgrounds. Budget target: ≤0.3 ms GPU per field; measurement is recorded by the section 3.1 page benchmark, not inferred from shader complexity.
