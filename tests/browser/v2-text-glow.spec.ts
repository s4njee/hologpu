import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import type { EffectField, TextureTap } from '../../packages/core/src/index.ts';

const core = '/@fs' + fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url));
const effect =
  '/@fs' +
  fileURLToPath(new URL('../../packages/effects/src/text-outline-glow/index.ts', import.meta.url));
type GlowWindow = Window & {
  glow: EffectField;
  mask: TextureTap & { version: number };
  masks: GPUTexture[];
  jfaPasses: number;
  restoreEncoder: () => void;
  paintMask: (x: number, layer?: number) => void;
};

async function fixture(page: Page) {
  await page.route('**/__v2_text_glow', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><style>body{margin:0;background:#11121b}canvas{width:240px;height:120px}</style><canvas></canvas>',
    }),
  );
  await page.goto('/__v2_text_glow');
  await page.evaluate(
    async ({ core, effect }) => {
      const { createEffect } = (await import(
        core
      )) as typeof import('../../packages/core/src/index.ts');
      const { default: definition } = (await import(effect)) as { default: EffectField['effect'] };
      const w = window as unknown as GlowWindow;
      const field = await createEffect(document.querySelector('canvas')!, definition, {
        playing: false,
        adaptiveQuality: false,
      });
      w.glow = field;
      field.session.scheduler.setHidden(true);
      field.visible = true;
      const device = field.session.device;
      const original = device.createCommandEncoder.bind(device);
      w.jfaPasses = 0;
      // Count actual compute encodes, without requiring optional timestamp-query support.
      device.createCommandEncoder = (descriptor) => {
        const encoder = original(descriptor);
        const begin = encoder.beginComputePass.bind(encoder);
        encoder.beginComputePass = (descriptor) => {
          if (descriptor?.label?.startsWith('jfa-')) w.jfaPasses++;
          return begin(descriptor);
        };
        return encoder;
      };
      w.restoreEncoder = () => {
        device.createCommandEncoder = original;
      };
      const texture = device.createTexture({
        size: [64, 32, 2],
        format: 'rgba8unorm',
        usage:
          GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
      });
      w.masks = [texture];
      w.mask = {
        texture,
        width: 64,
        height: 32,
        format: 'rgba8unorm',
        kind: 'float',
        arrayLayer: 0,
        version: 1,
      };
      w.paintMask = (x, layer = 0) => {
        const bytes = new Uint8Array(64 * 32 * 4);
        for (let y = 9; y < 23; y++)
          for (let column = x; column < x + 10; column++)
            bytes.fill(255, (y * 64 + column) * 4, (y * 64 + column) * 4 + 4);
        device.queue.writeTexture(
          { texture, origin: [0, 0, layer] },
          bytes,
          { bytesPerRow: 64 * 4 },
          [64, 32],
        );
      };
      w.paintMask(8, 0);
      w.paintMask(40, 1);
      await field.bindInput('text', {
        kind: 'texture',
        source: () => w.mask,
        colourSpace: 'linear',
        premultiplied: true,
      });
    },
    { core, effect },
  );
}

async function cleanup(page: Page) {
  return page.evaluate(async () => {
    const w = window as unknown as GlowWindow,
      field = w.glow,
      session = field.session;
    await session.device.queue.onSubmittedWorkDone();
    const errors = [...session.errors],
      diagnostics = [...field.diagnostics];
    w.restoreEncoder();
    w.masks.forEach((mask) => mask.destroy());
    field.destroy();
    field.destroy();
    return {
      errors,
      diagnostics,
      memory: field.memory(),
      taps: Object.keys(field.textureTaps),
      clients: session.clients,
      state: field.state,
      device: session.state,
    };
  });
}

test('text glow caches actual JFA work across time, styling and render-resolution changes', async ({
  page,
}) => {
  await fixture(page);
  const result = await page.evaluate(async () => {
    const w = window as unknown as GlowWindow,
      field = w.glow;
    field.drawAt(0, 7);
    const firstCount = w.jfaPasses,
      firstTap = field.textureTaps['distance']!;
    const distance = await field.readTap('distance');
    for (let i = 1; i <= 6; i++) field.drawAt(i * 9, 7);
    field.store.patch({ mode: 'both', tint: '#eba477', width: 2, glow: 10, intensity: 0.25 });
    field.reset(31);
    field.drawAt(64, 31);
    field.setResolutionScale(0.5);
    field.drawAt(70, 31);
    document.querySelector('canvas')!.style.width = '320px';
    document.querySelector('canvas')!.style.height = '160px';
    field.surface!.resize();
    field.drawAt(80, 31);
    const pixels = (await field.readPixels()).pixels;
    return {
      firstCount,
      finalCount: w.jfaPasses,
      sameTexture: firstTap.texture === field.textureTaps['distance']!.texture,
      firstVersion: firstTap.version,
      finalVersion: field.textureTaps['distance']!.version,
      dimensions: [distance.width, distance.height],
      negative: Array.from(distance.values).some((value) => value < 0),
      positive: Array.from(distance.values).some((value) => value > 0),
      visible: pixels.some((value, index) => index % 4 === 3 && value > 0),
    };
  });
  expect(result.firstCount).toBeGreaterThan(2);
  expect(result.finalCount).toBe(result.firstCount);
  expect(result.sameTexture).toBe(true);
  expect(result.firstVersion).toBe(1);
  expect(result.finalVersion).toBe(1);
  expect(result.dimensions).toEqual([64, 32]);
  expect(result.negative && result.positive && result.visible).toBe(true);
  const disposed = await cleanup(page);
  expect(disposed.errors).toEqual([]);
  expect(disposed.diagnostics).toEqual([]);
  expect(disposed.memory.textureBytes).toBe(0);
  expect(disposed.memory.bufferBytes).toBe(0);
  expect(disposed.taps).toEqual([]);
  expect(disposed.clients).toBe(0);
  expect(disposed.state).toBe('disposed');
  expect(disposed.device).toBe('closed');
});

