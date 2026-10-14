import { chromium, webkit } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { arch, platform, release } from 'node:os';
import { fileURLToPath } from 'node:url';

const browserName = process.argv[2] ?? 'chrome';
const runs = Number(process.env.HOLOGPU_BENCHMARK_RUNS ?? 1);
const append = process.env.HOLOGPU_BENCHMARK_APPEND === '1';
if (
  !['chrome', 'webkit'].includes(browserName) ||
  process.argv.length > 3 ||
  !Number.isInteger(runs) ||
  runs < 1 ||
  runs > 3
)
  throw new Error(
    'Usage: node scripts/benchmark-v2-typography.mjs chrome|webkit (HOLOGPU_BENCHMARK_RUNS=1…3, optional HOLOGPU_BENCHMARK_SCENARIOS=comma-separated IDs and HOLOGPU_BENCHMARK_APPEND=1)',
  );
const baseURL = process.env.HOLOGPU_URL ?? 'http://127.0.0.1:5175';
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const output = `docs/benchmarks/v2-typography-${browserName}.json`;
const previous = append ? JSON.parse(await readFile(output, 'utf8')) : null;
const layout = [
  {
    id: 'text-shimmer',
    left: 32,
    top: 24,
    width: 640,
    height: 160,
    text: 'Build what comes next.',
    params: { progress: 0.5 },
  },
  {
    id: 'heading-reveal',
    left: 32,
    top: 204,
    width: 640,
    height: 160,
    text: 'Build what comes next.',
    params: { progress: 0.5 },
  },
  {
    id: 'text-outline-glow',
    left: 32,
    top: 384,
    width: 480,
    height: 120,
    text: 'Hello, tomorrow.',
  },
  {
    id: 'morph-particles',
    left: 32,
    top: 524,
    width: 320,
    height: 128,
    text: 'Launch',
    preset: 'assemble-and-hold',
    params: { progress: 0.5 },
  },
];
const singles = [
  ...layout.slice(0, 3),
  {
    id: 'text-dissolve',
    width: 320,
    height: 128,
    text: 'Launch',
    preset: 'assemble-and-hold',
    params: { progress: 0.5 },
  },
  layout[3],
].map((item) => ({ id: item.id, layout: [{ ...item, left: 32, top: 24 }] }));
const allScenarios = [...singles, { id: 'four-above-fold-fields', layout }];
const selection = process.env.HOLOGPU_BENCHMARK_SCENARIOS?.split(',').filter(Boolean);
if (selection?.some((id) => !allScenarios.some((scenario) => scenario.id === id)))
  throw new Error('Unknown scenario in HOLOGPU_BENCHMARK_SCENARIOS');
const scenarios = selection
  ? allScenarios.filter((scenario) => selection.includes(scenario.id))
  : allScenarios;
if (
  scenarios.some(
    (scenario) =>
      (previous?.results.filter((row) => row.id === scenario.id).length ?? 0) + runs > 3,
  )
)
  throw new Error('At most three recorded runs per scenario are supported');
