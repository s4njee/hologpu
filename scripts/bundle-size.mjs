import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, relative, dirname } from 'node:path';
import { platform, arch, release } from 'node:os';

// Use the repository's existing Vite runtime; no install or application build is needed.
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../apps/playground/package.json', import.meta.url));
const { build, version: viteVersion } = await import(pathToFileURL(require.resolve('vite')).href);
const publicPackage = JSON.parse(
  await readFile(resolve(root, 'packages/hologpu/package.json'), 'utf8'),
);
const entries = [
  { id: 'core', publicEntry: '@mk7s/hologpu-core', source: 'packages/core/src/index.ts' },
  { id: 'dom', publicEntry: '@mk7s/hologpu-dom', source: 'packages/dom/src/index.ts' },
  {
    id: 'dom-with-catalogue-resolver',
    publicEntry: '@mk7s/hologpu/dom',
    source: 'packages/hologpu/src/dom.ts',
  },
  ...Object.entries(publicPackage.exports)
    .filter(([key]) => key.startsWith('./effects/'))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({
      id: key.replace('./effects/', ''),
      publicEntry: publicPackage.name + key.slice(1),
      source: 'packages/hologpu/' + value.source.replace(/^\.\//, ''),
    })),
];
const args = process.argv.slice(2);
const jsonIndex = args.indexOf('--json');
// `--json <file>` records the report elsewhere (used by `bundle:check` so the committed
// benchmark file is only rewritten by an explicit `bundle:size`).
const outPath = jsonIndex >= 0 ? args[jsonIndex + 1] : undefined;
const requested =
  jsonIndex >= 0 ? args.filter((_value, i) => i !== jsonIndex && i !== jsonIndex + 1) : args;
if (requested.some((id) => !entries.some((entry) => entry.id === id)))
  throw new Error('Usage: node scripts/bundle-size.mjs [core|dom|effect-id ...] [--json <file>]');

const rows = [];
for (const entry of entries.filter((entry) => !requested.length || requested.includes(entry.id))) {
  const result = await build({
    configFile: false,
    root,
    logLevel: 'error',
    publicDir: false,
    resolve: { conditions: ['source'] },
    build: {
      write: false,
      emptyOutDir: false,
      minify: true,
      target: 'es2022',
      sourcemap: false,
      assetsInlineLimit: 0,
      reportCompressedSize: false,
      rolldownOptions: {
        input: resolve(root, entry.source),
        preserveEntrySignatures: 'strict',
        output: { format: 'es', codeSplitting: false },
      },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((value) => value.output);
  const chunks = outputs
    .filter((value) => value.type === 'chunk')
    .map((chunk) => ({
      name: chunk.fileName,
      bytes: Buffer.byteLength(chunk.code),
      gzipBytes: gzipSync(chunk.code, { level: 9 }).byteLength,
      modules: Object.keys(chunk.modules).map((id) => relative(root, id)),
    }));
  const assets = outputs
    .filter((value) => value.type === 'asset')
    .map((asset) => ({
      name: asset.fileName,
      bytes:
        typeof asset.source === 'string'
          ? Buffer.byteLength(asset.source)
          : asset.source.byteLength,
      gzipBytes: gzipSync(asset.source, { level: 9 }).byteLength,
    }));
  if (!chunks.length || chunks.some((chunk) => !chunk.bytes))
    throw new Error('Missing public entry output: ' + entry.id);
  rows.push({
    ...entry,
    jsBytes: chunks.reduce((total, chunk) => total + chunk.bytes, 0),
    jsGzipBytes: chunks.reduce((total, chunk) => total + chunk.gzipBytes, 0),
    assetBytes: assets.reduce((total, asset) => total + asset.bytes, 0),
    assetGzipBytes: assets.reduce((total, asset) => total + asset.gzipBytes, 0),
    chunks,
    assets,
  });
  console.log(JSON.stringify({ id: entry.id, jsGzipBytes: rows.at(-1).jsGzipBytes }));
}
const reportPath =
  outPath ??
  resolve(root, `docs/benchmarks/bundle-size${requested.length ? '-selected' : ''}.json`);
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(
  reportPath,
  JSON.stringify(
    {
      recordedAt: new Date().toISOString(),
      environment: {
        node: process.version,
        platform: platform(),
        arch: arch(),
        release: release(),
        vite: viteVersion,
      },
      method:
        'Independent browser ESM bundles of the actual public entry exports, including their transitive runtime dependencies and WGSL strings. Repository Vite production minification, ES2022 target, source export condition, gzip level 9, no source maps. Each output chunk compressed separately; posters and other emitted assets are reported separately from JavaScript. All public exports are retained; these are complete entry footprints, not one specific consumer import. The optional dom-with-catalogue-resolver row includes all lazy catalogue loaders, inlined into one bundle to expose its complete graph; normal applications retain lazy splitting and do not transfer that entire graph upfront. Shared core code overlaps between rows, so rows must not be summed into a page transfer estimate. No application dist or source files are changed.',
      entries: rows,
    },
    null,
    2,
  ) + '\n',
);
