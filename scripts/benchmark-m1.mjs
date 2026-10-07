import { chromium, firefox, webkit } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { platform, arch, release } from 'node:os';
import { summarize } from '../packages/core/dist/measure.js';
const name = process.argv[2] ?? 'chrome';
const engine = { chrome: chromium, firefox, webkit, swiftshader: chromium }[name];
if (!engine) throw new Error('Expected chrome, firefox, webkit, or swiftshader');
const browser = await engine.launch({
  ...(name === 'chrome' ? { channel: 'chrome' } : {}),
  ...(name === 'swiftshader'
    ? { args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader'] }
    : {}),
  headless: name !== 'firefox',
});
const page = await browser.newPage({
  viewport: { width: 1200, height: 900 },
  deviceScaleFactor: 1,
});
const ids = process.argv.slice(3);
const label = process.env.HOLOGPU_BENCHMARK_LABEL ?? 'm1';
if (!/^[a-z][a-z0-9-]*$/.test(label)) throw new Error('Invalid benchmark label');
const results = [];
try {
  for (const id of ids.length
    ? ids
    : ['gradient-oklch', 'noise-lab', 'voronoi', 'sdf-2d', 'raymarch', 'fractal']) {
    await page.goto(
      `${process.env.HOLOGPU_URL ?? 'http://127.0.0.1:5175'}/?effect=${id}&playing=false`,
    );
    await page.locator('#status[data-state="ready"]').waitFor();
    await page.locator('#stage').evaluate((node) => {
      node.style.width = '514px';
      node.style.height = '322px';
    });
    await page.waitForFunction(() => window.hologpu.field.surface.size[0] === 512);
    for (let run = 1; run <= 3; run++) {
      const row = await page.evaluate(async () => {
        const field = window.hologpu.field;
        field.reset(7);
        const cpu = [],
          raf = [];
        let previous;
        for (let i = 0; i < 150; i++) {
          const time = await new Promise(requestAnimationFrame);
          const start = performance.now();
          field.drawAt(i / 60, 7);
          const encode = performance.now() - start;
          if (i >= 30) {
            cpu.push(encode);
            raf.push(time - previous);
          }
          previous = time;
        }
        await field.session.device.queue.onSubmittedWorkDone();
        return {
          cpu,
          raf,
          params: field.store.snapshot(),
          size: field.surface.size,
          memory: field.memory(),
          capabilities: field.session.capabilities,
          errors: field.session.errors,
        };
      });
      if (row.errors.length) throw new Error(row.errors.join('\n'));
      const { cpu, raf, ...metadata } = row;
      const result = {
        id,
        run,
        ...metadata,
        cpuEncodeMs: summarize(cpu),
        rafIntervalMs: summarize(raf),
        gpuMs: null,
      };
      results.push(result);
      console.log(
        `${id} ${run}: CPU ${result.cpuEncodeMs.mean.toFixed(3)}ms, rAF ${result.rafIntervalMs.mean.toFixed(3)}ms`,
      );
    }
  }
  await writeFile(
    `docs/benchmarks/${label}-${name}.json`,
    JSON.stringify(
      {
        recordedOn: '2026-10-07',
        environment: {
          platform: platform(),
          arch: arch(),
          release: release(),
          browser: name,
          browserVersion: browser.version(),
          headless: name !== 'firefox',
          softwareAdapter: name === 'swiftshader',
          dpr: 1,
        },
        scenario: {
          width: 512,
          height: 320,
          seed: 7,
          warmupFrames: 30,
          samples: 120,
          runs: 3,
          params: 'defaults',
          clock: 'fixed 1/60 s; explicit encoding in each requestAnimationFrame',
          timing: 'CPU encode/submit only; rAF cadence is not GPU execution time',
          memory: 'logical target/buffer byte counts, not VRAM',
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