const browser = await (browserName === 'webkit' ? webkit : chromium).launch({
  ...(browserName === 'chrome' ? { channel: 'chrome' } : {}),
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
const results = [...(previous?.results ?? [])],
  pageErrors = [],
  pageWarnings = [];
page.on('pageerror', (error) => {
  if (error.message === 'ResizeObserver loop completed with undelivered notifications.')
    pageWarnings.push({ category: 'deferred-resize-notification', message: error.message });
  else pageErrors.push(error.message);
});
await page.emulateMedia({ reducedMotion: 'no-preference' });
await page.route('**/__v2_typography_benchmark.html', (route) =>
  route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html><head><title>Typography page benchmark</title><style>html,body{margin:0;width:1440px;height:900px;overflow:hidden;background:#11121b;color:#eee}h1{position:absolute;margin:0;padding:0;border:0;box-sizing:border-box;overflow:hidden;font:700 48px/1.25 Arial,sans-serif}</style></head><body></body></html>',
  }),
);
let failure = null;
try {
  await page.goto(`${baseURL}/__v2_typography_benchmark.html`);
  for (const scenario of scenarios)
    for (let iteration = 1; iteration <= runs; iteration++) {
      const run =
        (previous?.results.filter((row) => row.id === scenario.id).length ?? 0) + iteration;
      const row = await page.evaluate(
        async ({ root, scenario, browserName }) => {
          const importStart = performance.now();
          const { attach } = await import(`/@fs${root}/packages/dom/src/index.ts`);
          const { acquireDevice } = await import(`/@fs${root}/packages/core/src/index.ts`);
          const { summarize } = await import(`/@fs${root}/packages/core/src/measure.ts`);
          const definitions = await Promise.all(
            scenario.layout.map(
              async (item) =>
                (await import(`/@fs${root}/packages/effects/src/${item.id}/index.ts`)).default,
            ),
          );
          const importMs = performance.now() - importStart;
          await document.fonts.ready;
          const acquireStart = performance.now();
          const { session, release } = await acquireDevice();
          const acquireDeviceMs = performance.now() - acquireStart;
          const profiler = session.profiler;
          session.scheduler.setHidden(true);
          await profiler.settle();
          profiler.clear();
          profiler.enabled = true;
          const profiles = [],
            encodedLabels = [];
          const removeProfile = profiler.onFrame((frame) => profiles.push(frame));
          const originalTimestampWrites = profiler.timestampWrites;
          profiler.timestampWrites = function (encoder, label) {
            encodedLabels.push(label);
            return originalTimestampWrites.call(this, encoder, label);
          };
          const attachments = [],
            hosts = [],
            fields = [],
            attachmentTimes = [];
          const bounds = () =>
            hosts.map((host) => {
              const r = host.getBoundingClientRect();
              return {
                left: r.left,
                top: r.top,
                width: r.width,
                height: r.height,
                visible:
                  r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
              };
            });
          const passCounts = (labels) =>
            Object.fromEntries(
              [...new Set(labels)].map((label) => [
                label,
                labels.filter((value) => value === label).length,
              ]),
            );
          const jfaCounts = (labels) =>
            passCounts(labels.filter((label) => label.startsWith('jfa-')));
          const errorCountBefore = session.errors.length;
          try {
            const mountStart = performance.now();
            for (let index = 0; index < scenario.layout.length; index++) {
              const item = scenario.layout[index],
                effect = definitions[index];
              const host = document.createElement('h1');
              host.textContent = item.text;
              host.style.cssText = `left:${item.left}px;top:${item.top}px;width:${item.width}px;height:${item.height}px;--hgpu-progress:0.5`;
              document.body.append(host);
              hosts.push(host);
              const start = performance.now();
              const attachment = await attach(host, effect, {
                playing: false,
                reducedMotion: false,
                adaptiveQuality: false,
                dprCap: 1,
                resolutionScale: 1,
                seed: 7,
                layer: 'front',
                preset: item.preset,
                params: item.params ?? {},
              });
              attachments.push(attachment);
              const field = attachment.field;
              if (!field || field.state !== 'ready' || field.session !== session)
                throw new Error(`Unready or unshared field ${item.id}`);
              field.visible = true;
              field.pause();
              await field.whenInputsReady();
              fields.push(field);
              attachmentTimes.push({ id: item.id, attachmentReadyMs: performance.now() - start });
            }
            for (let frame = 0; frame < 3; frame++) await new Promise(requestAnimationFrame);
            for (const field of fields) {
              await field.whenInputsReady();
              field.surface.resize();
            }
            session.submit();
            await session.device.queue.onSubmittedWorkDone();
            await profiler.settle();
            const attachmentInitializationMs = performance.now() - mountStart;
            if (bounds().some((bound) => !bound.visible))
              throw new Error('A field is outside the visible viewport');
            if (
              fields.some(
                (field, index) =>
                  field.surface.size[0] !== scenario.layout[index].width ||
                  field.surface.size[1] !== scenario.layout[index].height,
              )
            )
              throw new Error('Unexpected backing size after resize settlement');
            // Mask setup is complete before measuring the first explicit valid-mask render.
            const startupPassCounts = passCounts(encodedLabels);
            const startupJfa = jfaCounts(encodedLabels);
            if (Object.keys(startupJfa).length)
              throw new Error('JFA rendered before the explicit first-frame boundary');
            profiles.length = 0;
            encodedLabels.length = 0;
            profiler.clear();
            async function renderFrame(index) {
              const raf = await new Promise(requestAnimationFrame);
              const profileStart = profiles.length,
                labelStart = encodedLabels.length;
              const start = performance.now();
              for (const field of fields) {
                field.frame.time = index / 60;
                field.frame.index = index;
                field.frame.delta = 1 / 60;
                field.beforeFrame();
                field.render();
                field.dirty = false;
              }
              const encodeEnd = performance.now();
              session.submit();
              const submitEnd = performance.now();
              await session.device.queue.onSubmittedWorkDone();
              const completionMs = performance.now() - start;
              await profiler.settle();
              if (profiles.length > profileStart + 1)
                throw new Error('Unexpected extra profiler submission');
              const profile = profiles.length === profileStart + 1 ? profiles[profileStart] : null;
              const passes = profile?.passes ?? {};
              const resolveGpuMs = passes['hgpu-resolve']?.ms ?? null;
              const jfaGpuMs = profile
                ? Object.entries(passes)
                    .filter(([label]) => label.startsWith('jfa-'))
                    .reduce((sum, [, value]) => sum + value.ms, 0)
                : null;
              const effectGpuMs = profile
                ? Object.entries(passes)
                    .filter(([label]) => label !== 'hgpu-resolve')
                    .reduce((sum, [, value]) => sum + value.ms, 0)
                : null;
              return {
                raf,
                cpuEncodeMs: encodeEnd - start,
                cpuEncodeSubmitMs: submitEnd - start,
                completionMs,
                totalGpuMs: profile?.totalMs ?? null,
                effectGpuMs,
                resolveGpuMs,
                jfaGpuMs,
                passes,
                labels: encodedLabels.slice(labelStart),
                truncated: profile?.truncated ?? false,
              };
            }
            const first = await renderFrame(0);
            const firstJfa = jfaCounts(first.labels),
              glowCount = fields.filter((field) => field.effect.id === 'text-outline-glow').length;
            if (
              (firstJfa['jfa-seed'] ?? 0) !== glowCount ||
              (firstJfa['jfa-distance'] ?? 0) !== glowCount
            )
              throw new Error(
                `Expected exactly ${glowCount} initial JFA builds: ${JSON.stringify(firstJfa)}`,
              );
            const initialMaskVersions = fields.map(
              (field) => field.textureTaps.distance?.version ?? null,
            );
            const warmupCounts = {},
              samples = [],
              aggregatePassMs = {},
              aggregatePassCounts = {};
            let previousRaf = first.raf;
            for (let index = 1; index <= 150; index++) {
              const frame = await renderFrame(index);
              const counts = passCounts(frame.labels);
              if (Object.keys(jfaCounts(frame.labels)).length)
                throw new Error(`JFA rebuilt after first valid-mask render at sample ${index}`);
              if (index <= 30) {
                for (const [label, count] of Object.entries(counts))
                  warmupCounts[label] = (warmupCounts[label] ?? 0) + count;
              } else {
                samples.push({
                  index,
                  cpuEncodeMs: frame.cpuEncodeMs,
                  cpuEncodeSubmitMs: frame.cpuEncodeSubmitMs,
                  completionMs: frame.completionMs,
                  rafIntervalMs: frame.raf - previousRaf,
                  totalGpuMs: frame.totalGpuMs,
                  effectGpuMs: frame.effectGpuMs,
                  resolveGpuMs: frame.resolveGpuMs,
                  truncated: frame.truncated,
                });
                for (const [label, count] of Object.entries(counts))
                  aggregatePassCounts[label] = (aggregatePassCounts[label] ?? 0) + count;
                for (const [label, entry] of Object.entries(frame.passes))
                  (aggregatePassMs[label] ??= []).push(entry.ms);
              }
              previousRaf = frame.raf;
            }
            const summarizeMetric = (key) => {
              const values = samples.map((sample) => sample[key]).filter((value) => value !== null);
              return values.length ? summarize(values) : null;
            };
            const totalGpuMs = summarizeMetric('totalGpuMs'),
              effectGpuMs = summarizeMetric('effectGpuMs'),
              resolveGpuMs = summarizeMetric('resolveGpuMs'),
              completionMs = summarizeMetric('completionMs');
            const timestampsComplete =
              samples.filter((sample) => sample.totalGpuMs !== null).length === 120 &&
              !samples.some((sample) => sample.truncated);
            const fieldBudget = browserName === 'webkit' ? 1.5 : 0.5;
            const perField = fields.length === 1;
            const gates = perField
              ? {
                  field: {
                    metric: 'summed effect + canvas resolve GPU timestamp p95',
                    budgetMs: fieldBudget,
                    passed: timestampsComplete ? totalGpuMs.p95 <= fieldBudget : null,
                  },
                  ...(fields[0].effect.id === 'text-outline-glow'
                    ? {
                        glowItemIncludingResolve: {
                          metric: 'summed cached glow + canvas resolve GPU timestamp p95',
                          budgetMs: 0.3,
                          passed: timestampsComplete ? totalGpuMs.p95 <= 0.3 : null,
                        },
                        glowItemEffectOnly: {
                          metric: 'cached glow effect-only GPU timestamp p95',
                          budgetMs: 0.3,
                          passed: timestampsComplete ? effectGpuMs.p95 <= 0.3 : null,
                        },
                      }
                    : {}),
                }
              : {
                  page: {
                    metric: 'CPU encode start through shared submitted-work-done callback p95',
                    budgetMs: 4,
                    passed: completionMs.p95 <= 4,
                  },
                };
            const metadata = fields.map((field, index) => ({
              id: field.effect.id,
              requested: scenario.layout[index],
              size: [...field.surface.size],
              resolutionScale: field.surface.resolutionScale,
              dpr: field.frame.dpr,
              params: field.store.snapshot(),
              tier: field.effect.tier,
              context: Boolean(field.surface.context),
              visible: field.visible,
              state: field.state,
              diagnostics: [...field.diagnostics],
              font: getComputedStyle(hosts[index]).font,
              lineHeight: getComputedStyle(hosts[index]).lineHeight,
              copy: hosts[index].textContent,
              maskDimensions: field.textureTaps['input:text']
                ? [field.textureTaps['input:text'].width, field.textureTaps['input:text'].height]
                : null,
              initialDistanceVersion: initialMaskVersions[index],
              finalDistanceVersion: field.textureTaps.distance?.version ?? null,
              memory: field.memory(),
              renders: 151,
            }));
            if (
              metadata.some((field) => field.initialDistanceVersion !== field.finalDistanceVersion)
            )
              throw new Error('A cached distance map changed version during steady-state capture');
            const errors = session.errors.slice(errorCountBefore);
            if (errors.length) throw new Error(`GPU errors: ${JSON.stringify(errors)}`);
            return {
              id: scenario.id,
              warmupFrames: 30,
              measuredFrames: 120,
              submissions: 151,
              fields: metadata,
              bounds: bounds(),
              capabilities: session.capabilities,
              initialization: {
                dynamicImportMs: importMs,
                acquireDeviceMs,
                attachmentInitializationMs,
                attachments: attachmentTimes,
                startupPassCounts,
                firstRender: {
                  cpuEncodeMs: first.cpuEncodeMs,
                  cpuEncodeSubmitMs: first.cpuEncodeSubmitMs,
                  completionMs: first.completionMs,
                  totalGpuMs: first.totalGpuMs,
                  effectGpuMs: first.effectGpuMs,
                  resolveGpuMs: first.resolveGpuMs,
                  jfaGpuMs: first.jfaGpuMs,
                  passCounts: passCounts(first.labels),
                  passGpuMs: Object.fromEntries(
                    Object.entries(first.passes).map(([label, value]) => [label, value.ms]),
                  ),
                },
              },
              jfaCache: {
                instrumentation:
                  'Count actual profiler.timestampWrites calls for each encoded pass independently of timestamp feature support',
                firstFrame: firstJfa,
                warmup: {},
                measured: {},
                builds: firstJfa['jfa-seed'] ?? 0,
                expectedBuilds: glowCount,
              },
              cpuEncodeMs: summarizeMetric('cpuEncodeMs'),
              cpuEncodeSubmitMs: summarizeMetric('cpuEncodeSubmitMs'),
              completionMs,
              rafIntervalMs: summarizeMetric('rafIntervalMs'),
              totalGpuMs,
              effectGpuMs,
              resolveGpuMs,
              warmupPassCounts: warmupCounts,
              measuredPassCounts: aggregatePassCounts,
              passGpuMs: Object.fromEntries(
                Object.entries(aggregatePassMs).map(([label, values]) => [
                  label,
                  summarize(values),
                ]),
              ),
              timestamps: {
                supported: profiler.supported,
                complete: timestampsComplete,
                captured: totalGpuMs?.count ?? 0,
                droppedFrames: profiler.droppedFrames,
              },
              gates,
              errors,
              rawSamples: samples,
            };
          } finally {
            profiler.timestampWrites = originalTimestampWrites;
            removeProfile();
            for (const attachment of attachments) attachment.destroy();
            for (const host of hosts) host.remove();
            release();
          }
        },
        { root, scenario, browserName },
      );
      results.push({ ...row, run });
      console.log(
        `${browserName} ${scenario.id} run${run}: effect GPU ${row.effectGpuMs?.p95.toFixed(3) ?? 'n/a'}ms; total GPU ${row.totalGpuMs?.p95.toFixed(3) ?? 'n/a'}ms; completion ${row.completionMs.p95.toFixed(3)}ms p95; first JFA ${row.initialization.firstRender.jfaGpuMs?.toFixed(3) ?? 'n/a'}ms; gates ${JSON.stringify(row.gates)}`,
      );
    }
} catch (error) {
  failure = String(error);
} finally {
  await mkdir('docs/benchmarks', { recursive: true });
  await writeFile(
    output,
    JSON.stringify(
      {
        recordedOn: '2026-10-07',
        recordedAt: new Date().toISOString(),
        captureHistory: [
          ...(previous?.captureHistory ?? []),
          {
            recordedAt: new Date().toISOString(),
            runs,
            scenarios: scenarios.map((scenario) => scenario.id),
            append,
          },
        ],
        environment: {
          platform: platform(),
          arch: arch(),
          release: release(),
          browser: browserName,
          browserVersion: browser.version(),
          headless: true,
          requestedSoftwareAdapter: false,
          servingMode:
            'Vite development server with direct /@fs source imports; no production bundle used',
          baseURL,
          viewport: { width: 1440, height: 900 },
          dpr: 1,
          competingLoad:
            process.env.HOLOGPU_COMPETING_LOAD ??
            'No competing GPU work intentionally started by this script; machine-wide load remains uncontrolled.',
        },
        scenario: {
          ids: singles.map((scenario) => scenario.id),
          seed: 7,
          font: '700 48px/1.25 Arial,sans-serif',
          singles: singles.map((scenario) => scenario.layout[0]),
          pageLayout: layout,
          warmupFrames: 30,
          measuredFrames: 120,
          rendering:
            'Real light-DOM headings, actual DOM text-mask bindings, real canvas contexts, one shared GPU device and one submit per rAF. Explicit field.beforeFrame/render calls bypass idle gates for a conservative all-live workload. No simulation updates are applied to either analytic assembly preset. The mixed page includes three T1 effects and only one T3 assembly field.',
          progress:
            'Authored --hgpu-progress:0.5 keeps shimmer, reveal and assembly mid-transition; other parameters use defaults or assemble-and-hold preset values. Both assembly presets contain at most 8192 particles.',
          initialization:
            'Dynamic imports, GPU acquisition, DOM attachment readiness and first valid-mask frame are reported separately. Three rAFs settle canvas/DOM resize before first rendering. Scheduler is paused before attachment creation, so JFA runs once on the final DOM mask; first-frame JFA timestamp sum and actual pass counts are recorded. Startup queue work and first-frame work are excluded from steady-state samples.',
          cpu: 'CPU encode includes CSS polling, frame/parameter writes, input preparation, effect passes and canvas resolves. CPU encode+submit additionally includes profiler query resolution and shared queue submit.',
          completion:
            'CPU encode start through queue.onSubmittedWorkDone callback after one shared submission. This includes CPU and callback latency; it is not pure GPU execution. Timestamp settlement is outside this interval.',
          gpu: 'Optional timestamp-query pass interval sums, retained as total, effect-only and canvas-resolve summaries; these are not command-buffer wall durations and can differ from completion. Pass summaries and per-frame scalar summaries are retained without repeating raw per-pass data.',
          caching:
            'Actual jfa-* pass instrumentation proves one seed/distance build on first valid-mask frame and zero JFA work throughout warmup and measured frames, even when timestamp-query is unavailable. Distance tap version is also checked across capture.',
          gates:
            'General per-field summed effect+canvas-resolve GPU p95 <=0.5ms Chrome and <=1.5ms WebKit; Cached glow item <=0.3ms in either engine reported both with resolve and effect-only. Four-field mixed page CPU-start-to-completion p95 <=4ms. Compilation, initialization and first JFA are excluded from steady-state gates. Failed/unavailable gates remain explicit; execution/cache/errors throw after saving the partial capture.',
          memory:
            'Logical allocation bytes, not VRAM. DOM mask/raster font constraints remain in the effect notes; morph assembly retains its local raster target font rather than claiming exact DOM glyph alignment.',
        },
        results,
        pageErrors: [...(previous?.pageErrors ?? []), ...pageErrors],
        pageWarnings: [...(previous?.pageWarnings ?? []), ...pageWarnings],
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
