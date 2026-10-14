import { chromium, webkit } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { platform, release, arch } from 'node:os';

const engine = process.argv[2] ?? 'chrome';
const runs = Number(process.env.HOLOGPU_BENCHMARK_RUNS ?? 3);
const scenarios = [
  'section-wipe',
  'section-wipe-noise',
  'section-wipe-luminance',
  'wave-divider',
  'progress-line',
  'mixed-page',
];
const selected = process.env.HOLOGPU_BENCHMARK_SCENARIOS?.split(',').filter(Boolean);
if (
  !['chrome', 'webkit'].includes(engine) ||
  !Number.isInteger(runs) ||
  runs < 1 ||
  runs > 3 ||
  selected?.some((id) => !scenarios.includes(id))
)
  throw new Error(
    'Usage: node scripts/benchmark-v2-transitions.mjs chrome|webkit (HOLOGPU_BENCHMARK_RUNS=1…3)',
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
await page.route('**/__transitions_bench', (route) =>
  route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><style>body{margin:0;background:#fbfaf7}.host{position:absolute;overflow:hidden}.host img{position:absolute;inset:0;width:100%;height:100%}.host[data-hgpu-state=ready]>img{visibility:hidden}</style>',
  }),
);
try {
  await page.goto(`${process.env.HOLOGPU_URL ?? 'http://127.0.0.1:5175'}/__transitions_bench`);
  for (const id of selected ?? scenarios)
    for (let run = 1; run <= runs; run++) {
      const result = await page.evaluate(
        async ({ root, id, run, engine }) => {
          const { attach } = await import(`/@fs${root}/packages/dom/src/index.ts`);
          const { acquireDevice } = await import(`/@fs${root}/packages/core/src/index.ts`);
          const { summarize } = await import(`/@fs${root}/packages/core/src/measure.ts`);
          const effects = Object.fromEntries(
            await Promise.all(
              ['section-wipe', 'wave-divider', 'progress-line'].map(async (name) => [
                name,
                (await import(`/@fs${root}/packages/effects/src/${name}/index.ts`)).default,
              ]),
            ),
          );
          const images = await Promise.all(
            ['console', 'modules'].map(async (name) => {
              const image = new Image();
              image.src = `/media/products/${name}.png`;
              await image.decode();
              return image;
            }),
          );
          const { session, release } = await acquireDevice();
          session.scheduler.setHidden(true);
          const profiler = session.profiler,
            frames = [],
            items = [],
            hosts = [];
          profiler.enabled = true;
          const remove = profiler.onFrame((frame) => frames.push(frame));
          const lineParams = {
            pointCount: 6,
            p0: [0.04, 0.65],
            p1: [0.24, 0.65],
            p2: [0.38, 0.32],
            p3: [0.58, 0.32],
            p4: [0.74, 0.65],
            p5: [0.96, 0.65],
            intensity: 0.7,
            tint: '#596684',
          };
          const mount = async (name, left, top, width, height, params = {}) => {
            const host = document.createElement('div');
            host.className = 'host';
            host.style.cssText = `left:${left}px;top:${top}px;width:${width}px;height:${height}px`;
            if (name === 'section-wipe') host.append(...images.map((image) => image.cloneNode()));
            document.body.append(host);
            hosts.push(host);
            const item = await attach(host, effects[name], {
              layer: 'front',
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
            if (name === 'section-wipe') {
              await item.field.bindInput('image', { kind: 'image', source: images[0] });
              await item.field.bindInput('next', { kind: 'image', source: images[1] });
            }
          };
          try {
            if (id === 'mixed-page') {
              await mount('section-wipe', 24, 24, 560, 373, { progress: 0.45 });
              await mount('progress-line', 700, 120, 600, 170, lineParams);
              await mount('wave-divider', 0, 600, 1440, 100, { fill: '#eae9f2' });
            } else if (id.startsWith('section-wipe'))
              await mount('section-wipe', 24, 24, 560, 373, {
                mode:
                  id.replace('section-wipe-', '') === 'section-wipe'
                    ? 'directional'
                    : id.replace('section-wipe-', ''),
              });
            else if (id === 'wave-divider') await mount(id, 0, 24, 1440, 100, { fill: '#eae9f2' });
            else await mount(id, 24, 24, 600, 170, lineParams);
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
                if (field.effect.id !== 'wave-divider')
                  field.store.set('progress', 0.2 + 0.6 * ((n % 80) / 79));
                field.frame.time = n / 60;
                field.frame.index = n;
                field.frame.delta = 1 / 60;
                field.beforeFrame();
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
              assets: images.map((image) => ({
                url: image.src,
                width: image.naturalWidth,
                height: image.naturalHeight,
              })),
              warmup: 30,
              sampleCount: 80,
              boundary:
                'Forced active frames; actual DOM attachments at own CSS sizes. Static images and their normalized mip chains load before warmup. CPU encode/submit, queue completed-work wall latency and summed GPU pass timestamps are separate boundaries. Mixed page has all three fields above the fold; no decoder or simulation.',
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
  `docs/benchmarks/v2-transitions-${engine}${selected ? '-followup' : ''}.json`,
  JSON.stringify(
    {
      date: new Date().toISOString(),
      platform: platform(),
      release: release(),
      arch: arch(),
      method:
        'DPR1 native own-size DOM fields, 30 warmup +80 completed samples. Three captures per scenario. Active forced progress and time; uncontrolled load. CPU, GPU timestamps and completed-work wall latency reported separately.',
      results,
      errors,
    },
    null,
    2,
  ) + '\n',
);
if (errors.length || results.some((result) => result.errors.length)) process.exitCode = 1;
