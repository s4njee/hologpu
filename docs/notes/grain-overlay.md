# Quiet film grain (`grain-overlay`)

A transparent T1 layer adds fine seeded film grain over an existing light or dark page background. Use `attach(host, grain, { layer: 'front' })`; light DOM content remains interactive. Default opacity is 4%. The image input is optional and only weights grain by image luminance; it does not paint the image itself.

`rate` controls both noise identity and actual scheduled GPU draws (12–24 updates/second). Parameter and input invalidations draw immediately; changing image inputs can therefore refresh the luminance response faster than the grain. Explicit `drawAt` remains immediate for deterministic capture. Reduced motion renders seeded static grain at time zero. Output is linear premultiplied alpha, including transparent colour stops.

`poster.png` is the generated default reduced-motion fallback; `noise-tile.png` is a 64² repeating PNG from the same seed/pose for the CSS background. Regenerate with `node scripts/poster.mjs grain-overlay default 640x400` and `node scripts/poster.mjs grain-overlay default 64x64 packages/effects/src/grain-overlay/noise-tile.png`.

Keep intensity between 0.03 and 0.06. Grain can consume video-compression bandwidth, and changing resolution scale changes its physical-pixel footprint. It has no simulation history and owns only a neutral four-byte texture when no image is bound. Performance measurements are recorded in the section 3.1 validation report.

<!-- params:start -->

| Parameter       | Type  | Default   | Range / choices | Group   | Description                                                                         |
| --------------- | ----- | --------- | --------------- | ------- | ----------------------------------------------------------------------------------- |
| intensity       | f32   | 0.04      | 0…1             | Texture | Grain alpha; 0.03–0.06 is recommended over page backgrounds.                        |
| rate            | f32   | 18        | 12…24           | Motion  | Actual scheduled grain updates per second; explicit draws still render immediately. |
| luminanceWeight | f32   | 0.25      | 0…1             | Texture | Optional image luminance reduces grain in dark areas; no image gives uniform grain. |
| tint            | color | "#ffffff" | —               | Palette | Light grain colour.                                                                 |
| shadow          | color | "#000000" | —               | Palette | Dark grain colour.                                                                  |

<!-- params:end -->
