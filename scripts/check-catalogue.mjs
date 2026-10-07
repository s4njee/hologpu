import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const source = await readFile('examples/bands.ts', 'utf8');
assert(source.trim().split('\n').length < 50, 'fragment example must remain under 50 lines');
const root = await mkdtemp(join(tmpdir(), 'hologpu-catalogue-'));
try {
  for (const dir of ['packages/effects/src/bands', 'packages/hologpu/src/effects'])
    await mkdir(join(root, dir), { recursive: true });
  for (const path of ['packages/effects/package.json', 'packages/hologpu/package.json'])
    await writeFile(join(root, path), JSON.stringify({ exports: {} }));
  await writeFile(join(root, 'packages/effects/src/bands/index.ts'), source);
  const run = spawnSync(process.execPath, [join(process.cwd(), 'scripts/catalogue.mjs')], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(
    await readFile(join(root, 'packages/effects/src/index.ts'), 'utf8'),
    /\.\/bands\/index.ts/,
  );
  assert.match(
    await readFile(join(root, 'packages/hologpu/package.json'), 'utf8'),
    /"\.\/effects\/bands"/,
  );
  console.log(
    `Catalogue criterion: ${source.trim().split('\n').length}-line effect discovered and exported without playground changes.`,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
