import { catalogue } from '../packages/effects/dist/index.js';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { format } from 'prettier';
const records = [];
for (const filename of (await readdir('docs/benchmarks')).sort()) {
  if (!/^m1(?:-stretch)?-(chrome|firefox|webkit)\.json$/.test(filename)) continue;
  records.push({ ...JSON.parse(await readFile(`docs/benchmarks/${filename}`, 'utf8')), filename });
}
for (const effect of catalogue) {
  const path = `docs/notes/${effect.id}.md`;
  let note = await readFile(path, 'utf8');
  const params = [
    '| Parameter | Type | Default | Range / choices | Group | Description |',
    '| --- | --- | --- | --- | --- | --- |',
    ...Object.entries(effect.params).map(
      ([name, p]) =>
        `| ${name} | ${p.type} | ${JSON.stringify(p.default)} | ${p.options?.join(', ') ?? (p.min === undefined ? '—' : `${p.min}…${p.max}`)} | ${p.group ?? 'Parameters'} | ${p.description ?? ''} |`,
    ),
  ].join('\n');
  note = note.replace(
    /<!-- params:start -->[\s\S]*?<!-- params:end -->/,
    `<!-- params:start -->\n\n${params}\n\n<!-- params:end -->`,
  );
  const measurements = records.filter((record) => record.results.some((r) => r.id === effect.id));
  if (measurements.length) {
    const rows = measurements.map((record) => {
      const rows = record.results.filter((r) => r.id === effect.id);
      return `| ${record.environment.browser} ${record.environment.browserVersion} | ${rows.map((r) => r.cpuEncodeMs.mean.toFixed(3)).join(' / ')} | ${rows.map((r) => r.rafIntervalMs.mean.toFixed(3)).join(' / ')} | [JSON](../benchmarks/${record.filename}) |`;
    });
    const text = `Recorded 2026-10-07 on Apple M1 Max / macOS 26.6.2. Default parameters, seed 7, 512×320 physical pixels, DPR 1, resolution scale 1. Three runs; each discards 30 warm-up frames then measures 120 explicit encode/submit calls at fixed 1/60 s in rAF. CPU timings exclude GPU execution; rAF cadence is not a GPU timer. Device state and load are uncontrolled. Logical allocation sizes are not VRAM.\n\n| Browser | CPU mean ms (three runs) | rAF mean ms (three runs) | Record |\n| --- | --- | --- | --- |\n${rows.join('\n')}\n\nShader compilation is excluded. Optional GPU timestamp queries are deferred to M3. The SwiftShader pixel tests verify repeatability and disposal at DPR 1 and 2, both presets, every enum mode, and no compilation warnings. Hardware engines use the same compile/readback/disposal tests without cross-device image comparison.`;
    note = note.replace(
      /<!-- measurements:start -->[\s\S]*?<!-- measurements:end -->/,
      `<!-- measurements:start -->\n\n${text}\n\n<!-- measurements:end -->`,
    );
  }
  await writeFile(path, await format(note, { parser: 'markdown', printWidth: 100 }));
}
