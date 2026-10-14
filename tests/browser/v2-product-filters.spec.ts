import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import type { EffectDefinition } from '../../packages/core/src/index.ts';
const core = '/@fs' + fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url));
const dom = '/@fs' + fileURLToPath(new URL('../../packages/dom/src/index.ts', import.meta.url));
const effectPath = (id: string) =>
  '/@fs' + fileURLToPath(new URL(`../../packages/effects/src/${id}/index.ts`, import.meta.url));
async function fixture(page: Page) {
  await page.route('**/__v2_product_filters', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><style>body{margin:0}canvas,#product{width:64px;height:32px}#product{--hgpu-progress:0}</style><canvas></canvas><div id="product"><img alt="Authored product" width="64" height="32"></div>',
    }),
  );
  await page.goto('/__v2_product_filters');
}

test('product sheen requires image alpha, preserves premultiplication, honors progress and settles under reduced motion', async ({
  page,
}) => {
  await fixture(page);
  const result = await page.evaluate(
    async ({ core, path }) => {
      const api = (await import(core)) as typeof import('../../packages/core/src/index.ts');
      const { default: effect } = (await import(path)) as { default: EffectDefinition };
      const field = await api.createEffect(document.querySelector('canvas')!, effect, {
        playing: false,
        reducedMotion: false,
        adaptiveQuality: false,
        params: { angle: 0, width: 0.25 },
      });
      const pose = async (time: number) => {
        field.drawAt(time);
        return api.readTextureTap(field.session.device, field.output!);
      };
      const sum = (read: Awaited<ReturnType<typeof pose>>) =>
        Array.from(read.values).reduce((s, v, i) => s + (i % 4 === 3 ? v : 0), 0);
      const missing = sum(await pose(0));
      const data = new Float32Array(64 * 32 * 4);
      for (let y = 0; y < 32; y++)
        for (let x = 0; x < 64; x++) {
          const alpha = x < 16 || x >= 48 ? 0 : x < 32 ? 0.25 : 1;
          data.set([alpha, alpha, alpha, alpha], (y * 64 + x) * 4);
        }
      await field.bindInput('image', { kind: 'data', data, width: 64, height: 32 });
      const poses = [];
      for (const progress of [0, 0.5, 1]) {
        field.params.progress = progress;
        poses.push(sum(await pose(10)));
      }
      field.params.progress = 0.5;
      const mid = await pose(0);
      const at = (x: number) =>
        Array.from(
          mid.values.slice(
            (Math.floor(mid.height / 2) * mid.width + Math.floor((x * mid.width) / 64)) * 4,
            (Math.floor(mid.height / 2) * mid.width + Math.floor((x * mid.width) / 64)) * 4 + 4,
          ),
        );
      const quarter = at(24),
        opaque = at(40),
        outside = at(4);
      const premultiplied = Array.from(mid.values).every(
        (v, i) => i % 4 === 3 || v <= mid.values[i - (i % 4) + 3]! + 0.0001,
      );
      field.params.tint = '#ff0000';
      const red = await pose(0),
        redPixel = Array.from(
          red.values.slice(
            (Math.floor(red.height / 2) * red.width + Math.floor(red.width * 0.625)) * 4,
            (Math.floor(red.height / 2) * red.width + Math.floor(red.width * 0.625)) * 4 + 4,
          ),
        );
      field.params.progress = -1;
      field.params.duration = 1.2;
      const autoMid = sum(await pose(0.6)),
        autoFinal = sum(await pose(1.2));
      field.params.progress = 0.5;
      field.setReducedMotion(true);
      const reduced = sum(await pose(0.6));
      field.setReducedMotion(false);
      field.params.intensity = 0;
      const zero = sum(await pose(0));
      const errors = [...field.session.errors],
        diagnostics = [...field.diagnostics],
        instance = field.instance!,
        memory = instance.memory!();
      field.destroy();
      return {
        missing,
        poses,
        quarter,
        opaque,
        outside,
        premultiplied,
        redPixel,
        autoMid,
        autoFinal,
        reduced,
        zero,
        errors,
        diagnostics,
        memory,
        disposed: instance.memory!(),
        tier: effect.tier,
        features: effect.features,
        intensity: effect.params.intensity!.default,
        css: effect.params.progress!.css && effect.params.tint!.css && effect.params.intensity!.css,
      };
    },
    { core, path: effectPath('product-sheen') },
  );
  expect(result.missing).toBe(0);
  expect(result.poses[0]).toBe(0);
  expect(result.poses[1]).toBeGreaterThan(10);
  expect(result.poses[2]).toBe(0);
  expect(result.outside).toEqual([0, 0, 0, 0]);
  expect(result.quarter[3]! / result.opaque[3]!).toBeCloseTo(0.25, 1);
  expect(result.premultiplied).toBe(true);
  expect(result.redPixel[0]).toBeCloseTo(result.redPixel[3]!, 3);
  expect(result.redPixel[1]).toBe(0);
  expect(result.redPixel[2]).toBe(0);
  expect(result.autoMid).toBeGreaterThan(10);
  expect(result.autoFinal).toBe(0);
  expect(result.reduced).toBe(0);
  expect(result.zero).toBe(0);
  expect(result.memory).toEqual({ textureBytes: 4, bufferBytes: 0 });
  expect(result.disposed).toEqual({ textureBytes: 0, bufferBytes: 0 });
  expect(result.tier).toBe('T1');
  expect(result.features).toEqual([]);
  expect(result.intensity).toBeLessThanOrEqual(0.3);
  expect(result.css).toBe(true);
  expect(result.errors).toEqual([]);
  expect(result.diagnostics).toEqual([]);
});

