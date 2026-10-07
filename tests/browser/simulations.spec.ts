import { test, expect } from '@playwright/test';

test('adaptive queue-load decisions scale actual solver work, preserve state allocations, and restore the resolution ceiling', async ({
  page,
}) => {
  await page.goto('/?effect=reaction-diffusion&playing=false&params=%7B%22grid%22%3A32%7D');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  const result = await page.evaluate(async () => {
    const f = window.hologpu.field!;
    f.advance(0);
    await f.session.device.queue.onSubmittedWorkDone();
    const textures = [f.textureTaps.state!.texture];
    f.store.set('steps', 1);
    f.advance(1);
    textures.push(f.textureTaps.state!.texture);
    f.store.set('steps', 4);
    f.reset(7);
    f.advance(0);
    f.setAdaptiveQuality(true);
    // Feed sustained CPU load into the real post-submit completion observation path.
    for (let i = 0; i < 180; i++) {
      f.playing = true;
      f.frameCompleted({ cpuMs: 100, intervalMs: 1000 / 60 });
      await f.session.device.queue.onSubmittedWorkDone();
      await Promise.resolve();
      await Promise.resolve();
      f.pause();
    }
    const degraded = {
      resolution: f.surface!.resolutionScale,
      step: f.quality.state.stepScale,
      preserved: textures.includes(f.textureTaps.state!.texture),
    };
    f.reset(7);
    f.advance(1);
    const cheap = await f.readTap('state');
    f.setAdaptiveQuality(false);
    const restored = f.surface!.resolutionScale;
    f.reset(7);
    f.advance(1);
    const full = await f.readTap('state');
    let difference = 0;
    for (let i = 0; i < cheap.values.length; i++)
      difference = Math.max(difference, Math.abs(cheap.values[i]! - full.values[i]!));
    return { degraded, restored, difference, errors: f.session.errors };
  });
  expect(result.degraded.step).toBe(0.25);
  expect(result.degraded.resolution).toBeLessThan(1);
  expect(result.degraded.preserved).toBe(true);
  expect(result.restored).toBe(1);
  expect(result.difference).toBeGreaterThan(0.01);
  expect(result.errors).toEqual([]);
});
const ids = [
  'reaction-diffusion',
  'life',
  'lenia',
  'wave',
  'physarum',
  'falling-sand',
  'fluid',
  'ink',
  'smoke',
];
const small = { grid: 32 };
for (const id of ids)
  test(`${id}: fixed-step replay, presets, modes, taps and disposal`, async ({
    page,
  }, testInfo) => {
    const params = { ...small, ...(id === 'physarum' ? { agents: 256 } : {}) };
    await page.goto(
      `/?effect=${id}&playing=false&quality=fixed&resolution=0.5&params=${encodeURIComponent(JSON.stringify(params))}`,
    );
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
    await page.locator('#stage').evaluate((n: HTMLElement) => {
      n.style.width = '162px';
      n.style.height = '162px';
    });
    await expect
      .poll(() => page.evaluate(() => window.hologpu.field!.surface!.size[0]))
      .toBe(await page.evaluate(() => 80 * devicePixelRatio));
    const first = await page.evaluate(async () => {
      const f = window.hologpu.field!;
      f.reset(7);
      f.advance(8);
      return Array.from((await f.readPixels()).pixels);
    });
    const second = await page.evaluate(async () => {
      const f = window.hologpu.field!;
      f.reset(7);
      f.advance(8);
      return Array.from((await f.readPixels()).pixels);
    });
    expect(second).toEqual(first);
    expect(first.filter((_v, i) => i % 4 === 3).every((v) => v === 255)).toBe(true);
    expect(
      new Set(
        Array.from({ length: first.length / 4 }, (_, i) => first.slice(i * 4, i * 4 + 3).join(',')),
      ).size,
    ).toBeGreaterThan(1);
    if (testInfo.project.name.startsWith('swiftshader'))
      await expect(page.locator('#canvas')).toHaveScreenshot(`${id}.png`, {
        scale: 'css',
        maxDiffPixelRatio: 0.001,
      });
    const presets = await page.evaluate(() => Object.keys(window.hologpu.field!.effect.presets));
    expect(presets).toHaveLength(2);
    for (const preset of presets) {
      await page.evaluate(
        ({ preset, params }) => {
          const f = window.hologpu.field!;
          f.store.reset();
          f.store.patch({ ...f.effect.presets[preset], ...params });
          f.reset(7);
          f.advance(8);
        },
        { preset, params },
      );
      await page.evaluate(() => window.hologpu.field!.session.device.queue.onSubmittedWorkDone());
      if (testInfo.project.name.startsWith('swiftshader'))
        await expect(page.locator('#canvas')).toHaveScreenshot(`${id}-${preset}.png`, {
          scale: 'css',
          maxDiffPixelRatio: 0.001,
        });
    }
    const results = await page.evaluate(async (params) => {
      const f = window.hologpu.field!;
      for (const [name, spec] of Object.entries(f.effect.params))
        if (spec.type === 'enum')
          for (const option of spec.options) {
            f.store.set(name, option);
            f.store.patch(params);
            f.reset(7);
            f.advance(2);
            const read = await f.readPixels();
            if (!read.pixels.some((v) => v > 0)) throw new Error(`${name}=${option}: empty output`);
          }
      const taps = [];
      for (const name of Object.keys(f.textureTaps)) {
        const read = await f.readTap(name);
        taps.push({
          name,
          size: [read.width, read.height],
          finite: read.values.every(Number.isFinite),
        });
      }
      const owned = f.memory();
      const errors = [...f.session.errors],
        diagnostics = [...f.diagnostics];
      const session = f.session;
      f.destroy();
      f.destroy();
      return {
        taps,
        owned,
        errors,
        diagnostics,
        disposed: f.memory(),
        clients: session.clients,
        resources: session.resources.stats(),
        scheduled: session.scheduler.surfaceCount,
      };
    }, params);
    expect(results.taps.length).toBeGreaterThan(0);
    expect(results.taps.every((t) => t.finite && t.size[0] === 32 && t.size[1] === 32)).toBe(true);
    expect(results.owned.textureBytes).toBeGreaterThan(32 * 32 * 8);
    expect(results.errors).toEqual([]);
    expect(results.diagnostics).toEqual([]);
    expect(results.disposed.textureBytes).toBe(0);
    expect(results.disposed.bufferBytes).toBe(0);
    expect(results.clients).toBe(0);
    expect(results.resources.entries).toBe(0);
    expect(results.scheduled).toBe(0);
  });
