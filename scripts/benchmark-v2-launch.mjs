import { chromium, webkit } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { platform, arch, release } from 'node:os';

const name = process.argv[2] ?? 'chrome';
if (!['chrome', 'webkit'].includes(name) || process.argv.length > 3)
  throw new Error('Usage: node scripts/benchmark-v2-launch.mjs chrome|webkit');
const base = process.env.HOLOGPU_URL ?? 'http://127.0.0.1:5175';
const browser = await (name === 'webkit' ? webkit : chromium).launch({
  ...(name === 'chrome' ? { channel: 'chrome' } : {}),
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 1200, height: 900 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(`${base}/launch.html`);
  await page.waitForFunction(() => window.launchDemo?.attachments.length === 10);
  const firstFrames = await page.evaluate(() =>
    window.launchDemo.attachments.map((a) => ({
      id: a.effect.id,
      state: a.state,
      timings: a.timings,
    })),
  );
  const results = [];
  for (const section of ['home', 'details', 'product', 'join']) {
    const row = await page.evaluate(async (section) => {
      const attachments = window.launchDemo.attachments;
      const session = attachments[0].field.session;
      session.scheduler.setHidden(true);
      for (const attachment of attachments) attachment.pause();
      document.getElementById(section).scrollIntoView();
      // Resize, visibility and CSS binding observers settle outside the timed region.
      for (let i = 0; i < 10; i++) await new Promise(requestAnimationFrame);
      const visible = attachments.filter((a) => {
        const r = a.host.getBoundingClientRect();
        return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
      });
      for (const a of visible) {
        if (a.state !== 'ready' || !a.field) throw new Error('Visible field is not ready');
        await a.field.whenInputsReady();
        a.field.visible = true;
      }
      await session.device.queue.onSubmittedWorkDone();
      const samples = [];
      for (let i = 0; i < 150; i++) {
        await new Promise(requestAnimationFrame);
        const start = performance.now();
        for (const a of visible) {
          const f = a.field;
          f.frame.time = i / 60;
          f.frame.index = i;
          f.frame.delta = 1 / 60;
          f.frame.seed = 7;
          f.beforeFrame();
          f.render();
          f.dirty = false;
        }
        session.submit();
        const submitted = performance.now();
        await session.device.queue.onSubmittedWorkDone();
        if (i >= 30)
          samples.push({
            cpuEncodeSubmitMs: submitted - start,
            completedWorkMs: performance.now() - start,
          });
      }
      const summarize = (key) => {
        const values = samples.map((s) => s[key]).sort((a, b) => a - b);
        return {
          count: values.length,
          p50: values[Math.floor(values.length * 0.5)],
          p95: values[Math.floor(values.length * 0.95)],
          max: values.at(-1),
        };
      };
      const completedWorkMs = summarize('completedWorkMs');
      return {
        section,
        fields: visible.map((a) => ({
          id: a.effect.id,
          size: [...a.field.surface.size],
          resolutionScale: a.field.surface.resolutionScale,
        })),
        cpuEncodeSubmitMs: summarize('cpuEncodeSubmitMs'),
        completedWorkMs,
        gate: { budgetMs: 4, passed: completedWorkMs.p95 <= 4 },
        samples,
        gpuErrors: [...session.errors],
      };
    }, section);
    results.push(row);
    console.log(
      `${name} ${section}: ${row.fields.length} fields, completed-work p95 ${row.completedWorkMs.p95.toFixed(3)}ms, gate ${row.gate.passed}`,
    );
  }
  if (errors.length || results.some((r) => r.gpuErrors.length))
    throw new Error(JSON.stringify({ errors, results }));
  await mkdir('docs/benchmarks', { recursive: true });
  const filename = `docs/benchmarks/v2-launch-${name}.json`;
  await writeFile(
    filename,
    JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        environment: {
          platform: platform(),
          arch: arch(),
          release: release(),
          browser: name,
          browserVersion: browser.version(),
          viewport: [1200, 900],
          dpr: 1,
          baseURL: base,
          competingLoad:
            'HoloGPU captures are serialized. Independent user projects may be active; machine-wide load is not controlled.',
        },
        method:
          'Actual launch page, all viewport-intersecting attachments rendered every sampled frame, including interaction-only fields and the ordinarily rate-limited grain. 30 warmup plus 120 samples per section, seed 7, authored resolution scales, actual CSS/input hooks, shared session submit, queue completion awaited each frame. Scheduler is stopped during this manual capture. Completed-work is CPU encode+submit+GPU queue callback, not pure GPU execution or compositor presentation. Initial attachment timings retained separately. This measures the 4ms completed-work page gate; it does not establish individual pure-GPU timing gates.',
        firstFrames,
        results,
        errors,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Saved ${filename}`);
} finally {
  await browser.close();
}
