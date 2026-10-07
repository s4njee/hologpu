import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const domModule =
  '/@fs' + fileURLToPath(new URL('../../packages/dom/src/dom-rects.ts', import.meta.url));
async function ready(page: import('@playwright/test').Page, params: Record<string, unknown> = {}) {
  await page.routeWebSocket(/127\.0\.0\.1:5175/, (socket) => socket.close());
  await page.goto(
    '/?' +
      new URLSearchParams({
        effect: 'fluid-obstacles',
        playing: 'false',
        quality: 'fixed',
        params: JSON.stringify({ grid: 32, iterations: 80, ...params }),
      }),
  );
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await page.locator('#stage').evaluate((node: HTMLElement) => {
    node.style.width = '130px';
    node.style.height = '130px';
  });
  await expect
    .poll(() => page.evaluate(() => window.hologpu.field!.surface!.size[0]))
    .toBe(await page.evaluate(() => 128 * devicePixelRatio));
}
test('DOM boxes drive storage, impermeable faces, pressure and moving fluid geometry', async ({
  page,
}) => {
  await ready(page, {
    initial: 'compression',
    viscosity: 0,
    drag: 0,
    vorticity: 0,
    dissipation: 0,
    source: 0,
    force: 0,
  });
  const result = await page.evaluate(async (path) => {
    const { DomRectsInput } = (await import(
      path
    )) as typeof import('../../packages/dom/src/dom-rects.ts');
    const f = window.hologpu.field!;
    const host = document.createElement('div');
    host.style.cssText =
      'position:fixed;left:100px;top:100px;width:128px;height:128px;pointer-events:none';
    const heading = document.createElement('h1');
    heading.dataset.hgpuObstacle = '';
    heading.style.cssText = 'position:absolute;margin:0;left:32px;top:48px;width:64px;height:16px';
    heading.textContent = 'Heading';
    host.append(heading);
    document.body.append(host);
    const input = new DomRectsInput(host);
    let changes = 0;
    const unsub = input.subscribe(() => changes++);
    await f.setInput('obstacles', input);
    f.reset(7);
    f.drawAt(0, 7);
    const mask = await f.readTap('obstacleMask'),
      velocity = await f.readTap('velocity'),
      dye = await f.readTap('dye');
    const div = await f.readTap('divergence'),
      projected = await f.readTap('projectedDivergence');
    const rms = (values: ArrayLike<number>) =>
      Math.sqrt(Array.from(values).reduce((s, v) => s + v * v, 0) / values.length);
    let blocked = 0,
      maxFace = 0,
      maxDye = 0;
    const n = mask.width;
    const solid = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < n && y < n && mask.values[y * n + x] === 1;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const p = (y * n + x) * 4;
        if (solid(x, y) || solid(x + 1, y)) {
          maxFace = Math.max(maxFace, Math.abs(velocity.values[p]!));
          blocked++;
        }
        if (solid(x, y) || solid(x, y + 1)) {
          maxFace = Math.max(maxFace, Math.abs(velocity.values[p + 1]!));
          blocked++;
        }
        if (solid(x, y))
          for (let c = 0; c < 3; c++) maxDye = Math.max(maxDye, Math.abs(dye.values[p + c]!));
      }
    const face = (x: number, y: number, c: number): number => {
      if (
        x < 0 ||
        y < 0 ||
        x >= n ||
        y >= n ||
        (c === 0 && x === n - 1) ||
        (c === 1 && y === n - 1) ||
        solid(x, y) ||
        solid(x + (c === 0 ? 1 : 0), y + (c === 1 ? 1 : 0))
      )
        return 0;
      return Math.sin((((c === 0 ? x : y) + 1) / n) * Math.PI * 2) * 0.18;
    };
    const maxInitialDivError = Math.max(
      ...Array.from(div.values, (v, i) => {
        const x = i % n,
          y = Math.floor(i / n);
        const expected = solid(x, y)
          ? 0
          : face(x, y, 0) - face(x - 1, y, 0) + face(x, y, 1) - face(x, y - 1, 1);
        return Math.abs(v - expected);
      }),
    );
    f.advance(1);
    const steppedVelocity = await f.readTap('velocity'),
      steppedDye = await f.readTap('dye');
    let maxStepFace = 0,
      maxStepDye = 0;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const p = (y * n + x) * 4;
        if (solid(x, y) || solid(x + 1, y))
          maxStepFace = Math.max(maxStepFace, Math.abs(steppedVelocity.values[p]!));
        if (solid(x, y) || solid(x, y + 1))
          maxStepFace = Math.max(maxStepFace, Math.abs(steppedVelocity.values[p + 1]!));
        if (solid(x, y))
          for (let c = 0; c < 3; c++)
            maxStepDye = Math.max(maxStepDye, Math.abs(steppedDye.values[p + c]!));
      }
    const beforeRects = input.snapshot();
    const gpuBuffer = input.buffer(f.session.device),
      staging = f.session.device.createBuffer({
        size: gpuBuffer.size,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
    const enc = f.session.device.createCommandEncoder();
    enc.copyBufferToBuffer(gpuBuffer, 0, staging, 0, gpuBuffer.size);
    f.session.device.queue.submit([enc.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const raw = staging.getMappedRange().slice(0),
      count = new Uint32Array(raw)[0],
      packed = Array.from(new Float32Array(raw).slice(4, 8));
    staging.unmap();
    staging.destroy();
    heading.style.transform = 'translateY(32px)';
    input.refresh();
    f.invalidate();
    f.drawAt(0, 7);
    const moved = await f.readTap('obstacleMask');
    const afterRects = input.snapshot();
    const changedCells = Array.from(mask.values).filter((v, i) => v !== moved.values[i]).length;
    heading.remove();
    input.refresh();
    f.invalidate();
    f.drawAt(0, 7);
    const empty = await f.readTap('obstacleMask');
    unsub();
    input.dispose();
    const disposedBytes = input.bufferBytes;
    await f.setInput('obstacles', null);
    host.remove();
    return {
      beforeRects,
      afterRects,
      count,
      packed,
      blocked,
      maxFace,
      maxDye,
      maxInitialDivError,
      maxStepFace,
      maxStepDye,
      divergence: rms(div.values),
      ratio: rms(projected.values) / rms(div.values),
      changedCells,
      emptyMax: Math.max(...empty.values),
      changes,
      disposedBytes,
      errors: f.session.errors,
    };
  }, domModule);
  expect(result.beforeRects).toEqual([[0.25, 0.375, 0.75, 0.5]]);
  expect(result.count).toBe(1);
  expect(result.packed).toEqual(result.beforeRects[0]);
  expect(result.blocked).toBeGreaterThan(100);
  expect(result.maxFace).toBe(0);
  expect(result.maxDye).toBe(0);
  expect(result.maxStepFace).toBe(0);
  expect(result.maxStepDye).toBe(0);
  expect(result.divergence).toBeGreaterThan(0);
  // Four float16 face terms have at most 4*2^-14 rounding error at |v|<=.18.
  expect(result.maxInitialDivError).toBeLessThan(4 * 2 ** -14);
  expect(result.ratio).toBeLessThan(0.6);
  expect(result.afterRects).toEqual([[0.25, 0.625, 0.75, 0.75]]);
  expect(result.changedCells).toBe(128);
  expect(result.emptyMax).toBe(0);
  expect(result.changes).toBeGreaterThanOrEqual(2);
  expect(result.disposedBytes).toBe(0);
  expect(result.errors).toEqual([]);
});
test('Obstacle catalogue defaults and two presets replay on both DPRs', async ({ page }, info) => {
  await ready(page, { grid: 64 });
  const presets = await page.evaluate(() => Object.keys(window.hologpu.field!.effect.presets));
  expect(presets).toHaveLength(2);
  for (const preset of ['default', ...presets]) {
    const pixels = await page.evaluate(async (preset) => {
      const f = window.hologpu.field!;
      f.store.reset();
      f.store.patch({ ...f.effect.presets[preset], grid: 64 });
      f.reset(7);
      f.advance(8);
      return Array.from((await f.readPixels()).pixels);
    }, preset);
    expect(new Set(pixels).size).toBeGreaterThan(20);
    const replay = await page.evaluate(async () => {
      const f = window.hologpu.field!;
      f.reset(7);
      f.advance(8);
      return Array.from((await f.readPixels()).pixels);
    });
    expect(replay).toEqual(pixels);
    if (info.project.name.startsWith('swiftshader'))
      await expect(page.locator('#canvas')).toHaveScreenshot(`fluid-obstacles-${preset}.png`, {
        scale: 'css',
        maxDiffPixelRatio: 0.001,
      });
  }
  expect(await page.evaluate(() => window.hologpu.field!.session.errors)).toEqual([]);
});

test('DOM rectangle cap, growing buffer and borrowed source survive actual device replacement', async ({
  page,
}) => {
  test.setTimeout(60000);
  await ready(page);
  const corePath =
    '/@fs' + fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url));
  const result = await page.evaluate(
    async ({ domModule, corePath }) => {
      const { DomRectsInput } = (await import(
        domModule
      )) as typeof import('../../packages/dom/src/dom-rects.ts');
      const { createEffect } = (await import(
        corePath
      )) as typeof import('../../packages/core/src/index.ts');
      const main = window.hologpu.field!;
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:0;top:0;width:128px;height:128px';
      document.body.append(host);
      const add = (y: number) => {
        const node = document.createElement('div');
        node.dataset.hgpuObstacle = '';
        node.style.cssText = `position:absolute;left:16px;top:${y}px;width:64px;height:8px`;
        host.append(node);
        return node;
      };
      add(16);
      const input = new DomRectsInput(host, { maxRects: 3 });
      const device = main.session.device;
      const first = input.buffer(device);
      // Keep a command referencing the first capacity allocation unsubmitted while growing.
      const staging = device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const encoded = device.createCommandEncoder();
      encoded.copyBufferToBuffer(first, 0, staging, 0, 32);
      add(40);
      add(64);
      add(88);
      input.refresh();
      const second = input.buffer(device);
      device.queue.submit([encoded.finish()]);
      await staging.mapAsync(GPUMapMode.READ);
      const oldCount = new Uint32Array(staging.getMappedRange())[0];
      staging.unmap();
      staging.destroy();
      const count = input.snapshot().length,
        grew = second !== first,
        bytesBefore = input.bufferBytes;
      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'width:128px;height:128px';
      host.append(canvas);
      const f = await createEffect(canvas, main.effect, {
        playing: false,
        params: { grid: 32 },
      });
      await f.setInput('obstacles', input);
      f.drawAt(0, 7);
      const before = Array.from((await f.readTap('obstacleMask')).values);
      const generation = f.session.generation,
        instance = f.instance;
      device.destroy();
      await device.lost;
      const deadline = performance.now() + 15000;
      while (
        (f.state !== 'ready' ||
          f.session.state !== 'ready' ||
          f.session.generation === generation ||
          f.instance === instance) &&
        performance.now() < deadline
      )
        await new Promise((resolve) => setTimeout(resolve, 10));
      if (
        f.state !== 'ready' ||
        f.session.state !== 'ready' ||
        f.session.generation === generation ||
        f.instance === instance
      )
        throw new Error('DOM fluid failed to restore');
      f.drawAt(0, 7);
      const after = Array.from((await f.readTap('obstacleMask')).values);
      const restored = input.buffer(f.session.device),
        newDevice = f.session.device !== device,
        rebuilt = restored !== second,
        bytesAfter = input.bufferBytes;
      f.destroy();
      input.dispose();
      host.remove();
      return {
        oldCount,
        count,
        grew,
        bytesBefore,
        bytesAfter,
        newDevice,
        rebuilt,
        sameMask: before.join(',') === after.join(','),
        disposedBytes: input.bufferBytes,
        errors: main.session.errors,
      };
    },
    { domModule, corePath },
  );
  expect(result.oldCount).toBe(1);
  expect(result.count).toBe(3);
  expect(result.grew).toBe(true);
  expect(result.bytesBefore).toBe(96);
  expect(result.bytesAfter).toBe(64);
  expect(result.newDevice).toBe(true);
  expect(result.rebuilt).toBe(true);
  expect(result.sameMask).toBe(true);
  expect(result.disposedBytes).toBe(0);
  expect(result.errors).toEqual([]);
});

