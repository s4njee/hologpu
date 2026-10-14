import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import type { EffectDefinition, EffectField } from '../../packages/core/src/index.ts';

const source = (path: string) => '/@fs' + fileURLToPath(new URL(path, import.meta.url));
const modules = {
  core: source('../../packages/core/src/index.ts'),
  effect: source('../../packages/effects/src/section-wipe/index.ts'),
  read: source('./fixtures/panel-readback.ts'),
  dom: source('../../packages/dom/src/index.ts'),
};
type WipeWindow = Window & { wipe: EffectField; identity: EffectField; destination: Float32Array };

async function fixture(page: Page, bindNext = true) {
  await page.route('**/__section_wipe', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><style>body{margin:0}canvas,#host{width:64px;height:32px}</style><canvas id="wipe"></canvas><canvas id="identity"></canvas><div id="host"></div>',
    }),
  );
  await page.goto('/__section_wipe');
  await page.evaluate(
    async ({ modules, bindNext }) => {
      const { createEffect, filterEffect } = (await import(
        modules.core
      )) as typeof import('../../packages/core/src/index.ts');
      const { default: effect } = (await import(modules.effect)) as { default: EffectDefinition };
      const field = await createEffect(document.querySelector('#wipe')!, effect, {
        playing: false,
        adaptiveQuality: false,
      });
      const identity = await createEffect(
        document.querySelector('#identity')!,
        filterEffect({
          id: 'section-wipe-identity-oracle',
          title: 'Identity',
          params: {},
          wgsl: 'fn effect(uv:vec2f)->vec4f{return sample_image(uv);}',
        }),
        { playing: false, adaptiveQuality: false },
      );
      field.session.scheduler.setHidden(true);
      const a = new Float32Array([0.08, 0, 0, 0.4]);
      const destination = new Float32Array(64 * 32 * 4);
      for (let y = 0; y < 32; y++)
        for (let x = 0; x < 64; x++) {
          const gray = x < 32 ? 0.45 : 0.05;
          // Bright straight-linear gray is 0.9 although premultiplied RGB is below 0.5.
          destination.set([gray, gray, gray, 0.5], (y * 64 + x) * 4);
        }
      const image = { kind: 'data' as const, data: a, width: 1, height: 1 };
      await field.bindInput('image', image);
      await identity.bindInput('image', image);
      if (bindNext)
        await field.bindInput('next', {
          kind: 'data',
          data: destination,
          width: 64,
          height: 32,
        });
      Object.assign(window, { wipe: field, identity, destination });
      await new Promise(requestAnimationFrame);
      field.drawAt(0, 7);
      identity.drawAt(0, 7);
    },
    { modules, bindNext },
  );
}

test('endpoints and missing destination are exact identities; reduced motion cuts at halfway', async ({
  page,
}) => {
  await fixture(page, false);
  const result = await page.evaluate(async (modules) => {
    const { readFieldLinear } = (await import(
      modules.read
    )) as typeof import('./fixtures/panel-readback.ts');
    const w = window as unknown as WipeWindow,
      field = w.wipe;
    const read = async (progress: number) => {
      field.store.set('progress', progress);
      field.drawAt(7, 11);
      return Array.from((await readFieldLinear(field)).values);
    };
    const original = Array.from((await readFieldLinear(w.identity)).values),
      missing = [];
    for (const mode of ['directional', 'noise', 'luminance']) {
      field.store.set('mode', mode);
      for (const progress of [0, 0.5, 1]) missing.push(await read(progress));
    }
    await field.bindInput('next', {
      kind: 'data',
      data: w.destination,
      width: 64,
      height: 32,
    });
    await w.identity.bindInput('image', {
      kind: 'data',
      data: w.destination,
      width: 64,
      height: 32,
    });
    w.identity.drawAt(0, 7);
    const destination = Array.from((await readFieldLinear(w.identity)).values),
      endpoints = [],
      cuts = [];
    for (const mode of ['directional', 'noise', 'luminance']) {
      field.store.set('mode', mode);
      endpoints.push([await read(0), await read(1)]);
      field.setReducedMotion(true);
      cuts.push([await read(0.499), await read(0.5), await read(0.501)]);
      field.setReducedMotion(false);
    }
    const errors = [...field.session.errors],
      diagnostics = [...field.diagnostics];
    field.destroy();
    w.identity.destroy();
    return { original, destination, missing, endpoints, cuts, errors, diagnostics };
  }, modules);
  for (const frame of result.missing) expect(frame).toEqual(result.original);
  for (const [first, last] of result.endpoints) {
    expect(first).toEqual(result.original);
    expect(last).toEqual(result.destination);
  }
  for (const [before, at, after] of result.cuts) {
    expect(before).toEqual(result.original);
    expect(at).toEqual(result.destination);
    expect(after).toEqual(result.destination);
  }
  expect(result.errors).toEqual([]);
  expect(result.diagnostics).toEqual([]);
});

