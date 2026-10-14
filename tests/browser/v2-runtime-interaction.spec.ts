import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import type {
  Attachment,
  AttachmentTimings,
  HGPUFieldElement,
} from '../../packages/dom/src/index.ts';
const source = (path: string) => '/@fs' + fileURLToPath(new URL(path, import.meta.url));
const paths = {
  core: source('../../packages/core/src/index.ts'),
  dom: source('../../packages/dom/src/index.ts'),
};
type RuntimeWindow = Window & {
  runtime: Attachment;
  runtimeDraws: number;
  readyDetails: AttachmentTimings[];
};
async function pageFixture(page: Page) {
  await page.route('**/__v2_runtime', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><style>body{margin:0;background:#14151a;min-height:2500px}#host{width:160px;height:100px}button{margin:12px}</style><div id="host"><button id="button">Native button</button></div>',
    }),
  );
  await page.goto('/__v2_runtime');
}
async function fixture(
  page: Page,
  options: {
    reducedMotion?: boolean;
    forceFallback?: boolean;
    playing?: boolean;
    idleAfter?: number;
  } = {},
) {
  await pageFixture(page);
  await page.evaluate(
    async ({ paths, options }) => {
      const { fragmentEffect } = (await import(
        paths.core
      )) as typeof import('../../packages/core/src/index.ts');
      const { attach } = (await import(
        paths.dom
      )) as typeof import('../../packages/dom/src/index.ts');
      const host = document.getElementById('host')!;
      const readyDetails: AttachmentTimings[] = [];
      host.addEventListener('hgpu-ready', (event) =>
        readyDetails.push((event as CustomEvent<{ timings: AttachmentTimings }>).detail.timings),
      );
      const effect = fragmentEffect({
        id: 'interaction-lifecycle-fixture',
        title: 'Interaction fixture',
        params: {},
        inputs: ['pointer'],
        reducedMotion: { time: 0 },
        fallback: 'linear-gradient(#314766,#527076)',
        wgsl: 'fn effect(uv:vec2f)->vec4f{return vec4f(.15+sin(frame.time)*.02,.25,.35,1);}',
      });
      const runtime = await attach(host, effect, {
        renderOn: 'interaction',
        idleAfter: 80,
        adaptiveQuality: false,
        reducedMotion: false,
        ...options,
      });
      const w = window as unknown as RuntimeWindow;
      Object.assign(w, { runtime, readyDetails, runtimeDraws: 0 });
      runtime.field?.onRendered(() => w.runtimeDraws++);
    },
    { paths, options },
  );
}
const playing = (page: Page) =>
  page.evaluate(() => (window as unknown as RuntimeWindow).runtime.field?.playing ?? false);

test('ready means a correctly sized completed first GPU frame, with immutable timing evidence', async ({
  page,
}) => {
  await fixture(page);
  const result = await page.evaluate(async () => {
    const w = window as unknown as RuntimeWindow,
      a = w.runtime,
      f = a.field!;
    const pixels = await f.readPixels();
    const event = w.readyDetails[0]!;
    const result = {
      timings: a.timings,
      event,
      count: w.readyDetails.length,
      state: a.state,
      size: f.surface!.size,
      dpr: devicePixelRatio,
      visible: pixels.pixels.some((value, i) => i % 4 === 3 && value > 0),
      frozen: Object.isFrozen(a.timings) && Object.isFrozen(event),
      playing: f.playing,
    };
    a.destroy();
    return result;
  });
  expect(result.state).toBe('ready');
  expect(result.count).toBe(1);
  expect(result.visible).toBe(true);
  expect(result.frozen).toBe(true);
  expect(result.playing).toBe(false);
  expect(result.size).toEqual([160 * result.dpr, 100 * result.dpr]);
  expect(result.timings).toEqual(result.event);
  expect(result.timings.startedAt).toBeLessThanOrEqual(result.timings.gpuReadyAt!);
  expect(result.timings.gpuReadyAt!).toBeLessThanOrEqual(result.timings.firstFrameSubmittedAt!);
  expect(result.timings.firstFrameSubmittedAt!).toBeLessThanOrEqual(
    result.timings.firstFrameCompletedAt!,
  );
  expect(result.timings.firstFrameMs).toBeCloseTo(
    result.timings.firstFrameCompletedAt! - result.timings.startedAt,
    5,
  );
  expect(result.timings.fallbackReadyAt).toBeNull();
  expect(result.timings.fallbackMs).toBeNull();
});

