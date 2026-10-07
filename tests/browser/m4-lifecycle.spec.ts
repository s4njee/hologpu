import { test, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const corePath =
  '/@fs' + fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url));

async function harness(page: Page) {
  await page.route('**/__m4_lifecycle', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>M4 lifecycle</title>' }),
  );
  await page.goto('/__m4_lifecycle');
}

test('destroy during shared-device restoration leaves the surviving field and LUT ready', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const logs: string[] = [];
  page.on('pageerror', (error) => logs.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning')
      logs.push(`${message.type()}: ${message.text()}`);
  });
  await harness(page);
  const result = await page
    .evaluate(async (corePath) => {
      const stage = (name: string) => (document.body.dataset['lifecycleStage'] = name);
      stage('import core');
      const { createEffect, filterEffect } = (await import(
        corePath
      )) as typeof import('../../packages/core/src/index.ts');
      const canvas = () => {
        const node = document.createElement('canvas');
        node.style.cssText = 'width:48px;height:32px';
        document.body.append(node);
        return node;
      };
      const definition = filterEffect({
        id: 'lifecycle-recovery',
        title: 'Lifecycle recovery',
        params: { curve: { type: 'curve', default: [0, 1], min: 0, max: 1, resolution: 5 } },
        wgsl: 'fn effect(uv:vec2f)->vec4f {return vec4f(vec3f(sample_curve(uv).r),1);}',
        presets: { a: {}, b: {} },
      });
      stage('create doomed field');
      const doomed = await createEffect(canvas(), definition, { playing: false });
      stage('create surviving field');
      const survivor = await createEffect(canvas(), definition, { playing: false });
      const session = survivor.session,
        oldDevice = session.device,
        oldGeneration = session.generation,
        surface = doomed.surface!,
        restore = surface.restore.bind(surface);
      let entered!: () => void, unlock!: () => void;
      const gated = new Promise<void>((resolve) => (entered = resolve)),
        gate = new Promise<void>((resolve) => (unlock = resolve));
      surface.restore = async () => {
        entered();
        await gate;
        await restore();
      };
      const recovered = new Promise<void>((resolve, reject) => {
        const remove = session.onState((event) => {
          if (event === 'ready') {
            remove();
            resolve();
          } else if (event === 'error') {
            remove();
            reject(new Error(session.errors.join('\n') || 'Shared recovery failed'));
          }
        });
      });
      try {
        stage('destroy shared device');
        oldDevice.destroy();
        stage('await doomed surface restore gate');
        await gated;
        // The session exposes the new device before later fields finish restoring. A resize
        // observer can fire here while the surviving surface still holds its old pipeline.
        stage('resize survivor before its surface restoration');
        session.device.pushErrorScope('validation');
        survivor.surface!.resize();
        const earlyResizeAllocated = survivor.surface!.target !== null,
          earlyResizeError = (await session.device.popErrorScope())?.message ?? null;
        stage('destroy field during restore');
        doomed.destroy();
        unlock();
        stage('await shared session recovery');
        await recovered;
        stage('await surviving LUT readiness');
        await survivor.whenInputsReady();
        stage('draw surviving field');
        survivor.drawAt(0);
        stage('read surviving curve texture');
        const curve = await survivor.readTap('input:curve');
        stage('read surviving rendered pixels');
        const pixels = await survivor.readPixels();
        stage('recovery assertions');
        return {
          shared: doomed.session === session,
          doomed: doomed.state,
          survivor: survivor.state,
          session: session.state,
          replaced: session.device !== oldDevice && session.generation > oldGeneration,
          clients: session.clients,
          surfaces: session.scheduler.surfaceCount,
          earlyResizeAllocated,
          earlyResizeError,
          curve: Array.from(curve.values).filter((_, i) => i % 4 === 0),
          visible: pixels.pixels.some((value, i) => i % 4 !== 3 && value > 32),
          errors: [...session.errors],
        };
      } catch (error) {
        throw new Error(
          `${document.body.dataset['lifecycleStage']}: ${String(error)}; ` +
            JSON.stringify({
              doomed: doomed.state,
              survivor: survivor.state,
              session: session.state,
              generation: session.generation,
              errors: session.errors,
            }),
        );
      } finally {
        unlock();
        doomed.destroy();
        survivor.destroy();
        doomed.canvas.remove();
        survivor.canvas.remove();
      }
    }, corePath)
    .catch(async (error: unknown) => {
      const stage = await page.evaluate(() => document.body.dataset['lifecycleStage']);
      throw new Error(`${stage}: ${String(error)}; browser logs: ${JSON.stringify(logs)}`);
    });
  expect(result.shared).toBe(true);
  expect(result.doomed).toBe('disposed');
  expect(result.survivor).toBe('ready');
  expect(result.session).toBe('ready');
  expect(result.replaced).toBe(true);
  expect(result.clients).toBe(1);
  expect(result.surfaces).toBe(1);
  expect(result.earlyResizeAllocated).toBe(false);
  expect(result.earlyResizeError).toBeNull();
  expect(result.curve).toEqual([0, 0.25, 0.5, 0.75, 1]);
  expect(result.visible).toBe(true);
  expect(result.errors).toEqual([]);
  expect(logs.filter((message) => message.startsWith('pageerror:'))).toEqual([]);
});

