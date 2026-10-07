import { test, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const root = '/@fs' + fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
async function harness(page: Page) {
  await page.route('**/__lighting', (r) =>
    r.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><canvas style="width:128px;height:128px"></canvas>',
    }),
  );
  await page.goto('/__lighting');
}
test('Jump flood nearest seeds and signed distance match brute force fixtures including ties and odd dimensions', async ({
  page,
}) => {
  await harness(page);
  const result = await page.evaluate(async (root) => {
    const core = (await import(
      `${root}/packages/core/src/index.ts`
    )) as typeof import('../../packages/core/src/index.ts');
    const { createJumpFlood } = (await import(
      `${root}/packages/core/src/distance-fields.ts`
    )) as typeof import('../../packages/core/src/distance-fields.ts');
    const { session, release } = await core.acquireDevice();
    let cases = 0,
      maxError = 0;
    try {
      for (const [w, h, mode, boundary] of [
        [1, 1, 'empty', false],
        [7, 5, 'points', false],
        [9, 7, 'rect', true],
        [5, 3, 'full', true],
        [17, 13, 'points', false],
      ] as const) {
        const alpha = Array.from({ length: w * h }, (_, i) =>
          mode === 'full'
            ? 1
            : mode === 'empty'
              ? 0
              : mode === 'rect'
                ? i % w >= 2 && i % w <= 5 && Math.floor(i / w) >= 2 && Math.floor(i / w) <= 4
                  ? 1
                  : 0
                : (i % w === 1 || i % w === w - 2) &&
                    (Math.floor(i / w) === 1 || Math.floor(i / w) === h - 2)
                  ? 1
                  : 0,
        );
        const bytes = new Uint8Array(w * h * 4);
        alpha.forEach((a, i) => (bytes[i * 4 + 3] = a * 255));
        const mask = session.device.createTexture({
          size: [w, h],
          format: 'rgba8unorm',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
        session.device.queue.writeTexture({ texture: mask }, bytes, { bytesPerRow: w * 4 }, [w, h]);
        const jfa = await createJumpFlood(session, [w, h]);
        const e = session.device.createCommandEncoder();
        const taps = jfa.encode(
          e,
          { texture: mask, width: w, height: h, format: 'rgba8unorm', kind: 'float' },
          { boundary },
        );
        session.submitEncoder(e);
        const nearest = await core.readTextureTap(session.device, taps.nearest),
          dist = await core.readTextureTap(session.device, taps.distance);
        const occupied = (x: number, y: number) =>
          x >= 0 && y >= 0 && x < w && y < h ? alpha[y * w + x]! : 0;
        const seeds = alpha.flatMap((a, i) => {
          const x = i % w,
            y = Math.floor(i / w);
          let yes = !!a;
          if (boundary) {
            yes = false;
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++) if (occupied(x + dx, y + dy) !== a) yes = true;
          }
          return yes ? [[x, y]] : [];
        });
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            let best = [-1, -1],
              ds = Infinity;
            for (const [sx, sy] of seeds) {
              const q = (sx! - x) ** 2 + (sy! - y) ** 2;
              if (q < ds || (q === ds && (sy! < best[1]! || (sy === best[1] && sx! < best[0]!)))) {
                ds = q;
                best = [sx!, sy!];
              }
            }
            const i = y * w + x;
            if (nearest.values[i * 2] !== best[0] || nearest.values[i * 2 + 1] !== best[1])
              throw new Error(`Nearest seed mismatch ${w}x${h} at ${x},${y}`);
            const expected =
              (alpha[i] ? -1 : 1) * (seeds.length ? Math.sqrt(ds) : Math.hypot(w, h));
            maxError = Math.max(maxError, Math.abs(dist.values[i]! - expected));
          }
        const memory = jfa.memory();
        if (memory.textureBytes !== w * h * 20) throw new Error('JFA allocation mismatch');
        jfa.dispose();
        jfa.dispose();
        if (jfa.memory().textureBytes !== 0) throw new Error('JFA disposal accounting');
        let rejected = false;
        try {
          jfa.encode(e, taps.distance);
        } catch {
          rejected = true;
        }
        if (!rejected) throw new Error('Disposed helper accepted work');
        mask.destroy();
        cases++;
      }
      if (session.errors.length) throw new Error(session.errors.join('\n'));
      return { cases, maxError };
    } finally {
      release();
    }
  }, root);
  expect(result.cases).toBe(5);
  expect(result.maxError).toBeLessThan(0.00001);
});
for (const id of ['jump-flood', 'shadows-2d', 'radiance-cascades'])
  test(`${id}: masks, exact replay, all modes/presets, finite taps and cleanup`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await harness(page);
    const result = await page.evaluate(
      async ({ root, id }) => {
        const core = (await import(
          `${root}/packages/core/src/index.ts`
        )) as typeof import('../../packages/core/src/index.ts');
        const effect = (await import(`${root}/packages/effects/src/${id}/index.ts`)).default;
        const field = await core.EffectField.create(document.querySelector('canvas')!, effect, {
          playing: false,
          params: { grid: 32 },
        });
        const pixels = async () => Array.from((await field.readPixels()).pixels);
        try {
          field.advance(1);
          const first = await pixels();
          field.reset(7);
          field.advance(1);
          if (JSON.stringify(first) !== JSON.stringify(await pixels()))
            throw new Error('Replay mismatch');
          const poses: number[] = [];
          for (const preset of Object.values(effect.presets)) {
            field.store.patch({ ...(preset as object), grid: 32 });
            field.advance(1);
            poses.push(new Set((await pixels()).filter((_, i) => i % 4 === 0)).size);
          }
          for (const mode of effect.params.view.options) {
            field.params['view'] = mode;
            field.advance(1);
            await pixels();
          }
          field.params['scene'] = 'empty';
          field.params['view'] = effect.params.view.default;
          field.advance(1);
          const empty = await pixels();
          await field.setInput('rects', [[0.48, 0.2, 0.1, 0.6]]);
          field.advance(1);
          if (JSON.stringify(empty) === JSON.stringify(await pixels()))
            throw new Error('Rect mask has no effect');
          await field.setInput('text', 'LIGHT');
          field.params['scene'] = 'text';
          field.advance(1);
          for (const tap of Object.values(field.textureTaps)) {
            const values = await core.readTextureTap(field.session.device, tap);
            if (!Array.from(values.values).every(Number.isFinite))
              throw new Error('Nonfinite tap ' + tap.label);
          }
          field.params['grid'] = 64;
          field.advance(1);
          if (field.textureTaps.distance!.width !== 64)
            throw new Error('Grid allocation not resized');
          field.setReducedMotion(true);
          field.advance(1);
          const frozen = await pixels();
          field.advance(5);
          if (JSON.stringify(frozen) !== JSON.stringify(await pixels()))
            throw new Error('Reduced pose changes');
          if (field.session.errors.length) throw new Error(field.session.errors.join('\n'));
          return { poses, textureBytes: field.instance!.memory!().textureBytes };
        } finally {
          const instance = field.instance!;
          field.destroy();
          if (instance.memory!().textureBytes !== 0 || instance.memory!().bufferBytes !== 0)
            throw new Error('Disposed resources retained');
        }
      },
      { root, id },
    );
    expect(result.poses.every((n) => n > 2)).toBe(true);
    expect(result.textureBytes).toBeGreaterThan(0);
  });
