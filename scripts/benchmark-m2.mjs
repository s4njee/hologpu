import { chromium, webkit } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { platform, arch, release } from 'node:os';
import { summarize } from '../packages/core/dist/measure.js';
const name = process.argv[2] ?? 'chrome',
  gate = process.argv.includes('--gate');
const engine = { chrome: chromium, webkit }[name];
if (!engine) throw new Error('Expected chrome or webkit');
const browser = await engine.launch({
  ...(name === 'chrome' ? { channel: 'chrome' } : {}),
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 1400, height: 1200 },
  deviceScaleFactor: 1,
});
const results = [];
try {
  for (const id of gate
    ? ['reaction-diffusion', 'fluid']
    : [
        'reaction-diffusion',
        'life',
        'lenia',
        'wave',
        'physarum',
        'falling-sand',
        'fluid',
        'ink',
        'smoke',
      ]) {
    const size = gate ? 1024 : 512;
    await page.goto(
      `${process.env.HOLOGPU_URL ?? 'http://127.0.0.1:5176'}/?effect=${id}&playing=false&quality=fixed&resolution=1`,
    );
    await page.locator('#status[data-state="ready"]').waitFor();
    await page.locator('#stage').evaluate((node, size) => {
      node.style.width = `${size + 2}px`;
      node.style.height = `${size + 2}px`;
    }, size);
    await page.waitForFunction((size) => window.hologpu.field.surface.size[0] === size, size);
    if (gate) await page.evaluate(() => window.hologpu.field.store.set('grid', 1024));
    const baseline = await page.evaluate(async () => {
      const f = window.hologpu.field;
      f.reset(7);
      f.advance(0);
      await f.session.device.queue.onSubmittedWorkDone();
      const times = [];
      let previous;
      for (let i = 0; i < 40; i++) {
        const now = await new Promise(requestAnimationFrame);
        if (previous !== undefined) times.push(now - previous);
        previous = now;
      }
      return times;
    });
    const idle = summarize(baseline);
    for (let run = 1; run <= 3; run++) {
      const data = await page.evaluate(async () => {
        const f = window.hologpu.field;
        f.reset(7);
        f.advance(0);
        await f.session.device.queue.onSubmittedWorkDone();
        const cpu = [],
          completed = [],
          raf = [];
        let previous;
        for (let i = 0; i < 150; i++) {
          const now = await new Promise(requestAnimationFrame),
            start = performance.now();
          f.advance(1);
          const encode = performance.now() - start;
          await f.session.device.queue.onSubmittedWorkDone();
          const latency = performance.now() - start;
          if (i >= 30) {
            cpu.push(encode);
            completed.push(latency);
            raf.push(now - previous);
          }
          previous = now;
        }
        return {
          cpu,
          completed,
          raf,
          params: f.store.snapshot(),
          size: f.surface.size,
          taps: Object.fromEntries(
            Object.entries(f.textureTaps).map(([n, t]) => [
              n,
              { width: t.width, height: t.height, format: t.format },
            ]),
          ),
          memory: f.memory(),
          capabilities: f.session.capabilities,
          errors: f.session.errors,
          frameIndex: f.frame.index,
        };
      });
      if (data.errors.length) throw new Error(data.errors.join('\n'));
      const { cpu, completed, raf, ...metadata } = data;
      const deadline = idle.p50 * 1.1;
      const row = {
        id,
        run,
        ...metadata,
        idleRafMs: idle,
        cpuEncodeMs: summarize(cpu),
        submitToCompletionMs: summarize(completed),
        rafIntervalMs: summarize(raf),
        gpuMs: null,
        deadlineMs: deadline,
        completedWithinDeadline: completed.filter((v) => v <= deadline).length / completed.length,
        gate: gate
          ? (data.taps.state?.width === 1024 && data.taps.state?.height === 1024) ||
            (data.taps.velocity?.width === 1024 && data.taps.velocity?.height === 1024)
          : null,
      };
      if (gate)
        row.gate = Boolean(
          row.gate && row.completedWithinDeadline >= 0.95 && row.rafIntervalMs.p50 <= deadline,
        );
      results.push(row);
      console.log(
        `${id} ${run}: CPU ${row.cpuEncodeMs.mean.toFixed(3)}ms, completion ${row.submitToCompletionMs.p95.toFixed(3)}ms p95, cadence ${row.rafIntervalMs.p50.toFixed(3)}ms median${gate ? `, gate ${row.gate}` : ''}`,
      );
    }
  }
  await writeFile(
    `docs/benchmarks/m2${gate ? '-gate' : ''}-${name}.json`,
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
          width: gate ? 1024 : 512,
          height: gate ? 1024 : 512,
          seed: 7,
          warmupFrames: 30,
          samples: 120,
          runs: 3,
          params: gate ? 'defaults, grid overridden to1024' : 'defaults',
          clock: 'one fixed1/60s simulation update per rAF, queue completion awaited each frame',
          timing:
            'CPU encode/submit and submit-to-queue-completion wall latency; not GPU timestamp time',
          quality: 'fixed; no adaptive resolution or step scaling',
          gate: gate
            ? 'Actual simulation and display both1024²; at least95% completions and median rAF cadence within110% of measured idle display period'
            : null,
          memory: 'logical allocations, not VRAM',
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
