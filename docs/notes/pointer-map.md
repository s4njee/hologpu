# Pointer map

A baseline T1 data texture renders a Gaussian lens centred on the pointer. Its circular footprint uses the host aspect ratio and `radius` as a standard deviation normalized to host height. It has no time-driven grain, swirl or animation: unchanged frames submit no GPU work.

`encoding: 'normal'` writes RG around neutral `[0.5, 0.5]`. `encoding: 'flow'` writes signed RG around `[0, 0]`. Both put lens height in blue, centred on 0.5, and use opaque alpha. These are linear data values, so bind the field directly rather than uploading a screenshot or applying an sRGB transfer.

```ts
const map = await createEffect(mapCanvas, pointerMap, {
  present: false,
  pointerTarget: canvas,
});
const displaced = await createEffect(canvas, displace, {
  params: { mode: 'refraction', encoding: 'normal', amount: 0.01 },
});
await displaced.bindInput('image', { kind: 'image', source: originalImage });
await displaced.bindInput('map', map);
```

Give the map canvas the same CSS bounds as the consumer, so normalized pointer coordinates describe the same image. Use matching encodings in both effects. `displace`'s refraction mode uses RG; glass mode additionally differentiates the blue height channel. Neutral maps therefore preserve the original in either mode. Reduced motion forces the map fully neutral, including height, and `intensity: 0` does the same in normal motion.

The default `center: [-1, -1]` follows `frame.pointer`. Set `center` to normalized `[x, y]` when another host drives the interaction, as in the product-screen recipe; any negative component restores pointer tracking. `--hgpu-intensity` controls vector and height strength, with a quiet default of 0.25. The map has no brand colour because its channels carry data. If the source texture is unavailable, show the original authored image rather than interpreting the map poster as product artwork.

The pass allocates no textures or simulation buffers beyond the runtime's output and uniform buffers. Destroying a displaced consumer does not destroy its borrowed map field. For a screen-only treatment, put `masked-composite` after `displace` and bind an authored mask so the bezel and foreground remain unchanged.