test('direction and linear luminance determine reveal order; noise is still and seeded', async ({
  page,
}) => {
  await fixture(page);
  const result = await page.evaluate(async (modules) => {
    const { readFieldLinear } = (await import(
      modules.read
    )) as typeof import('./fixtures/panel-readback.ts');
    const w = window as unknown as WipeWindow,
      field = w.wipe;
    const read = async (mode: string, direction = 'right', time = 0, seed = 7) => {
      field.store.patch({ mode, direction, progress: 0.5, feather: 0 });
      field.drawAt(time, seed);
      return readFieldLinear(field);
    };
    const quadrantAlphas = (image: Awaited<ReturnType<typeof read>>) =>
      [
        [0.25, 0.25],
        [0.75, 0.25],
        [0.25, 0.75],
        [0.75, 0.75],
      ].map(
        ([x, y]) =>
          image.values[
            (Math.floor(image.height * y!) * image.width + Math.floor(image.width * x!)) * 4 + 3
          ],
      );
    const directions = [];
    for (const direction of ['right', 'down', 'left', 'up'])
      directions.push(quadrantAlphas(await read('directional', direction)));
    const luminance = quadrantAlphas(await read('luminance'));
    const noise = await read('noise'),
      repeated = await read('noise', 'right', 100),
      anotherSeed = await read('noise', 'right', 0, 23);
    const original = await readFieldLinear(w.identity);
    await w.identity.bindInput('image', {
      kind: 'data',
      data: w.destination,
      width: 64,
      height: 32,
    });
    w.identity.drawAt(0, 7);
    const destination = await readFieldLinear(w.identity);
    let finitePremultiplied = true,
      blendError = 0,
      mixed = 0,
      source = 0,
      next = 0;
    for (let i = 0; i < noise.values.length; i += 4) {
      const alpha = noise.values[i + 3]!;
      if (alpha > 0.401 && alpha < 0.499) mixed++;
      if (alpha < 0.401) source++;
      if (alpha > 0.499) next++;
      // Infer the blend from the strongest endpoint contrast. Using alpha alone
      // amplifies float16 rounding when its endpoint range is only 0.1.
      let component = 0;
      for (let c = 1; c < 4; c++)
        if (
          Math.abs(destination.values[i + c]! - original.values[i + c]!) >
          Math.abs(destination.values[i + component]! - original.values[i + component]!)
        )
          component = c;
      const delta = destination.values[i + component]! - original.values[i + component]!;
      const weight =
        delta === 0
          ? 0
          : Math.max(
              0,
              Math.min(1, (noise.values[i + component]! - original.values[i + component]!) / delta),
            );
      for (let c = 0; c < 4; c++) {
        const expected =
          original.values[i + c]! * (1 - weight) + destination.values[i + c]! * weight;
        blendError = Math.max(blendError, Math.abs(noise.values[i + c]! - expected));
        if (
          !Number.isFinite(noise.values[i + c]) ||
          noise.values[i + c]! < 0 ||
          (c < 3 && noise.values[i + c]! > alpha + 0.001)
        )
          finitePremultiplied = false;
      }
    }
    const replay = noise.values.every((value, i) => value === repeated.values[i]),
      seedChanged = noise.values.some(
        (value, i) => Math.abs(value - anotherSeed.values[i]!) > 0.01,
      ),
      errors = [...field.session.errors];
    field.destroy();
    w.identity.destroy();
    return {
      directions,
      luminance,
      replay,
      seedChanged,
      mixed,
      source,
      next,
      finitePremultiplied,
      blendError,
      errors,
    };
  }, modules);
  const expected = [
    [0.5, 0.4, 0.5, 0.4],
    [0.5, 0.5, 0.4, 0.4],
    [0.4, 0.5, 0.4, 0.5],
    [0.4, 0.4, 0.5, 0.5],
  ];
  result.directions.forEach((values, direction) =>
    values.forEach((value, i) => expect(value).toBeCloseTo(expected[direction]![i]!, 3)),
  );
  result.luminance.forEach((value, i) => expect(value).toBeCloseTo(expected[0]![i]!, 3));
  expect(result.replay && result.seedChanged && result.finitePremultiplied).toBe(true);
  expect(result.source).toBeGreaterThan(0);
  expect(result.next).toBeGreaterThan(0);
  expect(result.mixed).toBeGreaterThan(0);
  expect(result.blendError).toBeLessThan(0.001);
  expect(result.errors).toEqual([]);
});

