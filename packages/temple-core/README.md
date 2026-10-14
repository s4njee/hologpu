# @mk7s/hologpu-temple-core

The shared WebGPU core behind the holofx temples (Fire Temple, Water Temple): the
device/context helpers, render targets, texture and mipmap utilities, the shared
passes (blit, blur, downsample, common), the HDR post chain, scene primitives
(camera, mesh, geometry, orbit, forward lighting) and the shared WGSL library.

It is built with WGSL inlined as strings, so it works without a bundler plugin.

```sh
npm install @mk7s/hologpu-temple-core
```

Part of [HoloGPU / holofx](https://github.com/s4njee/hologpu). Licence: MIT.
