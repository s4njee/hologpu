import { catalogue } from '../packages/effects/dist/index.js';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { format } from 'prettier';
const records = [];
for (const filename of (await readdir('docs/benchmarks')).sort()) {
  if (!/^m(?:1(?:-stretch)?|2(?:-gate)?)-(chrome|firefox|webkit)\.json$/.test(filename)) continue;
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
    let text = `Recorded 2026-10-07 on Apple M1 Max / macOS 26.6.2. Default parameters, seed 7, 512×320 physical pixels, DPR 1, resolution scale 1. Three runs; each discards 30 warm-up frames then measures 120 explicit encode/submit calls at fixed 1/60 s in rAF. CPU timings exclude GPU execution; rAF cadence is not a GPU timer. Device state and load are uncontrolled. Logical allocation sizes are not VRAM.\n\n| Browser | CPU mean ms (three runs) | rAF mean ms (three runs) | Record |\n| --- | --- | --- | --- |\n${rows.join('\n')}\n\nShader compilation is excluded. Optional GPU timestamp queries are deferred to M3. The SwiftShader pixel tests verify repeatability and disposal at DPR 1 and 2, both presets, every enum mode, and no compilation warnings. Hardware engines use the same compile/readback/disposal tests without cross-device image comparison.`;
    if (effect.tier === 'T2') {
      const stateRows = measurements.map((record) => {
        const samples = record.results.filter((r) => r.id === effect.id);
        const first = samples[0],
          tap = first.taps.state ?? first.taps.velocity ?? first.taps.trail;
        const gate = record.scenario.gate
          ? `${samples.filter((r) => r.gate).length}/${samples.length} runs pass`
          : '—';
        return `| ${record.environment.browser} ${record.environment.browserVersion} | ${record.scenario.width}² display / ${tap.width}×${tap.height} state | ${samples.map((r) => r.cpuEncodeMs.mean.toFixed(3)).join(' / ')} | ${samples.map((r) => r.submitToCompletionMs.p95.toFixed(3)).join(' / ')} | ${samples.map((r) => r.rafIntervalMs.p50.toFixed(3)).join(' / ')} | ${gate} | [JSON](../benchmarks/${record.filename}) |`;
      });
      text = `Recorded 2026-10-07 on Apple M1 Max / macOS 26.6.2 using a production preview. Defaults and seed 7; gate runs override only the actual simulation grid to 1024. Resolution scale and DPR are 1, adaptive quality is disabled. Each of three runs discards 30 warm-up frames and measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion before the next frame.

| Browser | Display / simulation | CPU mean ms (three runs) | Submit-to-completion p95 ms | rAF median ms | 1024² gate | Record |
| --- | --- | --- | --- | --- | --- | --- |
${stateRows.join('\n')}

CPU encoding/submission and submission-to-queue-completion wall latency are separate observations. Completion latency includes queue wait, browser and driver overhead; neither is GPU timestamp timing. The gate requires full-sized state and display, at least 95% completions and median rAF cadence within 110% of the separately measured idle rAF period. Device state and system load are uncontrolled. Logical allocation bytes are not VRAM. Compilation and initialization are excluded from measured frames. GPU timestamp profiling remains M3 work. Deterministic snapshots use grid 32, eight fixed updates, and seed 7 at DPR 1 and 2; separate numerical tests exercise algorithm invariants.`;
    }
    note = note.replace(
      /<!-- measurements:start -->[\s\S]*?<!-- measurements:end -->/,
      `<!-- measurements:start -->\n\n${text}\n\n<!-- measurements:end -->`,
    );
  }
  await writeFile(path, await format(note, { parser: 'markdown', printWidth: 100 }));
}
