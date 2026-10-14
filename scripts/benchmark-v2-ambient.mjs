import { chromium, webkit } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { platform, release, arch } from 'node:os';

const engine = process.argv[2] ?? 'chrome';
const runs = Number(process.env.HOLOGPU_BENCHMARK_RUNS ?? 3);
const scenarios = ['particle-drift', 'particle-drift-max', 'constellation', 'mixed-page'];
const selected = process.env.HOLOGPU_BENCHMARK_SCENARIOS?.split(',').filter(Boolean);
if (
  !['chrome', 'webkit'].includes(engine) ||
  !Number.isInteger(runs) ||
  runs < 1 ||
  runs > 3 ||
  selected?.some((id) => !scenarios.includes(id))
)
  throw new Error(
    'Usage: node scripts/benchmark-v2-ambient.mjs chrome|webkit (HOLOGPU_BENCHMARK_RUNS=1…3)',
  );
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const browser = await (engine === 'chrome' ? chromium : webkit).launch({
  ...(engine === 'chrome' ? { channel: 'chrome' } : {}),
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
const results = [],
  errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.route('**/__ambient_bench', (route) =>
  route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><style>body{margin:0;background:#11121b;color:#eee;font:16px system-ui}.host{position:absolute;overflow:hidden}.host h1,.host p{position:relative;z-index:2;margin:24px;max-width:400px}</style>',
  }),
);
try {
  await page.goto(`${process.env.HOLOGPU_URL ?? 'http://127.0.0.1:5175'}/__ambient_bench`);
  for (const id of selected ?? scenarios)
    for (let run = 1; run <= runs; run++) {
      const result = await page.evaluate(
        async ({ root, id, run, engine }) => {
          const { attach } = await import(`/@fs${root}/packages/dom/src/index.ts`);
          const { acquireDevice } = await import(`/@fs${root}/packages/core/src/index.ts`);
          const { summarize } = await import(`/@fs${root}/packages/core/src/measure.ts`);
          const effects = Object.fromEntries(
            await Promise.all(
              ['particle-drift', 'constellation'].map(async (name) => [
                name,
                (await import(`/@fs${root}/packages/effects/src/${name}/index.ts`)).default,
              ]),
            ),
          );
          const { session, release } = await acquireDevice();
          session.scheduler.setHidden(true);
          const profiler = session.profiler,
            frames = [],
            items = [],
            hosts = [];
          profiler.enabled = true;
          const remove = profiler.onFrame((frame) => frames.push(frame));
          const mount = async (name, left, top, width, height, params = {}) => {
            const host = document.createElement('div');
            host.className = 'host';
            host.style.cssText = `left:${left}px;top:${top}px;width:${width}px;height:${height}px`;
            host.innerHTML =
              '<h1>A little atmosphere.</h1><p>Native readable copy remains in the light DOM.</p>';
            document.body.append(host);
            hosts.push(host);
            const item = await attach(host, effects[name], {
              layer: 'behind',
              poster: '',
              params,
              playing: false,
              reducedMotion: false,
              adaptiveQuality: false,
              dprCap: 1,
              seed: 7,
            });
            items.push(item);
            if (!item.field || item.state !== 'ready') throw new Error('Unready ' + name);
            item.field.visible = true;
          };
          try {
            if (id === 'mixed-page') {
              await mount('particle-drift', 24, 24, 680, 440, { count: 1024 });
              await mount('constellation', 760, 120, 500, 300);
            } else if (id.startsWith('particle-drift'))
              await mount('particle-drift', 24, 24, 680, 440, {
                count: id.endsWith('-max') ? 2048 : 1024,
              });
            else await mount('constellation', 24, 24, 500, 300);
            for (const item of items) {
              item.field.beforeFrame();
              item.field.render();
            }
            session.submit();
            await session.device.queue.onSubmittedWorkDone();
            await profiler.settle();
            profiler.clear();
            const startErrors = session.errors.length,
              samples = [],
              passes = {};
            for (let n = 0; n < 110; n++) {
              await new Promise(requestAnimationFrame);
              frames.length = 0;
              const start = performance.now();
              for (const item of items) {
                const field = item.field;
                field.beforeFrame();
                // One active simulation step per sample, encoded before its render.
                field.update({ time: (n + 1) / 60, delta: 1 / 60, index: n + 1 });
                field.render();
                field.dirty = false;
              }
              const encoded = performance.now();
              session.submit();
              const submitted = performance.now();
              await session.device.queue.onSubmittedWorkDone();
              const completion = performance.now() - start;
              await profiler.settle();
              if (n >= 30) {
                const frame = frames.at(-1);
                if (frame?.truncated) throw new Error('Truncated profile');
                samples.push({
                  cpuMs: encoded - start,
                  cpuSubmitMs: submitted - start,
                  completionMs: completion,
                  gpuMs: frame?.totalMs ?? null,
                });
                for (const [name, pass] of Object.entries(frame?.passes ?? {}))
                  (passes[name] ??= []).push(pass.ms);
              }
            }
            const fields = items.map((item) => {
              const field = item.field,
                rect = field.canvas.getBoundingClientRect();
              return {
                id: field.effect.id,
                params: field.store.values,
                cssBounds: {
                  left: rect.left,
                  top: rect.top,
                  width: rect.width,
                  height: rect.height,
                },
                target: field.surface.size,
                aboveFold:
                  rect.left >= 0 &&
                  rect.top >= 0 &&
                  rect.right <= innerWidth &&
                  rect.bottom <= innerHeight,
                mediaPath: field.inputMediaPath,
                memory: field.memory(),
              };
            });
            if (fields.some((field) => !field.aboveFold)) throw new Error('Field outside viewport');
            return {
              id,
              run,
              browser: engine,
              ua: navigator.userAgent,
              adapter: session.capabilities.adapter,
              dpr: devicePixelRatio,
              timestampQuery: session.capabilities.features.includes('timestamp-query'),
              fields,
              warmup: 30,
              sampleCount: 80,
              boundary:
                'Forced active frames; actual DOM attachments at own CSS sizes. Every sample advances the simulation exactly 1/60 s before rendering; particle compute and draw share a submit boundary. CPU encode/submit, queue completed-work wall latency and summed GPU pass timestamps are separate boundaries. Mixed page has both fields above the fold, one particle-drift instance, no decoder or external image assets.',
              cpuMs: summarize(samples.map((s) => s.cpuMs)),
              cpuSubmitMs: summarize(samples.map((s) => s.cpuSubmitMs)),
              completionMs: summarize(samples.map((s) => s.completionMs)),
              gpuMs: samples.some((s) => s.gpuMs !== null)
                ? summarize(samples.map((s) => s.gpuMs).filter((v) => v !== null))
                : null,
              passes: Object.fromEntries(
                Object.entries(passes).map(([name, values]) => [name, summarize(values)]),
              ),
              samples,
              errors: session.errors.slice(startErrors),
            };
          } finally {
            remove();
            profiler.enabled = false;
            for (const item of items.reverse()) item.destroy();
            for (const host of hosts) host.remove();
            session.scheduler.setHidden(false);
            release();
          }
        },
        { root, id, run, engine },
      );
      results.push(result);
      console.log(
        JSON.stringify({
          id,
          run,
          gpuP95: result.gpuMs?.p95,
          completionP95: result.completionMs.p95,
          errors: result.errors,
        }),
      );
    }
} finally {
  await browser.close();
}
await mkdir('docs/benchmarks', { recursive: true });
await writeFile(
  `docs/benchmarks/v2-ambient-${engine}${selected ? '-followup' : ''}.json`,
  JSON.stringify(
    {
      date: new Date().toISOString(),
      platform: platform(),
      release: release(),
      arch: arch(),
      method:
        'DPR1 native own-size DOM fields, 30 warmup +80 completed samples. Three captures per scenario. Active fixed-step compute and render; uncontrolled load. Particle count 1024 and maximum 2048, single instance per scenario. CPU, GPU timestamps and completed-work wall latency reported separately.',
      results,
      errors,
    },
    null,
    2,
  ) + '\n',
);
if (errors.length || results.some((result) => result.errors.length)) process.exitCode = 1;
