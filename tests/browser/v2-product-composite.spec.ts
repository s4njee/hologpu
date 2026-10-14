import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const path = (value: string) => '/@fs' + fileURLToPath(new URL(value, import.meta.url));
const modules = {
  core: path('../../packages/core/src/index.ts'),
  composite: path('../../packages/effects/src/masked-composite/index.ts'),
  map: path('../../packages/effects/src/pointer-map/index.ts'),
  displace: path('../../packages/effects/src/displace/index.ts'),
  read: path('./fixtures/panel-readback.ts'),
};
async function fixture(page: Page) {
  await page.route('**/__v2_product_composite', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><style>body{margin:0}canvas{display:block;width:96px;height:64px}</style><canvas id="image"></canvas><canvas id="map"></canvas><canvas id="filtered"></canvas><canvas id="composite"></canvas>',
    }),
  );
  await page.goto('/__v2_product_composite');
}

test('Composite mixes linear premultiplied alpha through canonical masks and explicit channels', async ({
  page,
}) => {
  await fixture(page);
  const result = await page.evaluate(async (modules) => {
    const { createEffect } = (await import(
      modules.core
    )) as typeof import('../../packages/core/src/index.ts');
    const { default: effect } = (await import(modules.composite)) as {
      default: import('../../packages/core/src/index.ts').EffectDefinition;
    };
    const { readFieldLinear } = (await import(
      modules.read
    )) as typeof import('./fixtures/panel-readback.ts');
    const field = await createEffect(document.querySelector('#composite')!, effect, {
      playing: false,
    });
    field.session.scheduler.setHidden(true);
    const original = [0.1, 0.05, 0.025, 0.25],
      filtered = [0.2, 0.4, 0.1, 0.5];
    const data = (values: number[]) => ({
      kind: 'data' as const,
      data: new Float32Array(values),
      width: 1,
      height: 1,
    });
    await field.bindInput('image', data(original));
    await field.bindInput('filtered', data(filtered));
    const read = async (blend: number) => {
      field.params['blend'] = blend;
      field.drawAt(0, 7);
      return readFieldLinear(field);
    };
    const rgba = (pixels: Awaited<ReturnType<typeof read>>, u: number) =>
      Array.from(
        pixels.values.slice(
          (Math.floor(pixels.height / 2) * pixels.width + Math.floor(pixels.width * u)) * 4,
          (Math.floor(pixels.height / 2) * pixels.width + Math.floor(pixels.width * u)) * 4 + 4,
        ),
      );
    const full = await read(1),
      zero = await read(0);
    const mask = document.createElement('canvas');
    mask.width = 96;
    mask.height = 64;
    const painter = mask.getContext('2d')!;
    painter.fillStyle = 'rgb(255 255 255 / 50%)';
    painter.fillRect(0, 0, 48, 64);
    await field.bindInput('mask', { kind: 'mask', source: mask, channel: 'alpha' });
    const masked = await read(1),
      half = await read(0.5);
    const maskTap = field.inputTexture('mask')!;
    // Legacy premultiplied RGBA masks can select alpha or luminance explicitly.
    await field.bindInput('mask', data([0.25, 0, 0, 0.5]));
    field.params['maskChannel'] = 'alpha';
    const legacyAlpha = await read(1);
    field.params['maskChannel'] = 'luminance';
    const legacyLuma = await read(1);
    const diagnostics = [...field.diagnostics],
      errors = [...field.session.errors];
    const boundBytes = field.memory().textureBytes;
    await field.bindInput('mask', null);
    await field.bindInput('filtered', null);
    field.params['maskChannel'] = 'red';
    const identity = await read(1);
    const releasedBytes = field.memory().textureBytes;
    field.destroy();
    return {
      original,
      filtered,
      full: rgba(full, 0.25),
      zero: rgba(zero, 0.25),
      masked: rgba(masked, 0.25),
      outside: rgba(masked, 0.75),
      half: rgba(half, 0.25),
      legacyAlpha: rgba(legacyAlpha, 0.25),
      legacyLuma: rgba(legacyLuma, 0.25),
      identity: rgba(identity, 0.25),
      maskFormat: maskTap.format,
      released: releasedBytes < boundBytes,
      errors,
      diagnostics,
    };
  }, modules);
  const matches = (actual: number[], expected: number[]) =>
    actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 3));
  const mix = (weight: number) =>
    result.original.map((value, i) => value + (result.filtered[i]! - value) * weight);
  matches(result.full, result.filtered);
  matches(result.zero, result.original);
  matches(result.masked, mix(128 / 255));
  matches(result.half, mix((128 / 255) * 0.5));
  matches(result.outside, result.original);
  matches(result.legacyAlpha, mix(0.5));
  matches(result.legacyLuma, mix(0.25 * 0.2126));
  matches(result.identity, result.original);
  expect(result.maskFormat).toBe('r8unorm');
  expect(result.released).toBe(true);
  expect(result.errors).toEqual([]);
  expect(result.diagnostics).toEqual([]);
});

