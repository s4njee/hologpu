import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests run against TypeScript sources, without a prior build. Vitest externalizes
// workspace dependencies by default and would otherwise resolve them through the "import"
// condition to a dist/ entry that does not exist on a fresh clone. Alias the workspace
// packages to their source entry points so the tests are self-contained.
const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    conditions: ['source'],
    alias: {
      '@mk7s/hologpu-core': source('./packages/core/src/index.ts'),
      '@mk7s/hologpu-effects': source('./packages/effects/src/index.ts'),
      '@mk7s/hologpu-dom': source('./packages/dom/src/index.ts'),
    },
  },
  test: { include: ['packages/*/src/**/*.test.ts'], environment: 'node' },
});
