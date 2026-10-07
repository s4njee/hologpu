import { test, expect, type Page } from '@playwright/test';
import type { ParamValues } from '../../packages/core/src/params.ts';
const n = 32;
async function start(page: Page, id: string, params: ParamValues = {}) {
  const query = new URLSearchParams({
    effect: id,
    playing: 'false',
    quality: 'fixed',
    seed: '7',
    params: JSON.stringify({
      grid: n,
      ...(['fluid', 'ink', 'smoke'].includes(id) ? {} : { steps: 1 }),
      ...params,
    }),
  });
  await page.goto(`/?${query}`);
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await page.locator('#stage').evaluate((node: HTMLElement) => {
    node.style.width = '66px';
    node.style.height = '66px';
  });
  await expect
    .poll(() => page.evaluate(() => window.hologpu.field!.surface!.size[0]))
    .toBe(await page.evaluate(() => 64 * devicePixelRatio));
  await page.evaluate(() => {
    const field = window.hologpu.field!;
    field.reset(7);
    field.drawAt(0, 7);
    field.frame.buttons = 0;
  });
}
async function read(page: Page, name = 'state') {
  return page.evaluate(async (tapName) => {
    const tap = await window.hologpu.field!.readTap(tapName);
    return {
      width: tap.width,
      height: tap.height,
      channels: tap.channels,
      values: Array.from(tap.values),
    };
  }, name);
}
async function advance(page: Page, count = 1) {
  await page.evaluate((steps) => window.hologpu.field!.advance(steps), count);
}
async function write(page: Page, values: number[], name = 'state') {
  await page.evaluate(
    ({ data, name }) => {
      const field = window.hologpu.field!,
        tap = field.textureTaps[name]!;
      const half = (value: number) => {
        const sign = value < 0 ? 0x8000 : 0,
          absolute = Math.abs(value);
        if (absolute === 0) return sign;
        const round = (x: number) => {
          const i = Math.floor(x),
            t = x - i;
          return t < 0.5 ? i : t > 0.5 ? i + 1 : i + (i & 1);
        };
        let exponent = Math.floor(Math.log2(absolute));
        if (exponent < -14) return sign | round(absolute / 2 ** -24);
        let mantissa = round((absolute / 2 ** exponent - 1) * 1024);
        if (mantissa === 1024) {
          exponent++;
          mantissa = 0;
        }
        return sign | ((exponent + 15) << 10) | mantissa;
      };
      const format = tap.format;
      const raw =
        format === 'r32uint'
          ? new Uint32Array(data)
          : format === 'r32float'
            ? new Float32Array(data)
            : new Uint16Array(data.map(half));
      field.session.device.queue.writeTexture(
        { texture: tap.texture },
        raw,
        { bytesPerRow: raw.byteLength / tap.height },
        [tap.width, tap.height],
      );
    },
    { data: values, name },
  );
}
function floatState(cell: (x: number, y: number) => readonly number[]) {
  const values: number[] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) values.push(...cell(x, y));
  return values;
}
function maximumError(actual: number[], expected: number[]) {
  expect(actual).toHaveLength(expected.length);
  return Math.max(...actual.map((v, i) => Math.abs(v - expected[i]!)));
}
function hash(value: number) {
  let h = value >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}
function cellRandom(x: number, y: number, seed: number) {
  return (
    (hash(hash(Math.imul(x, 0x9e3779b9) ^ hash((Math.imul(y, 0x85ebca6b) + seed) >>> 0))) >>> 8) /
    16777216
  );
}
const wrapped = (x: number) => ((x % n) + n) % n;
const clamped = (x: number) => Math.max(0, Math.min(n - 1, x));
async function clean(page: Page) {
  expect(await page.evaluate(() => window.hologpu.field!.session.errors)).toEqual([]);
}

