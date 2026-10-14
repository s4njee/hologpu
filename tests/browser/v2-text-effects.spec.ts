import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const core = '/@fs' + fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url));
const dom = '/@fs' + fileURLToPath(new URL('../../packages/dom/src/index.ts', import.meta.url));
const sources = {
  'text-shimmer':
    '/@fs' +
    fileURLToPath(new URL('../../packages/effects/src/text-shimmer/index.ts', import.meta.url)),
  'heading-reveal':
    '/@fs' +
    fileURLToPath(new URL('../../packages/effects/src/heading-reveal/index.ts', import.meta.url)),
};

for (const id of ['text-shimmer', 'heading-reveal'] as const) {
  test(`${id}: text alpha, progress endpoints, normalized timeline and reduced pose`, async ({
    page,
  }) => {
    await page.route('**/__v2_type_core', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><canvas style="width:160px;height:80px"></canvas>',
      }),
    );
    await page.goto('/__v2_type_core');
    const result = await page.evaluate(
      async ({ core, source, id }) => {
        const { createEffect } = (await import(
          core
        )) as typeof import('../../packages/core/src/index.ts');
        const { default: effect } = (await import(source)) as {
          default: import('../../packages/core/src/index.ts').EffectDefinition;
        };
        const mask = document.createElement('canvas');
        mask.width = 160;
        mask.height = 80;
        const painter = mask.getContext('2d', { willReadFrequently: true })!;
        painter.font = 'bold 60px sans-serif';
        painter.textAlign = 'center';
        painter.textBaseline = 'middle';
        painter.fillStyle = 'white';
        painter.fillText('GPU', 80, 43);
        const coverage = painter.getImageData(0, 0, 160, 80).data;
        const bitmap = await createImageBitmap(mask);
        const canvas = document.querySelector('canvas')!;
        const field = await createEffect(canvas, effect, {
          playing: false,
          adaptiveQuality: false,
        });
        await field.bindInput('text', { kind: 'image', source: bitmap });
        const read = async (progress: number) => {
          field.params.progress = progress;
          field.drawAt(0.6, 7);
          return field.readPixels();
        };
        const zero = await read(0),
          middle = await read(0.5),
          repeat = await read(0.5),
          final = await read(1);
        const alpha = (pixels: Uint8Array) =>
          pixels.reduce((sum, value, i) => sum + (i % 4 === 3 ? value : 0), 0);
        let outside = 0,
          opaqueInterior = 0;
        for (let y = 0; y < middle.height; y++)
          for (let x = 0; x < middle.width; x++) {
            const mx = ((x + 0.5) * 160) / middle.width - 0.5,
              my = ((y + 0.5) * 80) / middle.height - 0.5;
            const a = Math.floor(mx),
              b = Math.floor(my);
            const neighbors = [
              coverage[
                (Math.max(0, Math.min(79, b)) * 160 + Math.max(0, Math.min(159, a))) * 4 + 3
              ]!,
              coverage[
                (Math.max(0, Math.min(79, b)) * 160 + Math.max(0, Math.min(159, a + 1))) * 4 + 3
              ]!,
              coverage[
                (Math.max(0, Math.min(79, b + 1)) * 160 + Math.max(0, Math.min(159, a))) * 4 + 3
              ]!,
              coverage[
                (Math.max(0, Math.min(79, b + 1)) * 160 + Math.max(0, Math.min(159, a + 1))) * 4 + 3
              ]!,
            ];
            if (neighbors.every((value) => value === 0))
              outside = Math.max(outside, middle.pixels[(y * middle.width + x) * 4 + 3]!);
            if (neighbors.every((value) => value === 255))
              opaqueInterior = Math.max(
                opaqueInterior,
                zero.pixels[(y * middle.width + x) * 4 + 3]!,
              );
          }
        field.store.patch(effect.presets.timeline!);
        field.timeline(0.5);
        const timeline = await field.readPixels();
        const errors = [...field.session.errors],
          diagnostics = [...field.diagnostics];
        field.destroy();
        const reduced = await createEffect(canvas, effect, {
          playing: false,
          reducedMotion: true,
          params: { progress: 0 },
        });
        await reduced.bindInput('text', { kind: 'image', source: bitmap });
        reduced.drawAt(0.1, 7);
        const reducedZero = await reduced.readPixels();
        reduced.params.progress = 1;
        reduced.drawAt(9, 7);
        const reducedFinal = await reduced.readPixels();
        reduced.destroy();
        bitmap.close();
        return {
          id,
          zero: alpha(zero.pixels),
          middle: alpha(middle.pixels),
          final: alpha(final.pixels),
          outside,
          opaqueInterior,
          deterministic: middle.pixels.every((value, i) => value === repeat.pixels[i]),
          timeline: alpha(timeline.pixels),
          reduced: alpha(reducedZero.pixels),
          reducedStable: reducedZero.pixels.every((value, i) => value === reducedFinal.pixels[i]),
          errors,
          diagnostics,
        };
      },
      { core, source: sources[id], id },
    );
    expect(result.middle).toBeGreaterThan(1000);
    expect(result.final).toBe(0);
    expect(result.outside).toBe(0);
    expect(result.deterministic).toBe(true);
    expect(result.timeline).toBeGreaterThan(1000);
    expect(result.reducedStable).toBe(true);
    if (id === 'text-shimmer') {
      expect(result.zero).toBe(0);
      expect(result.reduced).toBeGreaterThan(1000);
    } else {
      expect(result.zero).toBeGreaterThan(result.middle);
      expect(result.opaqueInterior).toBe(255);
      expect(result.reduced).toBe(0);
    }
    expect(result.errors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  test(`${id}: CSS transition renders over real DOM text and can replay`, async ({ page }) => {
    await page.route('**/__v2_type_css', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><style>body{margin:0;background:#11121b}#heading{margin:0;width:160px;height:80px;color:white;font:bold 60px/80px sans-serif;--hgpu-progress:0;transition:--hgpu-progress 1.2s linear}</style><h1 id="heading">GPU</h1>',
      }),
    );
    await page.goto('/__v2_type_css');
    const result = await page.evaluate(
      async ({ dom, source }) => {
        const { attach } = (await import(dom)) as typeof import('../../packages/dom/src/index.ts');
        const { default: effect } = (await import(source)) as {
          default: import('../../packages/core/src/index.ts').EffectDefinition;
        };
        const host = document.getElementById('heading')!;
        const attachment = await attach(host, effect, { layer: 'front', playing: false });
        const field = attachment.field!;
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
        const final = (await field.readPixels()).pixels.reduce(
          (sum, value, i) => sum + (i % 4 === 3 ? value : 0),
          0,
        );
        host.style.transition = 'none';
        host.style.setProperty('--hgpu-progress', '0.5');
        await new Promise((resolve) => setTimeout(resolve, 150));
        const replay = (await field.readPixels()).pixels.reduce(
          (sum, value, i) => sum + (i % 4 === 3 ? value : 0),
          0,
        );
        const errors = [...field.session.errors];
        attachment.destroy();
        return { progress, mid, finalProgress, final, replay, copy: host.textContent, errors };
      },
      { dom, source: sources[id] },
    );
    expect(Number(result.progress)).toBeGreaterThan(0.2);
    expect(Number(result.progress)).toBeLessThan(0.8);
    expect(result.mid).toBeGreaterThan(1000);
    expect(result.finalProgress).toBe(1);
    expect(result.final).toBe(0);
    expect(result.replay).toBeGreaterThan(1000);
    expect(result.copy).toBe('GPU');
    expect(result.errors).toEqual([]);
  });

  test(`${id}: settled GPU draws stop, CSS changes reactivate and then sleep`, async ({ page }) => {
    await page.route('**/__v2_type_idle', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><style>#heading{margin:0;width:160px;height:80px;font:bold 60px/80px sans-serif}</style><h1 id="heading">GPU</h1>',
      }),
    );
    await page.goto('/__v2_type_idle');
    const result = await page.evaluate(
      async ({ dom, source, id }) => {
        const { attach } = (await import(dom)) as typeof import('../../packages/dom/src/index.ts');
        const { default: effect } = (await import(source)) as {
          default: import('../../packages/core/src/index.ts').EffectDefinition;
        };
        const host = document.getElementById('heading')!;
        const attachment = await attach(host, effect, {
          layer: 'front',
          params: id === 'text-shimmer' ? { duration: 0.15 } : {},
        });
        const field = attachment.field!;
        // Allow the initial ResizeObserver/DPR mask snapshot to finish before measuring steady draws.
        await new Promise((resolve) => setTimeout(resolve, 300));
        let draws = 0,
          settled = false;
        const remove = field.onRendered(() => {
          draws++;
          if (id !== 'text-shimmer' || field.frame.time >= 0.15) settled = true;
        });
        field.reset();
        const until = async (condition: () => boolean) => {
          const end = performance.now() + 5000;
          while (!condition()) {
            if (performance.now() > end) throw new Error('Expected text draw did not occur');
            await new Promise((resolve) => requestAnimationFrame(resolve));
          }
        };
        await until(() => settled);
        const before = draws,
          timeBefore = field.frame.time;
        await new Promise((resolve) => setTimeout(resolve, 300));
        const after = draws,
          timeAfter = field.frame.time;
        host.style.setProperty('--hgpu-progress', '0.5');
        await until(() => draws > after && field.params.progress === 0.5);
        const visible = (await field.readPixels()).pixels.reduce(
          (sum, value, i) => sum + (i % 4 === 3 ? value : 0),
          0,
        );
        const replay = draws;
        await new Promise((resolve) => setTimeout(resolve, 300));
        const idle = draws;
        const errors = [...field.session.errors];
        remove();
        attachment.destroy();
        return { before, after, timeBefore, timeAfter, visible, replay, idle, errors };
      },
      { dom, source: sources[id], id },
    );
    expect(result.before).toBeGreaterThan(0);
    expect(result.after).toBe(result.before);
    expect(result.timeAfter).toBeGreaterThan(result.timeBefore);
    expect(result.visible).toBeGreaterThan(1000);
    expect(result.idle).toBe(result.replay);
    expect(result.errors).toEqual([]);
  });
}