test('SDF shadow visibility equals an unobstructed and blocked CPU segment fixture', async ({
  page,
}) => {
  await harness(page);
  const result = await page.evaluate(async (root) => {
    const core = (await import(
      `${root}/packages/core/src/index.ts`
    )) as typeof import('../../packages/core/src/index.ts');
    const effect = (await import(`${root}/packages/effects/src/shadows-2d/index.ts`)).default;
    const f = await core.EffectField.create(document.querySelector('canvas')!, effect, {
      playing: false,
      params: { grid: 32, scene: 'empty', view: 'visibility', light: [0.2, 0.5], steps: 256 },
    });
    try {
      f.advance(1);
      let tap = await core.readTextureTap(f.session.device, f.textureTaps.visibility!);
      const open = tap.values[(16 * 32 + 25) * 4]!;
      await f.setInput('rects', [[0.45, 0, 0.1, 1]]);
      f.advance(1);
      tap = await core.readTextureTap(f.session.device, f.textureTaps.visibility!);
      return {
        open,
        blocked: tap.values[(16 * 32 + 25) * 4]!,
        near: tap.values[(16 * 32 + 8) * 4]!,
        errors: f.session.errors,
      };
    } finally {
      f.destroy();
    }
  }, root);
  expect(result.open).toBe(1);
  expect(result.blocked).toBe(0);
  expect(result.near).toBe(1);
  expect(result.errors).toEqual([]);
});
test('Radiance cascades preserve constant environment, hierarchical dimensions and bounded diffuse energy', async ({
  page,
}) => {
  await harness(page);
  const result = await page.evaluate(async (root) => {
    const core = (await import(
      `${root}/packages/core/src/index.ts`
    )) as typeof import('../../packages/core/src/index.ts');
    const effect = (await import(`${root}/packages/effects/src/radiance-cascades/index.ts`))
      .default;
    const f = await core.EffectField.create(document.querySelector('canvas')!, effect, {
      playing: false,
      params: { grid: 32, scene: 'empty', environment: '#808080', levels: 4, bounces: 1 },
    });
    try {
      f.advance(1);
      const env = core.parseColor('#808080')[0];
      let error = 0;
      const dimensions: number[][] = [];
      for (let l = 0; l < 4; l++) {
        const t = f.textureTaps[`cascade-${l}`]!;
        dimensions.push([t.width, t.height]);
        const data = await core.readTextureTap(f.session.device, t);
        for (let i = 0; i < data.values.length; i += 4)
          for (let c = 0; c < 3; c++) error = Math.max(error, Math.abs(data.values[i + c]! - env!));
      }
      await f.setInput('rects', [[0.4, 0, 0.2, 1]]);
      f.params['environment'] = '#000000';
      f.advance(1);
      const black = await core.readTextureTap(f.session.device, f.textureTaps['irradiance-0']!);
      const zero = Math.max(...Array.from(black.values).filter((_, i) => i % 4 !== 3));
      await f.setInput('rects', []);
      f.params['scene'] = 'blocks';
      f.params['bounces'] = 1;
      f.advance(1);
      const one = await core.readTextureTap(f.session.device, f.textureTaps['irradiance-0']!);
      const energy = (a: Float32Array | Uint32Array) =>
        Array.from(a).reduce((n, v, i) => n + (i % 4 === 3 ? 0 : v), 0);
      f.params['bounces'] = 3;
      f.advance(1);
      const data = await core.readTextureTap(f.session.device, f.textureTaps['irradiance-0']!);
      return {
        error,
        dimensions,
        zero,
        max: Math.max(...Array.from(data.values)),
        variation: new Set(data.values).size,
        oneBounceEnergy: energy(one.values),
        threeBounceEnergy: energy(data.values),
        errors: f.session.errors,
      };
    } finally {
      f.destroy();
    }
  }, root);
  expect(result.error).toBeLessThan(0.001);
  expect(result.dimensions).toEqual([
    [32, 8],
    [64, 4],
    [128, 2],
    [256, 1],
  ]);
  expect(result.zero).toBe(0);
  expect(result.max).toBeLessThanOrEqual(16);
  expect(result.variation).toBeGreaterThan(20);
  expect(result.threeBounceEnergy).toBeGreaterThan(result.oneBounceEnergy);
  expect(result.errors).toEqual([]);
});
for (const id of ['jump-flood', 'shadows-2d', 'radiance-cascades'])
  test(`${id}: default and both preset visual snapshots`, async ({ page }, info) => {
    await harness(page);
    await page.evaluate(
      async ({ root, id }) => {
        const core = (await import(
          `${root}/packages/core/src/index.ts`
        )) as typeof import('../../packages/core/src/index.ts');
        const effect = (await import(`${root}/packages/effects/src/${id}/index.ts`)).default;
        const canvas = document.querySelector('canvas')!;
        canvas.style.width = '160px';
        canvas.style.height = '160px';
        const f = await core.EffectField.create(canvas, effect, {
          playing: false,
          params: { grid: 64 },
        });
        (window as unknown as { lightingField: typeof f }).lightingField = f;
        f.advance(1);
      },
      { root, id },
    );
    const poses = await page.evaluate(() => {
      const f = (
        window as unknown as {
          lightingField: import('../../packages/core/src/runtime.ts').EffectField;
        }
      ).lightingField;
      if (f.instance?.diagnostics?.some((d) => d.type !== 'info'))
        throw new Error('Shader warnings or errors');
      return ['default', ...Object.keys(f.effect.presets)];
    });
    for (const pose of poses) {
      if (pose !== 'default')
        await page.evaluate((pose) => {
          const f = (
            window as unknown as {
              lightingField: import('../../packages/core/src/runtime.ts').EffectField;
            }
          ).lightingField;
          f.store.patch({ ...f.effect.presets[pose], grid: 64 });
          f.advance(1);
        }, pose);
      if (info.project.name.startsWith('swiftshader'))
        await expect(page.locator('canvas')).toHaveScreenshot(`${id}-${pose}.png`, {
          scale: 'css',
          maxDiffPixelRatio: 0.001,
        });
    }
    await page.evaluate(() => {
      const f = (
        window as unknown as {
          lightingField: import('../../packages/core/src/runtime.ts').EffectField;
        }
      ).lightingField;
      f.destroy();
    });
  });