test('Life integer cells match all five rule masks, wrapped neighbors and a two-step blinker', async ({
  page,
}) => {
  await start(page, 'life');
  const fixtures = Array.from({ length: n * n }, (_, i) =>
    (hash(i + 47) >>> 8) / 16777216 < 0.31 ? 1 : 0,
  );
  for (const [rule, birth, survival] of [
    ['life', 8, 12],
    ['highlife', 72, 12],
    ['seeds', 4, 0],
    ['day-night', 456, 472],
    ['custom', 6, 256],
  ] as const) {
    await page.evaluate((values) => window.hologpu.field!.store.patch(values), {
      rule,
      birthMask: birth,
      survivalMask: survival,
    });
    await write(page, fixtures);
    const expected = fixtures.map((alive, i) => {
      const x = i % n,
        y = Math.floor(i / n);
      let count = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (dx || dy) count += fixtures[wrapped(y + dy) * n + wrapped(x + dx)]!;
      return ((alive ? survival : birth) >>> count) & 1;
    });
    await advance(page);
    expect((await read(page)).values).toEqual(expected);
  }
  await page.evaluate(() => window.hologpu.field!.store.patch({ rule: 'life' }));
  const blinker = Array<number>(n * n).fill(0);
  for (const x of [14, 15, 16]) blinker[15 * n + x] = 1;
  await write(page, blinker);
  await advance(page);
  const vertical = Array<number>(n * n).fill(0);
  for (const y of [14, 15, 16]) vertical[y * n + 15] = 1;
  expect((await read(page)).values).toEqual(vertical);
  await advance(page);
  expect((await read(page)).values).toEqual(blinker);
  await clean(page);
});

test('Life guarded sampled-integer fallback preserves a wrapped blinker without the storage extension', async ({
  page,
}) => {
  await page.addInitScript(() => {
    // Force only the author's capability branch; the browser's underlying WebGPU remains real.
    Object.defineProperty(navigator.gpu, 'wgslLanguageFeatures', { value: { has: () => false } });
  });
  await start(page, 'life');
  expect(await page.evaluate(() => window.hologpu.field!.sources['step']!.code)).toContain(
    'var state:texture_2d<u32>',
  );
  const horizontal = Array<number>(n * n).fill(0);
  for (const x of [31, 0, 1]) horizontal[15 * n + x] = 1;
  await write(page, horizontal);
  await advance(page);
  const vertical = Array<number>(n * n).fill(0);
  for (const y of [14, 15, 16]) vertical[y * n] = 1;
  expect((await read(page)).values).toEqual(vertical);
  await advance(page);
  expect((await read(page)).values).toEqual(horizontal);
  await clean(page);
});

test('Gray–Scott uses the weighted diffusion stencil and preserves the reagent equilibrium', async ({
  page,
}) => {
  await start(page, 'reaction-diffusion', { dt: 0.5, feed: 0.03, kill: 0.06, map: false });
  for (const map of [false, true]) {
    await page.evaluate((map) => window.hologpu.field!.store.patch({ map }), map);
    await write(
      page,
      floatState((x, y) => [0.65 + 0.1 * Math.sin(x * 0.5), 0.12 + 0.03 * Math.cos(y * 0.6), 0, 1]),
    );
    const before = (await read(page)).values;
    const at = (x: number, y: number, c: number) => before[(wrapped(y) * n + wrapped(x)) * 4 + c]!;
    const expected = floatState((x, y) => {
      const a = at(x, y, 0),
        b = at(x, y, 1);
      const lap = (c: number) =>
        -at(x, y, c) +
        0.2 * (at(x + 1, y, c) + at(x - 1, y, c) + at(x, y + 1, c) + at(x, y - 1, c)) +
        0.05 *
          (at(x + 1, y + 1, c) + at(x + 1, y - 1, c) + at(x - 1, y + 1, c) + at(x - 1, y - 1, c));
      const reaction = a * b * b;
      const feed = map ? 0.01 + (0.07 * (x + 0.5)) / n : 0.03;
      const kill = map ? 0.045 + (0.03 * (y + 0.5)) / n : 0.06;
      return [
        Math.max(0, Math.min(1, a + 0.5 * (lap(0) - reaction + feed * (1 - a)))),
        Math.max(0, Math.min(1, b + 0.5 * (0.5 * lap(1) + reaction - (feed + kill) * b))),
        0,
        1,
      ];
    });
    await advance(page);
    expect(maximumError((await read(page)).values, expected)).toBeLessThan(0.0006);
  }
  const equilibrium = floatState(() => [1, 0, 0, 1]);
  await write(page, equilibrium);
  await advance(page, 8);
  expect((await read(page)).values).toEqual(equilibrium);
  await clean(page);
});

