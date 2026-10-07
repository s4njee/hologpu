# ADR 012: Reusable jump flooding and deterministic 2D light

Status: Accepted for the M4 research implementation.

## Decision

Expose `createJumpFlood(session, [width,height])` as a reusable core helper. It borrows an equal-size sampled float mask, writes nearest coordinates into rg32float ping-pong textures and signed distance into r32float, and owns its shaders, buffers and output textures. Boundary seeds lie on both sides of eight-neighbor occupancy transitions. Deterministic row-major ties, a finite empty-mask distance and one extra stride-one pass define reproducible behavior. Explicitly document approximation rather than calling JFA an exact distance transform. Encode once per submitted helper workload; scratch and uniforms are reused.

Family F shares a scene-mask adapter for linear-premultiplied image/text-mask inputs, local text rasterization and up to 64 normalized rects. This rectangle data hook satisfies the lighting family without adding M5 DOM observers.

`shadows-2d` marches clamped SDF steps toward a point light and conservatively treats an exhausted segment as shadow. `radiance-cascades` stores radiance/transmittance in four spatial/angular atlases, traces disjoint exponentially growing distance intervals, and merges four angular children with bilinear coarse-probe interpolation. One to three complete deterministic diffuse sweeps integrate incident radiance and reuse it at wall hits. First sweeps ignore prior-frame history, preserving paused and reduced-motion replay.

## Consequences

No CPU distance-field readback, optional feature or temporal accumulation is required. Intermediate fields and atlases are inspectable, and grid allocation can change synchronously. JFA remains approximate; ordinary probe merging can leak near barriers and four base directions can alias small lights. The finite radiance cap guarantees bounded scratch values but clips extreme energy. This baseline is suitable for studying quality/memory trade-offs rather than claiming a converged physical GI solution.

## Capture boundary

The playground exports the actual SDR resolve of these effects. PNG converts premultiplied readback bytes to straight-alpha ImageData. Video uses the same conversion in an owned Canvas2D compositor, populated before MediaRecorder starts; native WebGPU canvas streams can emit blank frames. Each animation callback waits for one paired GPU readback and paint before scheduling another. A Compare replacement discards a stale pair, and stop/dispose invalidate pending work. The right side clears its clipped region so transparent pixels replace the left effect rather than blend over it.

This export path adds GPU-to-CPU readback and 2D upload cost. Recording cadence follows completed readbacks and is not a promise of 60 completed effect frames per second. The GPU benchmark never enables capture. Recorded-content tests wait for actual video playback and a presented frame before sampling pixels; decoded dimensions alone do not prove capture content.

## Evidence

`tests/browser/lighting.spec.ts` compares nearest coordinates and signed distance against brute force for odd grids, ties, empty/full masks and boundaries; checks an unobstructed/blocked shadow segment; proves constant-environment preservation across all cascade levels; checks bounded emitter response, all modes/presets, replay, allocation edits, reduced-motion poses and disposal. Benchmark records and generated notes are linked by the M4 validation record after integration.

## References

[Rong and Tan, Jump Flooding in GPU (2006)](https://www.comp.nus.edu.sg/~tants/jfa/i3d06-submitted.pdf) and [Sannikov, Radiance Cascades paper source](https://github.com/Raikiri/RadianceCascadesPaper/blob/main/RadianceCascades.tex).