test('Neutral normal and flow maps preserve displacement; reduced motion returns neutral data', async ({
  page,
}) => {
  await fixture(page);
  const result = await page.evaluate(async (modules) => {
    const { createEffect, fragmentEffect } = (await import(
      modules.core
    )) as typeof import('../../packages/core/src/index.ts');
    const { default: pointerMap } = (await import(modules.map)) as {
      default: import('../../packages/core/src/index.ts').EffectDefinition;
    };
    const { default: displace } = (await import(modules.displace)) as {
      default: import('../../packages/core/src/index.ts').EffectDefinition;
    };
    const { readFieldLinear } = (await import(
      modules.read
    )) as typeof import('./fixtures/panel-readback.ts');
    const image = await createEffect(
      document.querySelector('#image')!,
      fragmentEffect({
        id: 'product-ramp',
        title: 'Linear product ramp',
        params: {},
        wgsl: 'fn effect(uv:vec2f)->vec4f{return vec4f(uv.x*0.5,uv.y*0.5,0.1,1);}',
      }),
      { playing: false },
    );
    const map = await createEffect(document.querySelector('#map')!, pointerMap, {
      playing: false,
      params: { center: [0.5, 0.5], intensity: 0 },
    });
    const filtered = await createEffect(document.querySelector('#filtered')!, displace, {
      playing: false,
      params: { mode: 'refraction', encoding: 'normal', amount: 0.05 },
    });
    image.session.scheduler.setHidden(true);
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
    image.drawAt(0, 7);
    map.drawAt(0, 7);
    await filtered.bindInput('image', image);
    await filtered.bindInput('map', map);
    filtered.drawAt(0, 7);
    const original = await readFieldLinear(image),
      normal = await readFieldLinear(filtered),
      normalMap = await readFieldLinear(map);
    map.params['encoding'] = 'flow';
    filtered.params['encoding'] = 'flow';
    map.drawAt(0, 7);
    filtered.drawAt(0, 7);
    const flow = await readFieldLinear(filtered),
      flowMap = await readFieldLinear(map);
    map.params['intensity'] = 0.25;
    map.drawAt(0, 7);
    filtered.drawAt(0, 7);
    const active = await readFieldLinear(filtered),
      activeMap = await readFieldLinear(map);
    map.setReducedMotion(true);
    map.render();
    filtered.drawAt(0, 7);
    const reduced = await readFieldLinear(filtered),
      reducedMap = await readFieldLinear(map);
    filtered.params['mode'] = 'glass';
    filtered.drawAt(0, 7);
    const glassNeutral = await readFieldLinear(filtered);
    const difference = (a: typeof original, b: typeof original) =>
      Array.from(a.values).reduce(
        (maximum, value, i) => Math.max(maximum, Math.abs(value - b.values[i]!)),
        0,
      );
    const neutral = (data: typeof original, encoding: string) =>
      data.values.every(
        (value, i) =>
          value === (i % 4 === 3 ? 1 : i % 4 === 2 ? 0.5 : encoding === 'normal' ? 0.5 : 0),
      );
    const errors = [...image.session.errors];
    const mapBytes = map.memory().textureBytes;
    filtered.destroy();
    map.drawAt(0, 7);
    const survivor = await readFieldLinear(map);
    const alive = survivor.values.length > 0 && map.memory().textureBytes === mapBytes;
    map.destroy();
    image.destroy();
    return {
      normalDifference: difference(normal, original),
      flowDifference: difference(flow, original),
      activeDifference: difference(active, original),
      reducedDifference: difference(reduced, original),
      glassDifference: difference(glassNeutral, original),
      normalNeutral: neutral(normalMap, 'normal'),
      flowNeutral: neutral(flowMap, 'flow'),
      reducedNeutral: neutral(reducedMap, 'flow'),
      signedFlow: activeMap.values.some((value, i) => i % 4 < 2 && value < 0),
      alive,
      errors,
    };
  }, modules);
  expect(result.normalDifference).toBeLessThan(0.0005);
  expect(result.flowDifference).toBeLessThan(0.0005);
  expect(result.activeDifference).toBeGreaterThan(0.001);
  expect(result.reducedDifference).toBeLessThan(0.0005);
  expect(result.glassDifference).toBeLessThan(0.0005);
  expect(result.normalNeutral).toBe(true);
  expect(result.flowNeutral).toBe(true);
  expect(result.reducedNeutral).toBe(true);
  expect(result.signedFlow).toBe(true);
  expect(result.alive).toBe(true);
  expect(result.errors).toEqual([]);
});

