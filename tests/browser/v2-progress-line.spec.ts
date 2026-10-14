import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const path = (value: string) => '/@fs' + fileURLToPath(new URL(value, import.meta.url));
const modules = {
  core: path('../../packages/core/src/index.ts'),
  dom: path('../../packages/dom/src/index.ts'),
  line: path('../../packages/effects/src/progress-line/index.ts'),
};
async function fixture(page: Page) {
  await page.route('**/__v2_progress_line', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><style>body{margin:0}canvas,#host{display:block;width:200px;height:100px}</style><canvas></canvas><div id="host">Native steps</div>',
    }),
  );
  await page.goto('/__v2_progress_line');
}

test('Progress follows CSS-pixel arc length, endpoint caps and safe degenerate segments', async ({
  page,
}) => {
  await fixture(page);
  const result = await page.evaluate(async ({ core, line }) => {
    const { createEffect } = (await import(
      core
    )) as typeof import('../../packages/core/src/index.ts');
    const { default: effect, progressLinePath } = (await import(
      line
    )) as typeof import('../../packages/effects/src/progress-line/index.ts');
    const field = await createEffect(document.querySelector('canvas')!, effect, {
      playing: false,
      adaptiveQuality: false,
      params: {
        pointCount: 3,
        p0: [0.1, 0.2],
        p1: [0.8, 0.2],
        p2: [0.8, 0.8],
        width: 4,
        intensity: 1,
        headGlow: 0,
      },
    });
    field.session.scheduler.setHidden(true);
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
    const read = async (progress: number) => {
      field.params.progress = progress;
      field.drawAt(9, 7);
      return field.readPixels();
    };
    const sample = (pixels: Awaited<ReturnType<typeof read>>, x: number, y: number) =>
      pixels.pixels[
        (Math.floor((y / 100) * pixels.height) * pixels.width +
          Math.floor((x / 200) * pixels.width)) *
          4 +
          3
      ]!;
    const empty = await read(0),
      half = await read(0.5),
      turn = await read(0.75),
      full = await read(1);
    const fallback = progressLinePath(200, 100, field.params);
    field.store.patch({ pointCount: 3, p0: [0.1, 0.5], p1: [0.1, 0.5], p2: [0.9, 0.5] });
    const repeated = await read(0.5);
    field.store.patch({ p2: [0.1, 0.5] });
    const zeroLength = await read(1);
    const degeneratePath = progressLinePath(200, 100, field.params);
    const errors = [...field.session.errors],
      diagnostics = [...field.diagnostics];
    field.destroy();
    return {
      empty: Math.max(...empty.pixels.filter((_v, i) => i % 4 === 3)),
      halfInside: sample(half, 116, 20),
      halfAfter: sample(half, 126, 20),
      halfUnreachedTurn: sample(half, 160, 20),
      turnInside: sample(turn, 160, 27),
      turnAfter: sample(turn, 160, 36),
      fullEnd: sample(full, 160, 80),
      fullOutside: sample(full, 165, 80),
      repeatedInside: sample(repeated, 96, 50),
      repeatedAfter: sample(repeated, 107, 50),
      zeroLength: Math.max(...zeroLength.pixels.filter((_v, i) => i % 4 === 3)),
      fallback,
      degeneratePath,
      errors,
      diagnostics,
    };
  }, modules);
  expect(result.empty).toBe(0);
  expect(result.halfInside).toBeGreaterThan(240);
  expect(result.halfAfter).toBe(0);
  expect(result.halfUnreachedTurn).toBe(0);
  expect(result.turnInside).toBeGreaterThan(240);
  expect(result.turnAfter).toBe(0);
  expect(result.fullEnd).toBeGreaterThan(240);
  expect(result.fullOutside).toBe(0);
  expect(result.repeatedInside).toBeGreaterThan(240);
  expect(result.repeatedAfter).toBe(0);
  expect(result.zeroLength).toBe(0);
  expect(result.fallback).toBe('M20 20 L160 20 L160 80');
  expect(result.degeneratePath).toBe('');
  expect(result.errors).toEqual([]);
  expect(result.diagnostics).toEqual([]);
});

