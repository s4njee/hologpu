import { chromium, webkit } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { platform, arch, release } from 'node:os';
import { catalogue } from '../packages/effects/dist/index.js';
import { ParamStore } from '../packages/core/dist/params.js';
const name = process.argv[2] ?? 'chrome';
const engine = { chrome: chromium, webkit }[name];
if (!engine || process.argv.length > 3)
  throw new Error('Usage: node scripts/benchmark-m6.mjs chrome|webkit');
const browser = await engine.launch({
  ...(name === 'chrome' ? { channel: 'chrome' } : {}),
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 1400, height: 1200 },
  deviceScaleFactor: 1,
});
const results = [];
const scenarios = ['instances', 'terrain', 'material-ball', 'glass'].map((id) => ({
  id,
  params: {},
}));
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
      const definition = catalogue.find((effect) => effect.id === scenario.id);
      if (
        !definition ||
        definition.tier !== 'T5' ||
        definition.family !== 'geometry' ||
        !definition.core ||
        JSON.stringify(row.params) !==
          JSON.stringify(new ParamStore(definition.params).snapshot()) ||
        row.params.msaa !== '4x'
      )
        throw new Error('Geometry benchmark diverged from current typed defaults');
      const expectedPasses =
        scenario.id === 'glass'
          ? ['glass-scene-capture', 'glass-mesh', 'glass-composite']
          : [`${scenario.id}-mesh`];
      if (
        row.capabilities.enabledFeatures.includes('timestamp-query') &&
        (!row.gpuMs || expectedPasses.some((name) => row.passes[name]?.count !== 120))
      )
        throw new Error('Incomplete geometry pass timestamps');
      if (
        scenario.id === 'instances' &&
        (row.params.count !== 4096 ||
          row.buffers.indices?.count !== 36 ||
          row.buffers.vertices?.count !== 24 ||
          row.buffers.occlusion?.stride !== 8 ||
          row.buffers.occlusion?.count !== 2)
      )
        throw new Error('Instance mesh/query workload mismatch');
      if (
        scenario.id === 'terrain' &&
        (row.buffers.indices?.count !== 128 * 128 * 6 ||
          row.buffers.vertices?.count !== 129 * 129 ||
          row.taps.heightField?.width !== 129 ||
          row.taps.heightField?.format !== 'r32float')
      )
        throw new Error('Terrain geometry workload mismatch');
      if (
        scenario.id === 'material-ball' &&
        (Object.keys(row.taps).length !== 54 ||
          row.taps['environment-face-0']?.width !== 64 ||
          row.taps['specular-5-mip-6']?.width !== 1)
      )
        throw new Error('Environment workload mismatch');
      if (
        scenario.id === 'glass' &&
        ['sceneCapture', 'glassLayer'].some(
          (name) =>
            row.taps[name]?.width !== 512 ||
            row.taps[name]?.height !== 512 ||
            row.taps[name]?.format !== 'rgba16float',
        )
      )
        throw new Error('Glass capture workload mismatch');
      results.push({ ...row, run, gate: null });
      console.log(
        `${scenario.id} ${run}: CPU ${row.cpuMs.mean.toFixed(3)}ms mean, completion ${row.completionMs.p95.toFixed(3)}ms p95, summed GPU ${row.gpuMs ? row.gpuMs.p95.toFixed(3) + 'ms p95' : 'unavailable'}, cadence ${row.rafMs.p50.toFixed(3)}ms median`,
      );
    }
  }
  await writeFile(
    `docs/benchmarks/m6-${name}.json`,
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
          params: 'defaults',
          clock: 'one fixed 1/60 s update per rAF; queue completion and timestamp readback awaited',
          timing:
            'cpuMs is encoding/submission wall time. completionMs is encoding through queue completion wall latency including wait/browser/driver overhead. gpuMs sums measured GPU pass timestamp durations when available; null means unavailable or no complete capture. rafMs includes serialized readback overhead and is observed cadence, not pure GPU execution.',
          quality: 'fixed; no adaptive resolution or step scaling; timeScale 1',
          gate: 'Baseline capability coverage; no refresh-rate exit threshold.',
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
