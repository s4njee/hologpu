# Masked composite

Mix an original image with a filtered output through an authored coverage mask. Both colour inputs use linear premultiplied RGBA; the filter interpolates all four channels together, so translucent edges retain correct colour and alpha.

```ts
const composite = await createEffect(canvas, maskedComposite, { playing: false });
await composite.bindInput('image', { kind: 'image', source: originalImage });
await composite.bindInput('filtered', filteredField);
await composite.bindInput('mask', { kind: 'mask', source: maskCanvas, channel: 'alpha' });
composite.params.blend = 1;
```

Canonical `mask` descriptors extract CPU coverage into a single-channel linear `r8unorm` texture. The default `maskChannel: 'red'` reads that coverage directly, without a colour transfer. The descriptor can extract source alpha, red or luminance; extraction happens once per binding, so rebind a changed canvas. `maskChannel: 'alpha'` or `'luminance'` is for legacy RGBA inputs and field-generated masks, not canonical single-channel masks. Luminance is measured from the premultiplied linear RGB channels.

Coverage is clamped to 0…1, then multiplied by `blend`. A zero mask or `blend: 0` returns the original; full coverage with `blend: 1` returns the filtered output. Missing masks use an owned opaque white pixel. Missing filtered outputs use the original, making the unbound effect an identity filter.

`sceneSource`, `filteredSource` and `maskSource` let authors choose binding names. `sceneSource` defaults to `original` and overrides the primary image when bound. This supports the LCD pattern `chain(displace, maskedComposite)`: bind the photograph to both `image` and `original`, bind the pointer map to `map`, and bind coverage to `mask`. The incoming displaced stage then supplies the filtered branch automatically. The existing LCD demo retains its specially tuned map and artwork.

`--hgpu-blend` supports CSS transitions. Attach a composite in front of its authored `<img>` when using DOM content; the image remains visible during fallback. Reduced motion leaves this static composite unchanged and should freeze the filtered source's motion separately. Same-device field inputs are borrowed directly at their base mip, avoiding conversion copies; raw images and media still receive their normal input preparation. There are no intermediate render targets: the pass owns only a four-byte coverage pixel plus the filter scaffold's 64 KiB standalone fixture. Borrowed fields and media keep their own lifetimes.
