#!/usr/bin/env node
// Declaration emit keeps the source's `.ts` import specifiers (the base tsconfig uses
// allowImportingTsExtensions). Rewrite them to `.js` so the published types resolve.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist', import.meta.url));

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith('.d.ts')) yield full;
  }
}

let changed = 0;
for (const file of walk(dist)) {
  const source = readFileSync(file, 'utf8');
  const rewritten = source.replace(/(from\s*['"])(\.[^'"]*)\.ts(['"])/g, '$1$2.js$3');
  if (rewritten !== source) {
    writeFileSync(file, rewritten);
    changed += 1;
  }
}
console.log(`Rewrote .ts specifiers in ${changed} declaration file(s).`);