test('Lenia convolution matches its radial lookup and normalized Gaussian growth', async ({
  page,
}) => {
  await start(page, 'lenia', { radius: 2, mean: 0.2, sigma: 0.08, dt: 0.1 });
  await write(
    page,
    floatState((x, y) => [0.2 + 0.05 * Math.sin(x * 0.4) * Math.cos(y * 0.7), 0, 0, 1]),
  );
  const before = (await read(page)).values;
  const weights: { x: number; y: number; w: number }[] = [];
  for (let y = -2; y <= 2; y++)
    for (let x = -2; x <= 2; x++) {
      const r = Math.hypot(x, y) / 2;
      if (r < 1) {
        const i = Math.floor(r * 255);
        weights.push({ x, y, w: Math.fround(Math.exp(-0.5 * ((i / 255 - 0.5) / 0.15) ** 2)) });
      }
    }
  const weight = weights.reduce((sum, item) => sum + item.w, 0);
  const expected = floatState((x, y) => {
    const u =
      weights.reduce(
        (sum, item) => sum + item.w * before[(wrapped(y + item.y) * n + wrapped(x + item.x)) * 4]!,
        0,
      ) / weight;
    const growth = 2 * Math.exp(-0.5 * ((u - 0.2) / 0.08) ** 2) - 1;
    return [Math.max(0, Math.min(1, before[(y * n + x) * 4]! + 0.1 * growth)), u, growth, 1];
  });
  await advance(page);
  expect(maximumError((await read(page)).values, expected)).toBeLessThan(0.001);
  await clean(page);
});

test('Wave two-time-level stencil matches CPU integration and keeps zero history at rest', async ({
  page,
}) => {
  await start(page, 'wave', { courant: 0.4, damping: 0.98 });
  await write(
    page,
    floatState((x, y) => [
      0.1 * Math.sin(x * 0.3) * Math.cos(y * 0.2),
      0.07 * Math.sin(x * 0.3) * Math.cos(y * 0.2),
      0,
      1,
    ]),
  );
  const before = (await read(page)).values;
  const at = (x: number, y: number) => before[(clamped(y) * n + clamped(x)) * 4]!;
  const expected = floatState((x, y) => {
    const h = at(x, y),
      previous = before[(y * n + x) * 4 + 1]!,
      lap = at(x + 1, y) + at(x - 1, y) + at(x, y + 1) + at(x, y - 1) - 4 * h;
    return [h + 0.98 * (h - previous) + 0.16 * lap, h, 0, 1];
  });
  await advance(page);
  expect(maximumError((await read(page)).values, expected)).toBeLessThan(0.00015);
  const zero = floatState(() => [0, 0, 0, 1]);
  await write(page, zero);
  await advance(page, 12);
  expect((await read(page)).values).toEqual(zero);
  await clean(page);
});

