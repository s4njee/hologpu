import { chromium, webkit } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { platform, arch, release } from 'node:os';
import { catalogue } from '../packages/effects/dist/index.js';
import { ParamStore } from '../packages/core/dist/params.js';
const name = process.argv[2] ?? 'chrome';
const engine = { chrome: chromium, webkit }[name];
if (!engine || process.argv.length > 3)
  throw new Error('Usage: node scripts/benchmark-m7.mjs chrome|webkit');
const browser = await engine.launch({
  ...(name === 'chrome' ? { channel: 'chrome' } : {}),
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 1400, height: 1200 },
  deviceScaleFactor: 1,
});
const results = [];
const scenarios = [
  'mpm',
  'pbf-fluid',
  'lattice-boltzmann',
  'path-tracer',
  'splats',
  'backdrop-glass',
].map((id) => ({
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
      const expectedPasses = {
        mpm: ['mpm-p2g', 'mpm-g2p', 'mpm-density', 'mpm-surface'],
        'pbf-fluid': [
          'pbf-fluid-predict',
          'pbf-fluid-lambda',
          'pbf-fluid-correct',
          'pbf-fluid-finish',
        ],
        'lattice-boltzmann': ['lattice-boltzmann-step', 'lattice-boltzmann-display'],
        'path-tracer': ['path-tracer-trace', 'path-tracer-display'],
        splats: ['splats-project', 'splats-composite'],
        'backdrop-glass': ['backdrop-glass-refraction'],
      }[scenario.id];
      if (
        row.capabilities.enabledFeatures.includes('timestamp-query') &&
        (!row.gpuMs || expectedPasses.some((name) => row.passes[name]?.count !== 120))
      )
        throw new Error('Missing complete pass timestamps: ' + scenario.id);
      const definition = catalogue.find((effect) => effect.id === scenario.id);
      if (
        !definition ||
        definition.core ||
        JSON.stringify(row.params) !== JSON.stringify(new ParamStore(definition.params).snapshot())
      )
        throw new Error('Stretch workload diverged from typed defaults');
      const checks = {
        mpm: ['particles', 'grid'],
        'pbf-fluid': ['particles', 'constraints'],
        'lattice-boltzmann': ['distributions', 'macroscopic'],
        'path-tracer': ['accumulation', 'primaryHits'],
        splats: ['splats', 'projected'],
        'backdrop-glass': [],
      }[scenario.id];
      const numerical = await page.evaluate(async (names) => {
        const f = window.hologpu.field,
          device = f.session.device,
          summaries = {};
        // The Profiler runner restores state in finally. Verify a separate,
        // untimed reproduction rather than inspecting freshly reset buffers.
        f.canvas.parentElement.style.width = '514px';
        f.canvas.parentElement.style.height = '514px';
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        f.setResolutionScale(1);
        f.setProfiling(false);
        f.reset(7);
        f.advance(0);
        for (let i = 0; i < 150; i++) {
          f.advance(1);
          await device.queue.onSubmittedWorkDone();
        }
        if (f.surface.size[0] !== 512 || f.surface.size[1] !== 512 || f.frame.index !== 150)
          throw new Error('Numerical validation scenario changed');
        for (const name of names) {
          const tap = f.bufferTaps[name],
            size = tap.count * tap.stride;
          const staging = device.createBuffer({
            size,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
          });
          try {
            const encoder = device.createCommandEncoder();
            encoder.copyBufferToBuffer(tap.buffer, 0, staging, 0, size);
            device.queue.submit([encoder.finish()]);
            await staging.mapAsync(GPUMapMode.READ);
            const values = new Float32Array(staging.getMappedRange());
            if (!values.every(Number.isFinite)) throw new Error('Non-finite ' + name);
            let min = Infinity,
              max = -Infinity;
            for (const value of values) {
              min = Math.min(min, value);
              max = Math.max(max, value);
            }
            summaries[name] = { count: tap.count, stride: tap.stride, min, max };
            staging.unmap();
          } finally {
            staging.destroy();
          }
        }
        return summaries;
      }, checks);
      const expected = {
        mpm: ['particles', 1024, 64],
        'pbf-fluid': ['particles', 256, 16],
        'lattice-boltzmann': ['distributions', 96 * 96, 36],
        'path-tracer': ['accumulation', 512 * 512, 16],
        splats: ['splats', 2048, 80],
      }[scenario.id];
      if (
        expected &&
        (row.buffers[expected[0]]?.count !== expected[1] ||
          row.buffers[expected[0]]?.stride !== expected[2])
      )
        throw new Error('Actual storage workload mismatch: ' + scenario.id);
      if (row.capabilities.adapter.isFallbackAdapter)
        throw new Error('Benchmarks require a hardware adapter');
      results.push({ ...row, numerical, run, gate: null });
      console.log(
        `${scenario.id} ${run}: CPU ${row.cpuMs.mean.toFixed(3)}ms mean, completion ${row.completionMs.p95.toFixed(3)}ms p95, summed GPU ${row.gpuMs ? row.gpuMs.p95.toFixed(3) + 'ms p95' : 'unavailable'}, cadence ${row.rafMs.p50.toFixed(3)}ms median`,
      );
    }
  }
  await writeFile(
    `docs/benchmarks/m7-${name}.json`,
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
          params:
            'defaults; backdrop-glass uses its explicitly labeled texture preview, without experimental DOM capture',
          clock: 'one fixed 1/60 s update per rAF; queue completion and timestamp readback awaited',
          timing:
            'cpuMs is encoding/submission wall time. completionMs is encoding through queue completion wall latency including wait/browser/driver overhead. gpuMs sums measured GPU pass timestamp durations when available; null means unavailable or no complete capture. rafMs includes serialized readback overhead and is observed cadence, not pure GPU execution.',
          quality: 'fixed; no adaptive resolution or step scaling; timeScale 1',
          gate: 'Six selected research stretches; no refresh-rate exit threshold.',
          memory: 'logical GPU allocation sizes, not driver VRAM',
          numerical:
            'Separate untimed reproduction of 150 fixed updates at 512² after each measured run; full f32 taps checked for finite values. Profiler timings exclude these validation/readback calls.',
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
