# Changelog

Historical milestone notes for HoloGPU. The [README](../README.md) is the guide;
this file keeps the running record of what each milestone added.

- M0 foundations, M1's shared runtime and Full-stage playground, all nine Family A
  procedural effects, and the M2 feedback/fluid implementation. See the
  [plan](../plan.md), [M1 validation](m1.md), [T1 stretch validation](t1-stretch.md),
  [M2 validation](m2.md) and [frozen T1 contract](adr/005-t1-effect-contract.md).
- M3 adds six particle effects, four compute primitive demos, timestamp profiling,
  fixed-scenario benchmark exports and a live WGSL editor. See [M3 validation](m3.md).
- M4 adds eight image filters, three distance/light effects, media inputs, filter
  chains, texture-backed parameters, Compare, screenshots and recording. M4 is
  complete on the development target: Chrome passes the 1080p video refresh gate in
  all three runs; WebKit passes correctness checks but misses that performance gate.
  See [M4 validation](m4.md).
- M5 adds DOM attachments and custom elements, six Family H effects, fluid obstacles,
  CSS/property/timeline drivers, and In page and Grid modes. Implementation and local
  validation are complete: the native six-effect refresh gate and matched
  software-adapter adaptation pass. Physical weaker-device validation remains for M8;
  see [M5 validation](m5.md).
- M6 adds all four Family G effects (`instances`, `terrain`, `material-ball`, `glass`),
  minimal camera and indexed mesh helpers, depth and 4x MSAA, render bundles,
  occlusion probes, and prefiltered HDR cube lighting. M6 completes all 47 core
  effects. See [M6 validation](m6.md).
- M7 adds six selected research stretches: MPM, PBF fluid, lattice Boltzmann, a
  progressive BVH path tracer, sorted anisotropic Gaussian splats, and experimental
  DOM backdrop glass. See [M7 validation](m7.md).
- Backlog v2 section 3.1 adds six T1 backgrounds: `aurora-veil`, `grain-overlay`,
  `dot-matrix-field`, `topographic-lines`, `grid-horizon` and `light-sweep`, bringing
  the catalogue to 62. See [background validation](v2-backgrounds.md).
- Backlog v2 section 3.2 adds `text-shimmer`, `text-outline-glow` and
  `heading-reveal`, bringing the catalogue to 65. See
  [typography validation and usage](v2-typography.md).
- Backlog v2 section 3.3 adds glass panels, press ripples, hover shadows and quiet
  spotlight/border presets, bringing the catalogue to 68. See
  [card usage and validation](v2-cards.md).
- Backlog v2 section 3.4 adds depth parallax, product sheen, bright-pass, masked
  composite and pointer maps, bringing the catalogue to 73. See
  [product imagery usage and validation](v2-products.md).
- Backlog v2 section 3.5 adds section wipes, wave dividers and arc-length progress
  lines, bringing the catalogue to 76. See
  [transition usage and validation](v2-transitions.md).
- Backlog v2 section 3.6 adds bounded dust drift and a stateless linked constellation,
  bringing the catalogue to 78. See [ambient usage and validation](v2-ambient.md).
- Backlog v2 section 4 adds interaction-only attachment playback, declared page
  budgets, completed-first-frame timings, PNG/WebP poster tooling, bundle-size
  reports, Firefox T1 pipelining and Family G settled fallbacks. See
  [runtime tooling](v2-runtime.md) and the
  [physical validation matrix](device-validation.md).
