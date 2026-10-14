# WebGPU compatibility — M0

Reviewed **2026-10-07**. Browser release support and local experiment results are separate: a shipped API can still return no adapter because of hardware, drivers, browser settings, or automation mode. All rendering must start with secure-context and adapter checks.

## Browser support matrix

| Browser           | Established shipping scope                                                           | Restrictions and HoloGPU policy                                                                                                                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chrome / Chromium | Chrome 113 on Windows, macOS and ChromeOS; Chrome 121 on selected Android devices    | Linux rollout includes Intel Gen12+ (Chrome 144) and modern NVIDIA/Wayland (147–148); coverage remains backend/device-dependent. Compatibility mode extends Android coverage in Chrome 146. Never infer availability from the browser name alone.                    |
| Edge              | Chromium-based WebGPU on supported desktop hardware                                  | Use the same runtime checks; Edge was not installed/tested on this Mac.                                                                                                                                                                                              |
| Safari            | Safari 26 on macOS, iOS, iPadOS and visionOS                                         | Baseline WebGPU ships; optional adapter features differ. Native Safari 27 was smoke-tested here.                                                                                                                                                                     |
| Firefox           | Firefox 141 on Windows; Firefox 147 on Apple Silicon across supported macOS versions | Do not extend that claim to Intel Macs, Linux or Android. Their stable shipping coverage was not established by the cited release notes; treat them as adapter-gated validation targets. Native Firefox 157 and Playwright Firefox 155 were tested on Apple Silicon. |

