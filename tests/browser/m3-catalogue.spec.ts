import { test, expect } from '@playwright/test';
import type { ParamValues } from '../../packages/core/src/params.ts';
const particles = [
  'flow-particles',
  'attractors',
  'boids',
  'n-body',
  'emitters',
  'morph-particles',
];
const primitives = ['prefix-sum', 'sort', 'spatial-hash', 'mipgen'];
const small = (id: string): ParamValues =>
  id === 'mipgen'
    ? { size: 32 }
    : particles.includes(id)
      ? { count: 256, ...(['boids', 'n-body'].includes(id) ? { grid: 8 } : {}) }
      : { count: 128, ...(id === 'spatial-hash' ? { grid: 8 } : {}) };
function meaningful(pixels: number[]) {
  expect(pixels.filter((_, i) => i % 4 === 3).every((v) => v === 255)).toBe(true);
  expect(
    new Set(
      Array.from({ length: pixels.length / 4 }, (_, i) => pixels.slice(i * 4, i * 4 + 3).join(',')),
    ).size,
  ).toBeGreaterThan(2);
}
for (const id of [...particles, ...primitives])
  test(`${id}: catalogue replay, presets, enum modes, allocation controls, taps and lifecycle`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    await page.routeWebSocket(/127\.0\.0\.1:5175/, (socket) => socket.close());
    const params = small(id);
    await page.goto(
      '/?' +
        new URLSearchParams({
          effect: id,
          playing: 'false',
          quality: 'fixed',
          resolution: '0.5',
          seed: '7',
          params: JSON.stringify(params),
        }),
    );
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
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
    const metadata = await page.evaluate(() => {
      const f = window.hologpu.field!;
      return {
        presets: Object.keys(f.effect.presets),
        inputs: f.effect.inputs,
        features: f.effect.features,
        fallback: f.effect.fallback,
        quality: f.effect.quality,
        params: Object.entries(f.effect.params).map(([name, spec]) => ({
          name,
          description: spec.description,
          group: spec.group,
          ...('min' in spec ? { min: spec.min, max: spec.max } : {}),
        })),
        sources: Object.keys(f.sources),
      };
    });
    expect(metadata.presets).toHaveLength(2);
    expect(metadata.fallback.length).toBeGreaterThan(0);
    expect(metadata.quality.resolutionScale).toEqual([0.25, 1]);
    expect(metadata.sources.length).toBeGreaterThan(1);
    for (const spec of metadata.params) {
      expect(spec.description, `${id}.${spec.name} description`).toBeTruthy();
      expect(spec.group, `${id}.${spec.name} group`).toBeTruthy();
      if (spec.min !== undefined) expect(spec.max).toBeGreaterThanOrEqual(spec.min);
    }
    for (const preset of metadata.presets) {
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
              throw new Error(`${id}/${name}: non-finite texture`);
            taps.push({
              name,
              width: read.width,
              height: read.height,
              layer: tap.arrayLayer ?? 0,
              level: tap.mipLevel ?? 0,
            });
          }
          const buffers = [];
          for (const [name, tap] of Object.entries(f.bufferTaps)) {
            const count = tap.count ?? 0,
              stride = tap.stride ?? 0;
            if (count < 1 || stride < 4 || count * stride > tap.buffer.size)
              throw new Error(`${id}/${name}: invalid buffer summary`);
            if (name === 'particles') {
              const staging = f.session.device.createBuffer({
                  size: count * stride,
                  usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
                }),
                encoder = f.session.device.createCommandEncoder();
              encoder.copyBufferToBuffer(tap.buffer, 0, staging, 0, count * stride);
              f.session.device.queue.submit([encoder.finish()]);
              await staging.mapAsync(GPUMapMode.READ);
              const finite = new Float32Array(staging.getMappedRange()).every(Number.isFinite);
              staging.unmap();
              staging.destroy();
              if (!finite) throw new Error(`${id}: non-finite particle storage`);
            }
            buffers.push({ name, count, stride, bytes: tap.buffer.size });
          }
          return { taps, buffers };
        };
        const modes = [];
        for (const [name, spec] of Object.entries(f.effect.params))
          if (spec.type === 'enum')
            for (const option of spec.options) {
              f.store.reset();
              f.store.patch({ ...params, [name]: option });
              f.reset(7);
              f.advance(2);
              const resources = await inspect();
              const pixels = (await f.readPixels()).pixels;
              const colors = new Set(
                Array.from(
                  { length: pixels.length / 4 },
                  (_, i) => `${pixels[i * 4]},${pixels[i * 4 + 1]},${pixels[i * 4 + 2]}`,
                ),
              );
              if (colors.size < 2) throw new Error(`${id}/${name}=${option}: flat output`);
              modes.push({
                name,
                option,
                taps: resources.taps.length,
                buffers: resources.buffers.length,
              });
              if (id === 'mipgen' && name === 'shape' && option === 'cube') {
                if (resources.taps.length !== 36)
                  throw new Error('Cube must expose all six faces and six levels at size32');
                for (let face = 0; face < 6; face++)
                  for (let level = 0; level < 6; level++)
                    if (
                      !resources.taps.some(
                        (t) =>
                          t.layer === face &&
                          t.level === level &&
                          t.width === 32 >> level &&
                          t.height === 32 >> level,
                      )
                    )
                      throw new Error(`Missing cube face${face} mip${level}`);
              }
            }
        f.store.reset();
        f.store.patch(params);
        f.reset(7);
        f.advance(0);
        const allocation = [];
        for (const [name, spec] of Object.entries(f.effect.params))
          if (spec.uniform === false && (name === 'count' || name === 'grid' || name === 'size')) {
            const original = Number(f.store.values[name]);
            const next = Math.min('max' in spec ? Number(spec.max) : original * 2, original * 2);
            f.step();
            f.store.set(name, next);
            f.reset(13);
            f.advance(2);
            const changed = await inspect();
            if (
              name === 'count' &&
              id !== 'mipgen' &&
              !changed.buffers.some((b) => b.count === next)
            )
              throw new Error(`${id}: count summary did not update`);
            if (name === 'size' && !changed.taps.some((t) => t.width === next && t.height === next))
              throw new Error(`${id}: mip allocation did not update`);
            allocation.push({ name, original, next });
            f.store.set(name, original);
            f.reset(7);
            f.advance(2);
            await inspect();
          }
        const resources = await inspect(),
          owned = f.memory();
        const pausedPixels = Array.from((await f.readPixels()).pixels);
        f.advance(0);
        if (
          JSON.stringify(pausedPixels) !== JSON.stringify(Array.from((await f.readPixels()).pixels))
        )
          throw new Error(`${id}: paused render changed the presentation`);
        f.setReducedMotion(true);
        f.advance(0);
        const still = Array.from((await f.readPixels()).pixels);
        f.advance(5);
        const after = Array.from((await f.readPixels()).pixels);
        const reduced = {
          index: f.frame.index,
          same: JSON.stringify(still) === JSON.stringify(after),
        };
        const errors = [...f.session.errors],
          diagnostics = [...f.diagnostics],
          session = f.session;
        f.destroy();
        f.destroy();
        return {
          modes,
          allocation,
          resources,
          owned,
          reduced,
          errors,
          diagnostics,
          disposed: f.memory(),
          clients: session.clients,
          resourcesAfter: session.resources.stats(),
          scheduled: session.scheduler.surfaceCount,
        };
      },
      { params, id },
    );
    expect(result.modes.length).toBeGreaterThanOrEqual(id === 'boids' ? 0 : 2);
    expect(result.allocation.length).toBeGreaterThan(0);
    expect(result.owned.textureBytes).toBeGreaterThan(0);
    expect(result.owned.bufferBytes).toBeGreaterThan(0);
    expect(result.resources.taps.length + result.resources.buffers.length).toBeGreaterThan(0);
    expect(result.reduced).toEqual({ index: 0, same: true });
    expect(result.errors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(result.disposed.textureBytes).toBe(0);
    expect(result.disposed.bufferBytes).toBe(0);
    expect(result.clients).toBe(0);
    expect(result.resourcesAfter.entries).toBe(0);
    expect(result.scheduled).toBe(0);
  });
