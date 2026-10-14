import { test, expect, type Page } from '@playwright/test';
import { tracerSpheres } from '../../packages/effects/src/_stretch/bvh.ts';
async function start(page: Page, id: string, params: Record<string, unknown> = {}) {
  await page.routeWebSocket(/127\.0\.0\.1:5175/, (socket) => socket.close());
  await page.goto(
    '/?' +
      new URLSearchParams({
        effect: id,
        playing: 'false',
        quality: 'fixed',
        resolution: '.25',
        seed: '7',
        params: JSON.stringify(params),
      }),
  );
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready', { timeout: 30000 });
  await page.locator('#stage').evaluate((node: HTMLElement) => {
    node.style.width = '130px';
    node.style.height = '130px';
  });
  await expect
    .poll(() => page.evaluate(() => window.hologpu.field!.surface!.size[0]))
    .toBe(await page.evaluate(() => 32 * devicePixelRatio));
  await page.evaluate(() => {
    const f = window.hologpu.field!;
    f.reset(7);
    f.advance(0);
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
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const e = device.createCommandEncoder();
      e.copyBufferToBuffer(tap.buffer, 0, staging, 0, size);
      device.queue.submit([e.finish()]);
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
async function advance(page: Page, n: number) {
  await page.evaluate((n) => window.hologpu.field!.advance(n), n);
}
async function clean(page: Page) {
  expect(await page.evaluate(() => window.hologpu.field!.session.errors)).toEqual([]);
}
const error = (a: number[], b: number[]) => {
  expect(a).toHaveLength(b.length);
  return Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));
};
test('MPM quadratic transfers conserve mass and reproduce uniform momentum', async ({ page }) => {
  await start(page, 'mpm', { count: 16, grid: 16, steps: 1, bulk: 0, gravity: 0 });
  const fixture = Array.from({ length: 16 }, (_, i) => [
    0.3 + (i % 4) * 0.04,
    0.3 + Math.floor(i / 4) * 0.04,
    0.1,
    -0.02,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    1,
    1,
    0,
    0,
    0,
  ]).flat();
  await page.evaluate((data) => {
    const f = window.hologpu.field!;
    f.session.device.queue.writeBuffer(f.bufferTaps.particles!.buffer, 0, new Float32Array(data));
  }, fixture);
  await advance(page, 1);
  const grid = await read(page, 'grid'),
    particles = await read(page, 'particles');
  const weight = (x: number) =>
    Math.abs(x) < 0.5 ? 0.75 - x * x : Math.abs(x) < 1.5 ? 0.5 * (1.5 - Math.abs(x)) ** 2 : 0;
  const masses = Array.from({ length: 256 }, (_, i) =>
    Array.from(
      { length: 16 },
      (_, j) =>
        (weight((i % 16) - fixture[j * 16]! * 16) *
          weight(Math.floor(i / 16) - fixture[j * 16 + 1]! * 16)) /
        16,
    ).reduce((a, b) => a + b, 0),
  );
  expect(
    error(
      grid.filter((_, i) => i % 4 === 2),
      masses,
    ),
  ).toBeLessThan(1e-7);
  expect(masses.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  expect(grid.reduce((sum, v, i) => sum + (i % 4 === 2 ? v : 0), 0)).toBeCloseTo(1, 5);
  expect(grid.reduce((sum, v, i) => sum + (i % 4 === 0 ? v * grid[i + 2]! : 0), 0)).toBeCloseTo(
    0.1,
    5,
  );
  for (let i = 0; i < 16; i++) {
    expect(particles[i * 16]!).toBeCloseTo(fixture[i * 16]! + 0.002 * 0.1, 5);
    expect(particles[i * 16 + 1]!).toBeCloseTo(fixture[i * 16 + 1]! - 0.002 * 0.02, 5);
    expect(particles[i * 16 + 2]!).toBeCloseTo(0.1, 5);
    expect(particles[i * 16 + 3]!).toBeCloseTo(-0.02, 5);
  }
  await clean(page);
});
test('PBF sorted neighbors, lambda and one Jacobi correction equal an all-pairs CPU reference', async ({
  page,
}) => {
  await start(page, 'pbf-fluid', {
    count: 32,
    gravity: 0,
    support: 0.1,
    restDensity: 100,
    iterations: 1,
  });
  const initial = await read(page, 'particles');
  const h = 0.1,
    rho0 = 100,
    eps = 0.001;
  const W = (x: number, y: number) =>
    (4 * Math.max(0, h * h - x * x - y * y) ** 3) / (Math.PI * h ** 8);
  const grad = (x: number, y: number) => {
    const r = Math.hypot(x, y);
    const s = r < 1e-6 || r >= h ? 0 : (-30 * (h - r) ** 2) / (Math.PI * h ** 5 * r);
    return [x * s, y * s];
  };
  const stats = Array.from({ length: 32 }, (_, i) => {
    let rho = 0,
      denom = 0,
      gx = 0,
      gy = 0,
      neighbors = 0;
    for (let j = 0; j < 32; j++) {
      const x = initial[i * 4]! - initial[j * 4]!,
        y = initial[i * 4 + 1]! - initial[j * 4 + 1]!;
      rho += W(x, y);
      if (i !== j && x * x + y * y < h * h) {
        const g = grad(x, y);
        gx += g[0]! / rho0;
        gy += g[1]! / rho0;
        denom += (g[0]! ** 2 + g[1]! ** 2) / rho0 ** 2;
        neighbors++;
      }
    }
    const c = Math.max(0, rho / rho0 - 1);
    return [-c / (denom + gx * gx + gy * gy + eps), rho, c, neighbors];
  });
  const expected = initial.slice();
  for (let i = 0; i < 32; i++) {
    let dx = 0,
      dy = 0;
    for (let j = 0; j < 32; j++) {
      if (i === j) continue;
      const g = grad(initial[i * 4]! - initial[j * 4]!, initial[i * 4 + 1]! - initial[j * 4 + 1]!);
      const s = (stats[i]![0]! + stats[j]![0]!) / rho0;
      dx += s * g[0]!;
      dy += s * g[1]!;
    }
    const scale = Math.min(1, 0.01 / Math.max(1e-6, Math.hypot(dx, dy)));
    expected[i * 4] = Math.min(0.975, Math.max(0.025, initial[i * 4]! + dx * scale));
    expected[i * 4 + 1] = Math.min(0.975, Math.max(0.025, initial[i * 4 + 1]! + dy * scale));
  }
  await advance(page, 1);
  const actualStats = await read(page, 'constraints'),
    actual = await read(page, 'particles');
  expect(
    error(
      actualStats.filter((_, i) => i % 4 === 1),
      stats.map((s) => s[1]!),
    ),
  ).toBeLessThan(0.002);
  expect(
    error(
      actualStats.filter((_, i) => i % 4 === 0),
      stats.map((s) => s[0]!),
    ),
  ).toBeLessThan(1e-6);
  expect(actualStats.filter((_, i) => i % 4 === 3)).toEqual(stats.map((s) => s[3]!));
  expect(
    error(
      actual.filter((_, i) => i % 4 < 2),
      expected.filter((_, i) => i % 4 < 2),
    ),
  ).toBeLessThan(1e-6);
  await clean(page);
});
test('D2Q9 periodic pull streaming and BGK collision match CPU and conserve mass', async ({
  page,
}) => {
  await start(page, 'lattice-boltzmann', {
    grid: 16,
    boundary: 'periodic',
    obstacle: 0,
    steps: 1,
    tau: 0.8,
  });
  const before = await read(page, 'distributions');
  const E = [
      [0, 0],
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
      [1, 1],
      [-1, 1],
      [-1, -1],
      [1, -1],
    ],
    W = [4 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 36, 1 / 36, 1 / 36, 1 / 36];
  const expected = before.slice();
  for (let i = 0; i < 256; i++) {
    const incoming = E.map((e) => {
      const x = ((i % 16) - e[0]! + 16) % 16,
        y = (Math.floor(i / 16) - e[1]! + 16) % 16;
      return before[(x + y * 16) * 9 + E.indexOf(e)]!;
    });
    const rho = incoming.reduce((a, b) => a + b, 0);
    const vx = incoming.reduce((a, b, q) => a + b * E[q]![0]!, 0) / rho,
      vy = incoming.reduce((a, b, q) => a + b * E[q]![1]!, 0) / rho;
    for (let q = 0; q < 9; q++) {
      const eu = E[q]![0]! * vx + E[q]![1]! * vy;
      const eq = W[q]! * rho * (1 + 3 * eu + 4.5 * eu * eu - 1.5 * (vx * vx + vy * vy));
      expected[i * 9 + q] = incoming[q]! - (incoming[q]! - eq) / 0.8;
    }
  }
  await advance(page, 1);
  const actual = await read(page, 'distributions');
  expect(error(actual, expected)).toBeLessThan(2e-7);
  expect(
    Math.abs(actual.reduce((a, b) => a + b, 0) - before.reduce((a, b) => a + b, 0)),
  ).toBeLessThan(0.0001);
  await advance(page, 64);
  const stable = await read(page, 'distributions');
  expect(stable.every(Number.isFinite)).toBe(true);
  expect(
    Math.abs(stable.reduce((a, b) => a + b, 0) - before.reduce((a, b) => a + b, 0)),
  ).toBeLessThan(0.003);
  await clean(page);
});
test('BVH primary intersections match brute-force spheres and accumulation resets only for radiance changes', async ({
  page,
}) => {
  await start(page, 'path-tracer', { samples: 1 });
  const primary = await read(page, 'primaryHits');
  const size = await page.evaluate(() => window.hologpu.field!.surface!.size);
  const expected: number[] = [];
  for (let y = 0; y < size[1]; y++)
    for (let x = 0; x < size[0]; x++) {
      let d = [
        (((((x + 0.5) / size[0]) * 2 - 1) * size[0]) / size[1]) * 0.55,
        -(((y + 0.5) / size[1]) * 2 - 1) * 0.55,
        -1,
      ];
      const norm = Math.hypot(...d);
      d = d.map((v) => v / norm);
      let nearest = 1e20,
        index = -1;
      tracerSpheres.forEach((s, i) => {
        const o = [-s[0], 0.5 - s[1], 3.5 - s[2]];
        const b = o.reduce((sum, v, a) => sum + v * d[a]!, 0),
          c = o.reduce((sum, v) => sum + v * v, 0) - s[3] ** 2,
          q = b * b - c;
        if (q < 0) return;
        const roots = [-b - Math.sqrt(q), -b + Math.sqrt(q)].filter((v) => v > 0.0001);
        const t = Math.min(...roots);
        if (t < nearest) {
          nearest = t;
          index = i;
        }
      });
      expected.push(index < 0 ? 0 : nearest, index, 0, 0);
    }
  expect(error(primary, expected)).toBeLessThan(0.004);
  const initial = await read(page, 'accumulation');
  expect(initial.filter((_, i) => i % 4 === 3).every((v) => v === 1)).toBe(true);
  await advance(page, 3);
  const accumulated = await read(page, 'accumulation');
  expect(accumulated.filter((_, i) => i % 4 === 3).every((v) => v === 4)).toBe(true);
  await page.evaluate(() => {
    const f = window.hologpu.field!;
    f.store.set('exposure', 2);
    f.advance(0);
  });
  expect(await read(page, 'accumulation')).toEqual(accumulated);
  await page.evaluate(() => {
    const f = window.hologpu.field!;
    f.store.set('angle', 0.3);
    f.advance(0);
  });
  expect(
    (await read(page, 'accumulation')).filter((_, i) => i % 4 === 3).every((v) => v === 1),
  ).toBe(true);
  await clean(page);
});
test('Gaussian depth sort is a permutation and projected conics are positive definite', async ({
  page,
}) => {
  await start(page, 'splats', { count: 64, speed: 0 });
  const keys = await read(page, 'sortedKeys', 'uint'),
    ids = await read(page, 'sortedIndices', 'uint'),
    p = await read(page, 'projected'),
    source = await read(page, 'splats');
  expect([...ids].sort((a, b) => a - b)).toEqual(Array.from({ length: 64 }, (_, i) => i));
  expect(keys).toEqual([...keys].sort((a, b) => a - b));
  for (let i = 0; i < 64; i++) {
    const q = p.slice(i * 16, i * 16 + 16);
    expect(q[4]).toBeGreaterThan(0);
    expect(q[6]).toBeGreaterThan(0);
    expect(q[4]! * q[6]! - q[5]! ** 2).toBeGreaterThan(0);
    expect(q[2]).toBeCloseTo(source[i * 20 + 2]! + 3, 5);
    if (i > 0) expect(p[ids[i - 1]! * 16 + 2]!).toBeGreaterThanOrEqual(p[ids[i]! * 16 + 2]!);
  }
  const sorted = await page.evaluate(async () =>
    Array.from((await window.hologpu.field!.readPixels()).pixels),
  );
  await page.evaluate(() => {
    const f = window.hologpu.field!;
    f.store.set('order', 'source');
    f.advance(0);
  });
  const unsorted = await page.evaluate(async () =>
    Array.from((await window.hologpu.field!.readPixels()).pixels),
  );
  expect(unsorted).not.toEqual(sorted);
  await clean(page);
});
test('Backdrop zero distortion is identity and unavailable DOM capture is explicit', async ({
  page,
}) => {
  await start(page, 'backdrop-glass', { refraction: 0, frost: 0, dispersion: 0 });
  const result = await page.evaluate(async () => {
    const f = window.hologpu.field!,
      device = f.session.device;
    const texture = device.createTexture({
      size: [1, 1],
      format: 'rgba32float',
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
    });
    device.queue.writeTexture(
      { texture },
      new Float32Array([0.25, 0.5, 0.75, 1]),
      { bytesPerRow: 16 },
      { width: 1, height: 1 },
    );
    await f.bindInput('image', {
      kind: 'texture',
      source: { texture, width: 1, height: 1, format: 'rgba32float', kind: 'float' },
    });
    f.advance(0);
    const pixels = Array.from((await f.readPixels()).pixels.slice(0, 4));
    const e = document.createElement('div');
    let message = '';
    try {
      await f.setInput('element', e);
    } catch (error) {
      message = String(error);
    }
    f.destroy();
    texture.destroy();
    return { pixels, message };
  });
  expect(result.pixels).toEqual([137, 188, 225, 255]);
  expect(result.message).toMatch(/unavailable|direct child/);
  await expect(page.locator('#backdrop-experiment')).toContainText('Texture preview');
});
