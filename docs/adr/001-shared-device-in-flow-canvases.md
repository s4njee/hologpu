# ADR-001 — Shared device and in-flow canvases (D3)

- Date: 2026-10-07
- Status: Confirmed for M1, subject to later effect workloads
- Spikes: M0 1 and 2

## Question

Can six separate DOM canvases share a single device and frame submission without breaking resize, alpha compositing, or scrolling, and what is their memory cost?

## Experiment

`SpikeSession` requests one adapter/device, compiles pipelines once, and allocates one shared compute storage buffer. Each of one or six canvases has a 16-byte surface uniform. Every frame encodes one compute pass followed by the surfaces' render/resolve passes into one command buffer and submits once. Canvases stay in normal document flow. All six render during measurement, including those outside the viewport; visibility-based resource release belongs to the runtime milestones.

ResizeObserver supplies device pixel dimensions when credible, with a CSS-size × DPR fallback. DPR is capped at 2, dimensions preserve aspect ratio at the device limit, and shaders emit premultiplied RGB/alpha. Fractional edge snapping can differ by one pixel from simple rounding. Chromium's emulated DPR may leave the device pixel box unscaled; the harness rejects inconsistent boxes.

## Evidence

The browser tests check fractional resize, DPR 1/2, canvas position after scrolling, CPU/GPU color agreement, and the separate color visible in each of six surfaces. Hardware tests pass on Chrome 154, headed Firefox 155 and Playwright WebKit 26.6 on Apple M1 Max. Native Safari 27 and Firefox 157 visibly render correct in-flow canvases. Native Safari's pixel verifier passes at both 988×480 (DPR 2) and 840×408 after zoom (DPR 1.7), with zero byte error.

At the fixed benchmark size, six 988×480 float targets use **22,763,520 bytes (21.71 MiB)** of logical texture payload; owned buffers use 208 bytes. A single canvas image per surface adds an estimated **11,381,760 bytes (10.85 MiB)**. The number of browser swapchain images, padding, driver residency, pipeline memory and compositor allocations are unknown. These estimates are not measured total VRAM.

For six float canvases, Chrome's three runs averaged **0.137–0.214 ms CPU encoding** and **16.666 ms rAF intervals**. See [the raw Chrome record](../benchmarks/m0-chrome.json), [Firefox](../benchmarks/m0-firefox.json), [WebKit](../benchmarks/m0-webkit.json), and [validation summary](../m0.md). Browser scheduling modes differ; do not rank browsers by these intervals. No per-pass GPU timestamps were captured.

## Decision and consequences

Keep one device per page and one in-flow canvas per attachment as the M1 starting point. Six canvases present no baseline obstacle in this test; their render-target memory is material and must be budgeted. WebGPU provides no portable guarantee of an unlimited number of canvases or a particular memory budget.

M1 must turn the isolated harness into shared acquisition and scheduling APIs. M5 must pause invisible effects, release unnecessary targets and compare the fixed overlay design under real scrolling. Six animated library effects at native display refresh rate remains a later success criterion; this study uses a trivial shader.
