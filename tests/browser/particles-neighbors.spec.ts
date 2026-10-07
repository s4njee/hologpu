import { test, expect, type Page } from '@playwright/test';
async function start(page: Page, id: string, params: Record<string, unknown>) {
  await page.goto(
    '/?' +
      new URLSearchParams({
        effect: id,
        playing: 'false',
        quality: 'fixed',
        params: JSON.stringify({ count: 32, grid: 8, trail: 0, ...params }),
      }),
  );
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await page.evaluate(() => {
    const f = window.hologpu.field!;
    f.reset(7);
    f.drawAt(0, 7);
    f.frame.buttons = 0;
  });
}
async function write(page: Page, state: number[]) {
  await page.evaluate((data) => {
    const f = window.hologpu.field!;
    f.session.device.queue.writeBuffer(f.bufferTaps.particles!.buffer, 0, new Float32Array(data));
  }, state);
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
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const encoder = device.createCommandEncoder();
      encoder.copyBufferToBuffer(tap.buffer, 0, staging, 0, size);
      device.queue.submit([encoder.finish()]);
      await staging.mapAsync(GPUMapMode.READ);
      const values = Array.from(
        kind === 'uint'
          ? new Uint32Array(staging.getMappedRange())
          : new Float32Array(staging.getMappedRange()),
      );
      staging.unmap();
      staging.destroy();
      return values;
    },
    { name, kind },
  );
}
const error = (a: number[], b: number[]) => {
  expect(a).toHaveLength(b.length);
  return Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));
};
const fixture = (n: number) =>
  Array.from({ length: n }, (_, i) => [
    0.15 + (0.7 * ((i * 13) % n)) / n,
    0.15 + (0.7 * ((i * 29 + 3) % n)) / n,
    0.01 * Math.sin(i),
    0.01 * Math.cos(i),
  ]).flat();
