#!/usr/bin/env node
// M3 story 3.12: every built entry point must import in a bare Node process without touching
// `window`, `document` or `navigator`. Run after a build (`pnpm build && node
// scripts/check-server-imports.mjs`).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const packagesDir = path.join(root, 'packages');

const entries = [];
for (const name of readdirSync(packagesDir)) {
  const pkgPath = path.join(packagesDir, name, 'package.json');
  if (!existsSync(pkgPath)) continue;
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (!pkg.exports) continue;
  for (const [subpath, conditions] of Object.entries(pkg.exports)) {
    const target = conditions.import;
    if (!target) continue;
    const file = path.join(packagesDir, name, target);
    if (!existsSync(file)) {
      console.error(`Missing build output for ${pkg.name}${subpath}: ${path.relative(root, file)}`);
      process.exit(1);
    }
    entries.push({ label: `${pkg.name}${subpath}`, file });
  }
}

let failed = 0;
for (const { label, file } of entries) {
  // `navigator` exists in Node (>=21), so it cannot be asserted absent; the import must simply
  // not throw, and `window`/`document` must stay undefined.
  const script = `await import(${JSON.stringify(pathToFileURL(file).href)}); if (typeof window !== 'undefined' || typeof document !== 'undefined') { throw new Error('touched a browser global'); }`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: path.dirname(file),
    encoding: 'utf8',
  });
  if (result.status === 0) {
    console.log(`ok   ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL ${label}\n${(result.stderr || result.stdout || '').trim()}`);
  }
}

if (failed) {
  console.error(`\n${failed} entry point(s) are not safe to import on a server.`);
  process.exit(1);
}
console.log(`\nAll ${entries.length} entry points import in a bare Node process.`);
