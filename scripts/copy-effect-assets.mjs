import { cp, readdir } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../packages/effects');
for (const directory of await readdir(path.join(root, 'src'), { withFileTypes: true })) {
  if (!directory.isDirectory()) continue;
  for (const file of await readdir(path.join(root, 'src', directory.name))) {
    if (!/\.(png|webp|svg|json)$/.test(file)) continue;
    await cp(
      path.join(root, 'src', directory.name, file),
      path.join(root, 'dist', directory.name, file),
    );
  }
}
