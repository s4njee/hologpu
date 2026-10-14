import { test, expect, type Page } from '@playwright/test';
test.beforeEach(async ({ page }) => {
  await page.routeWebSocket(/.*/, (socket) => socket.close());
});
async function start(page: Page, id: string, params: Record<string, unknown> = {}) {
  await page.goto(
    '/?' +
      new URLSearchParams({
        effect: id,
        playing: 'false',
        quality: 'fixed',
        params: JSON.stringify({ count: 128, trail: 0, ...params }),
      }),
  );
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await page.locator('#stage').evaluate((node: HTMLElement) => {
    node.style.width = '162px';
    node.style.height = '162px';
  });
  await expect
    .poll(() => page.evaluate(() => window.hologpu.field!.surface!.size[0]))
    .toBe(await page.evaluate(() => 160 * devicePixelRatio));
  await page.evaluate(() => {
    const f = window.hologpu.field!;
    f.reset(7);
    f.drawAt(0, 7);
    f.frame.buttons = 0;
  });
}
async function read(page: Page, name: string, kind: 'float' | 'uint' = 'float') {
  return page.evaluate(
    async ({ name, kind }) => {
      const f = window.hologpu.field!,
        tap = f.bufferTaps[name]!,
        device = f.session.device,
        size = tap.count! * tap.stride!;
      const staging = device.createBuffer({
        size,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
      const encoder = device.createCommandEncoder();
      encoder.copyBufferToBuffer(tap.buffer, 0, staging, 0, size);
      device.queue.submit([encoder.finish()]);
      await staging.mapAsync(GPUMapMode.READ);
      const values = Array.from(
        kind === 'float'
          ? new Float32Array(staging.getMappedRange())
          : new Uint32Array(staging.getMappedRange()),
      );
      staging.unmap();
      staging.destroy();
      return values;
    },
    { name, kind },
  );
}
async function _write(page: Page, data: number[]) {
  await page.evaluate((data) => {
    const f = window.hologpu.field!;
    f.session.device.queue.writeBuffer(f.bufferTaps.particles!.buffer, 0, new Float32Array(data));
  }, data);
}
const difference = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));
async function clean(page: Page) {
  expect(await page.evaluate(() => window.hologpu.field!.session.errors)).toEqual([]);
}
for (const id of ['flow-particles', 'attractors', 'emitters', 'morph-particles'])
  test(`${id} compiles, replays identical state and supports point/quad HDR`, async ({ page }) => {
    await start(page, id);
    await page.evaluate(() => window.hologpu.field!.advance(8));
    const first = await read(page, 'particles');
    expect(first.every(Number.isFinite)).toBe(true);
    await page.evaluate(() => {
      const f = window.hologpu.field!;
      f.reset(7);
      f.advance(8);
    });
    expect(await read(page, 'particles')).toEqual(first);
    for (const mode of ['point', 'quad']) {
      await page.evaluate((mode) => {
        const f = window.hologpu.field!;
        f.store.patch({ draw: mode });
        f.advance(1);
      }, mode);
      const tap = await page.evaluate(async () =>
        Array.from((await window.hologpu.field!.readTap('hdr')).values),
      );
      expect(tap.every(Number.isFinite)).toBe(true);
      expect(tap.some((v, i) => i % 4 !== 3 && v > 0)).toBe(true);
    }
    await clean(page);
  });
