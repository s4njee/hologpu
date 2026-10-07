# ADR 005: freeze the T1 fragment effect contract

Status: accepted for M1, 2026-10-07. Other tiers remain provisional.

## Decision

`fragmentEffect({ id, title, params, wgsl, ...metadata })` returns an immutable outer `EffectDefinition`. The fragment body implements `fn effect(uv: vec2f) -> vec4f`, with normalized top-left-origin UVs and **straight-alpha, linear sRGB** output. The helper multiplies RGB by clamped alpha into an internal `rgba16float` target; the shared resolve converts to premultiplied sRGB for a normal SDR canvas. HDR values require an explicit tone map in the effect; an internal float target does not enable an HDR canvas.

The definition declares family, tier, tags, Core status, required GPU features, inputs, presets, resolution range, reduced-motion time and CSS fallback. `features` are required features requested when available; unsupported requirements fail with a reason. Optional/degraded feature variants will extend the contract in later tiers. The six M1 effects require none.

`createEffect(canvas, definition, options)` returns a ready `EffectField`. The runtime owns the canvas surface, frame and parameter buffers, observers, pointer listeners and device lease. Effects own any custom allocations they create. `destroy()` is idempotent. The instance contract is `resize`, `update`, `render`, `reset`, `dispose`, with optional composed sources and diagnostics. T1 instances have no persistent simulation state. Use the public facade `@mk7s/hologpu` and per-effect `@mk7s/hologpu/effects/<id>` exports.

## Parameters and uniforms

The frozen T1 schema supports `f32`, `i32`, `u32`, `bool`, `vec2`, `vec3`, `vec4`, `color`, and `enum`. Each numeric parameter can declare min/max/step, group, description and unit. Uniform layout follows WGSL alignment: scalars 4 bytes, vec2 alignment 8, vec3/vec4 alignment 16; a scalar may occupy the fourth lane after vec3. Overall allocation rounds to 16 bytes. Booleans use u32; enum values are option indices. `color` is linear vec4 including alpha. Hex colours work in Node; other CSS syntax uses browser Canvas2D, which currently converts to sRGB and may quantize or gamut-clip. Texture-backed `curve`, `gradient` and `texture` parameters from plan section 5.5 are reserved for M4's binding/input work and are not advertised by this T1 API.

`field.params.name = value` validates and dirties the uniform buffer. Vectors are immutable snapshots; assign a complete replacement vector. `field.store.patch()` validates every entry before applying any. Finite numeric values clamp to ranges; invalid types, unknown keys and enum values throw. Entries with `uniform: false` stay CPU-side and trigger the instance's resize hook. CSS property bridges are deferred to M5; `css` metadata alone does not bind CSS.

The frame block is 64 bytes: resolution in physical target pixels, effective DPR including resolution scale, elapsed effect time, normalized pointer, pointer velocity per second, fixed delta, frame index, button bitmask, seed, normalized scroll, intersection ratio and pressure. Seed is u32. `frame.time` advances at fixed 1/60 s; normal animation performs at most six catch-up steps per frame. Resolution scale defaults to 1, bounded by the effect's range; DPR defaults to a cap of 2. Invisible fields stop updating and rendering; hidden documents stop the shared scheduler. Reduced motion freezes at the declared pose and reduces pointer velocity.

## Composition and lifetimes

Chunks are dependency-ordered and emitted once by identity; conflicting definitions and cycles fail. Source line regions map compiler messages to chunk-local locations. Async shader/pipeline creation shares device-scoped leases. Explicit frame/parameter bind layouts keep unused uniforms legal. Shader warnings fail creation rather than silently degrading an effect. Rendering encodes one shared command buffer and submits once per scheduled page frame.

Shader modules, pipelines, bind layouts and samplers have keyed resource leases. The texture pool bounds idle textures to two per descriptor and destroys outstanding leases when the session closes; each M1 surface directly owns and destroys its float target. These are logical allocation counts, not driver memory measurements. Recovery scaffolding is present, but end-to-end DOM recovery and `<hgpu-field>` remain M5 work.

## Evidence and boundary

The [19-line example](../../examples/bands.ts) defines its schema and WGSL without renderer code. `scripts/check-catalogue.mjs` copies it into a temporary effects directory and confirms discovery and individual exports without modifying the playground. A restart/build/typecheck runs `pnpm catalogue`; adding a directory while the dev server is already running requires rerunning it. The six real effects exercise the same helper.

Unit tests cover alignment, packing, dirty flags, atomic validation, chunk conflicts, resource leases and fixed-step scheduling. Browser tests cover repeatable pixels, both presets, enum modes, generated controls, URL reload, sharing, resize, alpha conversion and disposal. Pixel probes distinguish paired addition/multiplication from ordinary f32. A raw compute-buffer test compares 64 bounded cases, including cancellation, against a CPU f64 reference. Integer reconstruction forces intermediate rounding before compensation; this addresses the reassociation failure found on Metal. Extreme exponents and full iteration error remain research limits.

T2–T5 helpers, input/LUT bindings, quality adaptation, GPU profiling and DOM attachment are intentionally outside this frozen T1 contract. The M1 playground is the Full-stage shell specified by its milestone; the full section 7 feature list is delivered across later milestones.