test('pointer/touch/focus activity is bounded, native activation survives, and manual play pins until pause', async ({
  page,
}) => {
  await fixture(page, { idleAfter: 160 });
  await page.mouse.move(500, 300);
  await page.mouse.move(100, 70);
  expect(await playing(page)).toBe(true);
  await page.mouse.move(110, 75);
  await expect.poll(() => playing(page)).toBe(false);
  const initial = await page.evaluate(() => (window as unknown as RuntimeWindow).runtimeDraws);
  await page.waitForTimeout(120);
  expect(await page.evaluate(() => (window as unknown as RuntimeWindow).runtimeDraws)).toBe(
    initial,
  );
  await page.evaluate(() => {
    const host = document.getElementById('host')!;
    host.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerType: 'touch',
        pointerId: 7,
        clientX: 50,
        clientY: 50,
        bubbles: true,
      }),
    );
  });
  expect(await playing(page)).toBe(true);
  await page.evaluate(() =>
    document
      .getElementById('host')!
      .dispatchEvent(new PointerEvent('pointercancel', { pointerId: 7, bubbles: true })),
  );
  await expect.poll(() => playing(page)).toBe(false);
  await page.evaluate(() => {
    Reflect.set(window, 'nativeActivations', 0);
    document
      .getElementById('button')!
      .addEventListener('click', () =>
        Reflect.set(
          window,
          'nativeActivations',
          Number(Reflect.get(window, 'nativeActivations')) + 1,
        ),
      );
  });
  await page.locator('#button').focus();
  expect(await playing(page)).toBe(true);
  await page.locator('#button').press('Enter');
  expect(await page.evaluate(() => Reflect.get(window, 'nativeActivations'))).toBe(1);
  await expect.poll(() => playing(page)).toBe(false);
  await page.evaluate(() => (window as unknown as RuntimeWindow).runtime.play());
  await page.waitForTimeout(250);
  expect(await playing(page)).toBe(true);
  await page.evaluate(() => (window as unknown as RuntimeWindow).runtime.pause());
  expect(await playing(page)).toBe(false);
  await page.evaluate(() =>
    document
      .getElementById('host')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })),
  );
  expect(await playing(page)).toBe(true);
  await expect.poll(() => playing(page)).toBe(false);
  await page.evaluate(() => (window as unknown as RuntimeWindow).runtime.destroy());
});

test('reduced motion preserves its exact pose and stops hidden animation clocks', async ({
  page,
}) => {
  await fixture(page, { reducedMotion: true });
  await page.evaluate(async () => {
    Reflect.set(
      window,
      'runtimePose',
      (await (window as unknown as RuntimeWindow).runtime.field!.readPixels()).pixels,
    );
  });
  await page.mouse.move(50, 50);
  await page.locator('#button').focus();
  await page.locator('#button').press('Enter');
  await page.evaluate(() => (window as unknown as RuntimeWindow).runtime.play());
  await page.waitForTimeout(180);
  const result = await page.evaluate(async () => {
    const w = window as unknown as RuntimeWindow,
      f = w.runtime.field!;
    const pixels = (await f.readPixels()).pixels.every(
        (value, i) => value === (Reflect.get(window, 'runtimePose') as Uint8Array)[i],
      ),
      time = f.frame.time,
      playing = f.playing;
    const start = w.runtimeDraws;
    await new Promise((resolve) => setTimeout(resolve, 120));
    const idle = w.runtimeDraws === start;
    w.runtime.destroy();
    return { pixels, time, playing, idle };
  });
  expect(result.pixels).toBe(true);
  expect(result.time).toBe(0);
  expect(result.playing).toBe(false);
  expect(result.idle).toBe(true);
});

test('offscreen and document-hidden fields pause immediately; pinned motion resumes safely', async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() => (window as unknown as RuntimeWindow).runtime.play());
  expect(await playing(page)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 1200));
  await expect.poll(() => playing(page)).toBe(false);
  const stopped = await page.evaluate(
    () => (window as unknown as RuntimeWindow).runtime.field!.frame.time,
  );
  await page.waitForTimeout(150);
  expect(
    await page.evaluate(() => (window as unknown as RuntimeWindow).runtime.field!.frame.time),
  ).toBe(stopped);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => playing(page)).toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(await playing(page)).toBe(false);
  const hidden = await page.evaluate(
    () => (window as unknown as RuntimeWindow).runtime.field!.frame.time,
  );
  await page.waitForTimeout(120);
  expect(
    await page.evaluate(() => (window as unknown as RuntimeWindow).runtime.field!.frame.time),
  ).toBe(hidden);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(await playing(page)).toBe(true);
  await page.evaluate(() => (window as unknown as RuntimeWindow).runtime.destroy());
});

