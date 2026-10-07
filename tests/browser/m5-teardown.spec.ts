import { test, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const core = '/@fs' + fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url));
const dom = '/@fs' + fileURLToPath(new URL('../../packages/dom/src/index.ts', import.meta.url));
const fluid =
  '/@fs' +
  fileURLToPath(new URL('../../packages/effects/src/fluid-obstacles/index.ts', import.meta.url));
async function harness(page: Page) {
  await page.route('**/__m5_teardown', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>M5 teardown</title><style>body{margin:0}section{width:128px;height:96px}</style>',
    }),
  );
  await page.goto('/__m5_teardown');
}
test('An initial deferred factory follows a real replacement device before returning ready', async ({
  page,
}) => {
  test.setTimeout(60000);
  await harness(page);
  const result = await page.evaluate(async (core) => {
    const { acquireDevice, createEffect, fragmentEffect } = (await import(
      core
    )) as typeof import('../../packages/core/src/index.ts');
    const { session, release } = await acquireDevice([]);
    const base = fragmentEffect({
      id: 'deferred-initial-loss',
      title: 'deferred',
      params: {},
      wgsl: 'fn effect(uv:vec2f)->vec4f{return vec4f(.2,.4,.7,1);}',
    });
    let unblock!: () => void,
      enter!: () => void,
      calls = 0,
      obsoleteDisposed = 0;
    const held = new Promise<void>((resolve) => (unblock = resolve)),
      entered = new Promise<void>((resolve) => (enter = resolve));
    const devices: GPUDevice[] = [];
    const definition: typeof base = {
      ...base,
      async create(ctx) {
        calls++;
        devices.push(ctx.device);
        const instance = await base.create(ctx);
        if (calls === 1) {
          const dispose = instance.dispose.bind(instance);
          instance.dispose = () => {
            obsoleteDisposed++;
            dispose();
          };
          enter();
          await held;
        }
        return instance;
      },
    };
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:32px;height:32px';
    document.body.append(canvas);
    const initialGeneration = session.generation,
      pending = createEffect(canvas, definition, { playing: false });
    await entered;
    const old = session.device;
    old.destroy();
    await old.lost;
    await session.ready;
    unblock();
    const field = await pending;
    field.drawAt(0);
    const pixels = Array.from((await field.readPixels()).pixels.slice(0, 4));
    await session.device.queue.onSubmittedWorkDone();
    const ready = field.state === 'ready' && session.state === 'ready',
      generation = session.generation,
      replaced = session.device !== old,
      currentInstanceDevice = devices.at(-1) === session.device,
      errors = [...session.errors],
      memory = field.memory();
    field.destroy();
    release();
    canvas.remove();
    return {
      calls,
      obsoleteDisposed,
      ready,
      generation,
      initialGeneration,
      replaced,
      currentInstanceDevice,
      pixels,
      errors,
      memory,
      surfaces: session.scheduler.surfaceCount,
      disposedMemory: field.memory(),
    };
  }, core);
  expect(result.calls).toBe(2);
  expect(result.obsoleteDisposed).toBe(1);
  expect(result.ready).toBe(true);
  expect(result.generation).toBeGreaterThan(result.initialGeneration);
  expect(result.replaced).toBe(true);
  expect(result.currentInstanceDevice).toBe(true);
  expect(result.pixels).toEqual([124, 170, 218, 255]);
  expect(result.memory.textureBytes).toBeGreaterThan(0);
  expect(result.disposedMemory).toMatchObject({ textureBytes: 0, bufferBytes: 0 });
  expect(result.surfaces).toBe(0);
  expect(result.errors).toEqual([]);
});
for (const mode of ['direct', 'onRendered'] as const)
  test(`Pending fluid/rectangle batch survives ${mode} attachment destruction`, async ({
    page,
  }) => {
    await harness(page);
    const result = await page.evaluate(
      async ({ core, dom, fluid, mode }) => {
        const { createEffect, fragmentEffect } = (await import(
          core
        )) as typeof import('../../packages/core/src/index.ts');
        const { attach } = (await import(dom)) as typeof import('../../packages/dom/src/index.ts');
        const { default: definition } = (await import(
          fluid
        )) as typeof import('../../packages/effects/src/fluid-obstacles/index.ts');
        const host = document.createElement('section'),
          heading = document.createElement('h1');
        heading.dataset.hgpuObstacle = '';
        heading.textContent = 'Solid heading';
        heading.style.cssText = 'margin:0;width:64px;height:24px';
        host.append(heading);
        document.body.append(host);
        const attachment = await attach(host, definition, {
          playing: false,
          adaptiveQuality: false,
          params: { grid: 32 },
        });
        const doomed = attachment.field!;
        doomed.beforeFrame();
        doomed.drawAt(0, 7);
        const rectCount = doomed.bufferTaps['obstacles']?.buffer.size ?? 0;
        const solidCount = Array.from((await doomed.readTap('obstacleMask')).values).filter(
          (v) => v === 1,
        ).length;
        const survivorCanvas = document.createElement('canvas');
        survivorCanvas.style.cssText = 'width:64px;height:32px';
        document.body.append(survivorCanvas);
        const survivor = await createEffect(
          survivorCanvas,
          fragmentEffect({
            id: 'teardown-survivor',
            title: 'survivor',
            params: { amount: { type: 'f32', default: 0.2, min: 0, max: 1 } },
            wgsl: 'fn effect(uv:vec2f)->vec4f{return vec4f(params.amount,.3,.5,1);}',
            presets: { a: {}, b: {} },
          }),
          { playing: false, adaptiveQuality: false },
        );
        survivor.drawAt(0);
        const before = (await survivor.readPixels()).pixels[0]!;
        const session = survivor.session,
          baseline = session.scheduler.surfaceCount;
        survivor.store.set('amount', 0.8);
        survivor.render(); // Record live survivor commands in the same unsubmitted batch.
        if (mode === 'onRendered') doomed.onRendered(() => attachment.destroy());
        doomed.render(); // Includes the actual rectangle buffer and fluid targets.
        if (mode === 'direct') attachment.destroy();
        session.submit();
        await session.device.queue.onSubmittedWorkDone();
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        survivor.drawAt(0);
        const after = (await survivor.readPixels()).pixels[0]!;
        const disposedMemory = doomed.memory(),
          surfaceCount = session.scheduler.surfaceCount,
          content = host.textContent,
          errors = [...session.errors];
        survivor.destroy();
        survivorCanvas.remove();
        host.remove();
        return {
          rectCount,
          solidCount,
          before,
          after,
          baseline,
          surfaceCount,
          disposedMemory,
          content,
          errors,
          attachmentState: attachment.state,
          fieldState: doomed.state,
          finalSurfaces: session.scheduler.surfaceCount,
        };
      },
      { core, dom, fluid, mode },
    );
    expect(result.rectCount).toBeGreaterThanOrEqual(32);
    expect(result.solidCount).toBeGreaterThan(0);
    expect(result.after).toBeGreaterThan(result.before + 70);
    expect(result.baseline).toBe(2);
    expect(result.surfaceCount).toBe(1);
    expect(result.finalSurfaces).toBe(0);
    expect(result.attachmentState).toBe('disposed');
    expect(result.fieldState).toBe('disposed');
    expect(result.disposedMemory).toMatchObject({ textureBytes: 0, bufferBytes: 0 });
    expect(result.content).toContain('Solid heading');
    expect(result.errors).toEqual([]);
  });
