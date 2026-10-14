import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const core = '/@fs' + fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url));
const dom = '/@fs' + fileURLToPath(new URL('../../packages/dom/src/index.ts', import.meta.url));
const sweep =
  '/@fs' +
  fileURLToPath(new URL('../../packages/effects/src/light-sweep/index.ts', import.meta.url));

test('light-sweep: load, explicit progress, timeline, alpha masking and reduced-motion final pose', async ({
  page,
}) => {
  await page.route('**/__v2_sweep', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><canvas style="width:160px;height:120px"></canvas>',
    }),
  );
  await page.goto('/__v2_sweep');
  const result = await page.evaluate(
    async ({ core, sweep }) => {
      const { createEffect } = (await import(
        core
      )) as typeof import('../../packages/core/src/index.ts');
      const { default: effect } = (await import(
        sweep
      )) as typeof import('../../packages/effects/src/light-sweep/index.ts');
      const canvas = document.querySelector('canvas')!;
      const field = await createEffect(canvas, effect, { playing: false, adaptiveQuality: false });
      const alpha = async (time: number) => {
        field.drawAt(time);
        const pixels = (await field.readPixels()).pixels;
        return Array.from(pixels).filter((_v, i) => i % 4 === 3);
      };
      const automaticMid = await alpha(0.6),
        automaticFinal = await alpha(2);
      const poses = [];
      for (const progress of [0, 0.5, 1]) {
        field.params.progress = progress;
        poses.push((await alpha(10)).reduce((sum, value) => sum + value, 0));
      }
      field.store.patch(effect.presets.timeline!);
      field.timeline(0.5);
      const timelineMid = Array.from((await field.readPixels()).pixels)
        .filter((_v, i) => i % 4 === 3)
        .reduce((sum, value) => sum + value, 0);
      field.params.progress = 0.5;
      field.params.width = 0.25;
      const unmasked = await alpha(0);
      const mask = document.createElement('canvas');
      mask.width = 160;
      mask.height = 120;
      const painter = mask.getContext('2d')!;
      painter.fillStyle = 'white';
      painter.fillRect(0, 0, 80, 120);
      const bitmap = await createImageBitmap(mask);
      await field.bindInput('image', { kind: 'image', source: bitmap });
      const maskedRead = await field.readPixels(),
        masked = Array.from(maskedRead.pixels).filter((_v, i) => i % 4 === 3);
      const right = masked.filter((_v, i) => i % maskedRead.width > maskedRead.width / 2 + 2);
      const maskedSum = masked.reduce((sum, value) => sum + value, 0),
        unmaskedSum = unmasked.reduce((sum, value) => sum + value, 0);
      const errors = [...field.session.errors],
        diagnostics = [...field.diagnostics];
      field.destroy();
      bitmap.close();
      const reduced = await createEffect(canvas, effect, {
        playing: false,
        reducedMotion: true,
        params: { progress: 0.5 },
      });
      reduced.drawAt(0.5);
      const reducedAlpha = Array.from((await reduced.readPixels()).pixels).filter(
        (_v, i) => i % 4 === 3,
      );
      reduced.destroy();
      return {
        automaticMid: Math.max(...automaticMid),
        automaticFinal: Math.max(...automaticFinal),
        poses,
        timelineMid,
        right: Math.max(...right),
        maskedSum,
        unmaskedSum,
        reduced: Math.max(...reducedAlpha),
        errors,
        diagnostics,
      };
    },
    { core, sweep },
  );
  expect(result.automaticMid).toBeGreaterThan(20);
  expect(result.automaticFinal).toBe(0);
  expect(result.poses[0]).toBe(0);
  expect(result.poses[1]).toBeGreaterThan(1000);
  expect(result.poses[2]).toBe(0);
  expect(result.timelineMid).toBeGreaterThan(1000);
  expect(result.right).toBe(0);
  expect(result.maskedSum).toBeGreaterThan(1000);
  expect(result.maskedSum).toBeLessThan(result.unmaskedSum * 0.65);
  expect(result.reduced).toBe(0);
  expect(result.errors).toEqual([]);
  expect(result.diagnostics).toEqual([]);
});

test('light-sweep: one CSS progress transition renders the band and settles', async ({ page }) => {
  await page.route('**/__v2_sweep_css', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><style>#hero{width:160px;height:120px;--hgpu-progress:0;transition:--hgpu-progress 1.2s linear}</style><div id="hero">Readable copy</div>',
    }),
  );
  await page.goto('/__v2_sweep_css');
  const result = await page.evaluate(
    async ({ dom, sweep }) => {
      const { attach } = (await import(dom)) as typeof import('../../packages/dom/src/index.ts');
      const { default: effect } = (await import(
        sweep
      )) as typeof import('../../packages/effects/src/light-sweep/index.ts');
      const host = document.getElementById('hero')!;
      const attachment = await attach(host, effect, { layer: 'front', playing: false });
      const field = attachment.field!;
      // Let the initial CSS value be polled before changing the registered property.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      host.style.setProperty('--hgpu-progress', '1');
      await new Promise((resolve) => setTimeout(resolve, 600));
      const progress = field.params.progress;
      const mid = (await field.readPixels()).pixels.reduce(
        (sum, value, i) => sum + (i % 4 === 3 ? value : 0),
        0,
      );
      await new Promise((resolve) => setTimeout(resolve, 800));
      const finalProgress = field.params.progress;
      const settled = (await field.readPixels()).pixels.reduce(
        (sum, value, i) => sum + (i % 4 === 3 ? value : 0),
        0,
      );
      const errors = [...field.session.errors];
      attachment.destroy();
      return { progress, mid, finalProgress, settled, errors, copy: host.textContent };
    },
    { core, dom, sweep },
  );
  expect(result.progress).toBeGreaterThan(0.2);
  expect(result.progress).toBeLessThan(0.8);
  expect(result.mid).toBeGreaterThan(1000);
  expect(result.finalProgress).toBe(1);
  expect(result.settled).toBe(0);
  expect(result.errors).toEqual([]);
  expect(result.copy).toBe('Readable copy');
});

