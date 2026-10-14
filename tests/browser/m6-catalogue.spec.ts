import { test, expect } from '@playwright/test';
import type { ParamValues } from '../../packages/core/src/params.ts';
const ids = ['instances', 'terrain', 'material-ball', 'glass'];
const small = (id: string): ParamValues =>
  id === 'instances' ? { count: 64 } : id === 'terrain' ? { segments: 16 } : {};
function meaningful(pixels: number[]) {
  expect(pixels.every(Number.isFinite)).toBe(true);
  expect(
    new Set(
      Array.from({ length: pixels.length / 4 }, (_, i) => pixels.slice(i * 4, i * 4 + 3).join(',')),
    ).size,
  ).toBeGreaterThan(2);
}
for (const id of ids)
  test(`${id}: M6 catalogue replay, presets, every enum, taps and lifecycle`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await page.routeWebSocket(/127\.0\.0\.1:5175/, (socket) => socket.close());
    const params = small(id);
    await page.goto(
      '/?' +
        new URLSearchParams({
          effect: id,
          playing: 'false',
          quality: 'fixed',
          resolution: '.5',
          seed: '7',
          params: JSON.stringify(params),
        }),
    );
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready', {
      timeout: 30000,
    });
    await page.locator('#stage').evaluate((node: HTMLElement) => {
      node.style.width = '162px';
      node.style.height = '162px';
    });
    await expect
      .poll(() => page.evaluate(() => window.hologpu.field!.surface!.size[0]))
      .toBe(await page.evaluate(() => 80 * devicePixelRatio));
    const replay = () =>
      page.evaluate(async () => {
        const f = window.hologpu.field!;
        f.reset(7);
        f.advance(8);
        return Array.from((await f.readPixels()).pixels);
      });
    const first = await replay();
    expect(await replay()).toEqual(first);
    meaningful(first);
    if (testInfo.project.name.startsWith('swiftshader'))
      await expect(page.locator('#canvas')).toHaveScreenshot(`${id}.png`, {
        scale: 'css',
        maxDiffPixelRatio: 0.001,
      });
    const meta = await page.evaluate(() => {
      const f = window.hologpu.field!;
      return {
        presets: Object.keys(f.effect.presets),
        enumCount: Object.values(f.effect.params).reduce(
          (n, spec) => n + (spec.type === 'enum' ? spec.options.length : 0),
          0,
        ),
        params: Object.entries(f.effect.params).map(([name, spec]) => ({
          name,
          description: spec.description,
          group: spec.group,
          ...('min' in spec ? { min: spec.min, max: spec.max } : {}),
        })),
        fallback: f.effect.fallback,
        quality: f.effect.quality,
        sources: Object.keys(f.sources),
      };
    });
    expect(meta.presets).toHaveLength(2);
    expect(meta.fallback).toBeTruthy();
    expect(meta.quality.resolutionScale).toEqual([0.25, 1]);
    expect(meta.sources.length).toBeGreaterThan(0);
    for (const spec of meta.params) {
      expect(spec.description).toBeTruthy();
      expect(spec.group).toBeTruthy();
      if (spec.min !== undefined) expect(spec.max).toBeGreaterThanOrEqual(spec.min);
    }
    for (const preset of meta.presets) {
      const pixels = await page.evaluate(
        async ({ preset, params }) => {
          const f = window.hologpu.field!;
          f.store.reset();
          f.store.patch({ ...f.effect.presets[preset], ...params });
          f.reset(7);
          f.advance(8);
          return Array.from((await f.readPixels()).pixels);
        },
        { preset, params },
      );
      meaningful(pixels);
      if (testInfo.project.name.startsWith('swiftshader'))
        await expect(page.locator('#canvas')).toHaveScreenshot(`${id}-${preset}.png`, {
          scale: 'css',
          maxDiffPixelRatio: 0.001,
        });
    }
    const result = await page.evaluate(
      async ({ params, id }) => {
        const f = window.hologpu.field!;
        const inspect = async () => {
          const taps = [];
          for (const [name, tap] of Object.entries(f.textureTaps)) {
            const read = await f.readTap(name);
            if (!read.values.every(Number.isFinite))
              throw new Error(`${id}/${name}: non-finite tap`);
            if (tap.width < 1 || tap.height < 1) throw new Error('Zero-size texture');
            taps.push({
              name,
              width: read.width,
              height: read.height,
              format: tap.format,
              depthSlice: tap.depthSlice,
            });
          }
          return taps;
        };
        const modes = [];
        for (const [name, spec] of Object.entries(f.effect.params))
          if (spec.type === 'enum')
            for (const option of spec.options) {
              f.store.reset();
              f.store.patch({ ...params, [name]: option });
              f.reset(7);
              f.advance(2);
              const taps = await inspect();
              const pixels = (await f.readPixels()).pixels;
              if (
                !(name === 'scene' && ['empty', 'solid'].includes(option)) &&
                !pixels.some((v, i) => i % 4 !== 3 && v > 0)
              )
                throw new Error(`${id}/${name}=${option}: black output`);
              modes.push({ name, option, taps: taps.length });
            }
        f.store.reset();
        f.store.patch(params);
        f.reset(7);
        f.advance(0);
        const allocation = [];
        for (const [name, spec] of Object.entries(f.effect.params))
          if (
            ['count', 'segments'].includes(name) &&
            'max' in spec &&
            typeof spec.default === 'number'
          ) {
            const original = Number(f.store.values[name]),
              next = Math.min(Number(spec.max), original + 1);
            f.store.set(name, next);
            f.reset(13);
            f.advance(2);
            const changed = await inspect();
            allocation.push({ name, original, next, taps: changed.length });
            f.store.set(name, original);
            f.reset(7);
            f.advance(2);
            await inspect();
          }
        const taps = await inspect(),
          before = f.memory();
        const paused = Array.from((await f.readPixels()).pixels);
        f.advance(0);
        if (JSON.stringify(Array.from((await f.readPixels()).pixels)) !== JSON.stringify(paused))
          throw new Error('Paused render changed pixels');
        f.setReducedMotion(true);
        f.reset(7);
        f.advance(1);
        const pose = Array.from((await f.readPixels()).pixels),
          index = f.frame.index;
        f.advance(8);
        if (
          f.frame.index !== index ||
          JSON.stringify(Array.from((await f.readPixels()).pixels)) !== JSON.stringify(pose)
        )
          throw new Error('Reduced-motion pose changed');
        const diagnostics = Object.values(f.instance?.diagnostics ?? []),
          errors = [...f.session.errors];
        const session = f.session;
        f.destroy();
        return {
          modes,
          allocation,
          taps,
          before,
          diagnostics,
          errors,
          after: f.memory(),
          stats: session.resources.stats(),
        };
      },
      { params, id },
    );
    expect(result.modes.length).toBe(meta.enumCount);
    if (['glass', 'material-ball'].includes(id)) expect(result.taps.length).toBeGreaterThan(0);
    expect(result.before.textureBytes).toBeGreaterThan(0);
    expect(result.errors).toEqual([]);
    expect(result.diagnostics.filter((d) => d.type !== 'info')).toEqual([]);
    expect(result.after.textureBytes).toBe(0);
    expect(result.after.bufferBytes).toBe(0);
    expect(result.stats.references).toBe(0);
  });
