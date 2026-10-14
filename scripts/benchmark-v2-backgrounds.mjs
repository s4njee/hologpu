import { chromium, webkit } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { platform, arch, release } from 'node:os';
import { fileURLToPath } from 'node:url';

const name = process.argv[2] ?? 'chrome';
const runs = Number(process.env.HOLOGPU_BENCHMARK_RUNS ?? 1);
const phase = process.env.HOLOGPU_BENCHMARK_PHASE ?? 'all';
if (!['all', 'half-scale'].includes(phase) || (phase === 'half-scale' && name !== 'chrome'))
  throw new Error('HOLOGPU_BENCHMARK_PHASE=all|half-scale (half-scale is Chrome only)');
if (
  !['chrome', 'webkit'].includes(name) ||
  process.argv.length > 3 ||
  !Number.isInteger(runs) ||
  runs < 1 ||
  runs > 3
) {
  throw new Error(
    'Usage: node scripts/benchmark-v2-backgrounds.mjs chrome|webkit (HOLOGPU_BENCHMARK_RUNS=1…3)',
  );
}
const base = process.env.HOLOGPU_URL ?? 'http://127.0.0.1:5175';
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const ids = [
  'aurora-veil',
  'grain-overlay',
  'dot-matrix-field',
  'topographic-lines',
  'grid-horizon',
  'light-sweep',
];
const batchLayout = [
  { id: 'aurora-veil', left: 0, top: 0, width: 1440, height: 500, scale: 0.25 },
  { id: 'grain-overlay', left: 0, top: 0, width: 1440, height: 500, scale: 1 },
  { id: 'dot-matrix-field', left: 20, top: 500, width: 400, height: 180, scale: 1 },
  { id: 'topographic-lines', left: 520, top: 500, width: 400, height: 180, scale: 1 },
  { id: 'grid-horizon', left: 0, top: 680, width: 1440, height: 220, scale: 1 },
  {
    id: 'light-sweep',
    left: 1000,
    top: 500,
    width: 400,
    height: 180,
    scale: 1,
    params: { progress: 0.5 },
  },
];
const browser = await (name === 'webkit' ? webkit : chromium).launch({
  ...(name === 'chrome' ? { channel: 'chrome' } : {}),
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
const pageErrors = [],
  pageWarnings = [],
  results = [];
let previousCapture = null;
if (phase === 'half-scale') {
  previousCapture = JSON.parse(
    await readFile(`docs/benchmarks/v2-backgrounds-${name}.json`, 'utf8'),
  );
  results.push(...previousCapture.results);
}
page.on('pageerror', (error) => {
  // Retain the browser's deferred resize notification; measured bounds/sizes are checked.
  if (error.message === 'ResizeObserver loop completed with undelivered notifications.')
    pageWarnings.push(error.message);
  else pageErrors.push(error.message);
});
await page.emulateMedia({ reducedMotion: 'no-preference' });
await page.route('**/__v2_background_benchmark.html', (route) =>
  route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html><head><title>Launch background benchmark</title><style>html,body{margin:0;width:1440px;height:900px;overflow:hidden;background:#11121b;color:#eee;font:16px system-ui}h1,p{position:relative;z-index:2;margin:24px;max-width:700px}section{position:absolute;box-sizing:border-box;overflow:hidden}</style></head><body></body></html>',
  }),
);
let failure = null;
try {
  await page.goto(`${base}/__v2_background_benchmark.html`);
  const primaryScenarios = [
    ...ids.map((id) => ({
      id,
      stress: !['aurora-veil', 'grain-overlay'].includes(id),
      layout: [{ id, left: 0, top: 0, width: 1440, height: 900 }],
    })),
    ...batchLayout
      .filter((item) => !['aurora-veil', 'grain-overlay'].includes(item.id))
      .map((item) => ({
        id: `${item.id}-element`,
        stress: false,
        layout: [{ ...item, left: 0, top: 0 }],
      })),
    { id: 'six-above-fold-fields', layout: batchLayout },
  ];
  const diagnosticScenarios =
    name === 'chrome'
      ? ['grain-overlay', 'dot-matrix-field', 'grid-horizon'].map((id) => ({
          id: `${id}-half-scale`,
          stress: false,
          diagnostic: true,
          layout: [{ id, left: 0, top: 0, width: 1440, height: 900, scale: 0.5 }],
        }))
      : [];
  for (const scenario of phase === 'half-scale'
    ? diagnosticScenarios
    : [...primaryScenarios, ...diagnosticScenarios]) {
    for (let run = 1; run <= (scenario.diagnostic ? 1 : runs); run++) {
      const row = await page.evaluate(
        async ({ root, scenario, browserName }) => {
          const { attach } = await import(`/@fs${root}/packages/dom/src/index.ts`);
          const { summarize } = await import(`/@fs${root}/packages/core/src/measure.ts`);
          const definitions = await Promise.all(
            scenario.layout.map(
              async (item) =>
                (await import(`/@fs${root}/packages/effects/src/${item.id}/index.ts`)).default,
            ),
          );
          const attachments = [],
            fields = [],
            hosts = [];
          let session,
            removeProfile = () => {};
          const bounds = () =>
            hosts.map((host) => {
              const r = host.getBoundingClientRect();
              return {
                left: r.left,
                top: r.top,
                width: r.width,
                height: r.height,
                completelyVisible:
                  r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
              };
            });
          try {
            for (let index = 0; index < scenario.layout.length; index++) {
              const item = scenario.layout[index],
                effect = definitions[index];
              const host = document.createElement('section');
              host.style.cssText = `left:${item.left}px;top:${item.top}px;width:${item.width}px;height:${item.height}px`;
              host.innerHTML = `<h1>${effect.title}</h1><p>Product launch copy remains readable in the light DOM.</p>`;
              document.body.append(host);
              hosts.push(host);
              const attachment = await attach(host, effect, {
                playing: false,
                adaptiveQuality: false,
                reducedMotion: false,
                dprCap: 1,
                resolutionScale: item.scale ?? effect.defaultResolutionScale ?? 1,
                seed: 7,
                params: item.params ?? {},
                layer: ['grain-overlay', 'light-sweep'].includes(effect.id) ? 'front' : 'behind',
              });
              attachments.push(attachment);
              const field = attachment.field;
              if (!field || field.state !== 'ready')
                throw new Error(
                  `WebGPU attachment unavailable: ${effect.id} (${attachment.state})`,
                );
              session ??= field.session;
              if (field.session !== session)
                throw new Error('Fields do not share a device session');
              session.scheduler.setHidden(true);
              field.visible = true;
              field.pause();
              await field.whenInputsReady();
              field.surface.resize();
              fields.push(field);
            }
            if (bounds().some((rect) => !rect.completelyVisible))
              throw new Error('A field is outside the viewport');
            await session.device.queue.onSubmittedWorkDone();
            const profiler = session.profiler;
            await profiler.settle();
            profiler.enabled = true;
            profiler.clear();
            const profiles = [];
            removeProfile = profiler.onFrame((frame) => profiles.push(frame));
            const samples = [];
            let previous;
            for (let index = 0; index < 150; index++) {
              const raf = await new Promise(requestAnimationFrame);
              const profileCount = profiles.length;
              const start = performance.now();
              for (const field of fields) {
                field.frame.time = index / 60;
                field.frame.index = index;
                field.frame.delta = 1 / 60;
                field.frame.seed = 7;
                field.beforeFrame();
                field.render();
                field.dirty = false;
              }
              const encodeEnd = performance.now();
              session.submit();
              const submitEnd = performance.now();
              await session.device.queue.onSubmittedWorkDone();
              const completion = performance.now() - start;
              // Settle timestamp mapping outside the CPU/completion region and before reuse.
              await profiler.settle();
              const profile = profiles.length === profileCount + 1 ? profiles[profileCount] : null;
              if (profiles.length > profileCount + 1)
                throw new Error('Unexpected extra profiler submissions');
              if (index >= 30)
                samples.push({
                  index,
                  cpuEncodeMs: encodeEnd - start,
                  cpuEncodeSubmitMs: submitEnd - start,
                  completionMs: completion,
                  rafIntervalMs: raf - previous,
                  gpuMs: profile?.totalMs ?? null,
                  passes: profile?.passes ?? null,
                  truncated: profile?.truncated ?? false,
                });
              previous = raf;
            }
            const gpuValues = samples.flatMap((sample) =>
              sample.gpuMs === null ? [] : [sample.gpuMs],
            );
            const gpuMs = gpuValues.length ? summarize(gpuValues) : null;
            const effectGpuValues = samples.flatMap((sample) =>
              sample.passes
                ? [
                    Object.entries(sample.passes).reduce(
                      (sum, [label, entry]) => sum + (label === 'hgpu-resolve' ? 0 : entry.ms),
                      0,
                    ),
                  ]
                : [],
            );
            const resolveGpuValues = samples.flatMap((sample) =>
              sample.passes ? [sample.passes['hgpu-resolve']?.ms ?? 0] : [],
            );
            const passes = {};
            for (const sample of samples)
              for (const [label, entry] of Object.entries(sample.passes ?? {})) {
                const values = (passes[label] ??= []);
                values.push(entry.ms);
              }
            const completionMs = summarize(samples.map((sample) => sample.completionMs));
            const perFieldGpuBudgetMs =
              browserName === 'webkit'
                ? 1.5
                : ({
                    'aurora-veil': 0.3,
                    'grain-overlay': 0.2,
                    'dot-matrix-field': 0.3,
                    'grid-horizon': 0.2,
                  }[fields[0].effect.id] ?? 0.5);
            const timestampComplete =
              gpuValues.length === 120 && !samples.some((sample) => sample.truncated);
            const metadata = fields.map((field, i) => ({
              id: field.effect.id,
              requested: scenario.layout[i],
              renderSize: [...field.surface.size],
              effectiveDpr: field.surface.dpr,
              resolutionScale: field.surface.resolutionScale,
              params: field.store.snapshot(),
              state: field.state,
              visible: field.visible,
              adaptiveQuality: field.adaptiveQuality,
              reducedMotion: field.reducedMotion,
              context: Boolean(field.surface.context),
              memory: field.memory(),
              renders: 150,
            }));
            return {
              id: scenario.id,
              diagnostic: Boolean(scenario.diagnostic),
              warmup: 30,
              samples: 120,
              submissions: 150,
              fields: metadata,
              bounds: bounds(),
              capabilities: session.capabilities,
              cpuEncodeMs: summarize(samples.map((sample) => sample.cpuEncodeMs)),
              cpuEncodeSubmitMs: summarize(samples.map((sample) => sample.cpuEncodeSubmitMs)),
              completionMs,
              rafIntervalMs: summarize(samples.map((sample) => sample.rafIntervalMs)),
              gpuMs,
              effectGpuMs: effectGpuValues.length ? summarize(effectGpuValues) : null,
              resolveGpuMs: resolveGpuValues.length ? summarize(resolveGpuValues) : null,
              passes: Object.fromEntries(
                Object.entries(passes).map(([label, values]) => [label, summarize(values)]),
              ),
              timestamps: {
                supported: profiler.supported,
                complete: timestampComplete,
                captured: gpuValues.length,
                droppedFrames: profiler.droppedFrames,
              },
              gate:
                scenario.id === 'six-above-fold-fields'
                  ? {
                      metric: 'CPU start to submitted-work-done callback p95',
                      budgetMs: 4,
                      appliesToBacklog: true,
                      passed: completionMs.p95 <= 4,
                    }
                  : {
                      metric: 'Summed effect and canvas resolve GPU timestamps p95',
                      budgetMs: perFieldGpuBudgetMs,
                      appliesToBacklog: !scenario.stress && !scenario.diagnostic,
                      passed: timestampComplete ? gpuMs.p95 <= perFieldGpuBudgetMs : null,
                    },
              errors: [...session.errors],
              rawSamples: samples,
            };
          } finally {
            removeProfile();
            for (const attachment of attachments) attachment.destroy();
            for (const host of hosts) host.remove();
          }
        },
        { root, scenario, browserName: name },
      );
      results.push({ ...row, run });
      console.log(
        `${name} ${scenario.id} run${run}: CPU ${row.cpuEncodeSubmitMs.p95.toFixed(3)}ms p95, GPU ${row.gpuMs?.p95.toFixed(3) ?? 'unavailable'}ms p95, completion ${row.completionMs.p95.toFixed(3)}ms p95; gate ${row.gate.passed}`,
      );
      if (
        row.errors.length ||
        row.samples !== 120 ||
        row.fields.some((field) => !field.visible || !field.context)
      )
        throw new Error(
          `Incomplete or erroneous scenario ${scenario.id}: ${JSON.stringify(row.errors)}`,
        );
    }
  }
} catch (error) {
  failure = String(error);
} finally {
  const output = `docs/benchmarks/v2-backgrounds-${name}.json`;
  await mkdir('docs/benchmarks', { recursive: true });
  await writeFile(
    output,
    JSON.stringify(
      {
        recordedOn: '2026-10-07',
        recordedAt: new Date().toISOString(),
        captureHistory: [
          ...(previousCapture?.captureHistory ??
            (previousCapture
              ? [
                  {
                    recordedAt: previousCapture.recordedAt,
                    phase: 'all',
                    runs: previousCapture.scenario.runs,
                  },
                ]
              : [])),
          { recordedAt: new Date().toISOString(), phase, runs },
        ],
        environment: {
          platform: platform(),
          arch: arch(),
          release: release(),
          browser: name,
          browserVersion: browser.version(),
          headless: true,
          softwareAdapter: false,
          viewport: { width: 1440, height: 900 },
          dpr: 1,
          baseURL: base,
          competingLoad:
            process.env.HOLOGPU_COMPETING_LOAD ??
            'Machine-wide GPU load is uncontrolled; no competing benchmark is started by this script.',
        },
        scenario: {
          ids,
          seed: 7,
          runs: previousCapture?.scenario.runs ?? runs,
          halfScaleDiagnostics:
            'Chrome only, one run each at 1440×900 CSSpx, resolutionScale0.5 for grain/dots/grid; recorded alongside original-scale results without changing effect defaults.',
          warmupFrames: 30,
          measuredFrames: 120,
          standaloneCssSize: [1440, 900],
          batchLayout,
          params:
            'Effect defaults; element-local and mixed-page light-sweep progress explicitly 0.5. Aurora defaultResolutionScale 0.25; all other standalone scales 1. Four additional element-local cases use the mixed-page dimensions.',
          rendering:
            'Real DOM attachments with distinct actual canvas contexts and one shared device. Scheduler paused during capture; public beforeFrame/render calls encode all fields into one shared encoder, submitted once per rAF at fixed index/60s. Every field draws every sample, including grain (normal scheduled rate is 18Hz); this is a conservative all-live upper bound rather than automatic scheduler cadence.',
          cpuEncode:
            'First field beforeFrame through final field render; includes CSS polling, frame/parameter buffer writes, input preparation, effect passes and canvas resolves.',
          cpuEncodeSubmit: 'CPU encode plus shared timestamp query resolve and queue submission.',
          completion:
            'First field beforeFrame to onSubmittedWorkDone callback after the shared submit; includes CPU encode and callback latency, not pure GPU execution. Queue completion awaited each frame; at most one frame workload is in flight.',
          gpu: 'Optional timestamp-query, automatically requested if available by the existing device session; sum of driver-reported effect and actual canvas resolve pass intervals, not elapsed command-buffer wall time. Backend pass interval sums can exceed queue-completion wall duration; raw pass intervals and completion values are retained separately. Asynchronous query-map settlement occurs outside CPU/completion timings. Unavailable/incomplete timestamps leave GPU gate null.',
          memory:
            'Logical target/buffer byte counts, not VRAM. Compilation, first-frame startup and readback excluded from measured frame timings.',
          gates:
            'Timestamp p95: Chrome aurora0.3ms, grain0.2ms, dots0.3ms, grid0.2ms, other T1 effects0.5ms; WebKit1.5ms. Mixed page completed-work p95<=4ms. Aurora/grain full viewport and four element-local cases are backlog gates. Other full-viewport cases are informational stress tests with appliesToBacklog=false. Total/effect-only/resolve values are all retained; browsers may quantize timestamps, so small timing differences can be below their timestamp precision.',
        },
        results,
        pageErrors,
        pageWarnings,
        failure,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Saved ${output}`);
  await browser.close();
}
if (failure || pageErrors.length) throw new Error(failure ?? pageErrors.join('\n'));
