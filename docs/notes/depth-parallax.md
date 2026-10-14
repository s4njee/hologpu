# Subtle depth parallax (`depth-parallax`)

This baseline T4 filter shifts a product image using an aligned, authored grayscale depth map. White represents near content and black leaves far content fixed. The effect owns no simulation or history: pointer, progress and image/depth changes drive one fragment pass, which settles between changes. The default amount is 0.015 of the displayed image width with intensity 0.25, giving at most 0.375% of width (2.25 CSS px on a 600 px image). Increasing intensity strengthens this motion, with an absolute vector displacement limit of 2% of image width even in combined mode. Reduced motion returns the original image with zero offset; amount or intensity 0 also preserves the image.

```ts
import { attach } from '@mk7s/hologpu-dom';
import depthParallax from '@mk7s/hologpu-effects/depth-parallax';
const host = document.querySelector<HTMLDivElement>('.product-image')!;
const image = host.querySelector('img')!;
await image.decode();
const map = new Image();
map.src = '/product-depth.png';
await map.decode();
const layer = await attach(host, depthParallax, { layer: 'front' });
await layer.field?.bindInput('image', image);
await layer.field?.bindInput('depth', { kind: 'mask', source: map, channel: 'red' });
```

Use the linear `mask` input for PNG grayscale depth. It preserves gray 128 as approximately 0.502, rather than applying the sRGB decoding appropriate to photographs. The `depthSource` texture parameter can name another depth binding. A missing map uses an owned 1×1 black mask and keeps the image unchanged. Image and depth must use the same UV alignment and aspect ratio; use a shadow-root-compatible host such as a `div` matching the image's displayed content rectangle, avoiding unmatched `object-fit` letterboxing or cropping. Depth maps need not have identical pixel dimensions, but higher resolution helps fine boundaries.

The pointer mode uses host-local normalized pointer position, with the centre neutral. It shifts the sampling position toward the pointer, so visible near content moves in the opposite direction, like a camera moving across the image. Progress mode ignores pointer movement and uses `--hgpu-progress`: 0.5 is neutral, 0 moves visible content downward and 1 upward. Combined mode adds both controls and bounds their vector magnitude, with vertical UV displacement adjusted to preserve a limit expressed in image-width CSS pixels. `--hgpu-amount` and `--hgpu-intensity` are also CSS-driven. These three numeric bindings do not recolour the product.

Sampling clamps to the image's texel centres. Disoccluded boundary pixels use a small premultiplied cross blur (0.75 CSS px by default) to soften stretched edge samples; interior pixels retain unblurred sampling. This fill cannot reconstruct content that was absent from the original image, and depth discontinuities can stretch or tear at larger offsets. Smooth depth transitions or authored background padding help. Keep default motion subtle and visually inspect both authored depth maps in the demo; mathematical bounds do not establish that edge artefacts are invisible for every image.

The fallback keeps the real light-DOM `<img>`, preserving its alternative text and layout. Hide that native image visually while the front GPU image is ready to avoid compositing translucent pixels twice, then restore it in fallback; the DOM integration handles this state. The bundled poster supplies the standalone catalogue preview, and an explicit caller poster retains priority. Full resolution is recommended for small screenshot text; 0.5 is suitable for larger illustrations after inspection. There are no optional GPU features or captured DOM pixels. Performance budgets require dedicated native captures and are not claimed here.

The filter owns one byte of neutral depth plus its shared pipeline lease; the filter wrapper owns its 64×64 default image fixture. Caller image/depth inputs remain borrowed. Texture views honour mip level and array layer, and bindings refresh when these identities change. Focused browser tests compare raw linear output with an independent identity filter, measure gradient-image shifts against analytical distances, verify linear gray depth and the 2% cap, exercise edge-only blur and premultiplied alpha, and check borrowed lifetime and plain-image fallback.

<!-- params:start -->

| Parameter   | Type    | Default   | Range / choices             | Group  | Description                                                                              |
| ----------- | ------- | --------- | --------------------------- | ------ | ---------------------------------------------------------------------------------------- |
| depthSource | texture | "depth"   | —                           | Source | Linear grayscale depth binding: white moves near content, black keeps far content fixed. |
| mode        | enum    | "pointer" | pointer, progress, combined | Motion | Pointer, vertical progress or their bounded combination.                                 |
| amount      | f32     | 0.015     | 0…0.02                      | Motion | Maximum displacement as a fraction of CSS image width, before intensity.                 |
| intensity   | f32     | 0.25      | 0…1                         | Motion | Fraction of the bounded parallax displacement to apply; zero preserves the image.        |
| progress    | f32     | 0.5       | 0…1                         | Motion | Vertical displacement position; 0.5 is neutral, used in progress and combined modes.     |
| edgeBlur    | f32     | 0.75      | 0…2                         | Edges  | Small CSS-pixel blur of clamp-filled disoccluded edges only.                             |

<!-- params:end -->
