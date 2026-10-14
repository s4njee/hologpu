# @mk7s/hologpu

WebGPU visual effects for the web. The facade pulls together the runtime
(`@mk7s/hologpu-core`), the DOM layer (`@mk7s/hologpu-dom`) and the effect
library (`@mk7s/hologpu-effects`) behind one API:

```ts
import { attach } from '@mk7s/hologpu/dom';
import gradient from '@mk7s/hologpu/effects/gradient-oklch';

const field = await attach(document.querySelector('.hero')!, gradient, { preset: 'lagoon' });
```

`createEffect(canvas, effect, options)` works on a canvas you own (and throws
`WebGPUUnavailableError` without WebGPU); `attach` and `<hgpu-field>` degrade to a
poster or the effect's declared CSS.

Licence: MIT. See the [repository](https://github.com/s4njee/hologpu).
