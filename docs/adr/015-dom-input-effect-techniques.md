# ADR 015: DOM geometry, CSS progress and genuine input-driven Family H effects

Status: accepted for M5.

## Context

The DOM tier needs distinct surfaces to follow real element geometry and share one page pointer, while image, text and audio effects must consume actual borrowed inputs. A convincing screenshot alone cannot distinguish those mechanisms from local gradients or invented spectra.

## Decision

Border energy evaluates an analytic rounded-rectangle SDF in physical pixels. Spotlight transforms local UV into one viewport coordinate system; each attachment supplies its host rectangle and the same document pointer. CSS progress is a typed scalar input to image-hover, text-dissolve and scroll-scene. The DOM bridge samples registered animated custom properties before rendering; browser CSS can own hover/scroll animation progress, while GPU submission remains on the main thread.

Image-hover binds two independent linear-premultiplied textures and verifies exact transition endpoints. Audio-spectrum consumes the core two-row FFT-amplitude/signed-waveform layout, aggregates actual bins into bars, and samples actual FFT heights for raymarched terrain. Owned standalone fixtures are deterministic data, including the one-time DFT of a known waveform, and are distinguished from live audio.

Text-dissolve uses instanced particle quads. The vertex stage reads text-mask coverage and applies stable seeded analytic scatter trajectories controlled by progress. This deliberately preserves exact reversible scrubbing without simulation history, CPU particle extraction, per-frame readback or time-step instability. It is a particle draw rather than a fullscreen text-distortion shader. The attachment keeps the authored text in light DOM; shader masks do not replace accessible text nodes.

## Consequences

No effect destroys borrowed inputs. Pipeline leases and fallback textures are reported and released. CPU/GPU references verify rounded geometry, shared viewport light coordinates, premultiplied image endpoints, FFT/waveform response, mask-gated particles and exact reform. Catalogue snapshots are deterministic at DPR 1 and 2, with hardware correctness tested separately.

The current border has one radius, spotlight assumes axis-aligned bounding boxes, particles sample a regular mask grid, and audio bar cost grows with FFT band width. CSS timeline support and computed-style sampling overhead remain explicit browser boundaries; no compositor-only WebGPU execution is claimed.