test('Pointer map sleeps after settlement and redraws for manual and pointer centres', async ({
  page,
}) => {
  await fixture(page);
  const result = await page.evaluate(async (modules) => {
    const { createEffect } = (await import(
      modules.core
    )) as typeof import('../../packages/core/src/index.ts');
    const { default: effect } = (await import(modules.map)) as {
      default: import('../../packages/core/src/index.ts').EffectDefinition;
    };
    const { readFieldLinear } = (await import(
      modules.read
    )) as typeof import('./fixtures/panel-readback.ts');
    const field = await createEffect(document.querySelector('#map')!, effect, {
      playing: true,
      params: { center: [0.5, 0.5] },
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    let rendered = 0;
    const remove = field.onRendered(() => rendered++),
      start = field.frame.time;
    await new Promise((resolve) => setTimeout(resolve, 250));
    const idle = { rendered, clockAdvanced: field.frame.time > start };
    field.params['center'] = [0.3, 0.6];
    for (let i = 0; i < 20 && rendered === 0; i++) await new Promise(requestAnimationFrame);
    const changed = rendered;
    await new Promise((resolve) => setTimeout(resolve, 250));
    const settled = rendered;
    field.params['center'] = [-1, -1];
    const bounds = field.canvas.getBoundingClientRect();
    field.canvas.dispatchEvent(
      new PointerEvent('pointermove', {
        clientX: bounds.left + bounds.width * 0.75,
        clientY: bounds.top + bounds.height * 0.25,
      }),
    );
    for (let i = 0; i < 20 && rendered === settled; i++) await new Promise(requestAnimationFrame);
    const pointerRender = rendered;
    const data = await readFieldLinear(field);
    const height =
      data.values[
        (Math.floor(data.height * 0.25) * data.width + Math.floor(data.width * 0.75)) * 4 + 2
      ]!;
    const pointer = Array.from(field.frame.pointer),
      errors = [...field.session.errors];
    remove();
    field.destroy();
    return { idle, changed, settled, pointerRender, pointer, height, errors };
  }, modules);
  expect(result.idle).toEqual({ rendered: 0, clockAdvanced: true });
  expect(result.changed).toBeGreaterThan(0);
  expect(result.settled).toBe(result.changed);
  expect(result.pointerRender).toBeGreaterThan(result.settled);
  expect(result.pointer).toEqual([0.75, 0.25]);
  expect(result.height).toBeGreaterThan(0.6);
  expect(result.errors).toEqual([]);
});

test('Composite sceneSource preserves originals when the primary image is a filtered chain stage', async ({
  page,
}) => {
  await fixture(page);
  const result = await page.evaluate(async (modules) => {
    const { chain, createEffect, filterEffect } = (await import(
      modules.core
    )) as typeof import('../../packages/core/src/index.ts');
    const { default: composite } = (await import(modules.composite)) as {
      default: import('../../packages/core/src/index.ts').EffectDefinition;
    };
    const { readFieldLinear } = (await import(
      modules.read
    )) as typeof import('./fixtures/panel-readback.ts');
    const dim = filterEffect({
      id: 'product-dim',
      title: 'Dim test filter',
      params: {},
      wgsl: 'fn effect(uv:vec2f)->vec4f{let c=sample_image(uv);return vec4f(c.rgb*0.5,c.a);}',
    });
    const field = await createEffect(document.querySelector('#composite')!, chain(dim, composite), {
      playing: false,
    });
    field.session.scheduler.setHidden(true);
    const source = {
      kind: 'data' as const,
      data: new Float32Array([0.2, 0.1, 0.05, 0.5]),
      width: 1,
      height: 1,
    };
    await field.bindInput('image', source);
    await field.bindInput('original', source);
    const read = async (blend: number) => {
      field.params['s1_blend'] = blend;
      field.drawAt(0, 7);
      const pixels = await readFieldLinear(field);
      return Array.from(pixels.values.slice(0, 4));
    };
    const original = await read(0),
      filtered = await read(1),
      half = await read(0.5),
      errors = [...field.session.errors];
    field.destroy();
    return { original, filtered, half, errors };
  }, modules);
  [0.2, 0.1, 0.05, 0.5].forEach((value, i) => expect(result.original[i]).toBeCloseTo(value, 3));
  [0.1, 0.05, 0.025, 0.5].forEach((value, i) => expect(result.filtered[i]).toBeCloseTo(value, 3));
  [0.15, 0.075, 0.0375, 0.5].forEach((value, i) => expect(result.half[i]).toBeCloseTo(value, 3));
  expect(result.errors).toEqual([]);
});
