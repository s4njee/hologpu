import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import type { EffectDefinition, EffectField } from '../../packages/core/src/index.ts';

const source = (path: string) => '/@fs' + fileURLToPath(new URL(path, import.meta.url));
const paths = {
  core: source('../../packages/core/src/index.ts'),
  effect: source('../../packages/effects/src/particle-drift/index.ts'),
};
type DustWindow = Window & { dust: EffectField; dustDefinition: EffectDefinition };
async function fixture(
  page: Page,
  params: Record<string, unknown> = {},
  resolutionScale: number | 'default' = 1,
) {
  await page.route('**/__v2_dust', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><style>body{margin:0;background:#16111b}canvas{width:256px;height:128px}</style><canvas></canvas>',
    }),
  );
  await page.goto('/__v2_dust');
  await page.evaluate(
    async ({ paths, params, resolutionScale }) => {
      const { createEffect } = (await import(
        paths.core
      )) as typeof import('../../packages/core/src/index.ts');
      const { default: effect } = (await import(paths.effect)) as { default: EffectDefinition };
      const field = await createEffect(document.querySelector('canvas')!, effect, {
        playing: false,
        reducedMotion: false,
        adaptiveQuality: false,
        ...(resolutionScale === 'default' ? {} : { resolutionScale }),
        params: { count: 256, ...params },
      });
      field.session.scheduler.setHidden(true);
      field.frame.pointer = [-1, -1];
      await new Promise(requestAnimationFrame);
      field.drawAt(0, 7);
      Object.assign(window, { dust: field, dustDefinition: effect });
    },
    { paths, params, resolutionScale },
  );
}
async function records(page: Page) {
  return page.evaluate(async () => {
    const f = (window as unknown as DustWindow).dust;
    const tap = f.bufferTaps.particles!,
      device = f.session.device;
    f.session.submit();
    const staging = device.createBuffer({
      size: tap.count! * tap.stride!,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    try {
      const encoder = device.createCommandEncoder();
      encoder.copyBufferToBuffer(tap.buffer, 0, staging, 0, staging.size);
      device.queue.submit([encoder.finish()]);
      await staging.mapAsync(GPUMapMode.READ);
      const values = Array.from(new Float32Array(staging.getMappedRange()));
      staging.unmap();
      return values;
    } finally {
      staging.destroy();
    }
  });
}
const hash = (value: number) => {
  let h = value >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
};
const random = (seed: number) => (hash(seed) >>> 8) / 16777216;

test('seeded dust records agree with CPU anchors, replay deterministically and stay bounded all day', async ({
  page,
}) => {
  await fixture(page, { repulsion: 0 });
  const initial = await records(page);
  for (let id = 0; id < 256; id++) {
    const h = hash(id + 7 * 65537);
    expect(initial[id * 4]).toBeCloseTo(random(h) * 0.94 + 0.03, 6);
    expect(initial[id * 4 + 1]).toBeCloseTo(random(hash(h + 1)) * 0.94 + 0.03, 6);
    expect(initial[id * 4 + 2]).toBeCloseTo(0.25 + 0.5 * random(hash(h + 2)), 6);
    expect(initial[id * 4 + 3]).toBeCloseTo(0.65 + 0.7 * random(hash(h + 3)), 6);
  }
  for (const time of [90, 86400, 2 ** 30]) {
    await page.evaluate((time) => (window as unknown as DustWindow).dust.drawAt(time, 7), time);
    const moved = await records(page);
    expect(moved.every(Number.isFinite)).toBe(true);
    let total = 0;
    for (let id = 0; id < 256; id++) {
      const dx = (moved[id * 4]! - initial[id * 4]!) * 256,
        dy = (moved[id * 4 + 1]! - initial[id * 4 + 1]!) * 128;
      expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(6.001);
      total += Math.hypot(dx, dy);
      expect(
        moved[id * 4]! >= 0 &&
          moved[id * 4]! <= 1 &&
          moved[id * 4 + 1]! >= 0 &&
          moved[id * 4 + 1]! <= 1,
      ).toBe(true);
    }
    expect(total).toBeGreaterThan(100);
    await page.evaluate((time) => {
      const f = (window as unknown as DustWindow).dust;
      f.reset(7);
      f.drawAt(time, 7);
    }, time);
    expect(await records(page)).toEqual(moved);
  }
  const result = await page.evaluate(() => {
    const f = (window as unknown as DustWindow).dust;
    const diagnostics = [...f.diagnostics],
      errors = [...f.session.errors];
    f.destroy();
    return { diagnostics, errors };
  });
  expect(result.diagnostics).toEqual([]);
  expect(result.errors).toEqual([]);
});

test('gentle pointer repulsion is radial, CSS-pixel bounded, local and reversible without trails', async ({
  page,
}) => {
  await fixture(page, { speed: 0, repulsion: 0, radius: 80 });
  const initial = await records(page);
  await page.evaluate(() => {
    const f = (window as unknown as DustWindow).dust;
    f.frame.pointer = [0.5, 0.5];
    f.store.set('repulsion', 32);
    f.drawAt(0, 7);
  });
  const pushed = await records(page);
  let near = 0,
    far = 0;
  for (let id = 0; id < 256; id++) {
    const dx = (initial[id * 4]! - 0.5) * 256,
      dy = (initial[id * 4 + 1]! - 0.5) * 128;
    const distance = Math.hypot(dx, dy),
      px = (pushed[id * 4]! - initial[id * 4]!) * 256,
      py = (pushed[id * 4 + 1]! - initial[id * 4 + 1]!) * 128;
    expect(Math.hypot(px, py)).toBeLessThanOrEqual(32.001);
    if (distance >= 80) {
      expect(pushed.slice(id * 4, id * 4 + 4)).toEqual(initial.slice(id * 4, id * 4 + 4));
      far++;
    } else if (distance > 1 && distance < 60) {
      expect(px * dx + py * dy).toBeGreaterThan(0);
      near++;
    }
  }
  expect(near).toBeGreaterThan(30);
  expect(far).toBeGreaterThan(30);
  await page.evaluate(() => {
    const f = (window as unknown as DustWindow).dust;
    f.frame.pointer = [-1, -1];
    f.drawAt(0, 7);
  });
  expect(await records(page)).toEqual(initial);
  await page.evaluate(() => (window as unknown as DustWindow).dust.destroy());
});

test('Gaussian quads stay transparent, low alpha and brand drivable at zero intensity', async ({
  page,
}) => {
  await fixture(page);
  const result = await page.evaluate(async () => {
    const w = window as unknown as DustWindow,
      f = w.dust;
    f.drawAt(0, 7);
    const normal = (await f.readPixels()).pixels;
    f.store.patch({ intensity: 0 });
    f.drawAt(50, 7);
    const invisible = (await f.readPixels()).pixels;
    const metadata = {
      features: w.dustDefinition.features,
      cssTint: w.dustDefinition.params.tint!.css,
      cssIntensity: w.dustDefinition.params.intensity!.css,
      intensity: w.dustDefinition.params.intensity!.default,
      tier: w.dustDefinition.tier,
    };
    const errors = [...f.session.errors];
    f.destroy();
    let maxAlpha = 0,
      transparent = 0,
      visible = 0;
    for (let i = 3; i < normal.length; i += 4) {
      maxAlpha = Math.max(maxAlpha, normal[i]!);
      if (normal[i] === 0) transparent++;
      else visible++;
    }
    return {
      maxAlpha,
      transparent,
      visible,
      count: normal.length / 4,
      invisible: invisible.every((value) => value === 0),
      metadata,
      errors,
    };
  });
  expect(result.visible).toBeGreaterThan(0);
  expect(result.maxAlpha).toBeLessThan(90);
  expect(result.transparent).toBeGreaterThan(result.count * 0.75);
  expect(result.invisible).toBe(true);
  expect(result.metadata).toEqual({
    features: [],
    cssTint: true,
    cssIntensity: true,
    intensity: 0.18,
    tier: 'T3',
  });
  expect(result.errors).toEqual([]);
});

test('reduced motion is the exact settled scatter for every time and pointer, and idle work sleeps', async ({
  page,
}) => {
  await fixture(page);
  const result = await page.evaluate(async () => {
    const f = (window as unknown as DustWindow).dust;
    f.setReducedMotion(true);
    f.drawAt(0, 7);
    const baseline = (await f.readPixels()).pixels;
    const frames: boolean[] = [];
    for (const [time, x, y] of [
      [100, 0.1, 0.8],
      [86400, 0.9, 0.2],
      [2 ** 30, 0.5, 0.5],
    ]) {
      f.frame.pointer = [x!, y!];
      f.drawAt(time!, 7);
      const pixels = (await f.readPixels()).pixels;
      frames.push(pixels.every((value, i) => value === baseline[i]));
    }
    f.session.scheduler.setHidden(false);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    let draws = 0;
    const remove = f.onRendered(() => draws++);
    await new Promise((resolve) => setTimeout(resolve, 180));
    remove();
    const shouldRender = f.shouldRender(),
      errors = [...f.session.errors];
    f.destroy();
    return { frames, draws, shouldRender, errors };
  });
  expect(result.frames).toEqual([true, true, true]);
  expect(result.draws).toBe(0);
  expect(result.shouldRender).toBe(false);
  expect(result.errors).toEqual([]);
});

test('count reallocations stay under 32 KiB and disposal releases every owned allocation', async ({
  page,
}) => {
  await fixture(page);
  const result = await page.evaluate(async () => {
    const f = (window as unknown as DustWindow).dust;
    const states = [];
    for (const count of [256, 2048, 512, 99999]) {
      f.store.set('count', count);
      f.drawAt(0, 7);
      const tap = f.bufferTaps.particles!;
      states.push({
        count: tap.count,
        bytes: tap.buffer.size,
        memory: f.instance!.memory!(),
        stride: tap.stride,
      });
    }
    const errors = [...f.session.errors],
      diagnostics = [...f.diagnostics];
    f.destroy();
    f.destroy();
    return { states, errors, diagnostics, memory: f.memory() };
  });
  expect(result.states.map((s) => s.count)).toEqual([256, 2048, 512, 2048]);
  for (const state of result.states) {
    expect(state.stride).toBe(16);
    expect(state.bytes).toBeLessThanOrEqual(32768);
    expect(state.memory).toEqual({ textureBytes: 0, bufferBytes: state.count! * 16 + 16 });
  }
  expect(result.memory.textureBytes).toBe(0);
  expect(result.memory.bufferBytes).toBe(0);
  expect(result.errors).toEqual([]);
  expect(result.diagnostics).toEqual([]);
});

test('soft half-resolution default preserves CSS-sized drift and pointer geometry', async ({
  page,
}) => {
  await fixture(page, { count: 256, radius: 80, repulsion: 12 }, 'default');
  await page.evaluate(() => {
    const f = (window as unknown as DustWindow).dust;
    f.frame.pointer = [0.4, 0.6];
    f.drawAt(90, 7);
  });
  const half = await records(page);
  const halfSize = await page.evaluate(() => {
    const w = window as unknown as DustWindow;
    return {
      size: [...w.dust.surface!.size],
      scale: w.dust.surface!.resolutionScale,
      dpr: w.dust.surface!.dpr,
      declared: w.dustDefinition.defaultResolutionScale,
      actualDpr: devicePixelRatio,
    };
  });
  expect(halfSize.declared).toBe(0.5);
  expect(halfSize.scale).toBe(0.5);
  expect(halfSize.dpr).toBe(halfSize.actualDpr * 0.5);
  expect(halfSize.size).toEqual([128 * halfSize.actualDpr, 64 * halfSize.actualDpr]);
  await page.evaluate(() => {
    const f = (window as unknown as DustWindow).dust;
    f.surface!.resolutionScale = 1;
    f.surface!.resize();
    f.drawAt(90, 7);
  });
  expect(await records(page)).toEqual(half);
  const fullSize = await page.evaluate(() => {
    const f = (window as unknown as DustWindow).dust;
    const size = [...f.surface!.size],
      errors = [...f.session.errors];
    f.destroy();
    return { size, errors };
  });
  expect(fullSize.size).toEqual([256 * halfSize.actualDpr, 128 * halfSize.actualDpr]);
  expect(fullSize.errors).toEqual([]);
});