test('fallback timing is distinct and custom-element attributes remount and clean up interaction controls', async ({
  page,
}) => {
  await fixture(page, { forceFallback: true });
  const fallback = await page.evaluate(() => {
    const a = (window as unknown as RuntimeWindow).runtime;
    const result = { state: a.state, timings: a.timings };
    a.destroy();
    return result;
  });
  expect(fallback.state).toBe('fallback');
  expect(fallback.timings.firstFrameMs).toBeNull();
  expect(fallback.timings.firstFrameCompletedAt).toBeNull();
  expect(fallback.timings.gpuReadyAt).toBeNull();
  expect(fallback.timings.fallbackReadyAt!).toBeGreaterThanOrEqual(fallback.timings.startedAt);
  expect(fallback.timings.fallbackMs).toBeCloseTo(
    fallback.timings.fallbackReadyAt! - fallback.timings.startedAt,
    5,
  );
  const result = await page.evaluate(
    async ({ paths }) => {
      const { fragmentEffect } = (await import(
        paths.core
      )) as typeof import('../../packages/core/src/index.ts');
      const { registerHGPUField } = (await import(
        paths.dom
      )) as typeof import('../../packages/dom/src/index.ts');
      const definition = fragmentEffect({
        id: 'runtime-element',
        title: 'Runtime element',
        params: {},
        wgsl: 'fn effect(uv:vec2f)->vec4f{return vec4f(.2,.3,.4,1);}',
      });
      registerHGPUField({ name: 'runtime-field', resolveEffect: async () => definition });
      const node = document.createElement('runtime-field') as HGPUFieldElement;
      node.style.cssText = 'width:160px;height:100px';
      node.setAttribute('effect', definition.id);
      node.setAttribute('render-on', 'interaction');
      node.setAttribute('idle-after', '40');
      node.innerHTML = '<button>Native custom action</button>';
      document.body.append(node);
      const first = (await node.ready)!;
      const paused = first.field!.playing === false;
      node.dispatchEvent(new PointerEvent('pointerenter'));
      const active = first.field!.playing;
      await new Promise((resolve) => setTimeout(resolve, 100));
      const stopped = !first.field!.playing;
      node.setAttribute('idle-after', '80');
      const second = (await node.ready)!;
      const remounted = second !== first && first.state === 'disposed';
      node.dispatchEvent(new PointerEvent('pointerenter'));
      node.remove();
      await new Promise((resolve) => setTimeout(resolve, 120));
      return {
        paused,
        active,
        stopped,
        remounted,
        disposed: second.state,
        field: second.field,
        canvas: node.shadowRoot!.querySelector('canvas') !== null,
        slot: node
          .shadowRoot!.querySelector('slot')!
          .assignedElements()
          .some((n) => n.localName === 'button'),
      };
    },
    { paths },
  );
  expect(result).toEqual({
    paused: true,
    active: true,
    stopped: true,
    remounted: true,
    disposed: 'disposed',
    field: null,
    canvas: false,
    slot: true,
  });
});

test('invalid interaction options fail before taking ownership of an author host', async ({
  page,
}) => {
  await pageFixture(page);
  const result = await page.evaluate(
    async ({ paths }) => {
      const { fragmentEffect } = (await import(
        paths.core
      )) as typeof import('../../packages/core/src/index.ts');
      const { attach } = (await import(
        paths.dom
      )) as typeof import('../../packages/dom/src/index.ts');
      const effect = fragmentEffect({
        id: 'runtime-invalid',
        title: 'Invalid options',
        params: {},
        wgsl: 'fn effect(uv:vec2f)->vec4f{return vec4f(0);}',
      });
      const host = document.getElementById('host')!;
      let failures = 0;
      for (const idleAfter of [-1, Infinity, NaN, 10001])
        try {
          await attach(host, effect, { idleAfter });
        } catch {
          failures++;
        }
      const untouched = !host.shadowRoot;
      const a = await attach(host, effect, { renderOn: 'interaction', forceFallback: true });
      a.destroy();
      return { failures, untouched, state: a.state };
    },
    { paths },
  );
  expect(result).toEqual({ failures: 4, untouched: true, state: 'disposed' });
});