test('Flow zero velocity keeps positions exactly and nonzero curl wraps normalized coordinates', async ({
  page,
}) => {
  await start(page, 'flow-particles', { speed: 0 });
  const initial = await read(page, 'particles');
  await page.evaluate(() => window.hologpu.field!.advance(8));
  const frozen = await read(page, 'particles');
  expect(
    difference(
      initial.filter((_, i) => i % 8 < 4),
      frozen.filter((_, i) => i % 8 < 4),
    ),
  ).toBeLessThan(1e-6);
  await page.evaluate(() => {
    const f = window.hologpu.field!;
    f.store.patch({ speed: 0.8 });
    f.advance(64);
  });
  const moved = await read(page, 'particles');
  expect(difference(initial, moved)).toBeGreaterThan(0.01);
  expect(moved.every((v, i) => i % 8 > 1 || (v >= -1 && v <= 1))).toBe(true);
  await clean(page);
});
test('Attractor map coordinates agree with CPU equations for Clifford and De Jong', async ({
  page,
}) => {
  for (const system of ['clifford', 'dejong']) {
    await start(page, 'attractors', { system, a: -1.4, b: 1.6, c: 1, d: 0.7 });
    const initial = await read(page, 'particles');
    await page.evaluate(() => window.hologpu.field!.advance(1));
    const actual = await read(page, 'particles');
    const expected = [...initial];
    for (let i = 0; i < 128; i++) {
      const x = initial[i * 8]!,
        y = initial[i * 8 + 1]!;
      expected[i * 8] =
        system === 'clifford'
          ? Math.sin(-1.4 * y) + Math.cos(-1.4 * x)
          : Math.sin(-1.4 * y) - Math.cos(1.6 * x);
      expected[i * 8 + 1] =
        system === 'clifford'
          ? Math.sin(1.6 * x) + 0.7 * Math.cos(1.6 * y)
          : Math.sin(x) - Math.cos(0.7 * y);
      expected[i * 8 + 2] = 0;
    }
    expect(difference(actual, expected)).toBeLessThan(0.001);
    await clean(page);
  }
});
test('Emitter life/death/free-list conservation and indirect draw count remain exact', async ({
  page,
}) => {
  await start(page, 'emitters', { rate: 0, lifetime: 0.1 });
  const initialCount = (await read(page, 'activeCount', 'uint'))[0]!;
  expect(initialCount).toBe(32);
  await page.evaluate(() => window.hologpu.field!.advance(12));
  expect((await read(page, 'activeCount', 'uint'))[0]).toBe(0);
  expect((await read(page, 'freeCount', 'uint'))[0]).toBe(128);
  expect((await read(page, 'freeList', 'uint')).slice(0, 128)).toEqual(
    Array.from({ length: 128 }, (_, i) => i),
  );
  await page.evaluate(() => {
    const f = window.hologpu.field!;
    f.store.patch({ rate: 6000, lifetime: 2 });
    f.advance(1);
  });
  const living = (await read(page, 'activeCount', 'uint'))[0]!,
    free = (await read(page, 'freeCount', 'uint'))[0]!;
  expect(living).toBe(100);
  expect(living + free).toBe(128);
  expect((await read(page, 'indirect', 'uint')).slice(0, 2)).toEqual([6, 100]);
  await page.evaluate(() => {
    const f = window.hologpu.field!;
    f.store.patch({ draw: 'point' });
    f.advance(0);
  });
  expect((await read(page, 'indirect', 'uint')).slice(0, 2)).toEqual([100, 1]);
  await clean(page);
});
test('Morph text/image local inputs and pointer scatter use raster targets and damped springs', async ({
  page,
}) => {
  await start(page, 'morph-particles', { spring: 18, damping: 5 });
  const targets = await read(page, 'targets'),
    initial = await read(page, 'particles');
  await page.evaluate(() => window.hologpu.field!.advance(1));
  const actual = await read(page, 'particles'),
    dt = 1 / 60;
  for (let i = 0; i < 128; i++)
    for (let k = 0; k < 2; k++) {
      const v = (targets[i * 4 + k]! - initial[i * 8 + k]!) * 18 * dt * Math.exp(-5 * dt);
      expect(actual[i * 8 + k]).toBeCloseTo(initial[i * 8 + k]! + v * dt, 6);
      expect(actual[i * 8 + 4 + k]).toBeCloseTo(v, 6);
    }
  await page.evaluate(() => window.hologpu.field!.store.set('word', 'FLOW'));
  expect(await read(page, 'targets')).not.toEqual(targets);
  await page.evaluate(async () => {
    const f = window.hologpu.field!;
    await f.setInput('text', 'A');
    f.reset(7);
    f.advance(0);
  });
  const a = await read(page, 'targets');
  expect(a).not.toEqual(targets);
  await page.evaluate(async () => {
    const f = window.hologpu.field!,
      canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, 16, 32);
    f.store.patch({ mask: 'image' });
    await f.setInput('image', canvas);
    f.reset(7);
    f.advance(0);
  });
  const image = await read(page, 'targets');
  expect(image.filter((_, i) => i % 4 === 0).every((v) => v <= 0)).toBe(true);
  await page.evaluate(() => {
    const f = window.hologpu.field!;
    f.frame.pointer = [0.5, 0.5];
    f.frame.buttons = 1;
    f.advance(8);
  });
  expect(await read(page, 'particles')).not.toEqual(actual);
  await clean(page);
});
test('Lorenz and Aizawa RK4 derivatives agree with one-step CPU references', async ({ page }) => {
  for (const system of ['lorenz', 'aizawa']) {
    await start(page, 'attractors', { system, rate: 0.6 });
    const initial = await read(page, 'particles');
    await page.evaluate(() => window.hologpu.field!.advance(1));
    const actual = await read(page, 'particles'),
      dt = 0.6 / 60,
      expected = [...initial];
    const derivative = (v: number[]) => {
      const [x, y, z] = v as [number, number, number];
      if (system === 'lorenz') return [10 * (y - x), x * (28 - z) - y, x * y - (8 / 3) * z];
      const r = x * x + y * y;
      return [
        (z - 0.7) * x - 3.5 * y,
        3.5 * x + (z - 0.7) * y,
        0.6 + 0.95 * z - (z * z * z) / 3 - r * (1 + 0.25 * z) + 0.1 * z * x * x * x,
      ];
    };
    for (let i = 0; i < 128; i++) {
      const v = initial.slice(i * 8, i * 8 + 3),
        k1 = derivative(v),
        k2 = derivative(v.map((x, k) => x + (k1[k]! * dt) / 2)),
        k3 = derivative(v.map((x, k) => x + (k2[k]! * dt) / 2)),
        k4 = derivative(v.map((x, k) => x + k3[k]! * dt));
      for (let k = 0; k < 3; k++)
        expected[i * 8 + k] = v[k]! + (dt * (k1[k]! + 2 * k2[k]! + 2 * k3[k]! + k4[k]!)) / 6;
    }
    expect(difference(actual, expected)).toBeLessThan(5e-6);
    await clean(page);
  }
});
