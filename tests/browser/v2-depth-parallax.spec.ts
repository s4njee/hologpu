import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import type { EffectDefinition, EffectField, TextureTap } from '../../packages/core/src/index.ts';
const source = (path: string) => '/@fs' + fileURLToPath(new URL(path, import.meta.url));
const paths = {
  core: source('../../packages/core/src/index.ts'),
  effect: source('../../packages/effects/src/depth-parallax/index.ts'),
  read: source('./fixtures/panel-readback.ts'),
  dom: source('../../packages/dom/src/index.ts'),
};
type DepthWindow = Window & {
  depthField: EffectField;
  plainField: EffectField;
  sourceImage: TextureTap;
  depthMap: HTMLCanvasElement;
};

async function fixture(page: Page) {
  await page.route('**/__v2_depth', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><style>body{margin:0;background:#111}canvas{width:128px;height:96px}#product{width:128px;margin:0}img{display:block;width:128px;height:96px}</style><canvas id="depth"></canvas><canvas id="plain"></canvas><div id="product"><img alt="Native product screenshot" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22128%22 height=%2296%22%3E%3Crect width=%22128%22 height=%2296%22 fill=%22%237d92aa%22/%3E%3C/svg%3E"></div>',
    }),
  );
  await page.goto('/__v2_depth');
  await page.evaluate(
    async ({ paths }) => {
      const { createEffect, filterEffect } = (await import(
        paths.core
      )) as typeof import('../../packages/core/src/index.ts');
      const { default: effect } = (await import(paths.effect)) as { default: EffectDefinition };
      const field = await createEffect(document.querySelector('#depth')!, effect, {
        playing: false,
        adaptiveQuality: false,
        params: { amount: 0.02, intensity: 1, edgeBlur: 0 },
      });
      const plain = await createEffect(
        document.querySelector('#plain')!,
        filterEffect({
          id: 'depth-reference-identity',
          title: 'Identity',
          params: {},
          wgsl: 'fn effect(uv:vec2f)->vec4f{return sample_image(uv);}',
        }),
        { playing: false, adaptiveQuality: false },
      );
      field.session.scheduler.setHidden(true);
      const width = 128,
        height = 96,
        data = new Float32Array(width * height * 4);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const alpha = x < 8 ? 0 : 0.5;
          data.set(
            [
              ((x + 0.5) / width) * alpha,
              (0.2 + (0.6 * (y + 0.5)) / height) * alpha,
              (x % 2 ? 0.9 : 0.1) * alpha,
              alpha,
            ],
            (y * width + x) * 4,
          );
        }
      const texture = field.session.device.createTexture({
        label: 'borrowed-depth-test-image',
        size: [width, height],
        format: 'rgba32float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      field.session.device.queue.writeTexture({ texture }, data, { bytesPerRow: width * 16 }, [
        width,
        height,
      ]);
      const image: TextureTap = {
        texture,
        width,
        height,
        format: 'rgba32float',
        kind: 'float',
        version: 1,
      };
      await field.bindInput('image', {
        kind: 'texture',
        source: image,
        colourSpace: 'linear',
        premultiplied: true,
      });
      await plain.bindInput('image', {
        kind: 'texture',
        source: image,
        colourSpace: 'linear',
        premultiplied: true,
      });
      const map = document.createElement('canvas');
      map.width = width;
      map.height = height;
      Object.assign(window, {
        depthField: field,
        plainField: plain,
        sourceImage: image,
        depthMap: map,
      });
      await new Promise(requestAnimationFrame);
      field.drawAt(0, 7);
      plain.drawAt(0, 7);
      field.session.submit();
    },
    { paths },
  );
}

async function bindDepth(page: Page, value: number) {
  await page.evaluate(async (value) => {
    const w = window as unknown as DepthWindow,
      painter = w.depthMap.getContext('2d')!;
    painter.fillStyle = `rgb(${value},${value},${value})`;
    painter.fillRect(0, 0, w.depthMap.width, w.depthMap.height);
    await w.depthField.bindInput('depth', { kind: 'mask', source: w.depthMap, channel: 'red' });
  }, value);
}