const periodic = (d: number) => d - Math.round(d);
async function clean(page: Page) {
  expect(await page.evaluate(() => window.hologpu.field!.session.errors)).toEqual([]);
}
test('Boids sorted-grid neighbor counts and steering equal periodic all-pairs CPU reference', async ({
  page,
}) => {
  const radius = 0.17,
    separation = 0.18,
    alignment = 2,
    cohesion = 2,
    maxSpeed = 0.25,
    dt = 1 / 60;
  await start(page, 'boids', { radius, separation, alignment, cohesion, maxSpeed, pointer: 0 });
  const initial = fixture(32);
  initial.splice(
    0,
    16,
    0.001,
    0.5,
    0.02,
    0,
    0.999,
    0.5,
    -0.02,
    0,
    0.5,
    0.001,
    0.8,
    0,
    0.5,
    0.999,
    -0.8,
    0,
  );
  await write(page, initial);
  const counts: number[] = [],
    expected: number[] = [];
  for (let i = 0; i < 32; i++) {
    let count = 0,
      sx = 0,
      sy = 0,
      vx = 0,
      vy = 0,
      cx = 0,
      cy = 0;
    for (let j = 0; j < 32; j++) {
      if (i === j) continue;
      const dx = periodic(initial[j * 4]! - initial[i * 4]!),
        dy = periodic(initial[j * 4 + 1]! - initial[i * 4 + 1]!),
        r2 = dx * dx + dy * dy;
      if (r2 < radius * radius) {
        count++;
        cx += dx;
        cy += dy;
        vx += initial[j * 4 + 2]!;
        vy += initial[j * 4 + 3]!;
        sx -= dx / Math.max(r2, 0.0001);
        sy -= dy / Math.max(r2, 0.0001);
      }
    }
    counts.push(count);
    let ux = initial[i * 4 + 2]!,
      uy = initial[i * 4 + 3]!;
    if (count) {
      ux +=
        dt *
        ((cohesion * cx) / count +
          alignment * (vx / count - ux) +
          (separation * 0.01 * sx) / count);
      uy +=
        dt *
        ((cohesion * cy) / count +
          alignment * (vy / count - uy) +
          (separation * 0.01 * sy) / count);
    }
    const speed = Math.hypot(ux, uy);
    if (speed > maxSpeed) {
      ux *= maxSpeed / speed;
      uy *= maxSpeed / speed;
    }
    expected.push(
      (initial[i * 4]! + dt * ux + 1) % 1,
      (initial[i * 4 + 1]! + dt * uy + 1) % 1,
      ux,
      uy,
    );
  }
  await page.evaluate(() => window.hologpu.field!.advance(1));
  const statistics = await read(page, 'statistics');
  expect(statistics.filter((_, i) => i % 4 === 0)).toEqual(counts);
  expect(error(await read(page, 'particles'), expected)).toBeLessThan(2e-6);
  const keys = await read(page, 'sortedKeys', 'uint'),
    ids = await read(page, 'sortedIndices', 'uint'),
    offsets = await read(page, 'cellOffsets', 'uint'),
    pop = await read(page, 'cellCounts', 'uint');
  expect([...ids].sort((a, b) => a - b)).toEqual(Array.from({ length: 32 }, (_, i) => i));
  expect(keys).toEqual([...keys].sort((a, b) => a - b));
  expect(offsets[64]).toBe(32);
  expect(pop.reduce((a, b) => a + b, 0)).toBe(32);
  for (let k = 0; k < 64; k++) {
    expect(offsets[k + 1]! - offsets[k]!).toBe(pop[k]);
    for (let slot = offsets[k]!; slot < offsets[k + 1]!; slot++) {
      const j = ids[slot]!;
      expect(keys[slot]).toBe(
        Math.floor(initial[4 * j]! * 8) + 8 * Math.floor(initial[4 * j + 1]! * 8),
      );
    }
  }
  expect(statistics.filter((_, i) => i % 4 === 1).some((v) => v < 31)).toBe(true);
  await clean(page);
});
function gravity(initial: number[], grid: number, approximate: boolean) {
  const n = initial.length / 4,
    groups = Array.from({ length: grid * grid }, () => [] as number[]);
  for (let i = 0; i < n; i++)
    groups[
      Math.floor(initial[i * 4]! * grid) + grid * Math.floor(initial[i * 4 + 1]! * grid)
    ]!.push(i);
  const result: number[] = [],
    acceleration: number[] = [],
    G = 0.025,
    soft = 0.025,
    dt = 1 / 60;
  for (let i = 0; i < n; i++) {
    let ax = 0,
      ay = 0;
    const x = initial[i * 4]!,
      y = initial[i * 4 + 1]!,
      hx = Math.floor(x * grid),
      hy = Math.floor(y * grid);
    const add = (px: number, py: number, m: number) => {
      const dx = px - x,
        dy = py - y,
        r2 = dx * dx + dy * dy + soft * soft,
        k = (G * m) / (r2 * Math.sqrt(r2));
      ax += dx * k;
      ay += dy * k;
    };
    if (!approximate) {
      for (let j = 0; j < n; j++) if (i !== j) add(initial[j * 4]!, initial[j * 4 + 1]!, 1 / n);
    } else
      for (let k = 0; k < groups.length; k++) {
        const group = groups[k]!;
        if (Math.abs((k % grid) - hx) <= 1 && Math.abs(Math.floor(k / grid) - hy) <= 1) {
          for (const j of group) if (i !== j) add(initial[j * 4]!, initial[j * 4 + 1]!, 1 / n);
        } else if (group.length) {
          add(
            group.reduce((s, j) => s + initial[j * 4]!, 0) / group.length,
            group.reduce((s, j) => s + initial[j * 4 + 1]!, 0) / group.length,
            group.length / n,
          );
        }
      }
    const vx = initial[i * 4 + 2]! + dt * ax,
      vy = initial[i * 4 + 3]! + dt * ay;
    result.push(x + dt * vx, y + dt * vy, vx, vy);
    acceleration.push(ax, ay);
  }
  return { result, acceleration };
}
for (const method of ['tiled', 'grid'] as const)
  test(`N-body ${method} force matches CPU and preserves body/mass invariants`, async ({
    page,
  }) => {
    await start(page, 'n-body', {
      count: 80,
      method,
      grid: 8,
      gravity: 0.025,
      softening: 0.025,
      damping: 0,
    });
    const initial = fixture(80);
    await write(page, initial);
    const expected = gravity(initial, 8, method === 'grid');
    await page.evaluate(() => window.hologpu.field!.advance(1));
    const actual = await read(page, 'particles'),
      stats = await read(page, 'statistics');
    expect(error(actual, expected.result)).toBeLessThan(3e-6);
    expect(
      error(
        stats.flatMap((v, i) => (i % 4 < 2 ? [v] : [])),
        expected.acceleration,
      ),
    ).toBeLessThan(3e-5);
    expect(stats.filter((_, i) => i % 4 === 3)).toEqual(Array(80).fill(1));
    expect(actual.every(Number.isFinite)).toBe(true);
    if (method === 'tiled') {
      for (const axis of [2, 3]) {
        const before = initial.filter((_, i) => i % 4 === axis).reduce((a, b) => a + b, 0),
          after = actual.filter((_, i) => i % 4 === axis).reduce((a, b) => a + b, 0);
        expect(Math.abs(after - before)).toBeLessThan(2e-6);
      }
    } else {
      const cells = await read(page, 'aggregates');
      expect(cells.filter((_, i) => i % 4 === 3).reduce((a, b) => a + b, 0)).toBe(80);
      expect(
        Math.abs(cells.filter((_, i) => i % 4 === 2).reduce((a, b) => a + b, 0) - 1),
      ).toBeLessThan(1e-6);
      const exact = gravity(initial, 8, false);
      expect(error(expected.acceleration, exact.acceleration)).toBeGreaterThan(1e-4);
    }
    await clean(page);
  });
test('Neighbor buffer reallocations restart deterministically and n-body reflects walls', async ({
  page,
}) => {
  await start(page, 'n-body', { count: 32, gravity: 0, damping: 0 });
  const initial = fixture(32);
  initial.splice(0, 4, 0.999, 0.001, 1, -1);
  await write(page, initial);
  await page.evaluate(() => window.hologpu.field!.advance(1));
  const state = await read(page, 'particles');
  expect(state[0]).toBeLessThan(1);
  expect(state[1]).toBeGreaterThan(0);
  expect(state[2]).toBe(-1);
  expect(state[3]).toBe(1);
  for (const id of ['boids', 'n-body']) {
    await start(page, id, {});
    await page.evaluate(() => {
      const f = window.hologpu.field!;
      f.store.patch({ count: 64, grid: 16 });
      f.advance(3);
    });
    const a = await read(page, 'particles');
    await page.evaluate(() => {
      const f = window.hologpu.field!;
      f.reset(7);
      f.advance(3);
    });
    expect(await read(page, 'particles')).toEqual(a);
    expect(a).toHaveLength(256);
    await clean(page);
  }
});
