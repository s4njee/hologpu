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

Requires Node 22.12 or later to install and build (declared in `engines`). The
browser requirement is separate: a WebGPU-capable browser, with the effects'
CSS fallback everywhere else.

## Posters and asset URLs

Effects that ship a poster set it with `poster: new URL('./poster.png', import.meta.url).href`.
The image is emitted next to the built effect (`dist/<id>/poster.png`), so the URL resolves whether
or not your bundler understands `new URL(..., import.meta.url)`:

- Vite, webpack 5, Rollup and esbuild rewrite it to a hashed asset URL — nothing to configure.
- A bundler that leaves it untouched still resolves it, because `poster.png` sits beside
  `index.js` in the package.
- The DOM attachment renders the poster as a hidden `<img>` and hides it once the field draws. A
  poster that fails to load is not fatal: the effect keeps running and the element shows its CSS
  `fallback` background.

If your bundler rewrites the effect into a different directory _without_ handling `new URL`, pass
your own image via the `attach` `poster` option (or the element's `poster` attribute). Posters are
optional; every effect also declares a CSS `fallback`.

Licence: MIT. See the [repository](https://github.com/s4njee/hologpu).
