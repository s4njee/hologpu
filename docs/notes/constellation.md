# Constellation (`constellation`)

A transparent, faint network for a launch-page section. Each seeded grid cell holds one point and connects only to its eight immediate neighbours. The 88 CSS-pixel default pitch, 1.5 px point radius and 0.7 px stroke remain stable across DPR and resolution scale. Shorter connections fade in more strongly; `linkDistance` is expressed in lattice pitches. The default 0.22 point opacity and relative 0.28 connection opacity keep copy dominant.

The effect uses one baseline T1 fullscreen fragment pass with no textures, feedback, particle buffers, spatial hash or sorting. A fragment hashes the nine points surrounding its cell and evaluates twelve local segments: eight incident links and four diagonal neighbour links that can cross the cell without an endpoint in it. This avoids seams at grid boundaries while keeping every point's degree bounded to eight. Jitter and drift together never exceed 0.35 of a cell, so the local search is sufficient. RGB is returned straight; the fragment scaffold premultiplies output.

Slow bounded drift and gentle dimming add motion to the complete time-zero design. Reduced motion uses the time-zero scatter and stops scheduled draws. Setting `speed: 0`, or both `drift: 0` and `twinkle: 0`, also stops automatic renders after dirty work settles. There is no pointer input, so the composition is equally meaningful on touch devices. Intensity zero is transparent and stops animation. `--hgpu-tint` and `--hgpu-intensity` theme the field; `quiet`, `ember` and `paper` presets give light and dark page choices.

The default resolution scale is 0.5: soft, faint connections are suitable for an ambient backdrop and use a quarter of the full-scale fragment pixels. CSS-pixel geometry is preserved through the effective DPR. Pass `resolutionScale: 1` for sharper thin strokes; the browser geometry tests use that reference setting. The generated settled poster is the no-WebGPU fallback; generate an author poster for a different theme, seed or aspect ratio. The field is decorative and belongs behind readable DOM content.

Browser checks cover identical time/seed frames, different seeds and times, bounded premultiplied alpha, presets, CSS-pixel geometry at DPR 1/2, line continuity at cell boundaries, reduced and explicitly disabled motion, idle scheduling and resource cleanup. Measure the per-field 0.5 ms Chrome / 1.5 ms WebKit targets and 4 ms page gate with the section 3.6 page benchmark; shader complexity alone does not establish budget acceptance.

## Parameters (generated)

<!-- params:start -->

| Parameter    | Type  | Default   | Range / choices | Group      | Description                                                      |
| ------------ | ----- | --------- | --------------- | ---------- | ---------------------------------------------------------------- |
| pitch        | f32   | 88        | 32…200          | Geometry   | Spacing of the seeded point lattice in CSS pixels.               |
| radius       | f32   | 1.5       | 0.5…5           | Geometry   | Point radius in CSS pixels.                                      |
| width        | f32   | 0.7       | 0.25…3          | Geometry   | Connection stroke width in CSS pixels.                           |
| jitter       | f32   | 0.6       | 0…1             | Geometry   | Seeded point displacement, up to a quarter of the lattice pitch. |
| linkDistance | f32   | 1.5       | 0.5…2.5         | Geometry   | Maximum neighbour distance, measured in lattice pitches.         |
| tint         | color | "#a4b4d2" | —               | Palette    | Point and connection colour; alpha scales the whole field.       |
| intensity    | f32   | 0.22      | 0…1             | Appearance | Maximum point opacity; connections stay fainter.                 |
| lineOpacity  | f32   | 0.28      | 0…1             | Appearance | Connection opacity relative to the points.                       |
| drift        | f32   | 0.08      | 0…0.1           | Motion     | Slow bounded point drift, measured in lattice pitches.           |
| twinkle      | f32   | 0.15      | 0…0.5           | Motion     | Gentle point dimming; zero keeps point brightness steady.        |
| speed        | f32   | 0.04      | 0…0.2           | Motion     | Slow drift and twinkle angular speed; zero settles the field.    |

<!-- params:end -->