test('Stroke and bounded head use CSS pixels at DPR1/2; reduced motion preserves the authored step', async ({
  page,
}) => {
  await fixture(page);
  const result = await page.evaluate(async ({ core, line }) => {
    const { createEffect } = (await import(
      core
    )) as typeof import('../../packages/core/src/index.ts');
    const { default: effect } = (await import(
      line
    )) as typeof import('../../packages/effects/src/progress-line/index.ts');
    const field = await createEffect(document.querySelector('canvas')!, effect, {
      playing: false,
      adaptiveQuality: false,
      resolutionScale: 1,
      params: {
        pointCount: 2,
        p0: [0.1, 0.5],
        p1: [0.9, 0.5],
        width: 2,
        headGlow: 6,
        intensity: 1,
        progress: 0.5,
      },
    });
    field.session.scheduler.setHidden(true);
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
    field.drawAt(0, 7);
    const normal = await field.readPixels();
    field.setReducedMotion(true);
    field.drawAt(100, 7);
    const reduced = await field.readPixels();
    const alpha = (pixels: typeof normal, x: number, y: number) =>
      pixels.pixels[
        (Math.floor((y / 100) * pixels.height) * pixels.width +
          Math.floor((x / 200) * pixels.width)) *
          4 +
          3
      ]!;
    const bounds = {
      center: alpha(normal, 50, 50),
      outside: alpha(normal, 50, 53),
      head: alpha(normal, 104, 50),
      beyond: alpha(normal, 108, 50),
    };
    field.params.progress = 1;
    field.drawAt(0, 7);
    const full = await field.readPixels();
    const finalNoGlow = alpha(full, 184, 50);
    const errors = [...field.session.errors];
    field.destroy();
    return {
      bounds,
      finalNoGlow,
      same: normal.pixels.every((value, i) => value === reduced.pixels[i]),
      width: normal.width,
      height: normal.height,
      dpr: devicePixelRatio,
      errors,
    };
  }, modules);
  expect(result.width).toBe(200 * result.dpr);
  expect(result.height).toBe(100 * result.dpr);
  expect(result.bounds.center).toBeGreaterThan(190);
  expect(result.bounds.outside).toBe(0);
  expect(result.bounds.head).toBeGreaterThan(0);
  expect(result.bounds.beyond).toBe(0);
  expect(result.finalNoGlow).toBe(0);
  expect(result.same).toBe(true);
  expect(result.errors).toEqual([]);
});

test('CSS progress remains responsive while the playing field skips unchanged draws', async ({
  page,
}) => {
  await fixture(page);
  const result = await page.evaluate(async ({ dom, line }) => {
    const { attach } = (await import(dom)) as typeof import('../../packages/dom/src/index.ts');
    const { default: effect } = (await import(
      line
    )) as typeof import('../../packages/effects/src/progress-line/index.ts');
    const host = document.getElementById('host')!;
    host.style.setProperty('--hgpu-progress', '0');
    host.style.setProperty('--hgpu-width', '2');
    const attachment = await attach(host, effect, {
      layer: 'front',
      playing: true,
      reducedMotion: false,
    });
    const field = attachment.field!;
    let draws = 0;
    field.onRendered(() => draws++);
    const wait = (duration: number) => new Promise((resolve) => setTimeout(resolve, duration));
    const waitFor = async (predicate: () => boolean) => {
      const deadline = performance.now() + 5000;
      while (!predicate() && performance.now() < deadline) await wait(33);
      if (!predicate()) throw new Error('CSS progress-line update did not arrive');
    };
    const settle = async () => {
      const deadline = performance.now() + 5000;
      let previous = draws;
      let unchangedSince = performance.now();
      while (performance.now() < deadline) {
        await wait(50);
        if (draws !== previous) {
          previous = draws;
          unchangedSince = performance.now();
        }
        if (performance.now() - unchangedSince >= 200) return true;
      }
      return false;
    };
    await waitFor(() => field.params.progress === 0 && field.params.width === 2);
    await field.session.device.queue.onSubmittedWorkDone();
    const initiallySettled = await settle();
    const before = draws;
    await wait(250);
    const idle = initiallySettled && draws === before;
    host.style.setProperty('--hgpu-progress', '.5');
    host.style.setProperty('--hgpu-tint', '#ff8060');
    await waitFor(() => field.params.progress === 0.5);
    const progress = field.params.progress,
      width = field.params.width,
      changed = draws > before;
    const pixels = await field.readPixels();
    const visible = pixels.pixels.some((value, i) => i % 4 === 3 && value > 0);
    await field.session.device.queue.onSubmittedWorkDone();
    const changedSettled = await settle();
    const settledDraws = draws;
    await wait(250);
    const settled = changedSettled && draws === settledDraws;
    const errors = [...field.session.errors];
    attachment.destroy();
    return { idle, progress, width, changed, visible, settled, copy: host.textContent, errors };
  }, modules);
  expect(result.idle).toBe(true);
  expect(result.progress).toBe(0.5);
  expect(result.width).toBe(2);
  expect(result.changed).toBe(true);
  expect(result.visible).toBe(true);
  expect(result.settled).toBe(true);
  expect(result.copy).toBe('Native steps');
  expect(result.errors).toEqual([]);
});