test('bright-pass selects linear luminance rather than max RGB, preserves HDR/alpha and uses optional scalar author mask', async ({
  page,
}) => {
  await fixture(page);
  const result = await page.evaluate(
    async ({ core, path }) => {
      const api = (await import(core)) as typeof import('../../packages/core/src/index.ts');
      const { default: effect } = (await import(path)) as { default: EffectDefinition };
      const field = await api.createEffect(document.querySelector('canvas')!, effect, {
        playing: false,
        reducedMotion: false,
        adaptiveQuality: false,
        params: { threshold: 0.5, softness: 0, intensity: 1 },
      });
      const colours = [
        [1, 0, 0, 1],
        [0, 1, 0, 1],
        [0.25, 0.25, 0.25, 0.25],
        [2, 2, 2, 0.5],
      ];
      const data = new Float32Array(64 * 32 * 4);
      for (let y = 0; y < 32; y++)
        for (let x = 0; x < 64; x++) data.set(colours[Math.floor(x / 16)]!, (y * 64 + x) * 4);
      await field.bindInput('image', { kind: 'data', data, width: 64, height: 32 });
      const pose = async () => {
        field.drawAt(0);
        return api.readTextureTap(field.session.device, field.output!);
      };
      const selected = await pose();
      const samples = (read: typeof selected) =>
        [8, 24, 40, 56].map((x) =>
          Array.from(
            read.values.slice(
              (Math.floor(read.height / 2) * read.width + Math.floor((x * read.width) / 64)) * 4,
              (Math.floor(read.height / 2) * read.width + Math.floor((x * read.width) / 64)) * 4 +
                4,
            ),
          ),
        );
      const unmasked = samples(selected);
      const mask = document.createElement('canvas');
      mask.width = 64;
      mask.height = 32;
      const painter = mask.getContext('2d')!;
      painter.fillStyle = 'rgba(255,255,255,.5)';
      painter.fillRect(0, 0, 32, 32);
      await field.bindInput('mask', { kind: 'mask', source: mask });
      const masked = samples(await pose());
      await field.bindInput('mask', null);
      const removed = samples(await pose());
      field.params.threshold = 1;
      const high = samples(await pose());
      field.params.softness = 0.2;
      const soft = samples(await pose());
      field.params.threshold = 0.5;
      field.params.softness = 0;
      field.params.intensity = 0.25;
      const quiet = samples(await pose());
      field.setReducedMotion(true);
      const reduced = samples(await pose());
      field.params.intensity = 0;
      const zero = Array.from((await pose()).values).every((v) => v === 0);
      const errors = [...field.session.errors],
        diagnostics = [...field.diagnostics],
        instance = field.instance!,
        memory = instance.memory!();
      field.destroy();
      return {
        unmasked,
        masked,
        removed,
        high,
        soft,
        quiet,
        reduced,
        zero,
        errors,
        diagnostics,
        memory,
        disposed: instance.memory!(),
        features: effect.features,
        tier: effect.tier,
        intensity: effect.params.intensity!.default,
        maskType: effect.params.mask!.type,
      };
    },
    { core, path: effectPath('bright-pass') },
  );
  expect(result.unmasked[0]).toEqual([0, 0, 0, 0]);
  expect(result.unmasked[1]).toEqual([0, 1, 0, 1]);
  expect(result.unmasked[2]).toEqual([0.25, 0.25, 0.25, 0.25]);
  expect(result.unmasked[3]).toEqual([2, 2, 2, 0.5]);
  expect(result.masked[1]![3]).toBeCloseTo(0.5, 2);
  expect(result.masked[1]![1]).toBeCloseTo(0.5, 2);
  expect(result.masked[2]).toEqual([0, 0, 0, 0]);
  expect(result.masked[3]).toEqual([0, 0, 0, 0]);
  expect(result.removed).toEqual(result.unmasked);
  expect(result.high[1]).toEqual([0, 0, 0, 0]);
  expect(result.high[2]).toEqual([0.25, 0.25, 0.25, 0.25]);
  expect(result.soft[2]![3]).toBeCloseTo(0.125, 3);
  expect(result.soft[3]).toEqual([2, 2, 2, 0.5]);
  expect(result.quiet[3]).toEqual([0.5, 0.5, 0.5, 0.125]);
  expect(result.reduced).toEqual(result.quiet);
  expect(result.zero).toBe(true);
  expect(result.tier).toBe('T4');
  expect(result.features).toEqual([]);
  expect(result.intensity).toBeLessThanOrEqual(0.3);
  expect(result.maskType).toBe('texture');
  expect(result.memory.textureBytes).toBe(64 * 64 * 16 + 1);
  expect(result.disposed).toEqual({ textureBytes: 0, bufferBytes: 0 });
  expect(result.errors).toEqual([]);
  expect(result.diagnostics).toEqual([]);
});

