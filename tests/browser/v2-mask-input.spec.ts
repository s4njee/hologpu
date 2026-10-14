import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const core = '/@fs' + fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url));

for (const scenario of ['image-alpha', 'path-and-canvas'] as const)
  test(`linear scalar mask preserves ${scenario} and caller ownership`, async ({ page }) => {
    await page.route('**/__product_mask', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Scalar mask</title>',
      }),
    );
    await page.goto('/__product_mask');
    const result = await page.evaluate(
      async ({ core, scenario }) => {
        const { acquireDevice, InputManager, readTextureTap } = (await import(
          core
        )) as typeof import('../../packages/core/src/index.ts');
        const { session, release } = await acquireDevice();
        session.scheduler.setHidden(true);
        const manager = new InputManager(session);
        const read = async () => {
          const encoder = session.device.createCommandEncoder();
          manager.prepare({} as import('../../packages/core/src/effect.ts').FrameInfo, encoder);
          session.submitEncoder(encoder);
          await session.device.queue.onSubmittedWorkDone();
          const tap = manager.get('mask')!;
          const read = await readTextureTap(session.device, tap);
          return {
            values: Array.from(read.values),
            channels: read.channels,
            format: tap.format,
            version: tap.version,
            taps: Object.keys(manager.taps()),
            memory: manager.memory(),
          };
        };
        try {
          if (scenario === 'image-alpha') {
            const canvas = new OffscreenCanvas(2, 1),
              context = canvas.getContext('2d')!;
            context.putImageData(
              new ImageData(new Uint8ClampedArray([255, 0, 0, 128, 0, 255, 0, 255]), 2, 1),
              0,
              0,
            );
            const bitmap = await createImageBitmap(canvas);
            await manager.set('mask', { kind: 'mask', source: bitmap });
            bitmap.close();
            const initial = await read();
            const unchanged = await read();
            await manager.restore();
            const restored = await read();
            await manager.set('mask', null);
            return {
              initial,
              unchanged,
              restored,
              cleared: manager.memory(),
              errors: [...session.errors],
            };
          }
          await manager.set('mask', {
            kind: 'mask',
            source: 'M0 0H4V4H0Z M1 1H3V3H1Z',
            width: 4,
            height: 4,
            fillRule: 'evenodd',
          });
          const path = await read();
          const canvas = new OffscreenCanvas(2, 1),
            context = canvas.getContext('2d')!;
          context.putImageData(
            new ImageData(new Uint8ClampedArray([128, 128, 128, 255, 255, 255, 255, 255]), 2, 1),
            0,
            0,
          );
          await manager.set('mask', { kind: 'mask', source: canvas, channel: 'red' });
          const red = await read();
          await manager.set('mask', { kind: 'mask', source: canvas, channel: 'luminance' });
          const luminance = await read();
          await manager.set('mask', { kind: 'mask', source: canvas, channel: 'red' });
          canvas.width = 3;
          context.fillStyle = '#404040';
          context.fillRect(0, 0, 3, 1);
          const resized = await read();
          await manager.restore();
          const restored = await read();
          manager.dispose();
          return {
            path,
            red,
            luminance,
            resized,
            restored,
            callerWidth: canvas.width,
            cleared: manager.memory(),
            errors: [...session.errors],
          };
        } finally {
          manager.dispose();
          release();
        }
      },
      { core, scenario },
    );
    expect(result.errors).toEqual([]);
    expect(result.cleared).toEqual({ textureBytes: 0, bufferBytes: 0 });
    if (scenario === 'image-alpha') {
      expect(result.initial).toMatchObject({
        channels: 1,
        format: 'r8unorm',
        taps: ['mask'],
        memory: { textureBytes: 2, bufferBytes: 16 },
      });
      expect(result.initial!.values[0]).toBeCloseTo(128 / 255, 6);
      expect(result.initial!.values[1]).toBe(1);
      expect(result.unchanged!.version).toBe(result.initial!.version);
      expect(result.restored.values).toEqual(result.initial!.values);
    } else {
      expect(result.path!.values).toEqual([1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1]);
      expect(result.red!.values[0]).toBeCloseTo(128 / 255, 6);
      expect(result.red!.values[1]).toBe(1);
      expect(result.luminance!.values[0]).toBeCloseTo(55 / 255, 6);
      expect(result.luminance!.values[1]).toBe(1);
      result.resized!.values.forEach((v) => expect(v).toBeCloseTo(64 / 255, 6));
      expect(result.restored.values).toEqual(result.resized!.values);
      expect(result.callerWidth).toBe(3);
      expect(result.resized!.memory).toEqual({ textureBytes: 3, bufferBytes: 16 });
    }
  });