for (const progress of [0, 0.5, 1])
  test(`light-sweep: static progress ${progress} snapshot`, async ({ page }, testInfo) => {
    await page.route('**/__v2_sweep_snapshot', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><style>body{margin:0;background:#11121b}canvas{display:block;width:160px;height:120px}</style><canvas></canvas>',
      }),
    );
    await page.goto('/__v2_sweep_snapshot');
    const alpha = await page.evaluate(
      async ({ core, sweep, progress }) => {
        const { createEffect } = (await import(
          core
        )) as typeof import('../../packages/core/src/index.ts');
        const { default: effect } = (await import(
          sweep
        )) as typeof import('../../packages/effects/src/light-sweep/index.ts');
        const field = await createEffect(document.querySelector('canvas')!, effect, {
          playing: false,
          adaptiveQuality: false,
          params: { progress },
        });
        Object.assign(window, { hologpu: { field } });
        field.drawAt(0, 7);
        return (await field.readPixels()).pixels.reduce(
          (sum, value, i) => sum + (i % 4 === 3 ? value : 0),
          0,
        );
      },
      { core, sweep, progress },
    );
    if (progress === 0.5) expect(alpha).toBeGreaterThan(1000);
    else expect(alpha).toBe(0);
    if (testInfo.project.name.startsWith('swiftshader'))
      await expect(page.locator('canvas')).toHaveScreenshot(
        `light-sweep-progress-${progress}.png`,
        {
          scale: 'css',
          maxDiffPixelRatio: 0.001,
        },
      );
    await page.evaluate(() => window.hologpu.field!.destroy());
  });

test('light-sweep: settled load stops GPU draws and later CSS changes redraw', async ({ page }) => {
  await page.route('**/__v2_sweep_idle', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><style>#hero{width:160px;height:120px}</style><div id="hero">Readable copy</div>',
    }),
  );
  await page.goto('/__v2_sweep_idle');
  const result = await page.evaluate(
    async ({ dom, sweep }) => {
      const { attach } = (await import(dom)) as typeof import('../../packages/dom/src/index.ts');
      const { default: effect } = (await import(
        sweep
      )) as typeof import('../../packages/effects/src/light-sweep/index.ts');
      const host = document.getElementById('hero')!;
      const duration = 0.15;
      const attachment = await attach(host, effect, { layer: 'front', params: { duration } });
      const field = attachment.field!;
      let draws = 0,
        renderedFinal = false;
      const remove = field.onRendered(() => {
        draws++;
        if (field.frame.time >= duration) renderedFinal = true;
      });
      const until = async (predicate: () => boolean) => {
        const limit = performance.now() + 5000;
        while (!predicate()) {
          if (performance.now() > limit) throw new Error('Expected GPU draw did not occur');
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
      };
      await until(() => renderedFinal);
      const movingPointer = setInterval(() => {
        host.dispatchEvent(new PointerEvent('pointermove', { clientX: 80, clientY: 60 }));
      }, 10);
      const settledDraws = draws,
        clockBefore = field.frame.time;
      await new Promise((resolve) => setTimeout(resolve, 300));
      const idleDraws = draws,
        clockAfter = field.frame.time;
      const settled = (await field.readPixels()).pixels.reduce(
        (sum, value, i) => sum + (i % 4 === 3 ? value : 0),
        0,
      );
      const beforeCSS = draws;
      host.style.setProperty('--hgpu-progress', '0.5');
      await until(() => draws > beforeCSS && field.params.progress === 0.5);
      const mid = (await field.readPixels()).pixels.reduce(
        (sum, value, i) => sum + (i % 4 === 3 ? value : 0),
        0,
      );
      const explicitDraws = draws;
      await new Promise((resolve) => setTimeout(resolve, 300));
      const explicitIdleDraws = draws;
      clearInterval(movingPointer);
      const errors = [...field.session.errors];
      remove();
      attachment.destroy();
      return {
        renderedFinal,
        settledDraws,
        idleDraws,
        settled,
        mid,
        clockBefore,
        clockAfter,
        explicitDraws,
        explicitIdleDraws,
        errors,
      };
    },
    { dom, sweep },
  );
  expect(result.renderedFinal).toBe(true);
  expect(result.settledDraws).toBeGreaterThan(0);
  expect(result.idleDraws).toBe(result.settledDraws);
  expect(result.clockAfter).toBeGreaterThan(result.clockBefore);
  expect(result.settled).toBe(0);
  expect(result.mid).toBeGreaterThan(1000);
  expect(result.explicitIdleDraws).toBe(result.explicitDraws);
  expect(result.errors).toEqual([]);
});