test('text glow invalidates same-texture uploads, array subresources and resized masks', async ({
  page,
}) => {
  await fixture(page);
  const result = await page.evaluate(async () => {
    const w = window as unknown as GlowWindow,
      field = w.glow,
      device = field.session.device;
    field.drawAt(0, 7);
    const initialCount = w.jfaPasses;
    const input = field.textureTaps['input:text']!.texture;
    const first = (await field.readTap('distance')).values;
    w.paintMask(28);
    w.mask.version++;
    field.drawAt(0, 7);
    const uploadedCount = w.jfaPasses;
    const second = (await field.readTap('distance')).values;
    const inputReused = input === field.textureTaps['input:text']!.texture;
    field.drawAt(12, 7);
    const repeatedCount = w.jfaPasses;
    w.mask = { ...w.mask, arrayLayer: 1 };
    field.drawAt(12, 7);
    const layeredCount = w.jfaPasses;
    const third = (await field.readTap('distance')).values;
    const resized = device.createTexture({
      size: [32, 32],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
    });
    w.masks.push(resized);
    const bytes = new Uint8Array(32 * 32 * 4);
    for (let y = 8; y < 24; y++)
      for (let x = 8; x < 24; x++) bytes.fill(255, (y * 32 + x) * 4, (y * 32 + x) * 4 + 4);
    device.queue.writeTexture({ texture: resized }, bytes, { bytesPerRow: 128 }, [32, 32]);
    w.mask = {
      texture: resized,
      width: 32,
      height: 32,
      format: 'rgba8unorm',
      kind: 'float',
      version: 1,
    };
    field.drawAt(14, 7);
    const final = field.textureTaps['distance']!;
    // The runtime/effect must not destroy the old caller-owned mask when its input changes.
    device.pushErrorScope('validation');
    w.paintMask(8);
    await device.queue.onSubmittedWorkDone();
    const borrowedError = await device.popErrorScope();
    return {
      initialCount,
      uploadedCount,
      repeatedCount,
      layeredCount,
      finalCount: w.jfaPasses,
      inputReused,
      uploadChanged: first.some((value, i) => value !== second[i]),
      layerChanged: second.some((value, i) => value !== third[i]),
      dimensions: [final.width, final.height],
      version: final.version,
      borrowedError: borrowedError?.message ?? null,
    };
  });
  expect(result.initialCount).toBeGreaterThan(2);
  expect(result.uploadedCount).toBeGreaterThan(result.initialCount);
  expect(result.repeatedCount).toBe(result.uploadedCount);
  expect(result.layeredCount).toBeGreaterThan(result.repeatedCount);
  expect(result.finalCount).toBeGreaterThan(result.layeredCount);
  expect(result.inputReused && result.uploadChanged && result.layerChanged).toBe(true);
  expect(result.dimensions).toEqual([32, 32]);
  expect(result.version).toBe(4);
  expect(result.borrowedError).toBeNull();
  const disposed = await cleanup(page);
  expect(disposed.errors).toEqual([]);
  expect(disposed.diagnostics).toEqual([]);
});

test('text glow reduced-motion pose stays fixed and intensity zero is transparent', async ({
  page,
}) => {
  await fixture(page);
  const result = await page.evaluate(async () => {
    const w = window as unknown as GlowWindow,
      field = w.glow;
    field.store.patch({ breathing: 0.15, pointerStrength: 0.2 });
    field.setReducedMotion(true);
    const sums = [];
    let frozen = true;
    for (const mode of ['glow', 'outline', 'both']) {
      field.store.set('mode', mode);
      field.frame.pointer = [0, 0];
      field.drawAt(0, 7);
      const first = (await field.readPixels()).pixels;
      field.frame.pointer = [0.5, 0.5];
      field.drawAt(40, 7);
      const second = (await field.readPixels()).pixels;
      frozen &&= first.every((value, i) => value === second[i]);
      sums.push(first.reduce((sum, value) => sum + value, 0));
    }
    const passes = w.jfaPasses;
    field.store.set('intensity', 0);
    field.drawAt(44, 7);
    const pixels = (await field.readPixels()).pixels;
    return {
      frozen,
      sums,
      transparent: pixels.every((value) => value === 0),
      cached: passes === w.jfaPasses,
      version: field.textureTaps['distance']!.version,
      reducedMotion: field.reducedMotion,
    };
  });
  expect(result.frozen && result.transparent && result.cached && result.reducedMotion).toBe(true);
  expect(new Set(result.sums).size).toBe(3);
  expect(result.version).toBe(1);
  const disposed = await cleanup(page);
  expect(disposed.errors).toEqual([]);
  expect(disposed.diagnostics).toEqual([]);
});