for (const scenario of ['abort', 'queue-failure'] as const) {
  test(`${scenario} during the first submitted frame settles the attach promise and cleans ownership`, async ({
    page,
  }) => {
    await pageFixture(page);
    const result = await page.evaluate(
      async ({ paths, scenario }) => {
        const { fragmentEffect } = (await import(
          paths.core
        )) as typeof import('../../packages/core/src/index.ts');
        const { attach } = (await import(
          paths.dom
        )) as typeof import('../../packages/dom/src/index.ts');
        const host = document.getElementById('host')!;
        let entered!: () => void, release!: () => void;
        const waiting = new Promise<void>((resolve) => {
          entered = resolve;
        });
        const pendingQueue = new Promise<undefined>((resolve) => {
          release = () => resolve(undefined);
        });
        let queue: GPUQueue | undefined, original: GPUQueue['onSubmittedWorkDone'] | undefined;
        const base = fragmentEffect({
          id: `runtime-first-${scenario}`,
          title: 'First-frame failure',
          params: {},
          wgsl: 'fn effect(uv:vec2f)->vec4f{return vec4f(.2,.3,.4,1);}',
        });
        const effect = {
          ...base,
          async create(ctx: Parameters<typeof base.create>[0]) {
            const instance = await base.create(ctx);
            queue = ctx.device.queue;
            original = queue.onSubmittedWorkDone.bind(queue);
            queue.onSubmittedWorkDone = () => {
              entered();
              if (scenario === 'abort') return pendingQueue;
              queue!.onSubmittedWorkDone = original!;
              return Promise.reject(new Error('Injected first-frame queue failure'));
            };
            return instance;
          },
        };
        const abort = new AbortController();
        let ready = 0;
        host.addEventListener('hgpu-ready', () => ready++);
        const attaching = attach(host, effect, {
          renderOn: 'interaction',
          signal: abort.signal,
          adaptiveQuality: false,
        });
        await waiting;
        if (scenario === 'abort') abort.abort();
        let state: string | undefined, error: string | undefined;
        try {
          const attachment = await Promise.race([
            attaching,
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Attach promise did not settle')), 2000),
            ),
          ]);
          state = attachment.state;
        } catch (failure) {
          error = (failure as Error).message;
        }
        if (queue && original) queue.onSubmittedWorkDone = original;
        release();
        const native = host.querySelector('button')!.textContent;
        const cleaned = !host.shadowRoot!.querySelector('canvas');
        const fallback = await attach(host, base, { forceFallback: true });
        const remounted = fallback.state;
        fallback.destroy();
        return { state, error, ready, native, cleaned, remounted };
      },
      { paths, scenario },
    );
    expect(result.ready).toBe(0);
    expect(result.native).toBe('Native button');
    expect(result.cleaned).toBe(true);
    expect(result.remounted).toBe('fallback');
    if (scenario === 'abort') {
      expect(result.state).toBe('disposed');
      expect(result.error).toBeUndefined();
    } else expect(result.error).toBe('Injected first-frame queue failure');
  });
}

test('loss before the first pixel restores an initially offscreen reduced field and emits its first ready event', async ({
  page,
}) => {
  await pageFixture(page);
  const result = await page.evaluate(
    async ({ paths }) => {
      const { fragmentEffect } = (await import(
        paths.core
      )) as typeof import('../../packages/core/src/index.ts');
      const { attach } = (await import(
        paths.dom
      )) as typeof import('../../packages/dom/src/index.ts');
      const host = document.getElementById('host')!;
      host.style.marginTop = '1800px';
      const events: string[] = [];
      for (const name of ['ready', 'lost', 'restored'])
        host.addEventListener(`hgpu-${name}`, () => events.push(name));
      let creates = 0;
      const base = fragmentEffect({
        id: 'runtime-initial-loss',
        title: 'Initially lost',
        params: {},
        wgsl: 'fn effect(uv:vec2f)->vec4f{return vec4f(.3,.4,.5,1);}',
      });
      const effect = {
        ...base,
        async create(ctx: Parameters<typeof base.create>[0]) {
          const instance = await base.create(ctx);
          if (creates++ === 0) {
            const device = ctx.device,
              queue = device.queue,
              original = queue.onSubmittedWorkDone.bind(queue);
            queue.onSubmittedWorkDone = () => {
              queue.onSubmittedWorkDone = original;
              device.destroy();
              return Promise.reject(new Error('Injected loss before first-frame completion'));
            };
          }
          return instance;
        },
      };
      const attachment = await attach(host, effect, {
        renderOn: 'interaction',
        reducedMotion: true,
        adaptiveQuality: false,
      });
      const field = attachment.field!;
      const visible = (await field.readPixels()).pixels.some(
        (value, i) => i % 4 === 3 && value > 0,
      );
      const result = {
        events,
        creates,
        state: attachment.state,
        playing: field.playing,
        time: field.frame.time,
        visible,
        completed: attachment.timings.firstFrameCompletedAt !== null,
        errors: [...field.session.errors],
      };
      attachment.destroy();
      return result;
    },
    { paths },
  );
  expect(result.events.filter((name) => name === 'ready')).toHaveLength(1);
  expect(result.events.filter((name) => name === 'lost')).toHaveLength(1);
  expect(result.events.filter((name) => name === 'restored')).toHaveLength(0);
  expect(result.creates).toBe(2);
  expect(result.state).toBe('ready');
  expect(result.playing).toBe(false);
  expect(result.time).toBe(0);
  expect(result.visible).toBe(true);
  expect(result.completed).toBe(true);
  expect(result.errors).toEqual([]);
});

