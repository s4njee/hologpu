# @mk7s/hologpu-dom

Attach HoloGPU effects to ordinary DOM: `attach(element, effect, options)`
(progressive enhancement with a poster/CSS fallback), the `<hgpu-field>`
custom element, CSS/property/timeline drivers, DOM obstacle rectangles and the
declared page budget.

Part of [HoloGPU](https://github.com/s4njee/hologpu).

```ts
import { attach } from '@mk7s/hologpu-dom';
import gradient from '@mk7s/hologpu/effects/gradient-oklch';

const field = await attach(document.querySelector('.hero')!, gradient, { preset: 'lagoon' });
field.destroy();
```

Licence: MIT. See the [repository](https://github.com/s4njee/hologpu).