for (const action of ['destroy', 'supersede'] as const) {
  test(`a delayed LUT failure after ${action} cannot change terminal or newer field state`, async ({
    page,
  }) => {
    await harness(page);
    const result = await page.evaluate(
      async ({ corePath, action }) => {
        const { createEffect, filterEffect, InputManager } = (await import(
          corePath
        )) as typeof import('../../packages/core/src/index.ts');
        const node = document.createElement('canvas');
        node.style.cssText = 'width:48px;height:32px';
        document.body.append(node);
        const field = await createEffect(
          node,
          filterEffect({
            id: 'lifecycle-delayed-lut',
            title: 'Delayed LUT',
            params: {
              curve: { type: 'curve', default: [0, 1], min: 0, max: 1, resolution: 5 },
            },
            wgsl: 'fn effect(uv:vec2f)->vec4f {return vec4f(vec3f(sample_curve(uv).r),1);}',
            presets: { a: {}, b: {} },
          }),
          { playing: false },
        );
        const session = field.session,
          set = InputManager.prototype.set;
        let entered!: () => void, reject!: (reason: Error) => void;
        const gated = new Promise<void>((resolve) => (entered = resolve)),
          gate = new Promise<void>((_, fail) => (reject = fail));
        let next = true;
        // Warm managers reuse their pipelines. Delay the real completed upload's result instead
        // of inventing a second compilation; this isolates the runtime's pending-job handler.
        InputManager.prototype.set = function (name, source) {
          const uploaded = set.call(this, name, source);
          if (name !== 'curve' || !next) return uploaded;
          next = false;
          return uploaded.then(async () => {
            entered();
            await gate;
          });
        };
        try {
          field.store.set('curve', [1, 0]);
          const pending = field.whenInputsReady().then(
            () => false,
            () => true,
          );
          await gated;
          if (action === 'destroy') field.destroy();
          else {
            field.store.set('curve', [0, 0.5]);
            await field.whenInputsReady();
          }
          reject(new Error('Fixture delayed LUT failure'));
          const rejected = await pending;
          // Allow the tracked job's catch to run after its waiter observes rejection.
          await Promise.resolve();
          await Promise.resolve();
          const readySettled = await field.whenInputsReady().then(
            () => true,
            () => false,
          );
          let curve: number[] | undefined;
          if (action === 'supersede') {
            field.drawAt(0);
            curve = Array.from((await field.readTap('input:curve')).values).filter(
              (_, i) => i % 4 === 0,
            );
          }
          return {
            state: field.state,
            rejected,
            readySettled,
            curve,
            clients: session.clients,
            surfaces: session.scheduler.surfaceCount,
            errors: [...session.errors],
          };
        } finally {
          reject(new Error('Fixture cleanup'));
          InputManager.prototype.set = set;
          field.destroy();
          node.remove();
        }
      },
      { corePath, action },
    );
    expect(result.rejected).toBe(true);
    expect(result.readySettled).toBe(true);
    expect(result.state).toBe(action === 'destroy' ? 'disposed' : 'ready');
    expect(result.clients).toBe(action === 'destroy' ? 0 : 1);
    expect(result.surfaces).toBe(action === 'destroy' ? 0 : 1);
    expect(result.errors).toEqual([]);
    if (action === 'supersede') expect(result.curve).toEqual([0, 0.125, 0.25, 0.375, 0.5]);
  });
}