test('Late fields skip rendering while an earlier shared loss listener holds recovery', async ({
  page,
}) => {
  test.setTimeout(60000);
  await harness(page);
  const result = await page.evaluate(async (core) => {
    const { createEffect, fragmentEffect } = (await import(
      core
    )) as typeof import('../../packages/core/src/index.ts');
    const definition = fragmentEffect({
      id: 'loss-guard',
      title: 'guard',
      params: {},
      wgsl: 'fn effect(uv:vec2f)->vec4f{return vec4f(.2,.4,.7,1);}',
      presets: { a: {}, b: {} },
    });
    const canvas = () => {
      const c = document.createElement('canvas');
      c.style.cssText = 'width:32px;height:32px';
      document.body.append(c);
      return c;
    };
    const early = await createEffect(canvas(), definition, { playing: false }),
      session = early.session;
    let release!: () => void, enter!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve)),
      entered = new Promise<void>((resolve) => (enter = resolve));
    const remove = session.onState(async (state) => {
      if (state === 'lost') {
        enter();
        await held;
      }
    });
    const late = await createEffect(canvas(), definition, { playing: false });
    late.drawAt(0);
    const before = Array.from((await late.readPixels()).pixels);
    const oldDevice = session.device,
      generation = session.generation,
      instance = late.instance;
    oldDevice.destroy();
    await entered;
    const staleReady = late.state === 'ready',
      lost = session.state === 'lost';
    let advanceRejected = false,
      stepsRejected = false,
      tapRejected = false,
      pixelsRejected = false;
    try {
      late.advance(1);
    } catch (error) {
      advanceRejected = String(error).includes('not ready');
    }
    try {
      late.step();
    } catch (error) {
      stepsRejected = String(error).includes('not ready');
    }
    try {
      await late.readTap('surface');
    } catch (error) {
      tapRejected = String(error).includes('not ready');
    }
    try {
      await late.readPixels();
    } catch (error) {
      pixelsRejected = String(error).includes('not ready');
    }
    const index = late.frame.index;
    late.update({ time: 1, delta: 1 / 60, index: 60 });
    const skippedUpdate = late.frame.index === index;
    late.render(); // Must not access the lost GPU device despite stale per-field readiness.
    remove();
    release();
    const deadline = performance.now() + 15000;
    while (
      (late.state !== 'ready' ||
        session.state !== 'ready' ||
        session.generation === generation ||
        late.instance === instance) &&
      performance.now() < deadline
    )
      await new Promise((resolve) => setTimeout(resolve, 10));
    if (
      late.state !== 'ready' ||
      session.state !== 'ready' ||
      session.generation === generation ||
      late.instance === instance
    )
      throw new Error('Held shared recovery failed');
    late.drawAt(0);
    const after = Array.from((await late.readPixels()).pixels),
      errors = [...session.errors];
    early.destroy();
    late.destroy();
    early.canvas.remove();
    late.canvas.remove();
    return {
      staleReady,
      lost,
      advanceRejected,
      stepsRejected,
      tapRejected,
      pixelsRejected,
      skippedUpdate,
      samePixels: before.join(',') === after.join(','),
      errors,
      finalSurfaces: session.scheduler.surfaceCount,
    };
  }, core);
  expect(result.staleReady).toBe(true);
  expect(result.lost).toBe(true);
  expect(result.advanceRejected).toBe(true);
  expect(result.stepsRejected).toBe(true);
  expect(result.tapRejected).toBe(true);
  expect(result.pixelsRejected).toBe(true);
  expect(result.skippedUpdate).toBe(true);
  expect(result.samePixels).toBe(true);
  expect(result.errors).toEqual([]);
  expect(result.finalSurfaces).toBe(0);
});
