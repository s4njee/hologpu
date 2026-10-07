# ADR 011 — Premultiplied linear filter chains

Status: accepted for M4.

## Decision

`filterEffect({ wgsl })` is the T4 authoring helper. Its `effect(uv)` returns premultiplied linear RGBA, and binding 2 supplies the borrowed `image` input. `sample_image` performs clamped manual bilinear loads. Explicit extra bindings start at 3; generated `texture`, `curve` and `gradient` schema bindings start at 16 and expose `sample_<name>` functions. Curve and gradient samplers map normalized coordinates onto the endpoint texel centres of their one-dimensional LUTs; texture selectors retain ordinary two-dimensional UVs. The input provider resolves texture selectors and owns baked LUTs.

An optional asynchronous `setup({ ctx, input })` factory enables multiple passes, private textures and additional resource bindings. Factories report owned memory, sources, diagnostics and taps through the regular instance contract. The helper owns a deterministic 64² RGBA32 HDR fallback card, so every filter is independently usable without a network asset. Binding views restrict declared mip and array selection to one 2D subresource.

`chain(a, b, c)` accepts a source of any tier followed by T4 filters. Each child owns an independent ParamStore and aligned parameter uniform; the aggregate schema uses `s0_`, `s1_`, etc. prefixes. Generated child inputs first resolve their prefixed parent names. All children share the immutable frame description and device session. Their parameters flush before updates and renders; feedback children retain their own normal fixed-step snapshot semantics. Intermediate stage outputs are owned RGBA16 textures, and the last filter writes directly to the caller target.

Chain outputs are not passed through an SDR resolve between stages. HDR values and alpha coverage survive until the canvas presentation layer. Each child source and tap is prefixed with its stage index; composed code also carries a stage identity comment so repeated effect definitions can be edited independently; local shader edits, diagnostics, profiler labels and resource tracking remain available through the ordinary runtime. Resizing replaces intermediates and forwards resize to every child; reset forwards the common seed; disposal releases children, parameter buffers and intermediates exactly once.

## Consequences

Inputs are borrowed: a filter never destroys an externally supplied texture. Reading a source of another tier uses its rendered colour output unless the caller explicitly binds a physical-state texture to a second input such as the displacement map. The runtime owns source dependencies and frame scheduling; chain itself only owns its internal stages.

A four-stage image chain still allocates three full-size colour intermediates. Multipass filters add their own pyramid targets. Estimated bytes are logical allocation sizes, not driver VRAM. A shared RGBA16 target avoids a separate format negotiation protocol, with manual float32 sampling as the fallback for input precision.

Preset combinations expose the first and second declared preset from each child under aggregate `first` and `second` presets. Parameters remain stable under repeated child ids because prefixes use positions rather than effect names. A chain id incorporates child ids for reproducible identification.

## Evidence

`tests/browser/filters.spec.ts` compares separable blur kernels, boundaries and impulse energy to CPU references; checks HDR constant preservation, 3D LUT matrix/operator math, baked tone curves, threshold bloom, signed-map coordinates, Sobel stencils, dither means and real atlas coverage; and checks independent prefixed uniforms and intermediate taps in a four-filter chain. Every instance must leave no pipeline/module references and no GPU errors after disposal. Catalogue snapshots, arbitrary-tier source tests and hardware refresh measurements are tracked by the M4 validation record.
