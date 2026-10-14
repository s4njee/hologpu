# press-ripple

A T1 circular wavefront after a button or card press. Four oldest-first event slots
store normalized canvas position, start time and an active flag in one 64-byte uniform
buffer, with a separate 16-byte interaction-clock uniform. A fifth press replaces the
oldest slot. Every wave expires after 600 ms;
initial and settled frames are transparent. There is no simulation or feedback
texture. Idle fields do not submit GPU work.

The DOM adapter feeds real `pointerdown` coordinates and centres keyboard activation.
Content stays in the light DOM and the canvas remains `aria-hidden` with
`pointer-events: none`. Direct callers can use `field.press([x, y])`; coordinates are
normalized to the canvas, including any attachment padding. Press events are
transient and are cleared by reset or device restoration. The shared scheduler runs
only for the bounded interaction lifetime, even when playback is paused or reduced
motion freezes procedural time. `drawAt(time)` also drives the interaction clock for
deterministic manual poses.

Reduced motion replaces expanding rings with a single uniform opacity fade for the
latest press. Overlapping normal rings use maximum opacity rather than additive
brightness. The default intensity is 0.2, and `--hgpu-tint` / `--hgpu-intensity` theme
the appearance. Ring width uses CSS pixels and is stable across DPR and resolution
scale. The card or button already carries meaning without the effect, so the DOM
fallback adds no visual layer; the bundled settled poster is transparent.

```ts
// Attach to a div wrapping the real native button.
await attach(buttonWrapper, pressRipple, { layer: 'front' });
```

The transparent canvas follows its rectangular attachment boundary. This effect does
not mask rings to rounded host corners; use the host's overflow clipping when desired.
Native buttons cannot host an author shadow root; attach to their containing div and
let pointer and keyboard activation bubble from the real button.
No optional GPU features, DOM capture or persistent input adapters are required.

## Parameters (generated)

<!-- params:start -->

| Parameter | Type  | Default   | Range / choices | Group    | Description                                                         |
| --------- | ----- | --------- | --------------- | -------- | ------------------------------------------------------------------- |
| intensity | f32   | 0.2       | 0…1             | Light    | Maximum wavefront opacity; overlapping waves do not add brightness. |
| width     | f32   | 2         | 0.5…12          | Geometry | Soft wavefront standard deviation in CSS pixels.                    |
| tint      | color | "#d9e5ff" | —               | Palette  | Ripple colour; alpha also scales opacity.                           |

<!-- params:end -->
