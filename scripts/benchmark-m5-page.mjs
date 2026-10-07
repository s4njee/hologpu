import { chromium, webkit } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
import { platform, arch, release } from 'node:os';
import { summarize } from '../packages/core/dist/measure.js';

const name = process.argv[2] ?? 'chrome';
const part = process.argv[3] ?? 'all';
if (
  !['chrome', 'webkit', 'software'].includes(name) ||
  !['all', 'page', 'css', 'overlay', 'adaptive', 'stress'].includes(part) ||
  process.argv.length > 4 ||
  (name === 'software' && !['all', 'adaptive', 'stress'].includes(part))
) {
  throw new Error(
    'Usage: node scripts/benchmark-m5-page.mjs chrome|webkit [all|page|css|overlay], or software [adaptive|stress]',
  );
}
const browser = await (name === 'webkit' ? webkit : chromium).launch({
  ...(name === 'chrome' ? { channel: 'chrome' } : {}),
  ...(name === 'software' ? { args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader'] } : {}),
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
await page.emulateMedia({ reducedMotion: 'no-preference' });
const base = process.env.HOLOGPU_URL ?? 'http://127.0.0.1:5176';
const results = [];
const diagnostics = [];
page.on('pageerror', (error) => diagnostics.push(error.message));
const six = [
  'border-energy',
  'spotlight',
  'image-hover',
  'text-dissolve',
  'audio-spectrum',
  'scroll-scene',
];
const layoutCSS =
  '#stage.dom-mode{height:760px}.m5-cards{grid-template-columns:repeat(3,minmax(0,1fr));padding-bottom:1000px}.m5-card{height:220px;min-height:220px}';
if (name === 'software') {
  // Apply the declared measurement layout before attachment creation, including cold work.
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()).replace('</head>', `<style>${layoutCSS}</style></head>`),
    });
  });
  await page.addInitScript(() => {
    const quality = [],
      work = [],
      readyFields = [];
    window.__m5Cold = { quality, work, readyFields, pending: 0, maxPending: 0 };
    document.addEventListener(
      'hgpu-quality',
      (event) => {
        const attachment = event.detail.attachment;
        quality.push({
          navigationAtMs: performance.now(),
          quality: { ...event.detail.quality },
          id: attachment.effect.id,
          index: readyFields.indexOf(attachment.field),
          phase: 'cold-start',
        });
      },
      true,
    );
    document.addEventListener(
      'hgpu-ready',
      (event) => {
        const field = event.detail.field;
        if (!field || readyFields.includes(field)) return;
        readyFields.push(field);
        if (window.__m5Cold.restore) return;
        const session = field.session,
          original = session.submit;
        let boundary = performance.now();
        const remove = field.onBeforeFrame(() => (boundary = performance.now()));
        session.submit = function () {
          const result = original.call(this),
            begin = boundary,
            row = {
              navigationAtMs: performance.now(),
              completionMs: null,
              fields: readyFields.map((f) => ({
                id: f.effect.id,
                frameIndex: f.frame.index,
                quality: { ...f.quality.state },
                size: [...f.surface.size],
              })),
            };
          work.push(row);
          window.__m5Cold.pending++;
          window.__m5Cold.maxPending = Math.max(
            window.__m5Cold.maxPending,
            window.__m5Cold.pending,
          );
          session.device.queue.onSubmittedWorkDone().then(
            () => {
              row.completionMs = performance.now() - begin;
              row.navigationCompletedAtMs = performance.now();
              window.__m5Cold.pending--;
            },
            () => window.__m5Cold.pending--,
          );
          return result;
        };
        window.__m5Cold.restore = () => {
          session.submit = original;
          remove();
        };
      },
      true,
    );
  });
}
async function stage(overlay = false, adaptive = false, adaptiveFromCreation = false) {
  const navigationStart = performance.now();
  await page.goto(
    `${base}/?${new URLSearchParams({ effect: adaptive ? 'fluid-obstacles' : 'border-energy', mode: adaptive ? 'grid' : 'in-page', copies: '6', playing: 'true', quality: adaptiveFromCreation ? 'auto' : 'fixed', resolution: '1', timeScale: '1', seed: '7', ...(overlay ? { overlay: 'true' } : {}) })}`,
  );
  await page.locator('#status[data-state="ready"]').waitFor({ timeout: 60_000 });
  const statusReadyMs = performance.now() - navigationStart;
  await page.addStyleTag({ content: layoutCSS });
  await page.evaluate(async () => {
    const s = window.hologpu.domStage;
    if (s.fields.length !== 6 || s.attachments.length !== 6 || s.hosts.length !== 6)
      throw new Error('Expected six actual DOM attachments');
    await Promise.all(s.fields.map((f) => f.whenInputsReady()));
    for (let i = 0; i < 5; i++) await new Promise(requestAnimationFrame);
    for (const f of s.fields)
      if (!f.visible || f.state !== 'ready')
        throw new Error('An actual attached field is not visible and ready');
    const clip = document.getElementById('dom-stage').getBoundingClientRect();
    for (const host of s.hosts) {
      const r = host.getBoundingClientRect();
      if (
        r.left < 0 ||
        r.right > innerWidth ||
        r.top < clip.top ||
        r.bottom > Math.min(clip.bottom, innerHeight)
      )
        throw new Error('All six attached hosts must fit completely inside the visible clip');
    }
  });
  return {
    statusReadyMs,
    visibleInputsReadyMs: performance.now() - navigationStart,
    clock: 'Node wall time from navigation start, including browser protocol/readiness checks',
  };
}
function summaryRow(data) {
  const { idle, raf, cpu, completion, ...metadata } = data;
  const baseline = summarize(idle);
  const deadline = baseline.p50 * 1.1;
  const row = {
    ...metadata,
    idleRafMs: baseline,
    rafMs: summarize(raf),
    cpuMs: summarize(cpu),
    completionMs: summarize(completion),
    deadlineMs: deadline,
    completedWithinDeadline: completion.filter((x) => x <= deadline).length / completion.length,
  };
  row.gate = row.completedWithinDeadline >= 0.95 && row.rafMs.p50 <= deadline;
  return row;
}
try {
  if (name !== 'software' && ['all', 'page'].includes(part)) {
    for (let run = 1; run <= 3; run++) {
      await stage();
      const data = await page.evaluate(async () => {
        const s = window.hologpu.domStage,
          fields = s.fields,
          session = fields[0].session;
        if (fields.some((f) => f.session !== session || !f.surface.context))
          throw new Error('Six fields do not share a device and six actual contexts');
        const root = document.getElementById('dom-stage');
        const bounds = () =>
          s.hosts.map((host) => {
            const r = host.getBoundingClientRect(),
              clip = root.getBoundingClientRect();
            return {
              left: r.left,
              top: r.top,
              width: r.width,
              height: r.height,
              completelyVisible:
                r.left >= 0 &&
                r.right <= innerWidth &&
                r.top >= clip.top &&
                r.bottom <= Math.min(clip.bottom, innerHeight),
            };
          });
        if (bounds().some((r) => !r.completelyVisible))
          throw new Error('All six actual surfaces must fit inside the visible clipping viewport');
        session.scheduler.setHidden(true);
        for (const f of fields) {
          f.setAdaptiveQuality(false);
          f.setReducedMotion(false);
          f.setTimeScale(1);
          f.setResolutionScale(1);
          f.reset(7);
          f.play();
        }
        await session.device.queue.onSubmittedWorkDone();
        const idle = [];
        let last;
        for (let i = 0; i < 40; i++) {
          const now = await new Promise(requestAnimationFrame);
          if (last !== undefined) idle.push(now - last);
          last = now;
        }
        const renders = fields.map(() => 0),
          updates = fields.map(() => 0),
          removes = [];
        const originals = fields.map((f) => f.instance.update);
        fields.forEach((f, i) => {
          f.instance.update = function (frame) {
            updates[i]++;
            return originals[i].call(this, frame);
          };
          removes.push(f.onRendered(() => renders[i]++));
        });
        const rows = [],
          pending = [],
          submit = session.submit;
        let running = true,
          started = 0,
          tick = 0,
          previous;
        const begin = fields[0].onBeforeFrame(() => {
          started = performance.now();
          tick++;
          root.scrollTop = 20 + 20 * Math.sin((tick * Math.PI) / 90);
        });
        let finish;
        const finished = new Promise((resolve) => (finish = resolve));
        const timeout = setTimeout(() => finish('timeout'), 30_000);
        session.submit = function () {
          const result = submit.call(this);
          if (!running) return result;
          const now = performance.now(),
            entry = {
              tick,
              raf: previous === undefined ? 0 : started - previous,
              cpu: now - started,
              renders: [...renders],
              updates: [...updates],
              completion: null,
            };
          previous = started;
          rows.push(entry);
          // Capture the boundary in the closure; later frames must not overwrite its start.
          const boundary = started;
          pending.push(
            session.device.queue
              .onSubmittedWorkDone()
              .then(() => {
                entry.completion = performance.now() - boundary;
              })
              .catch((error) => {
                entry.error = String(error);
              }),
          );
          if (rows.length === 150) {
            running = false;
            session.scheduler.setHidden(true);
            finish('complete');
          }
          return result;
        };
        try {
          session.scheduler.setHidden(false);
          const outcome = await finished;
          running = false;
          session.scheduler.setHidden(true);
          if (outcome !== 'complete')
            throw new Error(
              `Six-page run timed out after ${rows.length} actual shared submissions`,
            );
          await Promise.all(pending);
          const measured = rows.slice(30),
            warm = rows[29];
          const actual = fields.map((f, i) => ({
            id: f.effect.id,
            state: f.state,
            visible: f.visible,
            playing: f.playing,
            reducedMotion: f.reducedMotion,
            adaptiveQuality: f.adaptiveQuality,
            timeScale: f.timeScale,
            size: [...f.surface.size],
            dpr: f.surface.dpr,
            params: f.store.snapshot(),
            frameIndex: f.frame.index,
            warmupRenders: warm.renders[i],
            renders: renders[i] - warm.renders[i],
            updates: updates[i] - warm.updates[i],
            memory: f.memory(),
            taps: Object.fromEntries(
              Object.entries(f.textureTaps).map(([key, t]) => [
                key,
                { width: t.width, height: t.height, format: t.format },
              ]),
            ),
          }));
          const pixels = [];
          for (const f of fields) {
            const image = await f.readPixels();
            let hash = 2166136261,
              lit = 0;
            for (let i = 0; i < image.pixels.length; i++) {
              hash = Math.imul(hash ^ image.pixels[i], 16777619);
              if (i % 4 !== 3 && image.pixels[i] > 24) lit++;
            }
            pixels.push({
              id: f.effect.id,
              width: image.width,
              height: image.height,
              hash: hash >>> 0,
              coloredSamples: lit,
            });
          }
          return {
            id: 'six-attached-effects',
            samples: 120,
            warmup: 30,
            submissions: rows.length,
            fields: actual,
            bounds: bounds(),
            pixels,
            contexts: s.memory.presentationContexts,
            memory: s.memory,
            capabilities: session.capabilities,
            errors: [...session.errors, ...measured.flatMap((r) => (r.error ? [r.error] : []))],
            idle,
            raf: measured.map((r) => r.raf),
            cpu: measured.map((r) => r.cpu),
            completion: measured.map((r) => r.completion),
            sampleBoundaries: measured.map((r) => ({
              tick: r.tick,
              renders: r.renders,
              updates: r.updates,
            })),
          };
        } finally {
          clearTimeout(timeout);
          running = false;
          session.submit = submit;
          begin();
          removes.forEach((r) => r());
          fields.forEach((f, i) => {
            if (f.instance) f.instance.update = originals[i];
          });
        }
      });
      const row = { ...summaryRow(data), run };
      if (
        row.submissions !== 150 ||
        row.samples !== 120 ||
        row.fields.length !== 6 ||
        row.contexts !== 6 ||
        row.errors.length ||
        row.completionMs.count !== 120 ||
        data.completion.some((x) => !Number.isFinite(x) || x < 0) ||
        row.rafMs.count !== 120 ||
        row.fields.some(
          (f) =>
            !f.visible ||
            f.state !== 'ready' ||
            f.adaptiveQuality ||
            f.reducedMotion ||
            f.timeScale !== 1 ||
            (f.playing ? f.renders !== 120 : f.id !== 'scroll-scene' || f.renders < 114) ||
            f.size.some((x) => x < 1),
        ) ||
        row.bounds.some((r) => !r.completelyVisible) ||
        row.pixels.some((p) => !p.coloredSamples) ||
        JSON.stringify(row.fields.map((f) => f.id).sort()) !== JSON.stringify([...six].sort())
      )
        throw new Error(`Incomplete six-field scenario: ${JSON.stringify(row)}`);
      results.push(row);
      console.log(
        `six attached ${run}: completion p95 ${row.completionMs.p95.toFixed(3)}ms, rAF median ${row.rafMs.p50.toFixed(3)}ms, gate ${row.gate}`,
      );
    }
  }
  if (name !== 'software' && ['all', 'css'].includes(part)) {
    for (const count of [0, 1, 8])
      for (let run = 1; run <= 3; run++) {
        await page.goto(`${base}/?effect=gradient-oklch&playing=false&quality=fixed`);
        await page.locator('#status[data-state="ready"]').waitFor();
        const row = await page.evaluate(async (count) => {
          window.hologpu.field.destroy();
          const h = window.hologpu,
            host = document.createElement('div'),
            canvas = document.createElement('canvas');
          host.style.cssText = 'position:fixed;left:20px;top:20px;width:64px;height:64px';
          canvas.style.cssText = 'width:64px;height:64px';
          host.append(canvas);
          document.body.append(host);
          const params = Object.fromEntries(
            Array.from({ length: 8 }, (_, i) => [
              `p${i}`,
              { type: 'f32', default: 0, min: 0, max: 1, css: true },
            ]),
          );
          const f = await h.createEffect(
            canvas,
            h.fragmentEffect({
              id: `m5-css-${count}`,
              title: 'CSS cost',
              params,
              wgsl: 'fn effect(uv:vec2f)->vec4f{return vec4f(uv,0,1);}',
            }),
            { playing: false, adaptiveQuality: false, dprCap: 1 },
          );
          f.session.scheduler.setHidden(true);
          f.visible = true;
          const names = Array.from({ length: count }, (_, i) => `p${i}`),
            bridge = h.bindCSSParameters(host, f, { names, prefix: `--m5-css-${count}-` }),
            hook = [];
          try {
            for (let i = 0; i < 150; i++) {
              await new Promise(requestAnimationFrame);
              for (let j = 0; j < count; j++)
                host.style.setProperty(`--m5-css-${count}-p${j}`, String(((i + j) % 120) / 119));
              const start = performance.now();
              f.beforeFrame();
              if (i >= 30) hook.push(performance.now() - start);
              if (i === 29) bridge.resetStats();
            }
            return {
              id: 'css-uniform-cost',
              bindings: count,
              samples: 120,
              warmup: 30,
              hook,
              stats: bridge.stats,
              finalValues: f.store.snapshot(),
              properties: bridge.properties,
              size: [...f.surface.size],
              errors: [...f.session.errors],
            };
          } finally {
            bridge.dispose();
            f.destroy();
            host.remove();
          }
        }, count);
        const { hook, stats, ...metadata } = row;
        if (
          stats.reads !== (count ? 120 : 0) ||
          stats.styleMs.length !== (count ? 120 : 0) ||
          stats.errors.length ||
          row.errors.length ||
          hook.length !== 120 ||
          row.properties.length !== count
        )
          throw new Error(`Incomplete CSS bridge measurement: ${JSON.stringify(row)}`);
        results.push({
          ...metadata,
          run,
          stats: { ...stats, styleMs: summarize(stats.styleMs), applyMs: summarize(stats.applyMs) },
          hookMs: summarize(hook),
        });
        console.log(
          `CSS ${count} bindings ${run}: style p95 ${summarize(stats.styleMs).p95.toFixed(4)}ms`,
        );
      }
  }
  if (name !== 'software' && ['all', 'overlay'].includes(part)) {
    for (const overlay of [false, true]) {
      await stage(overlay);
      const data = await page.evaluate(async (overlay) => {
        const s = window.hologpu.domStage,
          root = document.getElementById('dom-stage'),
          session = s.fields[0].session;
        for (const f of s.fields) {
          f.pause();
          f.setAdaptiveQuality(false);
        }
        const logical = () =>
          s.fields.map((field) => {
            const r = field.canvas.getBoundingClientRect();
            return { left: r.left, top: r.top, width: r.width, height: r.height };
          });
        const presented = () =>
          overlay
            ? s.overlay.drawnRects
            : s.fields.map((f) => {
                const r = f.canvas.getBoundingClientRect();
                return { left: r.left, top: r.top, width: r.width, height: r.height };
              });
        const drift = () => {
          const actual = logical(),
            drawn = presented();
          if (actual.length !== 6 || drawn.length !== 6)
            throw new Error('Scroll comparison lost visible surfaces');
          return actual.map((r, i) =>
            Math.max(
              ...['left', 'top', 'width', 'height'].map((k) => Math.abs(r[k] - drawn[i][k])),
            ),
          );
        };
        const before = [],
          after = [],
          latency = [];
        for (let i = 0; i < 120; i++) {
          await new Promise(requestAnimationFrame);
          const start = performance.now();
          root.scrollTop = i % 2 ? 60 : 0;
          before.push(...drift());
          await new Promise(requestAnimationFrame);
          await new Promise(requestAnimationFrame);
          await session.device.queue.onSubmittedWorkDone();
          latency.push(performance.now() - start);
          after.push(...drift());
        }
        const memory = s.memory,
          sourcePixels = s.fields.reduce((n, f) => n + f.surface.size[0] * f.surface.size[1], 0);
        return {
          id: 'overlay-scroll',
          overlay,
          samples: 120,
          contexts: memory.presentationContexts,
          memory,
          sourcePixels,
          estimatedSinglePresentationBytes: overlay
            ? s.overlay.canvas.width * s.overlay.canvas.height * 4
            : sourcePixels * 4,
          estimatedTriplePresentationBytes: overlay
            ? s.overlay.canvas.width * s.overlay.canvas.height * 12
            : sourcePixels * 12,
          presentationEstimate:
            'RGBA8 logical one-image and three-image estimates; browser swap-chain allocation is not observable',
          before,
          after,
          latency,
          drawnRects: presented(),
          domRects: logical(),
          hostRects: s.hosts.map((host) => {
            const r = host.getBoundingClientRect();
            return { left: r.left, top: r.top, width: r.width, height: r.height };
          }),
          errors: [...session.errors],
          capabilities: session.capabilities,
        };
      }, overlay);
      const { before, after, latency, ...metadata } = data;
      if (
        metadata.contexts !== (overlay ? 1 : 6) ||
        metadata.errors.length ||
        before.length !== 720 ||
        after.length !== 720 ||
        after.some((x) => x > 0.75)
      )
        throw new Error(`Incomplete overlay comparison: ${JSON.stringify(data)}`);
      const path = `docs/benchmarks/m5-${overlay ? 'overlay' : 'in-flow'}-${name}-scroll.png`;
      await page.screenshot({ path, fullPage: false });
      results.push({
        ...metadata,
        beforeNextRenderDriftPx: summarize(before),
        afterQueueAndTwoRafDriftPx: summarize(after),
        scrollSettleMs: summarize(latency),
        screenshot: path,
        samplingLimit:
          'CPU/layout observations of programmatic scroll before and after two rAF callbacks plus queue completion; this cannot observe compositor-only wheel scrolling or prove zero visual latency.',
      });
      console.log(
        `${overlay ? 'overlay' : 'in-flow'} scroll: ${metadata.contexts} contexts, pre-render drift max ${summarize(before).max.toFixed(1)}px, settled ${summarize(after).max.toFixed(3)}px`,
      );
    }
  }
  if (name === 'software') {
    const stress = part === 'stress';
    const coldStartup = await stage(false, stress, true);
    const row = await page.evaluate(async (stress) => {
      const s = window.hologpu.domStage,
        fields = s.fields,
        session = fields[0].session;
      session.scheduler.setHidden(true);
      const initialDrainStart = performance.now();
      await session.device.queue.onSubmittedWorkDone();
      const initialQueueDrainMs = performance.now() - initialDrainStart;
      window.__m5Cold.restore?.();
      for (const field of fields) {
        if (!field.adaptiveQuality) field.setAdaptiveQuality(true);
        field.setReducedMotion(false);
        field.setTimeScale(1);
        field.play();
      }
      const start = performance.now(),
        submit = session.submit,
        rows = [],
        events = window.__m5Cold.quality.map((event) => ({
          ...event,
          readyOrderIndex: event.index,
          index: fields.findIndex((field) => field.effect.id === event.id),
          atMs: event.navigationAtMs - start,
        })),
        remove = [];
      let done,
        active = true,
        boundary = 0,
        pendingQueue = 0,
        maxPendingQueue = 0,
        tickIndex = 0;
      const finished = new Promise((resolve) => (done = resolve));
      const timer = setTimeout(() => done('30-second limit'), 30_000);
      const root = document.getElementById('dom-stage');
      const tick = fields[0].onBeforeFrame(() => {
        boundary = performance.now();
        if (!stress) root.scrollTop = 20 + 20 * Math.sin((++tickIndex * Math.PI) / 90);
      });
      for (const [index, host] of s.hosts.entries()) {
        const listen = (event) =>
          events.push({
            atMs: performance.now() - start,
            quality: event.detail.quality,
            id: event.detail.attachment.effect.id,
            index,
            phase: 'timed-capture',
          });
        host.addEventListener('hgpu-quality', listen);
        remove.push(() => host.removeEventListener('hgpu-quality', listen));
      }
      const actualRenders = fields.map(() => 0);
      fields.forEach((f, i) => remove.push(f.onRendered(() => actualRenders[i]++)));
      const initial = fields.map((f) => ({
        id: f.effect.id,
        size: [...f.surface.size],
        quality: { ...f.quality.state },
        params: f.store.snapshot(),
        frameIndex: f.frame.index,
      }));
      session.submit = function () {
        const result = submit.call(this);
        if (!active) return result;
        const begin = boundary,
          entry = {
            atMs: performance.now() - start,
            frameIndex: fields.map((f) => f.frame.index),
            quality: fields.map((f) => ({ ...f.quality.state })),
            size: fields.map((f) => [...f.surface.size]),
            completionMs: null,
            renders: [...actualRenders],
          };
        rows.push(entry);
        pendingQueue++;
        maxPendingQueue = Math.max(maxPendingQueue, pendingQueue);
        session.device.queue
          .onSubmittedWorkDone()
          .then(() => {
            entry.completionMs = performance.now() - begin;
            entry.completedAtMs = performance.now() - start;
            pendingQueue--;
          })
          .catch(() => {
            pendingQueue--;
          });
        if (rows.length >= 300) done('300-frame limit');
        return result;
      };
      try {
        session.scheduler.setHidden(false);
        const stop = await finished;
        active = false;
        session.scheduler.setHidden(true);
        // The bounded capture does not extend itself by waiting for an arbitrarily long queue.
        const elapsedMs = performance.now() - start,
          final = fields.map((f, i) => ({
            id: f.effect.id,
            state: f.state,
            visible: f.visible,
            frameIndex: f.frame.index,
            size: [...f.surface.size],
            quality: { ...f.quality.state },
            adaptiveQuality: f.adaptiveQuality,
            memory: f.memory(),
            renders: actualRenders[i],
          }));
        const downshifts = events.filter(
          (e) => e.quality.resolutionScale < 1 || e.quality.stepScale < 1,
        );
        const firstDownshift = downshifts[0]?.atMs ?? null,
          framesAfterDownshift =
            firstDownshift === null ? 0 : rows.filter((r) => r.atMs > firstDownshift).length;
        const capturedRows = structuredClone(rows);
        return {
          id: stress ? 'software-adaptive-six-fluids' : 'software-adaptive-six-family-h',
          stop,
          elapsedMs,
          initialQueueDrainMs,
          startupWork: structuredClone(window.__m5Cold.work),
          startupMaxPendingQueue: window.__m5Cold.maxPending,
          startupPendingRows: window.__m5Cold.pending,
          requested: {
            resolutionScale: 1,
            dpr: 1,
            layout: fields.map((field) => {
              const rect = field.canvas.getBoundingClientRect();
              return { id: field.effect.id, width: rect.width, height: rect.height };
            }),
          },
          submissions: rows.length,
          initial,
          final,
          qualityEvents: events,
          actualDownshifts: downshifts.length,
          framesAfterDownshift,
          rows: capturedRows,
          completedRows: capturedRows.filter((r) => r.completionMs !== null).length,
          completedRowsAfterDownshift:
            firstDownshift === null
              ? 0
              : capturedRows.filter((r) => r.atMs > firstDownshift && r.completionMs !== null)
                  .length,
          maxPendingQueue,
          pendingRowsAtCaptureEnd: capturedRows.filter((r) => r.completionMs === null).length,
          capabilities: session.capabilities,
          memory: s.memory,
          errors: [...session.errors],
          proxy: stress
            ? 'SwiftShader software adapter under six real default 256² fluid-obstacles solvers; extreme solver stress beyond the six Family H criterion.'
            : 'SwiftShader software adapter with the same six Family H hosts, initial params/pixels and real scroll driver as native gates; a software pressure proxy, not physical weaker-device validation.',
        };
      } finally {
        active = false;
        clearTimeout(timer);
        session.submit = submit;
        tick();
        remove.forEach((f) => f());
      }
    }, stress);
    if (
      row.initial.length !== 6 ||
      (stress
        ? row.initial.some(
            (f) =>
              f.id !== 'fluid-obstacles' || f.params.grid !== 256 || f.params.iterations !== 32,
          )
        : JSON.stringify(row.initial.map((f) => f.id).sort()) !==
          JSON.stringify([...six].sort())) ||
      row.errors.length ||
      !/swiftshader|subzero/i.test(JSON.stringify(row.capabilities.adapter)) ||
      row.final.some((f) => f.state !== 'ready' || !f.visible || !f.adaptiveQuality) ||
      !row.submissions ||
      row.submissions > 300
    )
      throw new Error(
        `Software adaptive scenario did not prove degradation and progress: ${JSON.stringify(row)}`,
      );
    const cadence = row.rows.slice(1).map((sample, i) => sample.atMs - row.rows[i].atMs);
    const completed = row.rows.flatMap((sample) =>
      sample.completionMs === null ? [] : [sample.completionMs],
    );
    results.push({
      ...row,
      coldStartup: {
        ...coldStartup,
        initialQueueDrainMs: row.initialQueueDrainMs,
        completionMs: summarize(
          row.startupWork.flatMap((work) =>
            work.completionMs === null ? [] : [work.completionMs],
          ),
        ),
        timedCaptureStartsAfterStartup: true,
        limit:
          'The capture duration does not include cold readiness or the initial queue drain; those durations are retained here, and are not evidence of stall-free startup.',
      },
      rafMs: summarize(cadence),
      completionMs: summarize(completed),
      stallDeadlineMs: 1000,
      gate:
        row.actualDownshifts > 0 &&
        row.framesAfterDownshift >= 5 &&
        row.completedRowsAfterDownshift >= 5 &&
        summarize(completed).max <= 1000 &&
        summarize(cadence).max <= 1000 &&
        row.final.every((f) => f.renders >= 5),
    });
    console.log(
      `software ${stress ? 'six fluids' : 'six Family H'}: ${row.actualDownshifts} actual quality events, ${row.framesAfterDownshift} ongoing frames after first downshift`,
    );
  }
  if (diagnostics.length) throw new Error(`Page errors: ${diagnostics.join('\n')}`);
  await mkdir('docs/benchmarks', { recursive: true });
  const filename =
    name === 'software' && part === 'stress'
      ? 'docs/benchmarks/m5-stress-six-fluids-software.json'
      : `docs/benchmarks/m5-page-${name}${part === 'all' || name === 'software' ? '' : `-${part}`}.json`;
  await writeFile(
    filename,
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
          viewport: { width: 1440, height: 1000 },
          baseURL: base,
          competingLoad:
            process.env.HOLOGPU_COMPETING_LOAD ??
            'Independent user GPU tasks may be active; machine-wide load is not controlled by this harness.',
        },
        scenario: {
          layout: layoutCSS,
          seed: 7,
          page:
            part === 'stress'
              ? 'Actual production DOMStage with six independently attached default fluid-obstacles fields; real shared scheduler.'
              : 'Actual production DOMStage with six independently attached Family H fields; real shared scheduler with scroll-driven uniforms.',
          warmup: name === 'software' ? 'Cold readiness/queue drain retained separately' : 30,
          samples: name === 'software' ? '300 submissions or 30 seconds' : 120,
          deadline:
            name === 'software'
              ? 'Actual quality reduction, >=5 completed GPU workloads after downshift, ongoing rendering, and no >1-second cadence/completion stall during timed capture; cold stalls reported separately.'
              : '110% of per-run idle median rAF; >=95% completed CPU+queue work inside deadline and median workload rAF inside deadline.',
          cpuBoundary:
            'First field custom onBeforeFrame hook to shared queue completion; earlier automatic hooks on that first field are excluded. Capture is asynchronous and does not serialize rAF.',
          css: 'Public production bindCSSParameters; 0/1/8 selected bindings, 30 warmup +120 manually sampled visible frame hooks, no GPU rendering in timing region.',
        },
        results,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Saved ${filename}`);
} finally {
  await browser.close();
}
