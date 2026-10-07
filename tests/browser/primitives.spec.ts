import { test, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
async function initialize(page: Page) {
  await page.route('**/__primitive_harness', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>GPU primitives</title>',
    }),
  );
  await page.goto('/__primitive_harness');
}
for (const kind of ['scan', 'radix', 'bitonic', 'grid', 'mip2d', 'mipcube'] as const) {
  test(`GPU primitive ${kind} matches its CPU reference across boundaries`, async ({ page }) => {
    test.setTimeout(120_000);
    await initialize(page);
    const result = await page.evaluate(
      async ({ kind, corePath, primitivePath }) => {
        const core = (await import(corePath)) as typeof import('../../packages/core/src/index.ts');
        const primitives = (await import(
          primitivePath
        )) as typeof import('../../packages/core/src/primitives/index.ts');
        const { session, release } = await core.acquireDevice();
        const device = session.device;
        const owned: GPUBuffer[] = [];
        const buffer = (data: Uint32Array | Float32Array) => {
          const b = device.createBuffer({
            size: Math.max(4, data.byteLength),
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
          });
          if (data.length) device.queue.writeBuffer(b, 0, data);
          owned.push(b);
          return b;
        };
        const read = async (b: GPUBuffer, n: number) => {
          if (!n) return new Uint32Array();
          const staging = device.createBuffer({
            size: n * 4,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
          });
          const e = device.createCommandEncoder();
          e.copyBufferToBuffer(b, 0, staging, 0, n * 4);
          device.queue.submit([e.finish()]);
          await staging.mapAsync(GPUMapMode.READ);
          const result = new Uint32Array(staging.getMappedRange()).slice();
          staging.unmap();
          staging.destroy();
          return result;
        };
        const check = (
          a: readonly number[] | Uint32Array,
          b: readonly number[] | Uint32Array,
          label: string,
        ) => {
          if (a.length !== b.length) throw new Error(`${label}: length mismatch`);
          for (let i = 0; i < a.length; i++)
            if (a[i] !== b[i]) throw new Error(`${label}[${i}]: ${a[i]} != ${b[i]}`);
        };
        let cases = 0;
        const errorsBefore = session.errors.length;
        try {
          if (kind === 'scan') {
            const scan = await primitives.createPrefixSum(session, 1_048_576);
            try {
              for (const n of [0, 1, 255, 256, 257, 65537, 1_048_576]) {
                const values = new Uint32Array(n);
                for (let i = 0; i < n; i++)
                  values[i] = i % 17 === 0 ? 0xffffffff : (i * 1664525 + 1013904223) >>> 0;
                const input = buffer(values),
                  e = device.createCommandEncoder();
                const output = scan.encode(e, input, n);
                device.queue.submit([e.finish()]);
                const expected = new Uint32Array(n);
                let sum = 0;
                for (let i = 0; i < n; i++) {
                  expected[i] = sum;
                  sum = (sum + values[i]!) >>> 0;
                }
                check(await read(output, n), expected, `scan ${n}`);
                const flags = Uint32Array.from(values, (x) => (x % 7 === 0 ? 0 : x));
                const f = buffer(flags),
                  c = device.createCommandEncoder();
                const compact = scan.compact(c, f, n);
                device.queue.submit([c.finish()]);
                const expectedIndices = Array.from(flags).flatMap((flag, i) => (flag ? [i] : []));
                check(await read(compact.count, 1), [expectedIndices.length], `count ${n}`);
                check(
                  await read(compact.indices, expectedIndices.length),
                  expectedIndices,
                  `compact ${n}`,
                );
                cases++;
              }
              if (scan.diagnostics.some((x) => x.type !== 'info'))
                throw new Error('Scan shader diagnostics');
            } finally {
              scan.dispose();
            }
          } else if (kind === 'radix' || kind === 'bitonic') {
            const sort = await primitives.createSort(
              session,
              kind === 'radix' ? 1048576 : 65537,
              kind,
            );
            try {
              for (const n of [
                0,
                1,
                2,
                255,
                256,
                257,
                1025,
                65537,
                ...(kind === 'radix' ? [1048576] : []),
              ]) {
                const keys = new Uint32Array(n),
                  values = new Uint32Array(n);
                for (let i = 0; i < n; i++) {
                  keys[i] =
                    i % 11 === 0
                      ? 0xffffffff
                      : i % 13 === 0
                        ? 0
                        : i % 3 === 0
                          ? (i * 1664525 + 1013904223) >>> 0
                          : ((i * 1664525 + 1013904223) >>> 0) % 32;
                  values[i] = (n - i) ^ 0xdeadbeef;
                }
                const ordered = Array.from({ length: n }, (_, i) => i).sort(
                  (a, b) => keys[a]! - keys[b]! || a - b,
                );
                const e = device.createCommandEncoder();
                const output = sort.encode(e, buffer(keys), buffer(values), n);
                device.queue.submit([e.finish()]);
                check(
                  await read(output.keys, n),
                  ordered.map((i) => keys[i]!),
                  `${kind} keys ${n}`,
                );
                check(
                  await read(output.values, n),
                  ordered.map((i) => values[i]!),
                  `${kind} values ${n}`,
                );
                cases++;
              }
              if (sort.diagnostics.some((x) => x.type !== 'info'))
                throw new Error('Sort shader diagnostics');
            } finally {
              sort.dispose();
            }
          } else if (kind === 'grid') {
            const grid = await primitives.createSpatialHash(session, 1025, {
              dimensions: [7, 5, 3],
              maxDimensions: [8, 8, 8],
              axes: 'xyz',
            });
            try {
              for (const dimensions of [
                [7, 5, 3],
                [8, 8, 8],
                [1, 1, 1],
              ] as const) {
                grid.resize(dimensions);
                for (const n of [0, 1, 257, 1025]) {
                  const positions = new Float32Array(n * 4);
                  for (let i = 0; i < n; i++) {
                    positions[i * 4] = i % 11 === 0 ? 1 : ((i * 17) % 100) / 100;
                    positions[i * 4 + 1] = i % 13 === 0 ? -0.2 : ((i * 31) % 100) / 100;
                    positions[i * 4 + 2] = ((i * 7) % 100) / 100;
                  }
                  const keys = Array.from({ length: n }, (_, i) => {
                    const x = Math.min(
                        dimensions[0] - 1,
                        Math.max(0, Math.floor(positions[i * 4]! * dimensions[0])),
                      ),
                      y = Math.min(
                        dimensions[1] - 1,
                        Math.max(0, Math.floor(positions[i * 4 + 1]! * dimensions[1])),
                      ),
                      z = Math.min(
                        dimensions[2] - 1,
                        Math.max(0, Math.floor(positions[i * 4 + 2]! * dimensions[2])),
                      );
                    return x + dimensions[0] * (y + dimensions[1] * z);
                  });
                  const ordered = Array.from({ length: n }, (_, i) => i).sort(
                    (a, b) => keys[a]! - keys[b]! || a - b,
                  );
                  const e = device.createCommandEncoder();
                  grid.encode(e, buffer(positions), n);
                  device.queue.submit([e.finish()]);
                  check(await read(grid.sortedIndices, n), ordered, 'grid IDs');
                  check(
                    await read(grid.sortedKeys, n),
                    ordered.map((i) => keys[i]!),
                    'grid keys',
                  );
                  const counts = new Uint32Array(grid.cellCount);
                  keys.forEach((key) => (counts[key] = counts[key]! + 1));
                  const offsets = new Uint32Array(grid.cellCount + 1);
                  for (let i = 0; i < counts.length; i++) offsets[i + 1] = offsets[i]! + counts[i]!;
                  check(await read(grid.cellCounts, counts.length), counts, 'cell counts');
                  check(await read(grid.cellOffsets, offsets.length), offsets, 'cell offsets');
                  cases++;
                }
              }
            } finally {
              grid.dispose();
            }
          } else {
            const mip = await primitives.createMipGenerator(session, 'rgba32float');
            try {
              for (const [width, height] of kind === 'mipcube'
                ? [
                    [1, 1],
                    [2, 2],
                    [7, 7],
                    [16, 16],
                  ]
                : [
                    [1, 1],
                    [2, 2],
                    [7, 5],
                    [16, 8],
                  ]) {
                const layers = kind === 'mipcube' ? 6 : 1;
                const levels = 1 + Math.floor(Math.log2(Math.max(width!, height!)));
                const texture = device.createTexture({
                  size: [width!, height!, layers],
                  format: 'rgba32float',
                  mipLevelCount: levels,
                  usage:
                    GPUTextureUsage.TEXTURE_BINDING |
                    GPUTextureUsage.STORAGE_BINDING |
                    GPUTextureUsage.COPY_SRC |
                    GPUTextureUsage.COPY_DST,
                });
                try {
                  if (kind === 'mipcube') texture.createView({ dimension: 'cube' });
                  const originals: Float32Array[] = [];
                  for (let layer = 0; layer < layers; layer++) {
                    const data = Float32Array.from(
                      { length: width! * height! * 4 },
                      (_, i) => layer * 10 + (i % 17) / 17,
                    );
                    originals.push(data);
                    device.queue.writeTexture(
                      { texture, origin: [0, 0, layer] },
                      data,
                      { bytesPerRow: width! * 16 },
                      [width!, height!],
                    );
                  }
                  const e = device.createCommandEncoder();
                  mip.encode(e, texture);
                  device.queue.submit([e.finish()]);
                  for (let layer = 0; layer < layers; layer++) {
                    let expected = originals[layer]!,
                      w = width!,
                      h = height!;
                    for (let level = 1; level < levels; level++) {
                      const nw = Math.max(1, w >> 1),
                        nh = Math.max(1, h >> 1);
                      const next = new Float32Array(nw * nh * 4);
                      for (let y = 0; y < nh; y++)
                        for (let x = 0; x < nw; x++) {
                          const sx = (x * w) / nw,
                            ex = ((x + 1) * w) / nw,
                            sy = (y * h) / nh,
                            ey = ((y + 1) * h) / nh;
                          for (let c = 0; c < 4; c++) {
                            let total = 0,
                              weight = 0;
                            for (let yy = Math.floor(sy); yy < Math.ceil(ey); yy++)
                              for (let xx = Math.floor(sx); xx < Math.ceil(ex); xx++) {
                                const a =
                                  Math.max(0, Math.min(ex, xx + 1) - Math.max(sx, xx)) *
                                  Math.max(0, Math.min(ey, yy + 1) - Math.max(sy, yy));
                                total += expected[(yy * w + xx) * 4 + c]! * a;
                                weight += a;
                              }
                            next[(y * nw + x) * 4 + c] = total / weight;
                          }
                        }
                      const row = Math.ceil((nw * 16) / 256) * 256;
                      const staging = device.createBuffer({
                        size: row * nh,
                        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
                      });
                      const copy = device.createCommandEncoder();
                      copy.copyTextureToBuffer(
                        { texture, mipLevel: level, origin: [0, 0, layer] },
                        { buffer: staging, bytesPerRow: row },
                        [nw, nh],
                      );
                      device.queue.submit([copy.finish()]);
                      await staging.mapAsync(GPUMapMode.READ);
                      const actual = new Float32Array(staging.getMappedRange());
                      for (let y = 0; y < nh; y++)
                        for (let x = 0; x < nw * 4; x++) {
                          if (
                            Math.abs(actual[(y * row) / 4 + x]! - next[y * nw * 4 + x]!) > 0.00002
                          )
                            throw new Error(
                              `mip ${width}x${height} layer ${layer} level ${level} mismatch actual=${actual[(y * row) / 4 + x]} expected=${next[y * nw * 4 + x]} error=${Math.abs(actual[(y * row) / 4 + x]! - next[y * nw * 4 + x]!)}`,
                            );
                        }
                      staging.unmap();
                      staging.destroy();
                      expected = next;
                      w = nw;
                      h = nh;
                      cases++;
                    }
                  }
                } finally {
                  texture.destroy();
                }
              }
            } finally {
              mip.dispose();
            }
          }
          await device.queue.onSubmittedWorkDone();
          return { cases, errors: session.errors.slice(errorsBefore) };
        } finally {
          owned.forEach((x) => x.destroy());
          release();
        }
      },
      {
        kind,
        corePath: `/@fs${fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url))}`,
        primitivePath: `/@fs${fileURLToPath(new URL('../../packages/core/src/primitives/index.ts', import.meta.url))}`,
      },
    );
    expect(result.errors).toEqual([]);
    expect(result.cases).toBe(
      { scan: 7, radix: 9, bitonic: 8, grid: 12, mip2d: 7, mipcube: 42 }[kind],
    );
  });
}
test('Primitive arguments remain immutable within one encoder and invalid inputs fail before submission', async ({
  page,
}) => {
  await initialize(page);
  const result = await page.evaluate(
    async ({ corePath, primitivePath }) => {
      const { acquireDevice } = (await import(
        corePath
      )) as typeof import('../../packages/core/src/index.ts');
      const primitives = (await import(
        primitivePath
      )) as typeof import('../../packages/core/src/primitives/index.ts');
      const { session, release } = await acquireDevice();
      const device = session.device;
      const buffers: GPUBuffer[] = [];
      const buffer = (
        count: number,
        usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
      ) => {
        const b = device.createBuffer({ size: Math.max(4, count * 4), usage });
        buffers.push(b);
        return b;
      };
      const read = async (b: GPUBuffer, count: number) => {
        const staging = device.createBuffer({
            size: count * 4,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
          }),
          encoder = device.createCommandEncoder();
        encoder.copyBufferToBuffer(b, 0, staging, 0, count * 4);
        device.queue.submit([encoder.finish()]);
        await staging.mapAsync(GPUMapMode.READ);
        const result = Array.from(new Uint32Array(staging.getMappedRange()));
        staging.unmap();
        staging.destroy();
        return result;
      };
      const rejects = (action: () => unknown) => {
        try {
          action();
          return false;
        } catch {
          return true;
        }
      };
      const scan = await primitives.createPrefixSum(session, 257),
        sort = await primitives.createSort(session, 257, 'radix'),
        grid = await primitives.createSpatialHash(session, 257, { dimensions: [4, 4, 1] });
      const invalids: boolean[] = [];
      try {
        const input = buffer(257);
        device.queue.writeBuffer(
          input,
          0,
          Uint32Array.from({ length: 257 }, (_, i) => i + 1),
        );
        const first = buffer(257),
          second = buffer(17);
        const encoder = device.createCommandEncoder();
        encoder.copyBufferToBuffer(scan.encode(encoder, input, 257), 0, first, 0, 257 * 4);
        encoder.copyBufferToBuffer(scan.encode(encoder, input, 17), 0, second, 0, 17 * 4);
        device.queue.submit([encoder.finish()]);
        const a = await read(first, 257),
          b = await read(second, 17);
        for (let i = 0; i < a.length; i++)
          if (a[i] !== (i * (i + 1)) / 2) throw new Error('Queued long scan arguments changed');
        for (let i = 0; i < b.length; i++)
          if (b[i] !== (i * (i + 1)) / 2) throw new Error('Queued short scan arguments changed');
        const keys = buffer(257),
          values = buffer(257);
        device.queue.writeBuffer(
          keys,
          0,
          Uint32Array.from({ length: 257 }, (_, i) => 257 - i),
        );
        device.queue.writeBuffer(
          values,
          0,
          Uint32Array.from({ length: 257 }, (_, i) => i),
        );
        const k1 = buffer(257),
          k2 = buffer(17),
          v1 = buffer(257),
          v2 = buffer(17),
          sorting = device.createCommandEncoder();
        const sorted1 = sort.encode(sorting, keys, values, 257);
        sorting.copyBufferToBuffer(sorted1.keys, 0, k1, 0, 257 * 4);
        sorting.copyBufferToBuffer(sorted1.values, 0, v1, 0, 257 * 4);
        const sorted2 = sort.encode(sorting, keys, values, 17);
        sorting.copyBufferToBuffer(sorted2.keys, 0, k2, 0, 17 * 4);
        sorting.copyBufferToBuffer(sorted2.values, 0, v2, 0, 17 * 4);
        device.queue.submit([sorting.finish()]);
        const results = await Promise.all([
          read(k1, 257),
          read(k2, 17),
          read(v1, 257),
          read(v2, 17),
        ]);
        for (let i = 0; i < 257; i++) {
          if (results[0]![i] !== i + 1 || results[2]![i] !== 256 - i)
            throw new Error('Queued radix long args changed');
        }
        for (let i = 0; i < 17; i++) {
          if (results[1]![i] !== 241 + i || results[3]![i] !== 16 - i)
            throw new Error('Queued radix short args changed');
        }
        invalids.push(
          rejects(() => scan.encode(device.createCommandEncoder(), input, -1)),
          rejects(() => scan.encode(device.createCommandEncoder(), input, 258)),
          rejects(() => scan.encode(device.createCommandEncoder(), buffer(1), 257)),
          rejects(() =>
            scan.encode(device.createCommandEncoder(), buffer(257, GPUBufferUsage.COPY_DST), 257),
          ),
          rejects(() => scan.encode(device.createCommandEncoder(), scan.output, 16)),
          rejects(() => sort.encode(device.createCommandEncoder(), buffer(1), values, 257)),
          rejects(() => grid.encode(device.createCommandEncoder(), input, 257)),
          rejects(() => grid.resize([5, 5, 1])),
        );
        scan.dispose();
        invalids.push(rejects(() => scan.encode(device.createCommandEncoder(), input, 0)));
        await device.queue.onSubmittedWorkDone();
        return { invalids, errors: session.errors };
      } finally {
        scan.dispose();
        sort.dispose();
        grid.dispose();
        buffers.forEach((b) => b.destroy());
        release();
      }
    },
    {
      corePath: `/@fs${fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url))}`,
      primitivePath: `/@fs${fileURLToPath(new URL('../../packages/core/src/primitives/index.ts', import.meta.url))}`,
    },
  );
  expect(result.invalids).toEqual(Array(9).fill(true));
  expect(result.errors).toEqual([]);
});