test('missing/black depth and reduced motion preserve the input image exactly, including alpha', async ({
  page,
}) => {
  await fixture(page);
  const initial = await page.evaluate(
    async ({ paths }) => {
      const { readFieldLinear } = (await import(
        paths.read
      )) as typeof import('./fixtures/panel-readback.ts');
      const w = window as unknown as DepthWindow;
      w.depthField.frame.pointer = [1, 0.5];
      w.depthField.drawAt(20, 7);
      w.plainField.drawAt(0, 7);
      w.depthField.session.submit();
      const plain = await readFieldLinear(w.plainField),
        missing = await readFieldLinear(w.depthField);
      return { plain: Array.from(plain.values), missing: Array.from(missing.values) };
    },
    { paths },
  );
  expect(initial.missing).toEqual(initial.plain);
  await bindDepth(page, 0);
  const black = await page.evaluate(
    async ({ paths }) => {
      const { readFieldLinear } = (await import(
        paths.read
      )) as typeof import('./fixtures/panel-readback.ts');
      const f = (window as unknown as DepthWindow).depthField;
      f.drawAt(9, 7);
      f.session.submit();
      return Array.from((await readFieldLinear(f)).values);
    },
    { paths },
  );
  expect(black).toEqual(initial.plain);
  await bindDepth(page, 255);
  const result = await page.evaluate(
    async ({ paths }) => {
      const { readFieldLinear } = (await import(
        paths.read
      )) as typeof import('./fixtures/panel-readback.ts');
      const w = window as unknown as DepthWindow,
        f = w.depthField,
        frames = [];
      for (const parameters of [
        { amount: 0, intensity: 1 },
        { amount: 0.02, intensity: 0 },
      ]) {
        f.store.patch(parameters);
        f.drawAt(5, 7);
        f.session.submit();
        frames.push(Array.from((await readFieldLinear(f)).values));
      }
      f.store.patch({ amount: 0.02, intensity: 1, mode: 'combined', progress: 1 });
      f.frame.pointer = [1, 1];
      f.setReducedMotion(true);
      f.drawAt(100, 7);
      f.session.submit();
      frames.push(Array.from((await readFieldLinear(f)).values));
      const errors = [...f.session.errors],
        diagnostics = [...f.diagnostics],
        device = f.session.device;
      f.destroy();
      const memory = f.memory();
      device.pushErrorScope('validation');
      device.queue.writeTexture(
        { texture: w.sourceImage.texture },
        new Float32Array([0.1, 0.1, 0.1, 0.5]),
        { bytesPerRow: 16 },
        [1, 1],
      );
      await device.queue.onSubmittedWorkDone();
      const borrowedError = (await device.popErrorScope())?.message ?? null;
      w.sourceImage.texture.destroy();
      w.plainField.destroy();
      return { frames, errors, diagnostics, memory, borrowedError };
    },
    { paths },
  );
  for (const values of result.frames) expect(values).toEqual(initial.plain);
  expect(result.errors).toEqual([]);
  expect(result.diagnostics).toEqual([]);
  expect(result.borrowedError).toBeNull();
  expect(result.memory.textureBytes).toBe(0);
  expect(result.memory.bufferBytes).toBe(0);
});

test('linear depth controls measured pointer and progress shifts with a two-percent width cap', async ({
  page,
}) => {
  await fixture(page);
  await bindDepth(page, 128);
  const result = await page.evaluate(
    async ({ paths }) => {
      const { readFieldLinear } = (await import(
        paths.read
      )) as typeof import('./fixtures/panel-readback.ts');
      const w = window as unknown as DepthWindow,
        f = w.depthField;
      const draw = async () => {
        f.drawAt(0, 7);
        f.session.submit();
        return readFieldLinear(f);
      };
      w.plainField.drawAt(0, 7);
      w.plainField.session.submit();
      const plain = await readFieldLinear(w.plainField);
      const centre = (Math.floor(plain.height / 2) * plain.width + Math.floor(plain.width / 2)) * 4;
      const at = (read: { values: Float32Array | Uint32Array }) =>
        Array.from(read.values.slice(centre, centre + 4));
      f.frame.pointer = [1, 0.5];
      const half = at(await draw());
      const tap = await f.readTap('input:depth');
      const painter = w.depthMap.getContext('2d')!;
      painter.fillStyle = 'white';
      painter.fillRect(0, 0, 128, 96);
      await f.bindInput('depth', { kind: 'mask', source: w.depthMap, channel: 'red' });
      const near = at(await draw());
      f.store.set('intensity', 0.25);
      const quiet = at(await draw());
      f.store.patch({ intensity: 1, mode: 'progress', progress: 1 });
      f.frame.pointer = [0, 0];
      const down = at(await draw());
      f.frame.pointer = [1, 1];
      const pointerIgnored = at(await draw());
      f.store.set('progress', 0);
      const up = at(await draw());
      f.store.patch({ mode: 'combined', progress: 1, amount: 99 });
      f.frame.pointer = [1, 1];
      const combined = at(await draw());
      const base = at(plain),
        dx = (combined[0]! - base[0]!) / 0.5,
        dy = (((combined[1]! - base[1]!) / 0.3) * plain.height) / plain.width;
      const depthFormat = f.inputTexture('depth')?.format;
      const errors = [...f.session.errors],
        diagnostics = [...f.diagnostics];
      f.destroy();
      w.sourceImage.texture.destroy();
      w.plainField.destroy();
      return {
        base,
        half,
        near,
        quiet,
        down,
        pointerIgnored,
        up,
        cap: Math.hypot(dx, dy),
        depth: tap.values[0],
        depthFormat,
        errors,
        diagnostics,
      };
    },
    { paths },
  );
  expect(result.depthFormat).toBe('r8unorm');
  expect(result.depth).toBeCloseTo(128 / 255, 3);
  expect(result.half[0]! - result.base[0]!).toBeCloseTo((0.5 * 0.02 * 128) / 255, 3);
  expect(result.near[0]! - result.base[0]!).toBeCloseTo(0.01, 3);
  expect(result.quiet[0]! - result.base[0]!).toBeCloseTo(0.0025, 3);
  expect(result.down).toEqual(result.pointerIgnored);
  expect(result.down[1]).toBeGreaterThan(result.base[1]!);
  expect(result.up[1]).toBeLessThan(result.base[1]!);
  expect(result.cap).toBeGreaterThan(0.018);
  expect(result.cap).toBeLessThanOrEqual(0.0208);
  expect(result.errors).toEqual([]);
  expect(result.diagnostics).toEqual([]);
});

