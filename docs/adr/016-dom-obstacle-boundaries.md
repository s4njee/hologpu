# ADR 016: DOM rectangles enter fluid pressure boundaries

Status: accepted

## Decision

Pack actual browser bounding boxes of tagged light-DOM elements into a storage buffer. Direct sources normalize to their container; attachments query host descendants and normalize to the actual shadow canvas via `coordinateTarget`, preserving alignment inside authored padding and borders. Extend the existing MAC solver with blocked faces and Neumann pressure neighbors derived from that geometry. Keep the DOM input caller-owned and borrowed by the effect, with an explicit cap, observer teardown and GPU storage rebuild on a replacement device.

## Reason

A presentation mask would conceal dye while leaving velocity and pressure flowing through page content. The divergence, pressure neighbor coefficients and forward projection must describe the same obstacle topology to establish a no-through boundary. The direct bounded-rectangle buffer keeps that contract inspectable without page rasterization or optional browser features. A diagnostic mask and storage readback test prove the geometry reaching the solver.

## Consequences

Rectangles approximate browser-transformed boxes, not glyph contours. Stationary free-slip walls update instantaneously as layout changes. New solids remove covered material; pressure recomputes even on a paused timeline. Dye characteristics stop at analytic slab intersections, but interpolation remains diffusive. Moving-wall momentum and conservative cut-cell transport are future work. The default cap is 128 rectangles and direct rectangle queries cost linearly in the count; the M5 page experiment measures the relevant layout and solver costs.

DOM attachments refresh geometry in the shared before-frame scheduler hook, so each source does not add an animation loop. Observers invalidate structural, size and scroll changes. Buffers grow by powers of two and old capacity allocations stay owned until disposal to protect outstanding encoded GPU commands. Lost-device storage is replaced from DOM state; it is never reused on a new GPU device.

Attachment destruction submits pending commands before destroying the field or its owned rectangle source. This ordering also applies when destruction happens inside a render notification before the shared scheduler submits. A surviving peer remains usable and receives no validation errors.