test('Radiance cascade transmittance blocks emitter transport across a full-height wall', async ({
  page,
}) => {
  await harness(page);
  const result = await page.evaluate(async (root) => {
    const core = (await import(
      `${root}/packages/core/src/index.ts`
    )) as typeof import('../../packages/core/src/index.ts');
    const effect = (await import(`${root}/packages/effects/src/radiance-cascades/index.ts`))
      .default;
    const f = await core.EffectField.create(document.querySelector('canvas')!, effect, {
      playing: false,
      params: { grid: 64, scene: 'text', environment: '#000000', levels: 4, bounces: 1 },
    });
    try {
      await f.setInput('text', '');
      f.advance(1);
      const red = async () => {
        const data = await core.readTextureTap(f.session.device, f.textureTaps['irradiance-0']!);
        let sum = 0;
        for (let y = 0; y < 64; y++)
          for (let x = 40; x < 64; x++) sum += data.values[(y * 64 + x) * 4]!;
        return sum;
      };
      const open = await red();
      await f.setInput('rects', [[0.47, 0, 0.08, 1]]);
      f.advance(1);
      return { open, blocked: await red(), errors: f.session.errors };
    } finally {
      f.destroy();
    }
  }, root);
  expect(result.open).toBeGreaterThan(0);
  expect(result.blocked).toBeLessThan(result.open * 0.85);
  expect(result.errors).toEqual([]);
});
for (const id of ['jump-flood', 'shadows-2d', 'radiance-cascades'])
  test(`${id}: borrowed canvas mask overrides fallback and updates with the live source`, async ({
    page,
  }) => {
    await harness(page);
    const result = await page.evaluate(
      async ({ root, id }) => {
        const core = (await import(
          `${root}/packages/core/src/index.ts`
        )) as typeof import('../../packages/core/src/index.ts');
        const effect = (await import(`${root}/packages/effects/src/${id}/index.ts`)).default;
        const f = await core.EffectField.create(document.querySelector('canvas')!, effect, {
          playing: false,
          params: { grid: 32, scene: 'empty' },
        });
        const mask = document.createElement('canvas');
        mask.width = 32;
        mask.height = 32;
        const paint = mask.getContext('2d')!;
        paint.fillStyle = 'white';
        paint.fillRect(10, 10, 12, 12);
        try {
          await f.bindInput('image', { kind: 'canvas', source: mask });
          f.advance(1);
          const first = await core.readTextureTap(f.session.device, f.textureTaps.distance!);
          paint.clearRect(0, 0, 32, 32);
          paint.fillRect(1, 1, 6, 6);
          f.advance(1);
          const next = await core.readTextureTap(f.session.device, f.textureTaps.distance!);
          return {
            inside: first.values[16 * 32 + 16],
            outside: first.values[3 * 32 + 3],
            movedInside: next.values[3 * 32 + 3],
            movedOutside: next.values[16 * 32 + 16],
            errors: f.session.errors,
          };
        } finally {
          f.destroy();
        }
      },
      { root, id },
    );
    expect(result.inside).toBeLessThan(0);
    expect(result.outside).toBeGreaterThan(0);
    expect(result.movedInside).toBeLessThan(0);
    expect(result.movedOutside).toBeGreaterThan(0);
    expect(result.errors).toEqual([]);
  });
