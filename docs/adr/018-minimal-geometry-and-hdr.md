# ADR-018: Minimal indexed geometry and HDR presentation

Accepted 2026-10-07 for M6.

## Decision

Keep T5 effects on `defineEffect`, with explicit resource ownership and render graphs. Add camera/matrix, indexed primitive, depth/MSAA and async pipeline helpers rather than a scene graph or asset loader. All four Family G core definitions are individually exported and discovered by the existing playground.

Matrices are column-major, right-handed, with camera forward along negative z and WebGPU clip depth in [0, 1]. A camera buffer stores view-projection and world-space eye in 80 bytes. Mesh records store position xyz, unit normal xyz and UV in 32 bytes, followed by u32 index buffers. Cube, UV sphere and xz grid primitives have outward winding. Perspective rejects invalid frusta, and look-at rejects degenerate bases.

Render pipelines support single sample and 4x MSAA, strict-less depth32float and back-face culling. Four-sample linear HDR colour resolves into the runtime's single-sample target. Depth is discarded after each scene pass. Size/sample changes replace owned attachments. Shader modules use reference-counted device leases and source overrides; pipeline creation is asynchronous, labeled and validation-scoped. Pipelines and bundles are retained by the instance and released by garbage collection after disposal; their opaque driver memory is not included in logical byte accounting.

`instances` reuses one indexed cube through direct or bundled instancing. Bundles reference live uniform buffers and rebuild only on count/sample changes. Baseline occlusion queries surround the real draw and a repeated identical draw. The second must fail strict-less depth and report zero samples. This proves query/depth coverage without claiming GPU culling.

`terrain` generates an r32float noise map, then remaps each texel in place independently. No invocation reads a neighbor while another writes it. Read/write storage is gated on `readonly_and_readwrite_storage_textures`; the fallback fuses the same transform into write-only generation. Vertex sampling and central differences drive displacement and normals. Changing segments recreates both mesh and height map; changing seed/height/frequency/sculpt regenerates the map.

The environment fixture uses six array layers in +X, -X, +Y, -Y, +Z, -Z order. Base HDR radiance is generated through a storage texture array; existing area-weighted mip generation covers all faces. Separate GGX convolution writes each roughness mip, and cosine convolution writes diffuse irradiance. Sampling uses cube views. No mip reads and writes overlapping subresources within a pass. Each prefilter dispatch has a distinct immutable roughness buffer. Face/mip taps are borrowed planes; callers must not retain them across destruction.

`material-ball` uses a GGX metallic/roughness BRDF with an analytic split-sum DFG approximation. The fixture is reproducible and needs no external assets. `glass` captures a background, renders the refracting sphere into a transparent resolved layer, then composites over the capture. Refraction is an explicit screen-space travel approximation, not traced two-surface geometry.

`createHDRCanvas` is an opt-in presenter for a separate caller-owned canvas. It verifies rgba16float, extended tone mapping and the requested gamut via `getConfiguration()`. Its opaque output flattens linear-premultiplied input over black, converts linear sRGB to linear P3 when requested, then encodes the chosen transfer function without clipping values above one. This differs from ordinary SDR resolves only at presentation. A copied float pixel verifies both the nonlinear transfer and extended range. Browser support and actual display luminance remain separate; unsupported configurations release the pipeline and unconfigure the context. The caller resizes, schedules draws, disposes and rebuilds it on device loss.

## Evidence and limits

[M6 validation](../m6.md) records software snapshots, CPU references, bundle equivalence, actual occlusion results, HDR numeric readback, hardware engines and steady-state benchmarks. Internal allocations are logical sizes, not VRAM. Initial convolution, shader compilation and height-map generation are excluded from steady-state benchmark windows. Native display appearance, physical weaker devices and M8 optional-feature experiments remain future validation.

References: [WebGPU specification](https://gpuweb.github.io/gpuweb/), [Filament PBR and IBL](https://google.github.io/filament/Filament.html), [Chrome's extended tone mapping introduction](https://developer.chrome.com/blog/new-in-webgpu-129).
