import { test, expect } from '@playwright/test';
import type {} from './effects.spec.ts';

test('chains parameter LUTs, edits individual duplicate stages, rejects cycles and frees borrowed inputs', async ({
  page,
}) => {
  await page.goto('/?effect=gradient-oklch&playing=false');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  const result = await page.evaluate(async () => {
    const api = window.hologpu,
      primary = api.field!;
    primary.pause();
    const canvas = () => {
      const c = document.createElement('canvas');
      c.style.cssText = 'width:96px;height:64px';
      document.body.append(c);
      return c;
    };
    const shader = (id: string) =>
      api.filterEffect({
        id,
        title: id,
        params: {},
        wgsl: 'fn effect(uv:vec2f)->vec4f {return sample_image(uv);}',
        presets: { a: {}, b: {} },
      });
    const a = await api.createEffect(canvas(), shader('identity-a'), {
      playing: false,
      reducedMotion: false,
    });
    const b = await api.createEffect(canvas(), shader('identity-b'), {
      playing: false,
      reducedMotion: false,
    });
    await a.bindInput('image', primary);
    await b.bindInput('image', a);
    let cycle = false;
    try {
      await primary.bindInput('image', b);
    } catch {
      cycle = true;
    }
    await a.bindInput('image', null);
    await b.bindInput('image', null);
    const concurrent = await Promise.allSettled([a.bindInput('image', b), b.bindInput('image', a)]);
    const concurrentRejects = concurrent.filter((value) => value.status === 'rejected').length;
    await a.bindInput('image', null);
    await b.bindInput('image', null);
    const valid = a.bindInput('image', primary);
    let rejectedInvalid = false;
    try {
      await a.bindInput('image', a);
    } catch {
      rejectedInvalid = true;
    }
    await valid;
    const retainedDependency = a.dependencies().includes(primary);
    await a.bindInput('image', primary);
    a.dirty = false;
    primary.render();
    const reboundInvalidates = a.dirty;
    await a.bindInput('map', primary);
    await a.bindInput('image', null);
    a.dirty = false;
    primary.render();
    const remainingBindingInvalidates = a.dirty;
    await a.bindInput('image', primary);
    await a.bindInput('map', null);
    a.dirty = false;
    primary.render();
    const restoredBindingInvalidates = a.dirty;
    await b.bindInput('image', a);
    primary.drawAt(0.4);
    a.drawAt(0.4);
    b.drawAt(0.4);
    const raw = await b.readTap('input:image');
    const finite = raw.values.every(Number.isFinite);
    const base = primary.session.scheduler.surfaceCount;
    const graded = api.catalogue.find((e) => e.id === 'color-grade')!;
    const instance = await api.createEffect(canvas(), api.chain(graded, graded), {
      playing: false,
      reducedMotion: false,
    });
    instance.store.set('s1_curveAmount', 1);
    instance.store.set('s1_toneCurve', [1, 0]);
    await instance.whenInputsReady();
    instance.drawAt(0);
    const one = instance.sources['s0:fragment']!,
      two = instance.sources['s1:fragment']!;
    const distinct = one.code !== two.code;
    await instance.editSource(
      's1:fragment',
      two.code.replace('return effect(in.uv);', 'return vec4f(1,0,0,1);'),
    );
    instance.drawAt(0);
    const pix = await instance.readPixels();
    const red = pix.pixels[0]! > 240 && pix.pixels[1]! < 5;
    const taps = Object.keys(instance.textureTaps),
      memory = instance.memory();
    const firstUnchanged = instance.sources['s0:fragment']!.code === one.code;
    instance.destroy();
    instance.canvas.remove();
    a.destroy();
    a.canvas.remove();
    const destroyedSourceDetached = b.dependencies().length === 0 && !b.inputTexture('image');
    b.drawAt(0.5);
    await b.readPixels();
    b.destroy();
    b.canvas.remove();
    return {
      cycle,
      concurrentRejects,
      rejectedInvalid,
      retainedDependency,
      reboundInvalidates,
      remainingBindingInvalidates,
      restoredBindingInvalidates,
      finite,
      distinct,
      red,
      firstUnchanged,
      taps,
      memory,
      destroyedSourceDetached,
      base,
      after: primary.session.scheduler.surfaceCount,
    };
  });
  expect(result.cycle).toBe(true);
  expect(result.concurrentRejects).toBe(1);
  expect(result.rejectedInvalid).toBe(true);
  expect(result.retainedDependency).toBe(true);
  expect(result.reboundInvalidates).toBe(true);
  expect(result.remainingBindingInvalidates).toBe(true);
  expect(result.restoredBindingInvalidates).toBe(true);
  expect(result.finite).toBe(true);
  expect(result.distinct).toBe(true);
  expect(result.red).toBe(true);
  expect(result.firstUnchanged).toBe(true);
  expect(result.taps).toContain('input:s1_toneCurve');
  expect(result.memory.textureBytes).toBeGreaterThan(0);
  expect(result.destroyedSourceDetached).toBe(true);
  expect(result.after).toBe(result.base - 2);
});

test('every T4 filter accepts every current effect output', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/?effect=gradient-oklch&playing=false');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  const result = await page.evaluate(async () => {
    const api = window.hologpu;
    api.field!.pause();
    const session = api.field!.session,
      errorStart = session.errors.length;
    const baseline = session.scheduler.surfaceCount;
    const filters = api.catalogue.filter((e) => e.tier === 'T4' && e.core);
    const cases: string[] = [];
    const canvas = () => {
      const c = document.createElement('canvas');
      c.style.cssText = 'width:80px;height:56px';
      document.body.append(c);
      return c;
    };
    for (const definition of api.catalogue) {
      const source = await api.createEffect(canvas(), definition, {
        playing: false,
        reducedMotion: false,
        dprCap: 1,
      });
      source.advance(2);
      for (const filter of filters) {
        const output = await api.createEffect(canvas(), filter, {
          playing: false,
          reducedMotion: false,
          dprCap: 1,
        });
        try {
          await output.bindInput('image', source);
          source.drawAt(0.5);
          output.drawAt(0.5);
          const pixels = await output.readPixels();
          if (pixels.width !== 80 || pixels.height !== 56 || !output.textureTaps['input:image'])
            throw new Error(`Wrong output/input ${definition.id}→${filter.id}`);
          cases.push(`${definition.id}→${filter.id}`);
        } finally {
          output.destroy();
          output.canvas.remove();
        }
      }
      source.destroy();
      source.canvas.remove();
    }
    await session.device.queue.onSubmittedWorkDone();
    return {
      cases,
      filters: filters.length,
      sources: api.catalogue.length,
      after: session.scheduler.surfaceCount,
      baseline,
      errors: session.errors.slice(errorStart),
    };
  });
  expect(result.filters).toBe(10);
  expect(result.sources).toBe(39);
  expect(result.cases).toHaveLength(390);
  expect(new Set(result.cases).size).toBe(390);
  expect(result.errors).toEqual([]);
  expect(result.after).toBe(result.baseline);
});
