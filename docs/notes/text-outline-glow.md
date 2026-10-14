# Cached text outline and glow (`text-outline-glow`)

Attach this decorative transparent layer over a real DOM heading. A text mask seeds the existing baseline JFA+1 helper once; a single steady fragment pass reads the cached signed distance and paints an exterior exponential halo, crisp outline, or both. Glyph interiors remain transparent so the light-DOM text supplies the content. Intensity defaults to 0.18. Colour, intensity, width, and falloff support CSS bindings.

The cache key includes mask texture identity, dimensions, mip, array layer, and upload version. Time, pointer, palette, opacity and stroke-width changes do not rerun JFA. Changing core render resolution alone retains the cache; DOM attachments re-rasterize when effective DPR changes, which supplies a new mask and rebuilds JFA. A changed text mask does, including a same-texture upload with a new version. `distance` and `nearest` debug taps expose the cache generation as `version`. Borrowed inputs are never destroyed; the effect owns its default mask and two seed textures plus the distance texture.

Stroke width and falloff use CSS pixels, dividing physical render size by effective DPR. Real DOM masks should match the host aspect ratio; the unbound default GPU glyph fixture scales to fit and conservatively uses the smaller mask-to-CSS scale if stretched. Strong anisotropic resizing can distort distance estimates. JFA is approximate and thresholded at 50% coverage; very fine fonts and narrow counters can have a one-mask-pixel distance error. Keep full resolution for crisp small type and provide ordinary CSS padding around headings so the halo is not clipped by the host bounds.

Reduced motion disables breathing and pointer amplification for a fixed finished halo. The default 25-second breathing cycle changes opacity by ±4%, with pointer amplification off. The bundled poster is the default settled glyph fixture; ordinary DOM attachments instead apply a palette-, falloff-, and opacity-aware CSS `text-shadow` to their actual heading when WebGPU is unavailable. A caller-supplied poster can override that text-aware fallback. The shader background itself stays transparent; the fallback retains the real heading and its readable glyph fill.

Versioned source textures must advance their `version` after an in-place mutation, then invalidate or explicitly draw the field; changing a counter alone does not wake a settled field. Unversioned texture inputs conservatively normalize on every draw, so they rebuild JFA every draw and cannot benefit from this cache. DOM text/font/size changes should trigger a new mask upload through the attachment layer. The DOM rasterizer targets ordinary horizontal text; complex bidirectional shaping across styled nodes, vertical writing, and transformed hosts need separate alignment verification. Computing the field on first use or after a mask change has an initialization cost; that cost is not the steady fragment budget. No optional GPU features, feedback, or simulations are required. The ≤0.3 ms steady GPU goal requires native captures and is not claimed here.

<!-- params:start -->

| Parameter       | Type  | Default   | Range / choices     | Group       | Description                                                             |
| --------------- | ----- | --------- | ------------------- | ----------- | ----------------------------------------------------------------------- |
| mode            | enum  | "glow"    | glow, outline, both | Appearance  | Soft exterior halo, crisp exterior outline, or both.                    |
| tint            | color | "#c2b8e6" | —                   | Palette     | Soft halo colour.                                                       |
| outlineTint     | color | "#ebe5ff" | —                   | Palette     | Crisp outline colour.                                                   |
| intensity       | f32   | 0.18      | 0…1                 | Appearance  | Peak exterior glow or outline opacity.                                  |
| glow            | f32   | 6         | 0.5…32              | Geometry    | Exponential halo falloff in CSS pixels.                                 |
| width           | f32   | 1         | 0.25…6              | Geometry    | Exterior outline width in CSS pixels.                                   |
| breathing       | f32   | 0.04      | 0…0.15              | Motion      | Optional slow opacity breathing; disabled with reduced motion.          |
| speed           | f32   | 0.25      | 0…0.5               | Motion      | Breathing angular speed; default cycle is about 25 seconds.             |
| pointerStrength | f32   | 0         | 0…0.2               | Interaction | Optional pointer proximity opacity boost; disabled with reduced motion. |
| pointerRadius   | f32   | 160       | 32…480              | Interaction | Pointer boost radius in CSS pixels.                                     |

<!-- params:end -->
