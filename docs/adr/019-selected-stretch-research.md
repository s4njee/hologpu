# ADR-019 — Select bounded stretch probes and keep their approximations explicit

Date: 2026-10-07. Status: accepted for the M7 research implementation.

M7 selects its six suggested probes: MPM, PBF fluid, lattice Boltzmann, path tracing, Gaussian splats and DOM backdrop glass. All 47 core effects were completed in M6, and the three procedural stretches were completed earlier. Stretch is a research selection, not an obligation to implement the entire 79-entry catalogue.

Use the existing fixed-step feedback/particle wrapper with immutable uniform snapshots. Every compute dispatch has explicit resource dependencies and a separate pass. Expose the numerical state needed for CPU references, and preserve paused rendering and device-reconstruction semantics. Existing radix sort, prefix sum and spatial hash satisfy the selected dependants; histogram, FFT and generated blue noise are deferred until a selected question requires them.

Portable material transfers use grid-side P2G gathering, because baseline WGSL lacks float atomics. This deliberately trades throughput for reproducibility and portable ownership. The snow mode is volumetric plasticity; it is not a full SVD constitutive model. PBF uses compression-only density constraints and rebuilds neighbors per Jacobi iteration. LBM stores nine populations per node and provides a periodic conservation reference distinct from its driven channel boundary approximation.

Path tracing uses a small analytic scene and buffer BVH with progressive radiance; it does not introduce an asset/scene engine. Splatting uses procedural 3D covariance data, center-depth radix sorting and premultiplied source-over. The particle draw helper gains an explicit alpha-over option without changing existing additive/opaque defaults.

DOM capture is an opt-in HTML-in-canvas input. The caller retains its DOM and drawable source canvas; the adapter owns its texture and paint listener. The portable playground shows an explicitly labeled texture preview. Capture is unavailable outside the experiment, and arbitrary page elements are not moved into a canvas. The Chrome 154 copy dictionary is locally verified; the newer drawable-content/draw dialect remains externally documented but not locally browser validated. Straight sRGB capture is decoded and premultiplied before bilinear filtering.

Each selected effect ships two presets, metadata, public exports, source inspection, deterministic snapshots, numerical checks, disposal/recovery checks, notes and measured rows. Performance measurements report actual bounded default workloads and separate CPU encoding, queue-completion latency, summed timestamp diagnostics and observed cadence. They do not establish a refresh gate or speed on another device.
