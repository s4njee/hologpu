import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const core = '/@fs' + fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url));
for (const phase of ['pipeline', 'mapping'] as const)
  for (const action of ['resize', 'loss'] as const)
    test(`Readback ${phase} survives same-device resize and rejects replacement: ${action}`, async ({
      page,
    }) => {
      test.setTimeout(60000);
      await page.route('**/__m5_capture', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><title>Capture lifecycle</title><style>canvas{width:96px;height:64px}</style>',
        }),
      );
      await page.goto('/__m5_capture');
      const result = await page.evaluate(
        async ({ core, phase, action }) => {
          const { createEffect, fragmentEffect } = (await import(
            core
          )) as typeof import('../../packages/core/src/index.ts');
          const canvas = document.createElement('canvas');
          document.body.append(canvas);
          const field = await createEffect(
            canvas,
            fragmentEffect({
              id: 'capture-lifecycle',
              title: 'capture',
              params: { amount: { type: 'f32', default: 0.2 } },
              wgsl: 'fn effect(uv:vec2f)->vec4f{return vec4f(params.amount,0,0,1);}',
            }),
            { playing: false, adaptiveQuality: false },
          );
          const session = field.session,
            device = session.device,
            generation = session.generation;
          session.scheduler.setHidden(true);
          field.drawAt(0.4);
          await device.queue.onSubmittedWorkDone();
          let release!: () => void, enter!: () => void;
          const gate = new Promise<void>((resolve) => (release = resolve)),
            entered = new Promise<void>((resolve) => (enter = resolve));
          const pipeline = device.createRenderPipelineAsync.bind(device),
            createBuffer = device.createBuffer.bind(device);
          device.createRenderPipelineAsync = async (descriptor) => {
            const result = await pipeline(descriptor);
            if (phase === 'pipeline' && descriptor.label === 'hgpu-readback') {
              enter();
              await gate;
            }
            return result;
          };
          device.createBuffer = (descriptor) => {
            const result = createBuffer(descriptor);
            if (phase === 'mapping' && descriptor.label === 'hgpu-readback-staging') {
              const map = result.mapAsync.bind(result);
              result.mapAsync = async (...args) => {
                await map(...args);
                enter();
                await gate;
              };
            }
            return result;
          };
          const capture = field.readPixels().then(
            (value) => ({ value, error: '' }),
            (error) => ({ value: null, error: String(error) }),
          );
          await entered;
          let expected: readonly [number, number] = field.surface!.size;
          if (action === 'resize') {
            field.params.amount = 0.8;
            field.setResolutionScale(0.5);
            if (phase === 'pipeline') expected = field.surface!.size;
          } else {
            device.destroy();
            await device.lost;
          }
          release();
          const captured = await capture;
          device.createRenderPipelineAsync = pipeline;
          device.createBuffer = createBuffer;
          if (action === 'loss') {
            await device.lost;
            for (
              let i = 0;
              i < 180 &&
              !(
                session.state === 'ready' &&
                session.generation > generation &&
                field.state === 'ready'
              );
              i++
            )
              await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          }
          const errors = [...session.errors],
            replacementReady =
              session.state === 'ready' &&
              session.generation > generation &&
              field.state === 'ready';
          const value = captured.value
            ? {
                width: captured.value.width,
                height: captured.value.height,
                length: captured.value.pixels.length,
                first: Array.from(captured.value.pixels.slice(0, 4)),
                finite: Array.from(captured.value.pixels).every(Number.isFinite),
              }
            : null;
          field.destroy();
          canvas.remove();
          return {
            value,
            error: captured.error,
            expected,
            errors,
            replacementReady,
            surfaces: session.scheduler.surfaceCount,
            memory: field.memory(),
          };
        },
        { core, phase, action },
      );
      if (action === 'resize') {
        expect(result.error).toBe('');
        expect(result.value).toMatchObject({
          width: result.expected[0],
          height: result.expected[1],
          length: result.expected[0] * result.expected[1] * 4,
          finite: true,
        });
        expect(result.value!.first[0]).toBeGreaterThan(phase === 'pipeline' ? 200 : 100);
        expect(result.value!.first[0]).toBeLessThan(phase === 'pipeline' ? 240 : 150);
        expect(result.value!.first.slice(1)).toEqual([0, 0, 255]);
      } else {
        expect(result.error).toContain('Field is not ready');
        expect(result.value).toBeNull();
        expect(result.replacementReady).toBe(true);
      }
      expect(result.errors).toEqual([]);
      expect(result.surfaces).toBe(0);
      expect(result.memory).toMatchObject({ textureBytes: 0, bufferBytes: 0 });
    });
