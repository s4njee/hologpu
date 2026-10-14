import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { wgsl } from './vite-plugin-wgsl.ts';

const src = fileURLToPath(new URL('./src', import.meta.url));

/** One entry per source module, named by its path, so consumers import `.../gpu/canvas`. */
function entries(dir: string, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) Object.assign(out, entries(path, `${prefix}${entry.name}/`));
    else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.d.ts') &&
      !entry.name.endsWith('.test.ts')
    )
      out[`${prefix}${entry.name.slice(0, -3)}`] = path;
  }
  return out;
}

export default defineConfig({
  // WGSL text is inlined into the JS, so the built package needs no bundler-specific shader import.
  plugins: [wgsl()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    minify: false,
    lib: { entry: entries(src), formats: ['es'] },
    rollupOptions: {
      external: (id) => !id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\0'),
    },
  },
});