test('product sheen CSS progress drives the actual attachment and fallback retains the authored image', async ({
  page,
}) => {
  await fixture(page);
  const result = await page.evaluate(
    async ({ core, dom, path }) => {
      const { attach } = (await import(dom)) as typeof import('../../packages/dom/src/index.ts');
      const { default: effect } = (await import(path)) as { default: EffectDefinition };
      const host = document.getElementById('product')!,
        image = host.querySelector('img')!;
      const alpha = document.createElement('canvas');
      alpha.width = 64;
      alpha.height = 32;
      const paint = alpha.getContext('2d')!;
      paint.fillStyle = 'white';
      paint.fillRect(0, 0, 32, 32);
      const bitmap = await createImageBitmap(alpha);
      const attachment = await attach(host, effect, {
        layer: 'front',
        playing: false,
        reducedMotion: false,
        adaptiveQuality: false,
      });
      const field = attachment.field!;
      await field.bindInput('image', { kind: 'image', source: bitmap });
      const wait = async (progress: number) => {
        const deadline = performance.now() + 5000;
        while (Number(field.params.progress) !== progress) {
          if (performance.now() > deadline) throw new Error('CSS progress bridge timed out');
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      };
      host.style.setProperty('--hgpu-progress', '.5');
      await wait(0.5);
      const mid = (await field.readPixels()).pixels.some((v, i) => i % 4 === 3 && v > 0);
      host.style.setProperty('--hgpu-progress', '1');
      await wait(1);
      const final = (await field.readPixels()).pixels.every((v) => v === 0);
      const errors = [...field.session.errors];
      attachment.destroy();
      bitmap.close();
      const fallback = await attach(host, effect, { forceFallback: true, layer: 'front' });
      const posterHidden = host.shadowRoot!.querySelector<HTMLImageElement>('img')!.hidden;
      const copy = image.alt,
        imageSame = host.querySelector('img') === image;
      fallback.destroy();
      return { mid, final, errors, posterHidden, copy, imageSame };
    },
    { core, dom, path: effectPath('product-sheen') },
  );
  expect(result.mid).toBe(true);
  expect(result.final).toBe(true);
  expect(result.posterHidden).toBe(true);
  expect(result.imageSame).toBe(true);
  expect(result.copy).toBe('Authored product');
  expect(result.errors).toEqual([]);
});