test('destination aliases and resized output keep endpoint identity and release owned inputs', async ({
  page,
}) => {
  await fixture(page, false);
  await page.locator('canvas').evaluateAll((canvases) => {
    for (const canvas of canvases) {
      (canvas as HTMLCanvasElement).style.width = '96px';
      (canvas as HTMLCanvasElement).style.height = '48px';
    }
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const w = window as unknown as WipeWindow;
        return [w.wipe, w.identity].every(
          (field) =>
            field.frame.resolution[0] === 96 * devicePixelRatio &&
            field.frame.resolution[1] === 48 * devicePixelRatio,
        );
      }),
    )
    .toBe(true);
  const result = await page.evaluate(async (modules) => {
    const { readFieldLinear } = (await import(
      modules.read
    )) as typeof import('./fixtures/panel-readback.ts');
    const w = window as unknown as WipeWindow,
      field = w.wipe,
      source = { kind: 'data' as const, data: w.destination, width: 64, height: 32 };
    await field.bindInput('replacement', source);
    field.store.patch({ next: 'replacement', progress: 1 });
    await w.identity.bindInput('image', source);
    field.drawAt(0, 7);
    w.identity.drawAt(0, 7);
    const actual = await readFieldLinear(field),
      expected = await readFieldLinear(w.identity),
      errors = [...field.session.errors];
    field.destroy();
    w.identity.destroy();
    return {
      same: actual.values.every((value, i) => value === expected.values[i]),
      size: [actual.width, actual.height],
      ratio: devicePixelRatio,
      memory: field.memory(),
      errors,
    };
  }, modules);
  expect(result.same).toBe(true);
  expect(result.size).toEqual([96 * result.ratio, 48 * result.ratio]);
  expect(result.memory).toEqual({
    textureBytes: 0,
    bufferBytes: 0,
    profilingBytes: 0,
    shared: { entries: 0, references: 0, bytes: 0 },
  });
  expect(result.errors).toEqual([]);
});

test('CSS progress redraws the real attachment while an advancing clock leaves settled output idle', async ({
  page,
}) => {
  await fixture(page);
  const result = await page.evaluate(async (modules) => {
    const { attach } = (await import(
      modules.dom
    )) as typeof import('../../packages/dom/src/index.ts');
    const { default: effect } = (await import(modules.effect)) as { default: EffectDefinition };
    const w = window as unknown as WipeWindow;
    w.wipe.destroy();
    w.identity.destroy();
    const host = document.querySelector<HTMLDivElement>('#host')!;
    const attachment = await attach(host, effect, { playing: true, adaptiveQuality: false });
    const field = attachment.field!;
    await field.bindInput('image', {
      kind: 'data',
      data: new Float32Array([0.08, 0, 0, 0.4]),
      width: 1,
      height: 1,
    });
    await field.bindInput('next', { kind: 'data', data: w.destination, width: 64, height: 32 });
    field.session.scheduler.setHidden(false);
    await new Promise((resolve) => setTimeout(resolve, 250));
    let rendered = 0;
    const remove = field.onRendered(() => rendered++),
      start = field.frame.time;
    await new Promise((resolve) => setTimeout(resolve, 200));
    const idle = { rendered, clockAdvanced: field.frame.time > start };
    host.style.setProperty('--hgpu-progress', '1');
    for (let i = 0; i < 30 && rendered === 0; i++) await new Promise(requestAnimationFrame);
    const changed = rendered,
      progress = field.params['progress'];
    await new Promise((resolve) => setTimeout(resolve, 200));
    const settled = rendered,
      errors = [...field.session.errors];
    remove();
    attachment.destroy();
    return {
      idle,
      changed,
      progress,
      settled,
      errors,
      surfaces: field.session.scheduler.surfaceCount,
    };
  }, modules);
  expect(result.idle).toEqual({ rendered: 0, clockAdvanced: true });
  expect(result.progress).toBe(1);
  expect(result.changed).toBeGreaterThan(0);
  expect(result.settled).toBe(result.changed);
  expect(result.surfaces).toBe(0);
  expect(result.errors).toEqual([]);
});
