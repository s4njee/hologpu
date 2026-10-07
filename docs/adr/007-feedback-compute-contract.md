# ADR-007 — Feedback state and compute passes

- Date: 2026-10-07
- Status: Implemented for M2; numerical and browser evidence is recorded in the M2 validation record.
- Scope: T2 feedback, cellular state, and fluid solvers.

## Decision

`feedbackEffect` keeps the existing effect metadata and parameter schema, adding a `setup(context)` factory that returns a simulation program. The program owns its textures, custom buffers, pipelines, bind groups, and numerical algorithm. It implements `resize`, `initialize`, `step`, `display`, and `dispose`; the helper owns fixed-step queuing and uniform snapshots. This allows cellular kernels and multi-pass pressure solvers to share a lifecycle without forcing them into a single update shader.

The program initializes both sides of each ping-pong pair. Initialization is encoded on the next render after creation, reset, or a changed simulation grid, including when playback is paused. Rendering with no queued updates displays the initialized state without advancing it. `resize` returns `false` when its internal grid is unchanged so canvas resolution changes can preserve simulation state. A real allocation change discards queued updates and schedules deterministic reinitialization.

`createPingPongTargets` allocates two distinct textures, exposes the current read/write textures, swaps their roles, and reports the combined allocation size. It does not reuse a single texture for sampled reads and storage writes in the same dispatch. State textures have sampling, storage, render-attachment, and copy usages by default, so compute, fragment feedback, display, and raw diagnostic readback can use the same allocations. Formats outside the explicit uncompressed accounting table are rejected; dimensions are validated against the device limit before allocating. Resizing preserves the existing pair if a new allocation fails, destroying any partial replacement.

`createComputePass` and `createSimulationDisplay` use explicit bind-group layouts and asynchronous pipeline creation. Each compute dispatch ends its pass before the next dependent dispatch begins. Group zero holds the generated 64-byte frame and parameter uniforms; later groups hold solver-specific textures, buffers, and samplers. Source chunks and mapped compilation diagnostics remain available for inspection. Pipeline and shader leases are released on disposal and on failed pipeline creation.

## Why every queued step gets its own uniforms

A fixed-step scheduler can enqueue several simulation updates before rendering once. Calling `queue.writeBuffer` repeatedly on one frame buffer while encoding those passes would make the final written frame visible to every pass in that submission. JavaScript call order during encoding does not create a different bound buffer value for each recorded dispatch. Queue writes and command-buffer submission are distinct operations in the [WebGPU queue model](https://www.w3.org/TR/webgpu/#programming-model-synchronization).

The helper clones each update's frame vectors and packed parameters, then assigns a distinct frame/parameter buffer pair to each queued step in a command encoder. Initialization and display receive separate snapshots as well. The fourth `step` argument supplies the same packed parameter snapshot to host code that chooses iteration counts; otherwise a queued parameter edit could change shader inputs correctly while still using the final host iteration count.

`UniformSnapshots` reuses its allocated capacity only when a new command encoder begins. Its callers must submit the previous encoder first, as the shared `DeviceSession` does. Writes to reused buffers then occur after the prior submission in queue order. This avoids per-frame allocation and GPU completion waits while keeping multiple steps in one submission independent. The memory report includes the snapshot capacity, not only the algorithm's buffers and textures. A large explicit advance can increase this capacity; it is released when the instance is disposed.

## Integer state and diagnostic taps

Integer state can use a sampled `texture_2d<u32>` input and a write-only `texture_storage_2d<r32uint, write>` output with ping-pong state. This baseline route exercises integer storage without requiring the WGSL `readonly_and_readwrite_storage_textures` language extension. An effect that chooses read-write storage must first check the language capability and feature/format restrictions in the [WGSL extension specification](https://www.w3.org/TR/WGSL/#language-extensions); ping-pong is the portable default here.

Programs expose named texture taps with texture format, dimensions, and float/unsigned interpretation, plus optional buffer summaries. These taps represent the current read side after all encoded solver passes, rather than stale initialization targets. The program reports all custom resource bytes; the feedback helper adds its own snapshot bytes. Resource accounting is allocation accounting, not a claim about driver residency or pipeline-cache memory.

## Verification

The helper unit tests check swaps and exact texture byte totals, grid-preserving resize, disposal, failed replacement cleanup, mixed float/u32 frame packing, nonaliasing queued snapshots, capacity reuse across submissions, failed snapshot allocation cleanup, initialization while paused, queued parameter/frame immutability, reset discarding pending updates, failed asynchronous pipeline cleanup, and dispatch-limit validation.

These host tests verify the contract and its cleanup paths. GPU readbacks, solver invariants, cross-browser execution, and measurements are separate M2 gates; a mocked device cannot prove shader synchronization or numerical stability.
