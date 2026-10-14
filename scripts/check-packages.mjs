#!/usr/bin/env node
// M4 story 4.6: verify the published shape of every publishable package.
//
//   pnpm exec publint packages/core
//   pnpm exec attw --pack packages/core --profile esm-only
//
// The packages are ESM-only, so attw runs the `esm-only` profile: the node10 and
// node16-from-CJS resolutions are expected to fail (an `exports` map with no `require`
// condition is ESM-only by design) and are ignored. Everything else must be green.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const packages = readdirSync(path.join(root, 'packages'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const dir = path.join(root, 'packages', entry.name);
    const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
    return { dir, name: pkg.name, private: Boolean(pkg.private) };
  })
  .filter((pkg) => !pkg.private)
  .sort((a, b) => a.name.localeCompare(b.name));

const checks = [
  ['publint', (dir) => [dir]],
  ['attw', (dir) => ['--pack', dir, '--profile', 'esm-only']],
];

let failed = false;
for (const { dir, name } of packages) {
  console.log(`\n=== ${name} ===`);
  for (const [command, args] of checks) {
    const result = spawnSync('pnpm', ['exec', command, ...args(dir)], {
      cwd: root,
      stdio: 'inherit',
    });
    if (result.status !== 0) failed = true;
  }
}
if (failed) {
  console.error('\nPackage checks failed.');
  process.exit(1);
}
console.log(`\nAll ${packages.length} packages passed publint and attw (esm-only).`);
