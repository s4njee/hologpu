import { catalogue } from '../packages/effects/dist/index.js';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { format } from 'prettier';
const records = [];
for (const filename of (await readdir('docs/benchmarks')).sort()) {
  if (
    !/^m(?:1(?:-stretch)?|2(?:-gate)?|3(?:-gate)?|4(?:-gate)?)-(chrome|firefox|webkit)\.json$/.test(
      filename,
    )
  )
    continue;
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
      return `| ${record.environment.browser} ${record.environment.browserVersion} | ${rows.map((r) => (r.cpuEncodeMs ?? r.cpuMs).mean.toFixed(3)).join(' / ')} | ${rows.map((r) => (r.rafIntervalMs ?? r.rafMs).mean.toFixed(3)).join(' / ')} | [JSON](../benchmarks/${record.filename}) |`;
    });
    let text = `Recorded 2026-10-07 on Apple M1 Max / macOS 26.6.2. Default parameters, seed 7, 512×320 physical pixels, DPR 1, resolution scale 1. Three runs; each discards 30 warm-up frames then measures 120 explicit encode/submit calls at fixed 1/60 s in rAF. CPU timings exclude GPU execution; rAF cadence is not a GPU timer. Device state and load are uncontrolled. Logical allocation sizes are not VRAM.\n\n| Browser | CPU mean ms (three runs) | rAF mean ms (three runs) | Record |\n| --- | --- | --- | --- |\n${rows.join('\n')}\n\nShader compilation is excluded. Optional GPU timestamp queries are deferred to M3. The SwiftShader pixel tests verify repeatability and disposal at DPR 1 and 2, both presets, every enum mode, and no compilation warnings. Hardware engines use the same compile/readback/disposal tests without cross-device image comparison.`;
    if (effect.tier === 'T2' && !measurements.some((r) => /^m[34]/.test(r.filename))) {
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
    if (measurements.some((r) => r.filename.startsWith('m3'))) {
      const rows = measurements.flatMap((record) => {
        const samples = record.results.filter((r) => r.id === effect.id),
          groups = new Map();
        for (const sample of samples) {
          const mode = sample.params.draw ?? 'compute';
          if (!groups.has(mode)) groups.set(mode, []);
          groups.get(mode).push(sample);
        }
        return [...groups].map(([mode, group]) => {
          const first = group[0],
            allocation =
              Object.entries(effect.params)
                .filter(([, p]) => p.uniform === false)
                .map(([name]) => `${name}=${JSON.stringify(first.params[name])}`)
                .join(', ') || 'defaults';
          return `| ${record.environment.browser} ${record.environment.browserVersion} | ${mode}; ${allocation} | ${group.map((r) => r.cpuMs.mean.toFixed(3)).join(' / ')} | ${group.map((r) => r.completionMs.p95.toFixed(3)).join(' / ')} | ${group.map((r) => r.gpuMs?.p95.toFixed(3) ?? 'unavailable').join(' / ')} | ${group.map((r) => r.rafMs.p50.toFixed(3)).join(' / ')} | ${record.scenario.gate ? `${group.filter((r) => r.gate).length}/${group.length} runs pass` : '—'} | [JSON](../benchmarks/${record.filename}) |`;
        });
      });
      text = `Recorded on the development Apple M1 Max / macOS 26.6.2 using the production preview and the same fixed-scenario runner as the Profiler drawer. Physical display is 512² at DPR 1, seed 7, fixed resolution/work quality. Defaults are retained except million-particle gate rows set count to exactly 1,000,000 and select point or instanced-quad drawing. Each of three runs discards 30 warm-up updates and measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion and timestamp readback.

| Browser | Rendering / allocation controls | CPU mean ms | Completion p95 ms | Summed GPU pass p95 ms | rAF median ms | Million-particle gate | Record |
| --- | --- | --- | --- | --- | --- | --- | --- |
${rows.join('\n')}

GPU columns use actual pass-boundary timestamp queries when available; values are implementation-defined and may be quantized. Pass intervals may overlap; their sum is a diagnostic rather than whole-frame execution time. These captures include summed intervals larger than queue-completion wall latency, so the columns must not be substituted for one another. CPU encode, queue-completion wall latency and rAF cadence remain separate. The million-particle gate verifies actual storage count, both draw paths, all 150 fixed updates and no GPU errors; M3 specifies particle count rather than a refresh-rate threshold. Machine load is uncontrolled. Logical allocations are not VRAM. Initialization/compilation are excluded. Small deterministic software snapshots and CPU-reference GPU tests establish separate numerical/lifecycle properties, not million-particle speed.`;
    }
    if (measurements.some((record) => record.filename.startsWith('m4'))) {
      const rows = measurements.map((record) => {
        const samples = record.results.filter((r) => r.id === effect.id);
        return `| ${record.environment.browser} ${record.environment.browserVersion} | ${samples.map((r) => r.cpuMs.mean.toFixed(3)).join(' / ')} | ${samples.map((r) => r.completionMs.p95.toFixed(3)).join(' / ')} | ${samples.map((r) => r.gpuMs?.p95.toFixed(3) ?? 'unavailable').join(' / ')} | ${samples.map((r) => r.rafMs.p50.toFixed(3)).join(' / ')} | [JSON](../benchmarks/${record.filename}) |`;
      });
      text = `Recorded on the development Apple M1 Max / macOS 26.6.2 using the production preview. Defaults, seed 7, physical 512² display, DPR 1 and fixed resolution/work quality. Each of three runs discards 30 warm-up updates then measures 120 fixed 1/60 s updates, one per rAF, awaiting queue completion and timestamp readback. Filter defaults use their owned deterministic linear HDR test card; lighting uses its documented scene and grid.

| Browser | CPU mean ms | Completion p95 ms | Summed GPU pass p95 ms | rAF median ms | Record |
| --- | --- | --- | --- | --- | --- |
${rows.join('\n')}

CPU encode, queue-completion wall latency and rAF cadence measure different boundaries. GPU columns are sums of actual pass timestamps when supported; quantization and overlapping intervals can make their sum exceed completion latency. They are a diagnostic rather than whole-frame elapsed time. Initialization and compilation are excluded, machine load is uncontrolled, and allocation sizes are logical rather than VRAM. The separate [M4 video-chain gate](../m4.md) uses a genuinely decoded 1920×1080 clip, four filters and full-size intermediates, with a measured idle-refresh baseline. Small software snapshots and CPU-reference hardware tests verify numerical/lifecycle properties separately from speed.`;
    }
    note = note.replace(
      /<!-- measurements:start -->[\s\S]*?<!-- measurements:end -->/,
      `<!-- measurements:start -->\n\n${text}\n\n<!-- measurements:end -->`,
    );
  }
  await writeFile(path, await format(note, { parser: 'markdown', printWidth: 100 }));
}
