# product-sheen

A T1 front-layer light band clipped by the bound product image's alpha. It adds only
the highlight; the real product image remains beneath it in the light DOM. A missing
image produces a transparent field instead of a rectangular sheen.

`progress` defaults to 0.5 for a finished static design. CSS or a timeline can drive
0…1; both endpoints are exactly transparent. The `automatic` preset uses -1 and a
1.2-second once-on-load sweep. Automatic motion is optional. Reduced motion forces
the settled transparent pose, leaving the original product image unchanged. Static
or completed sweeps stop GPU draws until an input or parameter changes.

```ts
const sheen = await attach(productWrapper, productSheen, { layer: 'front', playing: false });
await sheen.field!.bindInput('image', { kind: 'image', source: productImage });
```

The canvas, original image and bound alpha must use the same crop and normalized
placement. This effect does not infer `object-fit` transforms. Use a wrapper matching
the image's displayed aspect ratio, or supply an alpha image already cropped to it.

`--hgpu-progress`, `--hgpu-intensity` and `--hgpu-tint` are CSS-driven. Default intensity
is 0.2. Gaussian width is normalized to the image; output is premultiplied linear RGB.
The no-WebGPU DOM path keeps the authored image with no implicit fixture poster.
An explicit author poster may bake in the sheen. The bundled poster is a standalone
fixture, and no optional GPU feature, simulation or feedback texture is required.