test('T2 transport, pointer capture, texture inspection, quality and URL controls', async ({
  page,
}) => {
  await page.goto('/?effect=wave&playing=false&params=%7B%22grid%22%3A32%7D');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#tier')).toContainText('T2');
  const before = await page.evaluate(() => window.hologpu.field!.frame.index);
  await page.locator('#step').click();
  expect(await page.evaluate(() => window.hologpu.field!.frame.index)).toBe(before + 1);
  await page.locator('#time-scale').selectOption('0.5');
  const rate = await page.evaluate(() => {
    const f = window.hologpu.field!;
    const before = f.frame.index;
    f.update({ delta: 1 / 60, time: 0, index: 1 });
    const half = f.frame.index;
    f.update({ delta: 1 / 60, time: 0, index: 2 });
    const full = f.frame.index;
    f.advance(0);
    return { before, half, full };
  });
  expect(rate.half).toBe(rate.before);
  expect(rate.full).toBe(rate.before + 1);
  const box = await page.locator('#canvas').boundingBox();
  await page.mouse.move(box!.x + box!.width * 0.5, box!.y + box!.height * 0.5);
  await page.mouse.down();
  const pressed = await page.evaluate(() => {
    const f = window.hologpu.field!;
    f.advance(1);
    return { buttons: f.frame.buttons, point: f.frame.pointer };
  });
  expect(pressed.buttons).toBe(1);
  expect(pressed.point[0]).toBeCloseTo(0.5, 2);
  await page.mouse.move(box!.x + box!.width + 10, box!.y + box!.height + 10);
  await page.mouse.up();
  expect(await page.evaluate(() => window.hologpu.field!.frame.buttons)).toBe(0);
  await page.getByRole('tab', { name: 'Passes', exact: true }).click();
  await page.locator('#tap-refresh').click();
  await expect(page.locator('#tap-status')).toContainText('0 non-finite values');
  await expect(page.locator('#tap-preview')).toBeVisible();
  await page.locator('#tap-channel').selectOption('1');
  await expect(page.locator('#tap-status')).toContainText('channel 1');
  await page.locator('#adaptive-quality').check();
  const url = page.url();
  await page.reload();
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#time-scale')).toHaveValue('0.5');
  await expect(page.locator('#adaptive-quality')).toBeChecked();
  expect(new URL(url).searchParams.get('quality')).toBe('auto');
  await page.locator('#motion').check();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const f = window.hologpu.field!;
        return f.reducedMotion && !f.dirty && !f.session.scheduler.submissionPending;
      }),
    )
    .toBe(true);
  const still = await page.evaluate(async () => {
    const f = window.hologpu.field!;
    f.advance(0);
    const a = Array.from((await f.readPixels()).pixels);
    f.advance(5);
    return {
      same: JSON.stringify(a) === JSON.stringify(Array.from((await f.readPixels()).pixels)),
      index: f.frame.index,
    };
  });
  expect(still).toEqual({ same: true, index: 0 });
});
for (const id of ['fluid', 'ink', 'smoke'])
  test(`${id} changes allocation controls before encoding, while paused and with queued steps`, async ({
    page,
  }) => {
    await page.goto(`/?effect=${id}&playing=false&params=%7B%22grid%22%3A32%7D`);
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
    await page.locator('#stage').evaluate((node: HTMLElement) => {
      node.style.width = '66px';
      node.style.height = '66px';
    });
    await expect
      .poll(() => page.evaluate(() => window.hologpu.field!.surface!.size[0]))
      .toBe(await page.evaluate(() => 64 * devicePixelRatio));
    const result = await page.evaluate(async () => {
      const f = window.hologpu.field!;
      f.advance(0);
      // A CPU allocation edit drops queued steps referencing the previous grid.
      f.step();
      f.store.set('grid', 64);
      f.reset(13);
      f.advance(0);
      const first = await f.readTap('velocity');
      f.advance(2);
      f.store.set('grid', 32);
      f.advance(1);
      const second = await f.readTap('velocity');
      await f.session.device.queue.onSubmittedWorkDone();
      return {
        first: [first.width, first.height],
        second: [second.width, second.height],
        finite: second.values.every(Number.isFinite),
        state: f.state,
        errors: f.session.errors,
      };
    });
    expect(result).toEqual({
      first: [64, 64],
      second: [32, 32],
      finite: true,
      state: 'ready',
      errors: [],
    });
  });
