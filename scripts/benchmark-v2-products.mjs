import { chromium, webkit } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { platform, release, arch } from 'node:os';

const engine = process.argv[2] ?? 'chrome';
const runs = Number(process.env.HOLOGPU_BENCHMARK_RUNS ?? 1);
const ids = [
  'depth-parallax',
  'product-sheen',
  'bright-pass',
  'pointer-map',
  'masked-composite',
  'screenshot-glow',
  'hero-video-grade',
  'mixed-page',
];
const requested = process.env.HOLOGPU_BENCHMARK_SCENARIOS?.split(',').filter(Boolean);
if (
  !['chrome', 'webkit'].includes(engine) ||
  !Number.isInteger(runs) ||
  runs < 1 ||
  runs > 3 ||
  requested?.some((id) => !ids.includes(id))
)
  throw new Error(
    'Usage: node scripts/benchmark-v2-products.mjs chrome|webkit (HOLOGPU_BENCHMARK_RUNS=1…3, optional HOLOGPU_BENCHMARK_SCENARIOS=comma-separated IDs)',
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
const errors = [],
  warnings = [],
  results = [];
page.on('pageerror', (error) =>
  (error.message.includes('ResizeObserver loop') ? warnings : errors).push(error.message),
);
await page.emulateMedia({ reducedMotion: 'no-preference' });
await page.route('**/__products_bench', (route) =>
  route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><title>Product effects benchmark</title><style>body{margin:0;background:#10151e;font:16px Arial}.host{position:absolute;box-sizing:border-box;overflow:hidden;border-radius:12px}.original{display:block;width:100%;height:100%;object-fit:fill}canvas{pointer-events:none}</style>',
  }),
);
try {
  await page.goto(`${process.env.HOLOGPU_URL ?? 'http://127.0.0.1:5175'}/__products_bench`);
  for (const scenario of requested ?? ids)
    for (let run = 1; run <= runs; run++) {
      const result = await page.evaluate(
        async ({ root, scenario, engine, run }) => {
          const { attach } = await import(`/@fs${root}/packages/dom/src/index.ts`);
          const { acquireDevice, chain, defineEffect } = await import(
            `/@fs${root}/packages/core/src/index.ts`
          );
          const { summarize } = await import(`/@fs${root}/packages/core/src/measure.ts`);
          const { heroVideoGrade } = await import(`/@fs${root}/packages/hologpu/src/recipes.ts`);
          const load = async (id) =>
            (await import(`/@fs${root}/packages/effects/src/${id}/index.ts`)).default;
          const definitions = Object.fromEntries(
            await Promise.all(
              [
                'depth-parallax',
                'product-sheen',
                'bright-pass',
                'bloom',
                'pointer-map',
                'displace',
                'masked-composite',
              ].map(async (id) => [id, await load(id)]),
            ),
          );
          const { session, release } = await acquireDevice();
          session.scheduler.setHidden(true);
          const profiler = session.profiler,
            profiles = [],
            labels = [],
            attachments = [],
            fields = [],
            measured = [],
            hosts = [],
            media = [];
          profiler.enabled = true;
          const remove = profiler.onFrame((frame) => profiles.push(frame));
          const timestampWrites = profiler.timestampWrites;
          profiler.timestampWrites = function (encoder, label) {
            labels.push(label);
            return timestampWrites.call(this, encoder, label);
          };
          const asset = async (name) => {
            const image = new Image();
            image.src = `/media/products/${name}.png`;
            await image.decode();
            return image;
          };
          const images = Object.fromEntries(
            await Promise.all(
              [
                'console',
                'modules',
                'console-cutout',
                'screenshot',
                'console-depth',
                'modules-depth',
              ].map(async (name) => [name, await asset(name)]),
            ),
          );
          const mount = async (effect, left, top, width, height, image, extra = {}) => {
            const host = document.createElement('section');
            host.className = 'host';
            host.style.cssText = `left:${left}px;top:${top}px;width:${width}px;height:${height}px`;
            if (image) {
              const native = image.cloneNode();
              native.className = 'original';
              host.append(native);
            }
            document.body.append(host);
            hosts.push(host);
            const item = await attach(host, effect, {
              layer: 'front',
              playing: false,
              reducedMotion: false,
              adaptiveQuality: false,
              dprCap: 1,
              resolutionScale: 1,
              seed: 7,
              ...extra,
            });
            if (!item.field || item.state !== 'ready') throw new Error(`Unready ${effect.id}`);
            item.field.visible = true;
            attachments.push(item);
            fields.push(item.field);
            return item;
          };
          const addDepth = async (name, left, top, width = 560, height = 373) => {
            const item = await mount(
              definitions['depth-parallax'],
              left,
              top,
              width,
              height,
              images[name],
              { params: { mode: 'combined', progress: 0.65 } },
            );
            await item.field.bindInput('image', { kind: 'image', source: images[name] });
            await item.field.bindInput('depth', {
              kind: 'mask',
              source: images[`${name}-depth`],
              channel: 'red',
            });
            measured.push(item.field);
          };
          const addSheen = async (left, top, width = 560, height = 373) => {
            const item = await mount(
              definitions['product-sheen'],
              left,
              top,
              width,
              height,
              images['console-cutout'],
              { preset: 'warm' },
            );
            await item.field.bindInput('image', {
              kind: 'image',
              source: images['console-cutout'],
            });
            measured.push(item.field);
          };
          const glowMask = {
            kind: 'mask',
            source: 'M260 207H1142V332H260Z M280 420H1120V608H280Z',
            width: 1200,
            height: 750,
          };
          const lensMask = {
            kind: 'mask',
            source: 'M260 360H1142V662H260Z',
            width: 1200,
            height: 750,
          };
          const addGlow = async (left, top, width = 560, height = 350, brightOnly = false) => {
            const effect = brightOnly
              ? definitions['bright-pass']
              : chain(definitions['bright-pass'], definitions.bloom);
            const item = await mount(
              effect,
              left,
              top,
              width,
              height,
              images.screenshot,
              brightOnly
                ? { params: { threshold: 0.55 } }
                : {
                    resolutionScale: 0.5,
                    params: {
                      s0_threshold: 0.55,
                      s0_intensity: 0.25,
                      s1_threshold: 0,
                      s1_knee: 0,
                      s1_strength: 0.45,
                      s1_levels: 4,
                    },
                  },
            );
            await item.field.bindInput('image', { kind: 'image', source: images.screenshot });
            await item.field.bindInput('mask', glowMask);
            item.canvas.style.mixBlendMode = 'screen';
            measured.push(item.field);
          };
          const addMap = async (left, top, width = 560, height = 350) => {
            const item = await mount(
              definitions['pointer-map'],
              left,
              top,
              width,
              height,
              images.console,
              { params: { center: [0.55, 0.5] } },
            );
            measured.push(item.field);
          };
          const addLens = async (left, top, width = 560, height = 350, mixed = false) => {
            // The map and displace are held prerequisites in the standalone composite measurement.
            // The mixed page uses the same two-stage lens chain as the product demo.
            const map = await mount(definitions['pointer-map'], left, top, width, height, null, {
              present: false,
              params: { center: [0.55, 0.5] },
            });
            if (mixed) {
              const lens = await mount(
                defineEffect({
                  ...chain(definitions.displace, definitions['masked-composite']),
                  fieldInputSampling: 'base',
                  imageFallback: true,
                  fallback: 'transparent',
                }),
                left,
                top,
                width,
                height,
                images.console,
                {
                  params: {
                    s0_mode: 'glass',
                    s0_encoding: 'normal',
                    s0_amount: 0.012,
                    s0_glass: 0.5,
                    s1_blend: 1,
                  },
                },
              );
              await lens.field.bindInput('image', { kind: 'image', source: images.console });
              await lens.field.bindInput('original', { kind: 'image', source: images.console });
              await lens.field.bindInput('map', map.field);
              await lens.field.bindInput('mask', lensMask);
              measured.push(map.field, lens.field);
              return;
            }
            const displacement = await mount(
              defineEffect({ ...definitions.displace, fieldInputSampling: 'base' }),
              left,
              top,
              width,
              height,
              null,
              {
                present: false,
                params: { mode: 'glass', encoding: 'normal', amount: 0.012, glass: 0.5 },
              },
            );
            await displacement.field.bindInput('image', { kind: 'image', source: images.console });
            await displacement.field.bindInput('map', map.field);
            const composite = await mount(
              defineEffect({ ...definitions['masked-composite'], fieldInputSampling: 'base' }),
              left,
              top,
              width,
              height,
              images.console,
            );
            await composite.field.bindInput('image', { kind: 'image', source: images.console });
            await composite.field.bindInput('filtered', displacement.field);
            await composite.field.bindInput('mask', lensMask);
            measured.push(composite.field);
          };
          const addVideo = async (left, top, width = 560, height = 315) => {
            const video = document.createElement('video');
            video.src = '/media/products/hero-720p.mp4';
            video.preload = 'auto';
            video.muted = true;
            video.loop = true;
            video.playsInline = true;
            video.className = 'original';
            await new Promise((resolve, reject) => {
              video.addEventListener('loadeddata', resolve, { once: true });
              video.addEventListener('error', () => reject(new Error('720p video decode failed')), {
                once: true,
              });
              video.load();
            });
            video.pause();
            if (video.duration > 0.5)
              await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Video seek timed out')), 5000);
                video.addEventListener(
                  'seeked',
                  () => {
                    clearTimeout(timeout);
                    resolve();
                  },
                  { once: true },
                );
                video.currentTime = 0.5;
              });
            if (video.videoWidth !== 1280 || video.videoHeight !== 720 || video.readyState < 2)
              throw new Error('Expected a decoded native 1280×720 video');
            const item = await mount(heroVideoGrade, left, top, width, height, null, {
              preset: 'warm',
            });
            item.host.append(video);
            media.push(video);
            await item.field.bindInput('image', { kind: 'video', source: video });
            await video.play();
            measured.push(item.field);
          };
          try {
            if (scenario === 'mixed-page') {
              await addDepth('console', 24, 24, 440, 293);
              await addDepth('modules', 488, 24, 440, 293);
              await addSheen(24, 24, 440, 293);
              await addGlow(24, 360, 440, 275);
              await addLens(488, 360, 440, 275, true);
              await addVideo(952, 24, 440, 248);
            } else if (scenario === 'depth-parallax') await addDepth('console', 24, 24);
            else if (scenario === 'product-sheen') await addSheen(24, 24);
            else if (scenario === 'bright-pass') await addGlow(24, 24, 560, 350, true);
            else if (scenario === 'screenshot-glow') await addGlow(24, 24);
            else if (scenario === 'pointer-map') await addMap(24, 24);
            else if (scenario === 'masked-composite') await addLens(24, 24);
            else if (scenario === 'hero-video-grade') await addVideo(24, 24);
            for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
            for (const field of fields) {
              field.beforeFrame();
              field.surface.resize();
              field.render();
              field.dirty = false;
            }
            session.submit();
            await session.device.queue.onSubmittedWorkDone();
            await profiler.settle();
            profiler.clear();
            const startErrors = session.errors.length,
              samples = [],
              passSamples = {};
            let sampleVideoStart = [];
            for (let i = 0; i < 110; i++) {
              await new Promise(requestAnimationFrame);
              if (i === 30)
                sampleVideoStart = media.map((video) => ({
                  currentTime: video.currentTime,
                  totalVideoFrames: video.getVideoPlaybackQuality?.().totalVideoFrames ?? null,
                  droppedVideoFrames: video.getVideoPlaybackQuality?.().droppedVideoFrames ?? null,
                }));
              profiles.length = 0;
              labels.length = 0;
              const start = performance.now();
              for (const field of measured) {
                field.frame.time = i / 60;
                field.frame.index = i;
                field.frame.delta = 1 / 60;
                field.frame.pointer = [
                  0.5 + Math.sin(i * 0.07) * 0.18,
                  0.5 + Math.cos(i * 0.07) * 0.18,
                ];
                if (field.effect.id === 'pointer-map')
                  field.store.set('center', field.frame.pointer);
                if (field.effect.id === 'product-sheen')
                  field.store.set('progress', 0.3 + 0.4 * ((i % 60) / 60));
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
              if (i >= 30) {
                const profile = profiles.at(-1);
                if (profile?.truncated) throw new Error('Truncated GPU profile');
                samples.push({
                  cpuMs: encoded - start,
                  cpuSubmitMs: submitted - start,
                  completionMs: completion,
                  gpuMs: profile?.totalMs ?? null,
                  inputPassCount: labels.filter(
                    (name) => name.startsWith('hgpu-input-') || name.startsWith('mip-'),
                  ).length,
                });
                for (const [label, pass] of Object.entries(profile?.passes ?? {}))
                  (passSamples[label] ??= []).push(pass.ms);
              }
            }
            const bounds = fields.map((field) => {
              const box = field.canvas.getBoundingClientRect();
              return {
                id: field.effect.id,
                measured: measured.includes(field),
                cssBounds: { left: box.left, top: box.top, width: box.width, height: box.height },
                aboveFold:
                  box.left >= 0 &&
                  box.top >= 0 &&
                  box.right <= innerWidth &&
                  box.bottom <= innerHeight,
                target: field.surface.size,
                scale: field.surface.resolutionScale,
                present: Boolean(field.surface.context),
                memory: field.memory(),
                mediaPath: field.inputMediaPath,
              };
            });
            if (bounds.some((field) => !field.aboveFold))
              throw new Error('Product benchmark field outside viewport');
            return {
              id: scenario,
              run,
              browser: engine,
              ua: navigator.userAgent,
              adapter: session.capabilities.adapter,
              timestampQuery: session.capabilities.features.includes('timestamp-query'),
              dpr: devicePixelRatio,
              fields: bounds,
              assets: Object.fromEntries(
                Object.entries(images).map(([name, image]) => [
                  name,
                  { url: image.src, width: image.naturalWidth, height: image.naturalHeight },
                ]),
              ),
              videos: media.map((video, index) => ({
                url: video.src,
                width: video.videoWidth,
                height: video.videoHeight,
                sampleStart: sampleVideoStart[index],
                sampleEnd: {
                  currentTime: video.currentTime,
                  totalVideoFrames: video.getVideoPlaybackQuality?.().totalVideoFrames ?? null,
                  droppedVideoFrames: video.getVideoPlaybackQuality?.().droppedVideoFrames ?? null,
                },
                readyState: video.readyState,
                paused: video.paused,
              })),
              boundary:
                scenario === 'masked-composite'
                  ? 'Composite only; map and displaced source are pre-rendered and held.'
                  : scenario === 'mixed-page'
                    ? 'All seven fields render in dependency order; two depth images, overlapping sheen, half-scale glow, pointer-map and two-stage masked lens, graded live native video.'
                    : 'Forced active-frame cost; ordinary settled gates are bypassed.',
              videoBoundary: media.length
                ? 'Muted native 720p loop plays during warmup and samples; currentTime, decoded/dropped frame counters and input-media path are recorded. Initial loading/seek is excluded; decoded frames arrive at media cadence while grain and grade use explicit effect time. Completed work includes GPU media normalization, not independent decoder wall time.'
                : 'No video input.',
              warmup: 30,
              sampleCount: samples.length,
              videoRefresh: {
                inputFrames: samples.filter((sample) => sample.inputPassCount > 0).length,
                valid:
                  !media.length ||
                  samples.filter((sample) => sample.inputPassCount > 0).length >= 10,
                criterion:
                  'Live media captures require normalization during at least ten of eighty sampled frames; currentTime alone does not prove fresh pixels.',
              },
              cpuMs: summarize(samples.map((s) => s.cpuMs)),
              cpuSubmitMs: summarize(samples.map((s) => s.cpuSubmitMs)),
              completionMs: summarize(samples.map((s) => s.completionMs)),
              gpuMs: samples.some((s) => s.gpuMs !== null)
                ? summarize(samples.map((s) => s.gpuMs).filter((s) => s !== null))
                : null,
              passes: Object.fromEntries(
                Object.entries(passSamples).map(([name, values]) => [name, summarize(values)]),
              ),
              samples,
              errors: session.errors.slice(startErrors),
            };
          } finally {
            remove();
            profiler.timestampWrites = timestampWrites;
            profiler.enabled = false;
            for (const item of attachments.reverse()) item.destroy();
            for (const video of media) {
              video.pause();
              video.removeAttribute('src');
              video.load();
            }
            for (const host of hosts) host.remove();
            session.scheduler.setHidden(false);
            release();
          }
        },
        { root, scenario, engine, run },
      );
      results.push(result);
      console.log(
        JSON.stringify({
          id: scenario,
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
  `docs/benchmarks/v2-products-${engine}${requested ? '-followup' : ''}.json`,
  JSON.stringify(
    {
      date: new Date().toISOString(),
      platform: platform(),
      release: release(),
      arch: arch(),
      method:
        'DPR1 real DOM attachments and authored assets; fixed singles 560px wide, compact 440px mixed above fold at 1440×1000; 30 warmup +80 completed samples; one submission/frame; CPU encode and submit, completed wall latency and GPU pass timestamps are separate; native 720p video plays during samples with media timing/frame counters and input path recorded, initial loading/seek excluded.',
      results,
      errors,
      warnings,
    },
    null,
    2,
  ) + '\n',
);
if (errors.length || results.some((row) => row.errors.length)) process.exitCode = 1;
