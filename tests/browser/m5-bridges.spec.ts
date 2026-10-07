import { test, expect } from '@playwright/test';
import type {} from './effects.spec.ts';
import { fileURLToPath } from 'node:url';
test('Faulty author drivers report errors without stopping healthy fields and unchanged clocks settle', async ({
  page,
}) => {
  const core = '/@fs' + fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
    dom = '/@fs' + fileURLToPath(new URL('../../packages/dom/src/index.ts', import.meta.url));
  await page.route('**/__m5_drivers', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Driver isolation</title><style>canvas{width:32px;height:32px}</style>',
    }),
  );
  await page.goto('/__m5_drivers');
  const result = await page.evaluate(
    async ({ core, dom }) => {
      const { createEffect, fragmentEffect } = (await import(
        core
      )) as typeof import('../../packages/core/src/index.ts');
      const { bindProperties, bindTimeline } = (await import(
        dom
      )) as typeof import('../../packages/dom/src/index.ts');
      const definition = fragmentEffect({
        id: 'driver-browser',
        title: 'driver',
        params: { amount: { type: 'f32', default: 0.2 } },
        wgsl: 'fn effect(uv:vec2f)->vec4f{return vec4f(params.amount,0,0,1);}',
      });
      const makeCanvas = () => {
        const canvas = document.createElement('canvas');
        document.body.append(canvas);
        return canvas;
      };
      const bad = await createEffect(makeCanvas(), definition, { playing: false }),
        healthy = await createEffect(makeCanvas(), definition, {
          playing: true,
          reducedMotion: false,
        });
      let mode: 'throw' | 'invalid' | 'valid' = 'throw',
        progress = NaN,
        rendered = 0;
      const events: { driver: string; message: string; bubbles: boolean; composed: boolean }[] = [];
      bad.canvas.addEventListener('hgpu-error', (event) => {
        const detail = (event as CustomEvent).detail;
        events.push({
          driver: detail.driver,
          message: String(detail.error),
          bubbles: event.bubbles,
          composed: event.composed,
        });
      });
      const properties = bindProperties(bad, () => {
          if (mode === 'throw') throw new Error('author source failed');
          return { amount: mode === 'invalid' ? NaN : 0.8 };
        }),
        timeline = bindTimeline(bad, () => progress);
      const removeRendered = bad.onRendered(() => rendered++);
      const frames = async (count: number) => {
        // Queue backpressure can span many rAF callbacks. Observe actual scheduled
        // renders and GPU completion before comparing progress or settled polling.
        for (let i = 0; i < count; i++) {
          await new Promise<void>((resolve) => {
            const remove = healthy.onRendered(() => {
              remove();
              resolve();
            });
          });
          await healthy.session.device.queue.onSubmittedWorkDone();
        }
      };
      const initialHealthy = healthy.frame.index;
      await frames(8);
      const whileBroken = healthy.frame.index,
        initialErrors = events.length;
      bad.drawAt(0);
      const before = (await bad.readPixels()).pixels[0]!;
      mode = 'invalid';
      await frames(3);
      const invalidAmount = bad.params.amount;
      mode = 'valid';
      progress = 0.4;
      await frames(4);
      const after = (await bad.readPixels()).pixels[0]!,
        pose = { time: bad.frame.time, delta: bad.frame.delta, index: bad.frame.index };
      await frames(2); // Let readback-induced invalidation settle before measuring idle polling.
      const baselineRenders = rendered,
        callsBefore = properties.stats.calls;
      await frames(8);
      const settledRenders = rendered - baselineRenders,
        stillPolling = properties.stats.calls > callsBefore,
        stillHealthy = healthy.frame.index > whileBroken,
        propertyErrors = properties.stats.errors,
        timelineErrors = timeline.stats.errors,
        amount = bad.params.amount,
        errors = [...bad.session.errors];
      removeRendered();
      timeline.dispose();
      properties.dispose();
      const pollingReleased = !bad.polling,
        session = bad.session;
      bad.destroy();
      healthy.destroy();
      bad.canvas.remove();
      healthy.canvas.remove();
      return {
        initialHealthy,
        whileBroken,
        initialErrors,
        before,
        after,
        invalidAmount,
        pose,
        settledRenders,
        stillPolling,
        stillHealthy,
        propertyErrors,
        timelineErrors,
        amount,
        events,
        pollingReleased,
        errors,
        surfaces: session.scheduler.surfaceCount,
      };
    },
    { core, dom },
  );
  expect(result.whileBroken).toBeGreaterThan(result.initialHealthy);
  expect(result.initialErrors).toBe(2);
  expect(result.invalidAmount).toBe(0.2);
  expect(result.after).toBeGreaterThan(result.before + 70);
  expect(result.amount).toBe(0.8);
  expect(result.pose).toEqual({ time: 0.4, delta: 0, index: 24 });
  expect(result.settledRenders).toBe(0);
  expect(result.stillPolling).toBe(true);
  expect(result.stillHealthy).toBe(true);
  expect(result.propertyErrors).toHaveLength(2);
  expect(result.timelineErrors).toHaveLength(1);
  expect(result.events).toHaveLength(3);
  expect(
    result.events.every((event) => event.bubbles && event.composed && event.message.length > 0),
  ).toBe(true);
  expect(result.pollingReleased).toBe(true);
  expect(result.surfaces).toBe(0);
  expect(result.errors).toEqual([]);
});
test('Typed CSS uniforms preserve JS/presets when unbound, poll once while visible, obey cap, and coexist with timelines', async ({
  page,
}) => {
  await page.routeWebSocket(/.*/, () => {});
  await page.goto('/?effect=gradient-oklch&playing=false&quality=fixed');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  const result = await page.evaluate(
    async (entry) => {
      const { bindCSSParameters, bindProperties, bindTimeline } = await import(entry);
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:10px;top:10px;width:64px;height:64px;';
      const canvas = document.createElement('canvas');
      host.append(canvas);
      document.body.append(host);
      const effect = window.hologpu.fragmentEffect({
        id: 'css-clock-test',
        title: 'CSS clock',
        params: {
          amount: { type: 'f32', default: 0.35, min: 0, max: 1, css: true },
          ink: { type: 'color', default: '#123456', css: true },
        },
        presets: { high: { amount: 0.7 } },
        wgsl: 'fn effect(uv:vec2f)->vec4f{return vec4f(params.amount,0,0,1);}',
      });
      const field = await window.hologpu.createEffect(canvas, effect, {
        playing: false,
        preset: 'high',
        adaptiveQuality: false,
      });
      let bridge: any, properties: any, timeline: any;
      try {
        bridge = bindCSSParameters(host, field, { prefix: '--m5-test-' });
        field.beforeFrame();
        const initial = field.params.amount;
        host.style.setProperty('--m5-test-amount', '.8');
        host.style.setProperty('--m5-test-ink', '#abcdef');
        bridge.resetStats();
        field.beforeFrame();
        const changed = {
          amount: field.params.amount,
          ink: field.params.ink,
          reads: bridge.stats.reads,
          properties: bridge.properties,
        };
        field.visible = false;
        field.beforeFrame();
        const hiddenReads = bridge.stats.reads;
        field.visible = true;
        properties = bindProperties(field, () => ({ amount: 0.55 }));
        timeline = bindTimeline(field, () => 0.6);
        field.beforeFrame();
        const driven = {
          amount: field.params.amount,
          time: field.frame.time,
          delta: field.frame.delta,
          playing: field.playing,
        };
        bridge.dispose();
        timeline.dispose();
        const stillPolling = field.polling;
        properties.dispose();
        const stoppedPolling = field.polling;
        const errors: string[] = [];
        try {
          bindCSSParameters(host, field, { names: Array.from({ length: 9 }, (_, i) => 'x' + i) });
        } catch (e) {
          errors.push(String(e));
        }
        try {
          bindCSSParameters(host, field, { names: ['amount', 'amount'] });
        } catch (e) {
          errors.push(String(e));
        }
        return { initial, changed, hiddenReads, driven, stillPolling, stoppedPolling, errors };
      } finally {
        bridge?.dispose();
        properties?.dispose();
        timeline?.dispose();
        field.destroy();
        host.remove();
      }
    },
    '/@fs' + new URL('../../packages/hologpu/src/dom.ts', import.meta.url).pathname,
  );
  expect(result.initial).toBe(0.7);
  expect(result.changed.amount).toBe(0.8);
  expect(result.changed.ink).toBe('rgb(171, 205, 239)');
  expect(result.changed.reads).toBe(1);
  expect(result.hiddenReads).toBe(1);
  expect(result.changed.properties.length).toBe(2);
  expect(result.driven).toEqual({ amount: 0.55, time: 0.6, delta: 0, playing: false });
  expect(result.stillPolling).toBe(true);
  expect(result.stoppedPolling).toBe(false);
  expect(result.errors[0]).toContain('At most 8');
  expect(result.errors[1]).toContain('Duplicate');
});
test('No WebGPU keeps all six article contents and buttons usable', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'gpu', { get: () => undefined, configurable: true }),
  );
  await page.routeWebSocket(/.*/, (socket) => socket.close());
  await page.goto('/?effect=border-energy&mode=in-page&playing=false');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'fallback');
  await expect(page.locator('hgpu-field[data-hgpu-state="fallback"]')).toHaveCount(6);
  const button = page.locator('hgpu-field').first().getByRole('button');
  await button.click();
  await expect(button).toHaveText('Content remains interactive');
  expect(
    await page
      .locator('hgpu-field')
      .evaluateAll((nodes) =>
        nodes.every(
          (node) =>
            node.children.length >= 3 &&
            node.shadowRoot?.querySelector('slot') &&
            node.textContent!.includes('One element'),
        ),
      ),
  ).toBe(false);
  expect(
    await page
      .locator('hgpu-field')
      .evaluateAll((nodes) =>
        nodes.every(
          (node) => node.children.length >= 3 && !!node.shadowRoot?.querySelector('slot'),
        ),
      ),
  ).toBe(true);
});
