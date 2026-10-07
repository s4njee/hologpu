import { chromium, webkit } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { platform, arch, release } from 'node:os';
const name = process.argv[2] ?? 'chrome',
  gate = process.argv.includes('--gate');
const engine = { chrome: chromium, webkit }[name];
if (!engine || process.argv.slice(3).some((arg) => arg !== '--gate'))
  throw new Error('Usage: node scripts/benchmark-m3.mjs chrome|webkit [--gate]');
const browser = await engine.launch({
  ...(name === 'chrome' ? { channel: 'chrome' } : {}),
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 1400, height: 1200 },
  deviceScaleFactor: 1,
});
const results = [];
const scenarios = gate
  ? ['point', 'quad'].map((draw) => ({
      id: 'flow-particles',
      params: { count: 1_000_000, draw },
      draw,
    }))
  : [
      'prefix-sum',
      'sort',
      'spatial-hash',
      'mipgen',
      'flow-particles',
      'attractors',
      'boids',
      'n-body',
      'emitters',
      'morph-particles',
    ].map((id) => ({ id, params: {} }));
try {
  for (const scenario of scenarios) {
    const query = new URLSearchParams({
      effect: scenario.id,
      playing: 'false',
      quality: 'fixed',
      resolution: '1',
      timeScale: '1',
      seed: '7',
      params: JSON.stringify(scenario.params),
    });
    await page.goto(`${process.env.HOLOGPU_URL ?? 'http://127.0.0.1:5176'}/?${query}`);
    await page.locator('#status[data-state="ready"]').waitFor({ timeout: 30_000 });
    for (let run = 1; run <= 3; run++) {
      const row = await page.evaluate(async () => {
        const field = window.hologpu.field;
        if (field.adaptiveQuality || field.timeScale !== 1)
          throw new Error('Benchmark must start with fixed quality and timeScale 1');
        return window.hologpu.runBenchmark(field, 30, 120);
      });
      if (row.errors.length) throw new Error(row.errors.join('\n'));
      if (
        row.samples !== 120 ||
        row.warmup !== 30 ||
        row.cpuMs.count !== 120 ||
        row.frameIndex !== 150 ||
        row.size[0] !== 512 ||
        row.size[1] !== 512 ||
        row.seed !== 7
      )
        throw new Error(`Incomplete fixed scenario: ${scenario.id}`);
      if (row.gpuMs && row.gpuMs.count !== 120)
        throw new Error(`Incomplete GPU timestamp capture: ${scenario.id}`);
      if (
        gate &&
        row.gpuMs &&
        row.passes[`flow-particles-${scenario.draw === 'point' ? 'points' : 'quads'}`]?.count !==
          120
      )
        throw new Error(`Rendered gate path lacks 120 timestamp samples: ${scenario.draw}`);
      const gatePassed = gate
        ? row.params.count === 1_000_000 &&
          row.params.draw === scenario.draw &&
          row.buffers.particles?.count === 1_000_000 &&
          row.buffers.particles?.stride === 32 &&
          row.buffers.particles?.bytes === 32_000_000 &&
          row.memory.bufferBytes >= 64_000_000
        : null;
      if (gate && !gatePassed)
        throw new Error(`Million-particle workload mismatch: ${JSON.stringify(row.buffers)}`);
      results.push({ ...row, run, gate: gatePassed });
      console.log(
        `${scenario.id}${scenario.draw ? ` ${scenario.draw}` : ''} ${run}: CPU ${row.cpuMs.mean.toFixed(3)}ms mean, completion ${row.completionMs.p95.toFixed(3)}ms p95, summed GPU ${row.gpuMs ? row.gpuMs.p95.toFixed(3) + 'ms p95' : 'unavailable'}, cadence ${row.rafMs.p50.toFixed(3)}ms median${gate ? `, million gate ${gatePassed}` : ''}`,
      );
    }
  }
  await writeFile(
    `docs/benchmarks/m3${gate ? '-gate' : ''}-${name}.json`,
    JSON.stringify(
      {
        recordedOn: new Date().toISOString().slice(0, 10),
        environment: {
          platform: platform(),
          arch: arch(),
          release: release(),
          browser: name,
          browserVersion: browser.version(),
          headless: true,
          dpr: 1,
        },
        scenario: {
          width: 512,
          height: 512,
          seed: 7,
          warmupFrames: 30,
          samples: 120,
          runs: 3,
          params: gate
            ? 'defaults with exact count 1,000,000; point and quad draw separately'
            : 'defaults',
          clock: 'one fixed 1/60 s update per rAF; queue completion and timestamp readback awaited',
          timing:
            'cpuMs is encoding/submission wall time. completionMs is encoding through queue completion wall latency including wait/browser/driver overhead. gpuMs sums measured GPU pass timestamp durations when available; null means unavailable or no complete capture. rafMs includes serialized readback overhead and is observed cadence, not pure GPU execution.',
          quality: 'fixed; no adaptive resolution or step scaling; timeScale 1',
          gate: gate
            ? 'Exactly 1,000,000 32-byte particle records per state side, both point and instanced-quad paths, 150 completed fixed ticks and full 512² presentation. Refresh-rate performance is reported, not an exit threshold.'
            : '',
          memory: 'logical GPU allocation sizes, not driver VRAM',
          runner: 'same window.hologpu.runBenchmark implementation as the Profiler drawer',
        },
        results,
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  await browser.close();
}