test('Attached fluid normalizes tagged boxes to its canvas inside authored padding and borders', async ({
  page,
}) => {
  await page.route('**/__m5_obstacle_padding', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Padded fluid</title><style>body{margin:0}</style>',
    }),
  );
  await page.goto('/__m5_obstacle_padding');
  const core = '/@fs' + fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
    dom = '/@fs' + fileURLToPath(new URL('../../packages/dom/src/index.ts', import.meta.url)),
    fluid =
      '/@fs' +
      fileURLToPath(
        new URL('../../packages/effects/src/fluid-obstacles/index.ts', import.meta.url),
      );
  const result = await page.evaluate(
    async ({ core, dom, fluid }) => {
      const { attach } = (await import(dom)) as typeof import('../../packages/dom/src/index.ts');
      const { default: definition } = (await import(
        fluid
      )) as typeof import('../../packages/effects/src/fluid-obstacles/index.ts');
      const host = document.createElement('section');
      host.style.cssText =
        'position:relative;width:192px;height:128px;padding:24px;border:8px solid black';
      const heading = document.createElement('h1');
      heading.dataset.hgpuObstacle = '';
      heading.textContent = 'Solid';
      heading.style.cssText =
        'position:relative;left:12px;top:16px;margin:0;width:96px;height:24px';
      host.append(heading);
      document.body.append(host);
      const attachment = await attach(host, definition, {
          playing: false,
          adaptiveQuality: false,
          params: { grid: 32 },
        }),
        field = attachment.field!;
      const inspect = async () => {
        field.beforeFrame();
        field.drawAt(0, 7);
        const mask = await field.readTap('obstacleMask'),
          canvas = attachment.canvas.getBoundingClientRect(),
          box = heading.getBoundingClientRect(),
          hostBox = host.getBoundingClientRect();
        const rect = [
          Math.max(0, (box.left - canvas.left) / canvas.width),
          Math.max(0, (box.top - canvas.top) / canvas.height),
          Math.min(1, (box.right - canvas.left) / canvas.width),
          Math.min(1, (box.bottom - canvas.top) / canvas.height),
        ];
        let errors = 0,
          solids = 0;
        for (let y = 0; y < mask.height; y++)
          for (let x = 0; x < mask.width; x++) {
            const u = (x + 0.5) / mask.width,
              v = (y + 0.5) / mask.height,
              expected = u >= rect[0]! && v >= rect[1]! && u < rect[2]! && v < rect[3]! ? 1 : 0;
            if (mask.values[y * mask.width + x] !== expected) errors++;
            solids += expected;
          }
        return {
          errors,
          solids,
          offset: [canvas.left - hostBox.left, canvas.top - hostBox.top],
          rect,
          width: mask.width,
          height: mask.height,
        };
      };
      const first = await inspect();
      host.style.padding = '40px';
      heading.style.transform = 'translateY(16px)';
      const moved = await inspect();
      attachment.destroy();
      const result = {
        first,
        moved,
        errors: field.session.errors,
        disposed: field.memory(),
        content: host.textContent,
      };
      host.remove();
      return result;
    },
    { core, dom, fluid },
  );
  expect(result.first.offset).toEqual([32, 32]);
  expect(result.moved.offset).toEqual([48, 48]);
  expect(result.first.errors).toBe(0);
  expect(result.moved.errors).toBe(0);
  expect(result.first.solids).toBeGreaterThan(0);
  expect(result.moved.solids).toBeGreaterThan(0);
  expect(result.first.rect).not.toEqual(result.moved.rect);
  expect(result.content).toBe('Solid');
  expect(result.disposed).toMatchObject({ textureBytes: 0, bufferBytes: 0 });
  expect(result.errors).toEqual([]);
});