test('text-shimmer: author hover transition can replay after returning to rest', async ({
  page,
}) => {
  await page.route('**/__v2_type_hover', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><style>body{margin:0}#heading{margin:0;width:160px;height:80px;font:bold 60px/80px sans-serif;--hgpu-progress:0;transition:--hgpu-progress 1.2s linear}#heading:hover{--hgpu-progress:1}</style><h1 id="heading">GPU</h1>',
    }),
  );
  await page.goto('/__v2_type_hover');
  await page.mouse.move(500, 500);
  await page.evaluate(
    async ({ dom, source }) => {
      const { attach } = (await import(dom)) as typeof import('../../packages/dom/src/index.ts');
      const { default: effect } = (await import(source)) as {
        default: import('../../packages/core/src/index.ts').EffectDefinition;
      };
      const attachment = await attach(document.getElementById('heading')!, effect, {
        layer: 'front',
        playing: false,
      });
      Object.assign(window, { typographyAttachment: attachment });
    },
    { dom, source: sources['text-shimmer'] },
  );
  const read = () =>
    page.evaluate(async () => {
      const attachment = (
        window as unknown as {
          typographyAttachment: import('../../packages/dom/src/index.ts').Attachment;
        }
      ).typographyAttachment;
      const field = attachment.field!;
      const alpha = (await field.readPixels()).pixels.reduce(
        (sum, value, i) => sum + (i % 4 === 3 ? value : 0),
        0,
      );
      return { progress: field.params.progress, alpha };
    });
  await page.hover('#heading');
  await page.waitForTimeout(600);
  expect((await read()).alpha).toBeGreaterThan(1000);
  await page.waitForTimeout(800);
  expect(await read()).toEqual({ progress: 1, alpha: 0 });
  await page.mouse.move(500, 500);
  await page.waitForTimeout(1400);
  expect(await read()).toEqual({ progress: 0, alpha: 0 });
  await page.hover('#heading');
  await page.waitForTimeout(600);
  expect((await read()).alpha).toBeGreaterThan(1000);
  await page.evaluate(() =>
    (
      window as unknown as {
        typographyAttachment: import('../../packages/dom/src/index.ts').Attachment;
      }
    ).typographyAttachment.destroy(),
  );
});