test('clamp fill stays finite and premultiplied; blur affects disoccluded edges only', async ({
  page,
}) => {
  await fixture(page);
  await bindDepth(page, 255);
  const result = await page.evaluate(
    async ({ paths }) => {
      const { readFieldLinear } = (await import(
        paths.read
      )) as typeof import('./fixtures/panel-readback.ts');
      const w = window as unknown as DepthWindow,
        f = w.depthField;
      f.frame.pointer = [1, 0.5];
      f.drawAt(0, 7);
      f.session.submit();
      const clamped = await readFieldLinear(f);
      f.store.set('edgeBlur', 0.75);
      f.drawAt(0, 7);
      f.session.submit();
      const blurred = await readFieldLinear(f);
      f.drawAt(99, 7);
      f.session.submit();
      const repeat = await readFieldLinear(f);
      let interior = 0,
        edge = 0,
        premultiplied = true;
      for (let y = 0; y < blurred.height; y++)
        for (let x = 0; x < blurred.width; x++)
          for (let c = 0; c < 4; c++) {
            const i = (y * blurred.width + x) * 4 + c,
              d = Math.abs(blurred.values[i]! - clamped.values[i]!);
            if (x > blurred.width * 0.25 && x < blurred.width * 0.75)
              interior = Math.max(interior, d);
            if (x === blurred.width - 1) edge = Math.max(edge, d);
            if (
              !Number.isFinite(blurred.values[i]) ||
              blurred.values[i]! < 0 ||
              (c < 3 && blurred.values[i]! > blurred.values[i - c + 3]! + 0.001)
            )
              premultiplied = false;
          }
      const errors = [...f.session.errors],
        diagnostics = [...f.diagnostics];
      f.destroy();
      w.sourceImage.texture.destroy();
      w.plainField.destroy();
      return {
        interior,
        edge,
        premultiplied,
        replay: blurred.values.every((v, i) => v === repeat.values[i]),
        errors,
        diagnostics,
      };
    },
    { paths },
  );
  expect(result.interior).toBe(0);
  expect(result.edge).toBeGreaterThan(0.001);
  expect(result.premultiplied && result.replay).toBe(true);
  expect(result.errors).toEqual([]);
  expect(result.diagnostics).toEqual([]);
});

test('forced fallback preserves the authored image instead of displaying a fixture poster', async ({
  page,
}) => {
  await fixture(page);
  const result = await page.evaluate(
    async ({ paths }) => {
      const { attach } = (await import(
        paths.dom
      )) as typeof import('../../packages/dom/src/index.ts');
      const { default: effect } = (await import(paths.effect)) as { default: EffectDefinition };
      const host = document.querySelector<HTMLDivElement>('#product')!,
        image = host.querySelector('img')!;
      await image.decode();
      const before = image.src;
      const a = await attach(host, effect, { forceFallback: true, layer: 'front' });
      const result = {
        state: a.state,
        src: image.src,
        before,
        poster: host.shadowRoot!.querySelector<HTMLImageElement>('.hgpu-poster')!.hidden,
        opacity: getComputedStyle(image).opacity,
        visibility: getComputedStyle(image).visibility,
      };
      a.destroy();
      const w = window as unknown as DepthWindow;
      w.depthField.destroy();
      w.sourceImage.texture.destroy();
      w.plainField.destroy();
      return result;
    },
    { paths },
  );
  expect(result).toMatchObject({
    state: 'fallback',
    poster: true,
    opacity: '1',
    visibility: 'visible',
  });
  expect(result.src).toBe(result.before);
  await expect(page.getByRole('img', { name: 'Native product screenshot' })).toBeVisible();
});
