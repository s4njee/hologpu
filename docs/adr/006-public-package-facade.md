# ADR 006: public package facade

Status: accepted, 2026-10-07.

The public `@mk7s/hologpu` package is a small facade over `@mk7s/hologpu-core` and `@mk7s/hologpu-effects`. Core has no dependency on the catalogue; effects depend only on core. This avoids a package cycle while retaining the plan's public imports:

```ts
import { createEffect, fragmentEffect } from '@mk7s/hologpu';
import gradient from '@mk7s/hologpu/effects/gradient-oklch';
```

Individual effect exports preserve tree shaking. The playground's `@mk7s/hologpu/effects` catalogue imports all six M1 effects; lazy loading is later DOM/catalogue work. `scripts/catalogue.mjs` discovers effect directories, writes the catalogue and public wrappers, and updates subpath exports before dev, build and typecheck. The generated catalogue erases schema-specific generic types only at the heterogeneous browser boundary; individual effect imports retain their parameter types.

Package source conditions support development without building. Production packages emit JS and declarations with rewritten relative extensions; build TypeScript resolves already-built dependency declarations. `pnpm build` builds in dependency order and Vite consumes only public facade exports. `@mk7s/hologpu/spikes` and `/m0.html` retain the isolated M0 lab. Nothing is published to a registry or hosted remotely.