function sandStep(before: number[], phase: number) {
  const after = Array<number>(n * n).fill(0),
    kind = (v: number) => v & 255;
  const heavy = (a: number, b: number) =>
    (kind(a) === 1 && [0, 2, 3].includes(kind(b))) || (kind(a) === 2 && [0, 3].includes(kind(b)));
  for (let y = 0; y < n; y += 2)
    for (let x = 0; x < n; x += 2) {
      const bx = x + phase,
        by = y + phase;
      const cells = [
        [bx, by],
        [bx + 1, by],
        [bx, by + 1],
        [bx + 1, by + 1],
      ].map(([cx, cy]) => wrapped(cy!) * n + wrapped(cx!));
      const v = cells.map((i) => before[i]!);
      const swap = (a: number, b: number) => {
        [v[a], v[b]] = [v[b]!, v[a]!];
      };
      for (let i = 0; i < 4; i++)
        if (kind(v[i]!) === 3) v[i] = v[i]! >>> 8 > 1 ? 3 | (((v[i]! >>> 8) - 1) << 8) : 0;
      if (heavy(v[0]!, v[2]!)) swap(0, 2);
      if (heavy(v[1]!, v[3]!)) swap(1, 3);
      const choice = cellRandom(bx, by, 7 + phase * 37);
      if (choice < 0.5) {
        if (kind(v[0]!) === 1 && kind(v[3]!) === 0) swap(0, 3);
      } else if (kind(v[1]!) === 1 && kind(v[2]!) === 0) swap(1, 2);
      for (let column = 0; column < 2; column++)
        if (kind(v[column + 2]!) === 3 && kind(v[column]!) === 0) swap(column, column + 2);
      for (let row = 0; row < 2; row++) {
        const left = row * 2,
          right = left + 1;
        if (
          ((kind(v[left]!) === 2 && kind(v[right]!) === 0) ||
            (kind(v[right]!) === 2 && kind(v[left]!) === 0)) &&
          choice < 0.5
        )
          swap(left, right);
      }
      cells.forEach((cell, i) => {
        after[cell] = v[i]!;
      });
    }
  return after;
}
test('Sand uses alternating disjoint blocks, conserves stable materials and expires fire TTL', async ({
  page,
}) => {
  await start(page, 'falling-sand', { waterFlow: true });
  const before = Array.from({ length: n * n }, (_, i) => {
    const x = i % n,
      y = Math.floor(i / n);
    if (x === 0 || x === n - 1 || y === n - 1) return 4;
    if (y === 4 && x > 5 && x < 25) return 1;
    if (y === 19 && x > 9 && x < 20) return 2;
    if (x === 20 && y === 12) return 3 | (2 << 8);
    return 0;
  });
  const counts = (values: number[], material: number) =>
    values.filter((v) => (v & 255) === material).length;
  await write(page, before);
  await advance(page);
  const first = (await read(page)).values;
  expect(first).toEqual(sandStep(before, 0));
  await advance(page);
  const second = (await read(page)).values;
  expect(second).toEqual(sandStep(first, 1));
  for (const material of [1, 2, 4]) expect(counts(second, material)).toBe(counts(before, material));
  expect(counts(second, 3)).toBe(0);
  const meanSandY = (values: number[]) =>
    values.reduce((sum, v, i) => sum + ((v & 255) === 1 ? Math.floor(i / n) : 0), 0) /
    counts(values, 1);
  expect(meanSandY(second)).toBeGreaterThan(meanSandY(before));
  await clean(page);
});

