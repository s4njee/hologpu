import { firefox } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { platform, release, arch } from 'node:os';

const runs = Number(process.env.HOLOGPU_BENCHMARK_RUNS ?? 3);
if (!Number.isInteger(runs) || runs < 1 || runs > 3 || process.argv.length > 2)
  throw new Error(
    'Usage: node scripts/benchmark-firefox-submissions.mjs (HOLOGPU_BENCHMARK_RUNS=1…3)',
  );
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const headless = process.env.HOLOGPU_HEADLESS === '1';
const browser = await firefox.launch({ headless });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
await page.emulateMedia({ reducedMotion: 'no-preference' });
const errors = [],
  results = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.route('**/__firefox_submission_bench', (route) =>
  route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><style>body{margin:0;background:#11121b;color:#eee;font:16px system-ui}.host{position:absolute;overflow:hidden}.host h2,.host p{position:relative;z-index:2;margin:24px;max-width:340px}</style>',
  }),
);

try {
  // Interleave the bounds by capture to reduce a simple warm-cache or machine-load order bias.
  for (let run = 1; run <= runs; run++)
    for (const limit of run % 2 ? [1, 8] : [8, 1]) {
      await page.goto(
        `${process.env.HOLOGPU_URL ?? 'http://127.0.0.1:5175'}/__firefox_submission_bench`,
      );
      const result = await page.evaluate(
        async ({ root, limit, run }) => {
          const { attach } = await import(`/@fs${root}/packages/dom/src/index.ts`);
          const { summarize } = await import(`/@fs${root}/packages/core/src/measure.ts`);
          const definitions = Object.fromEntries(
            await Promise.all(
              ['constellation', 'dot-matrix-field'].map(async (id) => [
                id,
                (await import(`/@fs${root}/packages/effects/src/${id}/index.ts`)).default,
              ]),
            ),
          );
          const items = [],
            hosts = [],
            removes = [],
            restores = [],
            rows = [],
            pendingPromises = [];
          let session,
            running = false,
            pending = 0,
            peakPending = 0,
            boundary = 0,
            timer;
          const renderCounts = Array(6).fill(0),
            updateCounts = Array(6).fill(0);
          try {
            for (let index = 0; index < 6; index++) {
              const id = index % 2 ? 'constellation' : 'dot-matrix-field';
              const host = document.createElement('section');
              host.className = 'host';
              host.style.cssText = `left:${24 + (index % 3) * 472}px;top:${24 + Math.floor(index / 3) * 286}px;width:400px;height:240px`;
              host.innerHTML =
                '<h2>Quiet atmosphere</h2><p>Six modest fields over real, native copy.</p>';
              document.body.append(host);
              hosts.push(host);
              const item = await attach(host, definitions[id], {
                layer: 'behind',
                poster: '',
                playing: false,
                reducedMotion: false,
                adaptiveQuality: false,
                resolutionScale: 1,
                dprCap: 1,
                seed: 7,
              });
              items.push(item);
              const field = item.field;
              if (!field || item.state !== 'ready')
                throw new Error('Unready native Firefox field: ' + id);
              session ??= field.session;
              if (field.session !== session)
                throw new Error('Fields do not share one device session');
              session.scheduler.setHidden(true);
              field.visible = true;
              field.pause();
            }
            await session.device.queue.onSubmittedWorkDone();
            const defaultSubmissionLimit = session.scheduler.submissionLimit;
            session.scheduler.setSubmissionLimit(limit);
            const fields = items.map((item) => item.field);
            fields.forEach((field, index) => {
              removes.push(field.onRendered(() => renderCounts[index]++));
              const update = field.instance.update;
              if (update) {
                field.instance.update = function (frame) {
                  updateCounts[index]++;
                  return update.call(this, frame);
                };
                restores.push(() => {
                  if (field.instance) field.instance.update = update;
                });
              }
              field.play();
            });
            const idleRaf = [];
            let previous;
            for (let index = 0; index < 40; index++) {
              const now = await new Promise(requestAnimationFrame);
              if (previous !== undefined) idleRaf.push(now - previous);
              previous = now;
            }
            removes.push(
              fields[0].onBeforeFrame(() => {
                boundary = performance.now();
              }),
            );
            const originalSubmit = session.submit;
            let finish;
            const finished = new Promise((resolve) => {
              finish = resolve;
            });
            timer = setTimeout(() => finish('timeout'), 45_000);
            const captureStart = performance.now();
            session.submit = function () {
              const returned = originalSubmit.call(this);
              if (!running) return returned;
              const submittedAt = performance.now();
              const row = {
                index: rows.length,
                submittedAtMs: submittedAt - captureStart,
                encodeSubmitMs: submittedAt - boundary,
                callbackMs: null,
                completedAtMs: null,
                renders: [...renderCounts],
                updates: [...updateCounts],
              };
              rows.push(row);
              pending++;
              peakPending = Math.max(peakPending, pending);
              row.pendingAfterSubmit = pending;
              pendingPromises.push(
                session.device.queue.onSubmittedWorkDone().then(
                  () => {
                    const now = performance.now();
                    row.callbackMs = now - submittedAt;
                    row.completedAtMs = now - captureStart;
                    pending--;
                  },
                  (error) => {
                    row.error = String(error);
                    pending--;
                  },
                ),
              );
              if (rows.length >= 150) {
                running = false;
                session.scheduler.setHidden(true);
                finish('complete');
              }
              return returned;
            };
            restores.push(() => {
              session.submit = originalSubmit;
            });
            const startErrors = session.errors.length;
            running = true;
            session.scheduler.setHidden(false);
            const outcome = await finished;
            running = false;
            session.scheduler.setHidden(true);
            await Promise.all(pendingPromises);
            await session.device.queue.onSubmittedWorkDone();
            if (outcome !== 'complete' || rows.length !== 150)
              throw new Error(`Firefox limit ${limit} timed out after ${rows.length} submissions`);
            if (pending !== 0 || peakPending > limit)
              throw new Error(
                `Submission bound violated: ${peakPending}/${limit}, pending ${pending}`,
              );
            const measured = rows.slice(30),
              warm = rows[29];
            if (measured.some((row) => row.callbackMs === null || row.completedAtMs === null))
              throw new Error('Missing completed submission samples');
            const submittedIntervals = measured
              .slice(1)
              .map((row, index) => row.submittedAtMs - measured[index].submittedAtMs);
            const completed = [...measured].sort((a, b) => a.completedAtMs - b.completedAtMs);
            const completedIntervals = completed
              .slice(1)
              .map((row, index) => row.completedAtMs - completed[index].completedAtMs);
            const pixels = [];
            for (const field of fields) {
              const image = await field.readPixels();
              let litAlpha = 0;
              for (let index = 3; index < image.pixels.length; index += 4)
                if (image.pixels[index] > 2) litAlpha++;
              pixels.push({
                id: field.effect.id,
                width: image.width,
                height: image.height,
                litAlpha,
              });
            }
            const geometry = fields.map((field, index) => {
              const rect = hosts[index].getBoundingClientRect();
              return {
                id: field.effect.id,
                tier: field.effect.tier,
                cssBounds: {
                  left: rect.left,
                  top: rect.top,
                  width: rect.width,
                  height: rect.height,
                },
                aboveFold:
                  rect.left >= 0 &&
                  rect.top >= 0 &&
                  rect.right <= innerWidth &&
                  rect.bottom <= innerHeight,
                target: [...field.surface.size],
                resolutionScale: field.surface.resolutionScale,
                params: field.store.snapshot(),
                firstFrameTimings: items[index].timings,
                renders: renderCounts[index] - warm.renders[index],
                updates: updateCounts[index] - warm.updates[index],
                memory: field.memory(),
              };
            });
            if (
              geometry.some((field) => !field.aboveFold || field.renders !== 120) ||
              pixels.some((image) => !image.litAlpha)
            )
              throw new Error('Modest page lost a visible, active rendered field');
            return {
              run,
              limit,
              defaultSubmissionLimit,
              ua: navigator.userAgent,
              capabilities: session.capabilities,
              dpr: devicePixelRatio,
              geometry,
              pixels,
              warmup: 30,
              samples: 120,
              submissions: rows.length,
              peakPending,
              pendingAfterDrain: pending,
              idleRafMs: summarize(idleRaf),
              encodeSubmitMs: summarize(measured.map((row) => row.encodeSubmitMs)),
              completionCallbackMs: summarize(measured.map((row) => row.callbackMs)),
              submittedCadenceMs: summarize(submittedIntervals),
              completedCadenceMs: summarize(completedIntervals),
              submittedFps: 119_000 / (measured.at(-1).submittedAtMs - measured[0].submittedAtMs),
              completedFps: 119_000 / (completed.at(-1).completedAtMs - completed[0].completedAtMs),
              completionBatchesWithin1Ms: completedIntervals.filter((delta) => delta < 1).length,
              errors: [
                ...session.errors.slice(startErrors),
                ...measured.flatMap((row) => (row.error ? [row.error] : [])),
              ],
              rawSamples: measured,
            };
          } finally {
            clearTimeout(timer);
            running = false;
            session?.scheduler.setHidden(true);
            await Promise.allSettled(pendingPromises);
            restores.reverse().forEach((restore) => restore());
            removes.forEach((remove) => remove());
            items.reverse().forEach((item) => item.destroy());
            hosts.forEach((host) => host.remove());
          }
        },
        { root, limit, run },
      );
      results.push(result);
      console.log(
        JSON.stringify({
          run,
          limit,
          submittedFps: result.submittedFps,
          completedFps: result.completedFps,
          callbackP95: result.completionCallbackMs.p95,
          peakPending: result.peakPending,
          errors: result.errors,
        }),
      );
    }
} finally {
  await browser.close();
}

await mkdir('docs/benchmarks', { recursive: true });
await writeFile(
  'docs/benchmarks/firefox-submissions.json',
  JSON.stringify(
    {
      recordedAt: new Date().toISOString(),
      environment: {
        platform: platform(),
        release: release(),
        arch: arch(),
        browser: 'firefox',
        version: browser.version(),
        headless,
        viewport: { width: 1440, height: 1000 },
        competingLoad: process.env.HOLOGPU_COMPETING_LOAD ?? 'Machine-wide load is uncontrolled.',
      },
      method:
        'Real shared production scheduler, six active T1 DOM attachments at CSS400x240/DPR1/resolution1, three captures per explicit bound (1/8) in alternating order. 30 warmup submissions +120 measured completed submissions; no profiler, forced drawAt, per-frame await, or GPU readback inside capture. Completion callbacks report notified work completion and can be delivered in a batch. Both submitted and completed cadence are retained; callback latency is not GPU execution time. Six final readbacks validate rendered content after the timed region. JavaScript observed pending callbacks verify the bound; this is not physical GPU queue occupancy.',
      results,
      errors,
    },
    null,
    2,
  ) + '\n',
);
if (errors.length || results.some((row) => row.errors.length)) process.exitCode = 1;
