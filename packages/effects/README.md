# @mk7s/hologpu-effects

The HoloGPU effect definitions: procedural shaders, feedback simulations,
particles, filters and geometry, each exported on its own path so one effect can
be imported alone.

Part of [HoloGPU](https://github.com/s4njee/hologpu). Usually imported through the
facade `@mk7s/hologpu/effects/<id>`. Effect posters use
`new URL('./poster.png', import.meta.url)` and ship beside the built effect; see the
[README](https://github.com/s4njee/hologpu/tree/main/packages/hologpu#posters-and-asset-urls)
for how that behaves under different bundlers.

```sh
npm install @mk7s/hologpu-effects
```

Licence: MIT. See the [repository](https://github.com/s4njee/hologpu).
