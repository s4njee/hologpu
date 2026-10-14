# @mk7s/hologpu-react

A thin React wrapper over `@mk7s/hologpu-dom`'s `attach`. `<HoloField>` creates
one host element, attaches an effect to it and disposes the attachment on
unmount.

Part of [HoloGPU](https://github.com/s4njee/hologpu).

```tsx
import { HoloField } from '@mk7s/hologpu-react';
import gradient from '@mk7s/hologpu/effects/gradient-oklch';

export function Hero() {
  return <HoloField effect={gradient} preset="lagoon" />;
}
```

Licence: MIT. See the [repository](https://github.com/s4njee/hologpu).