test('Physarum agents stay bounded and atomic deposits account for every agent', async ({
  page,
}) => {
  await start(page, 'physarum', { agents: 256, deposit: 0.25, diffusion: 0, decay: 0.97 });
  await page.evaluate(() => {
    const field = window.hologpu.field!,
      bytes = new ArrayBuffer(256 * 16),
      view = new DataView(bytes);
    for (let i = 0; i < 256; i++) {
      view.setFloat32(i * 16, i < 128 ? 0.99 : 0.01, true);
      view.setFloat32(i * 16 + 4, 0.5, true);
      view.setFloat32(i * 16 + 8, i < 128 ? 0 : Math.PI, true);
      view.setUint32(i * 16 + 12, i, true);
    }
    field.session.device.queue.writeBuffer(field.bufferTaps['agents']!.buffer, 0, bytes);
  });
  await advance(page);
  const records = await page.evaluate(async () => {
    const field = window.hologpu.field!,
      device = field.session.device;
    const result: Record<string, number[]> = {};
    for (const name of ['agents', 'deposits']) {
      const tap = field.bufferTaps[name]!,
        buffer = device.createBuffer({
          label: 'test-buffer-staging',
          size: tap.buffer.size,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
      try {
        const encoder = device.createCommandEncoder();
        encoder.copyBufferToBuffer(tap.buffer, 0, buffer, 0, tap.buffer.size);
        device.queue.submit([encoder.finish()]);
        await buffer.mapAsync(GPUMapMode.READ);
        const bytes = buffer.getMappedRange();
        result[name] = Array.from(
          name === 'agents' ? new Float32Array(bytes) : new Uint32Array(bytes),
        );
      } finally {
        buffer.destroy();
      }
    }
    return result;
  });
  for (let i = 0; i < records['agents']!.length; i += 4) {
    expect(records['agents']![i]).toBeGreaterThanOrEqual(0);
    expect(records['agents']![i]).toBeLessThan(1);
    expect(records['agents']![i + 1]).toBeGreaterThanOrEqual(0);
    expect(records['agents']![i + 1]).toBeLessThan(1);
    expect(Number.isFinite(records['agents']![i + 2])).toBe(true);
    expect(records['agents']![i]).toBeCloseTo(i < 128 * 4 ? 0.0275 : 0.9725, 5);
  }
  expect(records['deposits']!.reduce((sum, value) => sum + value, 0)).toBe(256 * 1024);
  const trail = (await read(page, 'trail')).values;
  expect(trail.filter((_, i) => i % 4 === 0).reduce((sum, value) => sum + value, 0)).toBe(
    256 * 0.25,
  );
  await advance(page, 64);
  expect((await read(page, 'trail')).values.every(Number.isFinite)).toBe(true);
  await clean(page);
});

const passive = { source: 0, force: 0, drag: 0, viscosity: 0, vorticity: 0, dissipation: 0 };
test('Fluid transports periodic constant velocity and dye without changing either field', async ({
  page,
}) => {
  await start(page, 'fluid', {
    ...passive,
    initial: 'uniform',
    boundary: 'periodic',
    iterations: 80,
  });
  const velocity = await read(page, 'velocity'),
    dye = await read(page, 'dye');
  expect(velocity.width).toBe(n);
  expect(velocity.height).toBe(n);
  expect(Math.max(...velocity.values.map(Math.abs))).toBeGreaterThan(0.1);
  await advance(page, 16);
  expect((await read(page, 'velocity')).values).toEqual(velocity.values);
  expect((await read(page, 'dye')).values).toEqual(dye.values);
  await clean(page);
});
test('Fluid pressure projection reduces measured L2 divergence of compressive periodic flow', async ({
  page,
}) => {
  await start(page, 'fluid', {
    ...passive,
    initial: 'compression',
    boundary: 'periodic',
    iterations: 80,
  });
  await advance(page);
  const before = (await read(page, 'divergence')).values,
    after = (await read(page, 'projectedDivergence')).values;
  const l2 = (values: number[]) =>
    Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
  // The stored divergence is a face difference; multiply by inverse cell spacing for domain units.
  expect(l2(before) * n).toBeGreaterThan(1);
  expect(l2(after) / l2(before)).toBeLessThan(0.55);
  expect(after.every(Number.isFinite)).toBe(true);
  await clean(page);
});
test('Ink transfers pigment to paper monotonically while conserving suspended plus deposited mass', async ({
  page,
}) => {
  await start(page, 'ink', {
    ...passive,
    initial: 'rest',
    absorption: 2,
    evaporation: 0,
    grain: 0,
  });
  const mass = (values: number[]) =>
    values.reduce((sum, value, i) => sum + (i % 4 < 2 ? value : 0), 0);
  const initial = mass((await read(page, 'dye')).values);
  expect(initial).toBeGreaterThan(10);
  await advance(page, 32);
  const mobile = mass((await read(page, 'dye')).values),
    deposited = mass((await read(page, 'paper')).values);
  expect(deposited).toBeGreaterThan(initial * 0.5);
  expect(mobile).toBeLessThan(initial * 0.5);
  expect(Math.abs(mobile + deposited - initial) / initial).toBeLessThan(0.001);
  await advance(page, 32);
  const later = mass((await read(page, 'paper')).values);
  expect(later).toBeGreaterThan(deposited);
  expect(Math.abs(mass((await read(page, 'dye')).values) + later - initial) / initial).toBeLessThan(
    0.002,
  );
  await clean(page);
});
test('Smoke temperature generates upward buoyancy and its shadow transmission stays bounded', async ({
  page,
}) => {
  const means: number[] = [];
  for (const heat of [0, 2]) {
    await start(page, 'smoke', {
      ...passive,
      initial: 'rest',
      heat,
      weight: 0,
      buoyancy: 1,
      cooling: 0,
    });
    await advance(page, 8);
    const velocity = (await read(page, 'velocity')).values,
      material = (await read(page, 'dye')).values;
    let weighted = 0,
      weight = 0;
    for (let i = 0; i < velocity.length; i += 4) {
      weighted += velocity[i + 1]! * material[i]!;
      weight += material[i]!;
    }
    means.push(weighted / weight);
    const temperatures = material.filter((_, i) => i % 4 === 1);
    if (heat === 0) expect(Math.max(...temperatures)).toBe(0);
    else expect(Math.max(...temperatures)).toBeGreaterThan(0.1);
    const shadow = (await read(page, 'shadow')).values;
    expect(shadow.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)).toBe(true);
    expect(Math.min(...shadow)).toBeLessThan(0.9);
    await clean(page);
  }
  expect(Math.abs(means[0]!)).toBeLessThan(1e-6);
  expect(means[1]!).toBeLessThan(-0.02);
});

test('Queued fixed updates bind distinct frame and parameter snapshots in one GPU submission', async ({
  page,
}) => {
  await start(page, 'wave');
  const modulePath = `/@fs${new URL('../../packages/core/src/index.ts', import.meta.url).pathname}`;
  const records = await page.evaluate(async (modulePath) => {
    const core = (await import(modulePath)) as typeof import('../../packages/core/src/index.ts');
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:32px;height:32px';
    document.body.append(canvas);
    const schema = { rate: { type: 'f32', default: 1, min: 0, max: 4 } } as const;
    let output!: GPUBuffer;
    const definition = core.feedbackEffect({
      id: 'snapshot-proof',
      title: 'Snapshot proof',
      params: schema,
      async setup(ctx) {
        output = ctx.device.createBuffer({
          label: 'snapshot-proof-output',
          size: 16 * 16,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        });
        const resources = ctx.device.createBindGroupLayout({
          entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
          ],
        });
        const source = core.simulationSource(
          schema,
          '@group(1) @binding(0) var<storage,read_write> records:array<vec4f>; @compute @workgroup_size(1) fn main(){records[frame.index]=vec4f(frame.time,frame.delta,frame.pointer.x,params.rate);}',
        );
        const pass = await core.createComputePass(ctx.session, source, 'snapshot-proof', [
          core.simulationUniformLayout(ctx.device),
          resources,
        ]);
        const group = ctx.device.createBindGroup({
          layout: resources,
          entries: [{ binding: 0, resource: { buffer: output } }],
        });
        return {
          resize: () => false,
          initialize(encoder) {
            encoder.clearBuffer(output);
          },
          step(encoder, _frame, uniforms) {
            pass.dispatch(encoder, [uniforms, group], [1]);
          },
          display() {},
          dispose() {
            output.destroy();
            pass.dispose();
          },
        };
      },
    });
    const field = await core.createEffect(canvas, definition, {
      playing: false,
      adaptiveQuality: false,
    });
    let staging: GPUBuffer | undefined;
    try {
      field.drawAt(0);
      for (let i = 1; i <= 3; i++) {
        field.frame.index = i;
        field.frame.time = i / 60;
        field.frame.delta = 1 / 60;
        field.frame.pointer = [i / 10, 0.5];
        field.params.rate = i;
        field.instance!.update(field.frame);
      }
      field.frame.pointer = [0.9, 0.5];
      field.params.rate = 4;
      field.render();
      field.session.submit();
      const device = field.session.device;
      staging = device.createBuffer({
        size: output.size,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
      const encoder = device.createCommandEncoder();
      encoder.copyBufferToBuffer(output, 0, staging, 0, output.size);
      device.queue.submit([encoder.finish()]);
      await staging.mapAsync(GPUMapMode.READ);
      if (field.session.errors.length) throw new Error(field.session.errors.join('\n'));
      return Array.from(new Float32Array(staging.getMappedRange())).slice(4, 16);
    } finally {
      staging?.destroy();
      field.destroy();
      canvas.remove();
    }
  }, modulePath);
  for (let i = 0; i < 3; i++) {
    expect(records[i * 4]).toBeCloseTo((i + 1) / 60, 6);
    expect(records[i * 4 + 1]).toBeCloseTo(1 / 60, 6);
    expect(records[i * 4 + 2]).toBeCloseTo((i + 1) / 10, 6);
    expect(records[i * 4 + 3]).toBe(i + 1);
  }
  await clean(page);
});