test('failed ready fields reject playback and native activity, stop CSS polling, and recover their drivers', async ({
  page,
}) => {
  await pageFixture(page);
  const result = await page.evaluate(
    async ({ paths }) => {
      const { fragmentEffect } = (await import(
        paths.core
      )) as typeof import('../../packages/core/src/index.ts');
      const { attach } = (await import(
        paths.dom
      )) as typeof import('../../packages/dom/src/index.ts');
      const host = document.getElementById('host')!;
      const definition = fragmentEffect({
        id: 'runtime-error-playback',
        title: 'Error playback',
        inputs: ['pointer'],
        params: { level: { type: 'f32', default: 0.2, min: 0, max: 1, css: true } },
        fallback: 'linear-gradient(#314766,#527076)',
        wgsl: 'fn effect(uv:vec2f)->vec4f{return vec4f(params.level,.3,.4,1);}',
      });
      const attachment = await attach(host, definition, {
        renderOn: 'interaction',
        idleAfter: 100,
        adaptiveQuality: false,
        reducedMotion: false,
      });
      const field = attachment.field!;
      attachment.play();
      const originally = { playing: field.playing, polling: field.polling };
      // Mirror the runtime's terminal error notification without destroying the shared test device.
      field.state = 'error';
      field.notify();
      const fallback = attachment.state;
      attachment.play();
      attachment.setReducedMotion(true);
      attachment.setReducedMotion(false);
      host.dispatchEvent(new PointerEvent('pointerenter'));
      host.dispatchEvent(
        new PointerEvent('pointermove', { clientX: 50, clientY: 50, bubbles: true }),
      );
      const button = host.querySelector('button')!;
      let activations = 0;
      button.addEventListener('click', () => activations++);
      button.focus();
      button.click();
      button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 250));
      let beforeFrames = 0,
        updates = 0,
        renders = 0;
      const before = field.beforeFrame.bind(field),
        update = field.update.bind(field),
        render = field.render.bind(field);
      field.beforeFrame = () => {
        beforeFrames++;
        before();
      };
      field.update = (tick) => {
        updates++;
        update(tick);
      };
      field.render = () => {
        renders++;
        render();
      };
      const stopped = { playing: field.playing, polling: field.polling };
      await new Promise((resolve) => setTimeout(resolve, 180));
      const attempts = { beforeFrames, updates, renders };
      // Restoring a healthy field must restore its CSS bridge rather than leave it frozen.
      attachment.pause();
      const ready = new Promise<void>((resolve) =>
        host.addEventListener('hgpu-ready', () => resolve(), { once: true }),
      );
      field.state = 'ready';
      field.notify();
      await ready;
      host.style.setProperty('--hgpu-level', '0.7');
      await new Promise((resolve) => setTimeout(resolve, 180));
      const restored = {
        state: attachment.state,
        playing: field.playing,
        polling: field.polling,
        level: field.params.level,
      };
      const errors = [...field.session.errors];
      attachment.destroy();
      return { originally, fallback, stopped, attempts, activations, restored, errors };
    },
    { paths },
  );
  expect(result.originally).toEqual({ playing: true, polling: true });
  expect(result.fallback).toBe('fallback');
  expect(result.stopped).toEqual({ playing: false, polling: false });
  expect(result.attempts).toEqual({ beforeFrames: 0, updates: 0, renders: 0 });
  expect(result.activations).toBe(1);
  expect(result.restored).toEqual({ state: 'ready', playing: false, polling: true, level: 0.7 });
  expect(result.errors).toEqual([]);
});