Sources: [Chrome overview](https://developer.chrome.com/docs/web-platform/webgpu/overview), [Microsoft’s Edge 113 shipping confirmation](https://opensource.microsoft.com/blog/2024/02/29/onnx-runtime-web-unleashes-generative-ai-in-the-browser-using-webgpu/), [Chrome troubleshooting and platform requirements](https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips), [Safari 26 features](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/#webgpu), [Firefox 141 release notes](https://www.firefox.com/en-US/firefox/141.0/releasenotes/), [Firefox 147 release notes](https://www.firefox.com/en-US/firefox/147.0/releasenotes/).

Linux sources: [Chrome 144 rollout](https://developer.chrome.com/blog/new-in-webgpu-144#webgpu-on-linux), [Chrome 147–148 NVIDIA expansion](https://developer.chrome.com/blog/new-in-webgpu-147-148#webgpu-on-linux-nvidia).

The plan's blanket “ships in current browsers” assumption holds for these primary platforms, with the Firefox macOS scope narrowed to Apple Silicon. Linux/Android are not universal support guarantees.

## Local results

Host: Apple M1 Max (32 GPU cores), macOS 26.6.2, arm64. Hardware-backed Chrome and WebKit identify an Apple adapter; Firefox hides identifying strings. Results are in [m0-probes.json](benchmarks/m0-probes.json).

| Capability                                                | Chrome 154, hardware                            | Firefox 155, headed                           | Playwright WebKit 26.6                       |
| --------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------- | -------------------------------------------- |
| Fullscreen triangle, six canvases, shared compute buffer  | Pass                                            | Pass                                          | Pass                                         |
| `rgba16float` internal render target + SDR resolve        | Pass                                            | Pass                                          | Pass                                         |
| `rgba16float` canvas + extended tone mapping + Display P3 | Accepted; configuration reports both options    | Rejected (`rgba16float` canvas not supported) | Accepted; configuration reports both options |
| `PressureObserver` present                                | Yes                                             | No                                            | No                                           |
| HTML-in-canvas queue entry points, with default flags     | Neither entry point exposed                     | Neither exposed                               | Neither exposed                              |
| Compatibility request returns an adapter                  | Yes                                             | Yes                                           | Yes                                          |
| Resulting device enforces reduced compatibility limits    | Yes: 4 color attachments, core feature disabled | No: core feature enabled, 8 attachments       | No: core feature enabled, 8 attachments      |

Native Safari 27 also passed the compute/pixel verifier at DPR 2 and after zooming to DPR 1.7. Native Firefox 157 visibly rendered six correctly composited surfaces. Playwright WebKit is a separate test build, not a substitute for native Safari.

Playwright Firefox returned no adapter in **headless** mode on this host, but passed in **headed** mode. `pnpm test:hardware` uses headed Firefox. CI uses Chromium/SwiftShader, whose adapter identity is asserted in the pixel test. These are environment results, not claims that headless Firefox universally lacks WebGPU.

## Review of every plan verification item

### Compatibility feature level (sections 4 and 6.11)

The exact request is `navigator.gpu.requestAdapter({ featureLevel: 'compatibility' })`. [Chrome 146's shipping announcement](https://developer.chrome.com/blog/new-in-webgpu-146) establishes support on Android OpenGL ES 3.1, following the earlier experimental implementation. A core-capable adapter can still be returned; the device remains restricted unless `core-features-and-limits` is enabled.

The local Chrome probe requested no optional features and obtained the restricted device. Firefox/WebKit returned a core device, so accepting this dictionary is **not** proof of compatibility-mode implementation. M8 must confirm effective features/limits and execute real T1/T4 shaders within them. This M0 compute shader reads a storage buffer in the fragment stage and is not a claim of compatibility-mode portability.

### HTML-in-canvas (section 5.6)

This remains a Chromium experiment/origin trial, not baseline DOM screenshot access. Elements participate in a canvas subtree layout/paint model; this is not an unrestricted capture of arbitrary content behind an element.

The WebGPU entry point belongs to **`GPUQueue`**. In the Chrome 150–154 API generation it is `copyElementImageToTexture(sourceDict, destDict)`, with `sourceDict.source` and `destDict.destination`, `width`, `height`. The vendor's newer Chrome 155 API generation renames it to `drawElementImageToTexture`, with changed source-coordinate fields and destination `size`. Feature-detect the actual method and version the integration, rather than assuming the signatures are interchangeable. Our installed Chrome 154 exposes neither without enabling the experiment.

Sources: [origin trial introduction](https://developer.chrome.com/blog/html-in-canvas-origin-trial), [API changes across Chrome 150/155](https://developer.chrome.com/blog/html-in-canvas-ot-changes). Keep the input off by default. The [M7 backdrop-glass spike](m7.md) captures real DOM paint under the explicit Chrome flag, including edits, resize, translucency and device recovery. Chrome 154 exposes both queue names when flagged, but its draw alias still expects the old dictionary; the adapter selects the copy dialect with legacy canvas markup. The newer drawable-content/draw generation remains unvalidated locally. DOM rectangles remain the portable starting point.

### Compute Pressure (section 5.9)

[Chrome's implementation documentation](https://developer.chrome.com/docs/web-platform/compute-pressure) records launch in Chrome 125. The supported pressure source is **CPU**, not GPU. `PressureObserver` presence and `observe('cpu')` success must both be checked, and observation may be constrained by secure context and Permissions Policy. Use it as an optional secondary signal alongside measured frame time, never as a portable GPU-load meter.

### HDR canvas (section 6.11)

The intended configuration is `format: 'rgba16float'`, `toneMapping: { mode: 'extended' }`, and optionally `colorSpace: 'display-p3'`. Extended luminance range and wider color gamut are separate choices. Chrome introduced extended canvas tone mapping in 129; Safari 26's release notes include HDR WebGPU canvas. Firefox's local implementation rejects the float canvas format, while successfully rendering to internal float textures.

Sources: [Chrome 129 HDR announcement](https://developer.chrome.com/blog/new-in-webgpu-129), [Safari 26 release notes](https://developer.apple.com/documentation/safari-release-notes/safari-26-release-notes), [Firefox float-canvas tracking bug](https://bugzilla.mozilla.org/show_bug.cgi?id=1834395). The latter is also linked by the actual Firefox exception.

Do not mistake successful `configure()` for visible HDR: dictionary members can be ignored, and display/OS support matters. M0 checks validation errors, `getConfiguration()` and `(dynamic-range: high)` independently; it does not certify panel luminance or color accuracy. The default canvas remains the preferred SDR format. D5's internal float target needs neither an HDR display nor `shader-f16`.

### Optional feature names and availability (section 6.11)

The canonical strings in the [WebGPU specification](https://gpuweb.github.io/gpuweb/#enumdef-gpufeaturename) are:

| Experiment            | `GPUFeatureName`        | Local hardware exposure: Chrome / Firefox / WebKit |
| --------------------- | ----------------------- | -------------------------------------------------- |
| Dual-source blending  | `dual-source-blending`  | Yes / Yes / No                                     |
| Clip distances        | `clip-distances`        | Yes / No / Yes                                     |
| Subgroup operations   | `subgroups`             | Yes / No / Yes                                     |
| Texture format tier 1 | `texture-formats-tier1` | Yes / No / Yes                                     |
| Texture format tier 2 | `texture-formats-tier2` | Yes / No / Yes                                     |

Tier 2 depends on tier 1. Use the **plural** `texture-formats-tier1/2`; the Chrome 142 announcement's sample contains a singular-name typo, while its prose and the specification use the correct names. See [Chrome 142's announcement](https://developer.chrome.com/blog/new-in-webgpu-142).

Adapter exposure is not device enablement. Check `adapter.features`, request exactly the features needed when creating the device, and check `device.features` before using them. WGSL extensions also need the appropriate `enable` directive where specified. The M0 renderer requests none of these optional features. Availability in one Apple adapter is not a universal browser guarantee; the M8 experiments remain gated.

## What remains for later milestones

M0 establishes a baseline, not a complete hardware survey. Windows/Edge, Linux, phones, HDR appearance, worker rendering, and the HTML-in-canvas integration remain later validation work. The shipped browser matrix should be rechecked before release and when new devices are added.

## M1 runtime validation

On 2026-10-07, all six Family A effects passed compile, deterministic readback, preset/enum, resize, shared-device, fallback, alpha and disposal tests on Chrome 154 / Metal and Playwright WebKit 26.6 / Apple. Paired-fractal arithmetic uses explicit intermediate rounding after the tests exposed Metal reassociation; bounded add/multiply cases now agree with a CPU f64 reference. These results are recorded in [M1 validation](m1.md), [Chrome measurements](benchmarks/m1-chrome.json) and [WebKit measurements](benchmarks/m1-webkit.json). Full native Safari/Firefox catalogue passes remain M8 work. The M0 engine/native results above retain their original scope.
