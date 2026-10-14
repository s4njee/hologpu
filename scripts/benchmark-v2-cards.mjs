import { chromium, webkit } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { platform, release, arch } from 'node:os';
const engine = process.argv[2] ?? 'chrome';
if (!['chrome', 'webkit'].includes(engine))
  throw new Error('Usage: node scripts/benchmark-v2-cards.mjs chrome|webkit');
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const browser = await (engine === 'chrome' ? chromium : webkit).launch({
  ...(engine === 'chrome' ? { channel: 'chrome' } : {}),
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
const errors = [],
  warnings = [];
page.on('pageerror', (e) =>
  (e.message.includes('ResizeObserver loop') ? warnings : errors).push(e.message),
);
await page.route('**/__cards_bench', (route) =>
  route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><title>Card page benchmark</title><style>body{margin:0;background:#11121b;font:16px Arial}article,section,div.host{position:absolute;box-sizing:border-box;border-radius:20px}button{width:100%;height:100%}</style>',
  }),
);
const results = [];
try {
  await page.goto(`${process.env.HOLOGPU_URL ?? 'http://127.0.0.1:5175'}/__cards_bench`);
  for (const scenario of [
    'spotlight',
    'border-energy',
    'panel-refraction',
    'press-ripple',
    'hover-lift-shadow',
    'mixed-page',
  ]) {
    const result = await page.evaluate(
      async ({ root, scenario, engine }) => {
        const { attach } = await import(`/@fs${root}/packages/dom/src/index.ts`);
        const { acquireDevice } = await import(`/@fs${root}/packages/core/src/index.ts`);
        const { summarize } = await import(`/@fs${root}/packages/core/src/measure.ts`);
        const { session, release } = await acquireDevice();
        session.scheduler.setHidden(true);
        const profiler = session.profiler,
          rows = [],
          hosts = [],
          fields = [],
          profiles = [],
          labels = [];
        profiler.enabled = true;
        const remove = profiler.onFrame((p) => profiles.push(p));
        const original = profiler.timestampWrites;
        profiler.timestampWrites = function (encoder, label) {
          labels.push(label);
          return original.call(this, encoder, label);
        };
        async function mount(id, left, top, width, height, extra = {}) {
          const host = document.createElement('div');
          host.className = 'host';
          host.style.cssText = `left:${left}px;top:${top}px;width:${width}px;height:${height}px;border-radius:20px`;
          if (id === 'press-ripple') host.innerHTML = '<button>Begin</button>';
          else host.innerHTML = '<p>Native card content</p>';
          document.body.append(host);
          hosts.push(host);
          const effect = (await import(`/@fs${root}/packages/effects/src/${id}/index.ts`)).default;
          const item = await attach(host, effect, {
            playing: false,
            reducedMotion: false,
            adaptiveQuality: false,
            dprCap: 1,
            resolutionScale: 1,
            seed: 7,
            ...extra,
          });
          if (!item.field || item.state !== 'ready') throw new Error('Unready ' + id);
          item.field.visible = true;
          rows.push(item);
          fields.push(item.field);
          return item;
        }
        let hero;
        if (scenario === 'panel-refraction' || scenario === 'mixed-page') {
          hero = await mount('aurora-veil', 32, 24, 960, 460, {
            preset: 'dusk',
            resolutionScale: 0.5,
          });
          const cards = scenario === 'mixed-page' ? 3 : 1;
          for (let n = 0; n < cards; n++) {
            const panel = await mount('panel-refraction', 64 + n * 302, 150, 280, 220, {
              preset: 'frost',
            });
            await panel.bindBackdrop(hero);
            if (panel.field.inputTexture('image').texture !== hero.field.output.texture)
              throw new Error('Hero copied');
          }
        }
        if (scenario === 'spotlight' || scenario === 'mixed-page')
          await mount('spotlight', 32, scenario === 'mixed-page' ? 510 : 24, 960, 180, {
            preset: 'card-spotlight',
          });
        if (scenario === 'border-energy' || scenario === 'mixed-page')
          await mount('border-energy', 64, scenario === 'mixed-page' ? 530 : 48, 280, 140, {
            preset: 'border-trace',
            padding: 16,
            params: { intensity: 1 },
          });
        if (scenario === 'hover-lift-shadow' || scenario === 'mixed-page')
          await mount('hover-lift-shadow', 382, scenario === 'mixed-page' ? 530 : 48, 280, 140, {
            padding: 40,
            params: { elevation: 0.65 },
          });
        if (scenario === 'press-ripple' || scenario === 'mixed-page')
          await mount('press-ripple', 708, scenario === 'mixed-page' ? 590 : 48, 240, 48, {
            layer: 'front',
          });
        for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
        for (const f of fields) {
          f.beforeFrame();
          f.surface.resize();
        }
        if (hero) {
          hero.field.frame.time = 0.5;
          hero.field.render();
        }
        session.submit();
        await session.device.queue.onSubmittedWorkDone();
        await profiler.settle();
        profiler.clear();
        const measured = scenario === 'panel-refraction' ? fields.slice(1) : fields;
        const samples = [],
          passSamples = {},
          startErrors = session.errors.length;
        for (let i = 0; i < 110; i++) {
          await new Promise(requestAnimationFrame);
          profiles.length = 0;
          labels.length = 0;
          const start = performance.now();
          for (const f of measured) {
            f.frame.time = i / 60;
            f.frame.index = i;
            f.frame.delta = 1 / 60;
            f.beforeFrame();
            if (f.effect.id === 'press-ripple') {
              f.reset();
              f.frame.interactionTime = 0;
              f.press([0.5, 0.5]);
              f.frame.interactionTime = 0.15;
            }
            if (f.effect.id === 'spotlight') f.store.patch({ pagePointer: [100 + i * 4, 580] });
            f.render();
            f.dirty = false;
          }
          const encoded = performance.now();
          session.submit();
          const submitted = performance.now();
          await session.device.queue.onSubmittedWorkDone();
          const completion = performance.now() - start;
          await profiler.settle();
          if (i >= 30) {
            const profile = profiles.at(-1);
            samples.push({
              cpuMs: encoded - start,
              cpuSubmitMs: submitted - start,
              completionMs: completion,
              gpuMs: profile?.totalMs ?? null,
            });
            for (const [name, pass] of Object.entries(profile?.passes ?? {}))
              (passSamples[name] ??= []).push(pass.ms);
            if (labels.some((label) => label.startsWith('hgpu-input-') || label.startsWith('mip-')))
              throw new Error('Unexpected source conversion during card frame');
          }
        }
        const data = {
          id: scenario,
          browser: engine,
          ua: navigator.userAgent,
          adapter: session.capabilities.adapter,
          timestampQuery: session.capabilities.features.includes('timestamp-query'),
          dpr: devicePixelRatio,
          fields: measured.map((f) => ({
            id: f.effect.id,
            cssBounds: (() => {
              const r = f.canvas.getBoundingClientRect();
              return {
                left: r.left,
                top: r.top,
                width: r.width,
                height: r.height,
                visible:
                  r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
              };
            })(),
            target: f.surface.size,
            scale: f.surface.resolutionScale,
            memory: f.memory(),
          })),
          warmup: 30,
          sampleCount: samples.length,
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
        remove();
        profiler.timestampWrites = original;
        profiler.enabled = false;
        for (const item of rows.reverse()) item.destroy();
        for (const host of hosts) host.remove();
        session.scheduler.setHidden(false);
        release();
        return data;
      },
      { root, scenario, engine },
    );
    results.push(result);
    console.log(
      JSON.stringify({
        id: scenario,
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
  `docs/benchmarks/v2-cards-${engine}.json`,
  JSON.stringify(
    {
      date: new Date().toISOString(),
      platform: platform(),
      release: release(),
      arch: arch(),
      method:
        'DPR1 real DOM attachments; fixed own size; one queue submission per frame;30warmup+80completed samples; panel single holds hero; mixed renders hero .5 and3cards; CSS/geometry polling included; source borrowed without conversion/mips; completed wall latency separate from GPU pass timestamps',
      results,
      errors,
      warnings,
    },
    null,
    2,
  ) + '\n',
);
if (errors.length || results.some((r) => r.errors.length)) process.exitCode = 1;
