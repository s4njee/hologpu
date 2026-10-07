import { test, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const core = '/@fs' + fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url));
const dom = '/@fs' + fileURLToPath(new URL('../../packages/dom/src/index.ts', import.meta.url));
async function harness(page: Page) {
  await page.route('**/__m5_dom', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>M5 DOM</title><style>body{margin:0}#host{width:160px;height:120px}</style><div id="host"><button id="authored">Accessible action</button><h1>Authored heading</h1></div>',
    }),
  );
  await page.goto('/__m5_dom');
}

test('fallbacks preserve authored content, poster priority, parameter handles and teardown', async ({
  page,
}) => {
  await harness(page);
  const result = await page.evaluate(
    async ({ core, dom }) => {
      const { fragmentEffect } = (await import(
        core
      )) as typeof import('../../packages/core/src/index.ts');
      const { attach } = (await import(dom)) as typeof import('../../packages/dom/src/index.ts');
      const host = document.getElementById('host')!;
      const button = document.getElementById('authored')!;
      host.style.borderRadius = '12px';
      const original = host.style.cssText;
      const definition = fragmentEffect({
        id: 'dom-fallback',
        title: 'Fallback',
        params: { value: { type: 'f32', default: 0.2, min: 0, max: 1 } },
        presets: { first: { value: 0.3 }, second: { value: 0.7 } },
        fallback: 'linear-gradient(red,blue)',
        wgsl: 'fn effect(uv:vec2f)->vec4f{return vec4f(uv,0,1);}',
      });
      const originalGPU = Object.getOwnPropertyDescriptor(navigator, 'gpu');
      const results = [];
      for (const scenario of ['missing-gpu', 'missing-adapter', 'missing-feature']) {
        Object.defineProperty(navigator, 'gpu', {
          configurable: true,
          value:
            scenario === 'missing-gpu'
              ? undefined
              : {
                  requestAdapter: async () =>
                    scenario === 'missing-adapter' ? null : { features: new Set() },
                },
        });
        let events = 0;
        const event = () => events++;
        host.addEventListener('hgpu-fallback', event);
        const field = await attach(
          host,
          scenario === 'missing-feature' ? { ...definition, features: ['shader-f16'] } : definition,
          {
            preset: 'first',
            poster:
              'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="green"/></svg>',
          },
        );
        const params = field.params;
        params.value = 0.6;
        field.preset('second');
        field.pause();
        field.play();
        field.reset();
        field.timeline(0.5);
        const root = host.shadowRoot!;
        const poster = root.querySelector('img')!;
        results.push({
          state: host.dataset['hgpuState'],
          same: params === field.params,
          value: params.value,
          events,
          poster: getComputedStyle(poster).display !== 'none',
          canvasHidden: getComputedStyle(field.canvas).display === 'none',
          assigned: root.querySelector('slot')!.assignedElements().includes(button),
          authored: host.contains(button),
        });
        field.destroy();
        field.destroy();
        host.removeEventListener('hgpu-fallback', event);
        if (
          host.shadowRoot!.querySelector('canvas') ||
          !host.shadowRoot!.querySelector('slot')!.assignedElements().includes(button)
        )
          throw new Error('Teardown hid authored content');
      }
      if (originalGPU) Object.defineProperty(navigator, 'gpu', originalGPU);
      else Reflect.deleteProperty(navigator, 'gpu');
      return {
        results,
        original: host.style.cssText === original,
        stateRemoved: !host.hasAttribute('data-hgpu-state'),
        content: button.textContent,
      };
    },
    { core, dom },
  );
  expect(result.results).toHaveLength(3);
  for (const row of result.results)
    expect(row).toEqual({
      state: 'fallback',
      same: true,
      value: 0.7,
      events: 1,
      poster: true,
      canvasHidden: true,
      assigned: true,
      authored: true,
    });
  expect(result.original).toBe(true);
  expect(result.stateRemoved).toBe(true);
  expect(result.content).toBe('Accessible action');
});

test('decorative canvas keeps child hit testing and host pointer/timeline uniforms', async ({
  page,
}) => {
  await harness(page);
  await page.evaluate(
    async ({ core, dom }) => {
      const { fragmentEffect } = (await import(
        core
      )) as typeof import('../../packages/core/src/index.ts');
      const { attach } = (await import(dom)) as typeof import('../../packages/dom/src/index.ts');
      const host = document.getElementById('host')!;
      const field = await attach(
        host,
        fragmentEffect({
          id: 'dom-pointer',
          title: 'Pointer',
          params: {},
          wgsl: 'fn effect(uv:vec2f)->vec4f{return vec4f(uv,0,1);}',
        }),
        { playing: false, layer: 'front' },
      );
      (window as unknown as { attachment: typeof field }).attachment = field;
      document
        .getElementById('authored')!
        .addEventListener('click', () => (host.dataset['clicked'] = 'true'));
    },
    { core, dom },
  );
  await page.getByRole('button', { name: 'Accessible action' }).click();
  await expect(page.locator('#host')).toHaveAttribute('data-clicked', 'true');
  await page.locator('#host').evaluate((host) => {
    host.style.width = '240px';
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const a = (
          window as unknown as { attachment: import('../../packages/dom/src/index.ts').Attachment }
        ).attachment;
        return a.field!.surface!.size[0] / a.field!.surface!.dpr;
      }),
    )
    .toBe(240);
  const result = await page.evaluate(() => {
    const field = (
      window as unknown as { attachment: import('../../packages/dom/src/index.ts').Attachment }
    ).attachment;
    const host = field.host;
    host.dispatchEvent(
      new PointerEvent('pointermove', {
        clientX: host.getBoundingClientRect().width / 2,
        clientY: 60,
        buttons: 0,
        pressure: 0.5,
      }),
    );
    const pointer = [...field.field!.frame.pointer];
    field.timeline(0.625);
    const clock = {
      time: field.field!.frame.time,
      delta: field.field!.frame.delta,
      playing: field.field!.playing,
    };
    let rejected = false;
    try {
      field.timeline(1.1);
    } catch {
      rejected = true;
    }
    const accessibility = field.canvas.getAttribute('aria-hidden'),
      hit = getComputedStyle(field.canvas).pointerEvents;
    field.destroy();
    return { pointer, clock, rejected, accessibility, hit };
  });
  expect(result.pointer).toEqual([0.5, 0.5]);
  expect(result.clock).toEqual({ time: 0.625, delta: 0, playing: false });
  expect(result.rejected).toBe(true);
  expect(result.accessibility).toBe('true');
  expect(result.hit).toBe('none');
});

test('actual device loss emits one lost/restored pair and preserves accessible content', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await harness(page);
  const result = await page.evaluate(
    async ({ core, dom }) => {
      const { fragmentEffect } = (await import(
        core
      )) as typeof import('../../packages/core/src/index.ts');
      const { attach } = (await import(dom)) as typeof import('../../packages/dom/src/index.ts');
      const host = document.getElementById('host')!;
      const events: string[] = [];
      for (const name of ['ready', 'lost', 'restored', 'quality'])
        host.addEventListener(`hgpu-${name}`, () => events.push(name));
      const attachment = await attach(
        host,
        fragmentEffect({
          id: 'dom-recovery',
          title: 'Recovery',
          params: { value: { type: 'f32', default: 0.7, min: 0, max: 1 } },
          wgsl: 'fn effect(uv:vec2f)->vec4f{return vec4f(params.value,uv.x,0,1);}',
        }),
        { playing: false },
      );
      const field = attachment.field!,
        session = field.session,
        generation = session.generation;
      const recovered = new Promise<void>((resolve, reject) => {
        host.addEventListener('hgpu-restored', () => resolve(), { once: true });
        host.addEventListener('hgpu-fallback', () => reject(new Error('Recovery fell back')), {
          once: true,
        });
      });
      session.device.destroy();
      await recovered;
      field.drawAt(0.5);
      const pixels = await field.readPixels();
      const answer = {
        events,
        state: attachment.state,
        newDevice: session.generation > generation,
        sameParams: attachment.params.value === 0.7,
        lit: pixels.pixels.some((x, i) => i % 4 === 0 && x > 100),
        errors: [...session.errors],
        content: host.querySelector('button')!.textContent,
        clients: session.clients,
      };
      attachment.destroy();
      return { ...answer, remaining: session.clients, surfaces: session.scheduler.surfaceCount };
    },
    { core, dom },
  );
  expect(result.events.filter((x) => x === 'ready')).toHaveLength(1);
  expect(result.events.filter((x) => x === 'lost')).toHaveLength(1);
  expect(result.events.filter((x) => x === 'restored')).toHaveLength(1);
  expect(result.state).toBe('ready');
  expect(result.newDevice).toBe(true);
  expect(result.sameParams).toBe(true);
  expect(result.lit).toBe(true);
  expect(result.errors).toEqual([]);
  expect(result.content).toBe('Accessible action');
  expect(result.clients).toBe(1);
  expect(result.remaining).toBe(0);
  expect(result.surfaces).toBe(0);
});

test('initial custom element lifecycle events expose live attachment and parameter handles', async ({
  page,
}) => {
  await harness(page);
  const result = await page.evaluate(
    async ({ core, dom }) => {
      const { fragmentEffect } = (await import(
        core
      )) as typeof import('../../packages/core/src/index.ts');
      const { registerHGPUField } = (await import(
        dom
      )) as typeof import('../../packages/dom/src/index.ts');
      const definition = fragmentEffect({
        id: 'dom-event-handles',
        title: 'Event handles',
        params: { value: { type: 'f32', default: 0.2, min: 0, max: 1 } },
        wgsl: 'fn effect(uv:vec2f)->vec4f{return vec4f(params.value,0,0,1);}',
      });
      registerHGPUField({ resolveEffect: async () => definition });
      const rows = [];
      for (const scenario of ['ready', 'fallback', 'disconnect'] as const) {
        const host = document.createElement(
          'hgpu-field',
        ) as import('../../packages/dom/src/index.ts').HGPUFieldElement;
        host.style.cssText = 'display:block;width:80px;height:60px';
        host.setAttribute('effect', definition.id);
        host.setAttribute('playing', 'false');
        if (scenario === 'fallback') host.setAttribute('fallback', '');
        host.innerHTML = '<button>Accessible event action</button>';
        const snapshots: {
          state: string;
          sameAttachment: boolean;
          sameParams: boolean;
          value: unknown;
          canvasAlive: boolean;
          contentAlive: boolean;
          fieldReady: boolean;
        }[] = [];
        const eventName = scenario === 'fallback' ? 'hgpu-fallback' : 'hgpu-ready';
        host.addEventListener(eventName, (event) => {
          const attachment = (
            event as CustomEvent<{
              attachment: import('../../packages/dom/src/index.ts').Attachment;
            }>
          ).detail.attachment;
          snapshots.push({
            state: host.dataset['hgpuState']!,
            sameAttachment: host.attachment === attachment,
            sameParams: host.params === attachment.params,
            value: host.params?.['value'],
            canvasAlive: host.shadowRoot?.querySelector('canvas') === attachment.canvas,
            contentAlive: host
              .shadowRoot!.querySelector('slot')!
              .assignedElements()
              .includes(host.querySelector('button')!),
            fieldReady: attachment.field?.state === 'ready',
          });
          if (host.params) host.params['value'] = 0.6;
          if (scenario === 'disconnect') host.remove();
        });
        document.body.append(host);
        const attachment = await host.ready;
        rows.push({
          scenario,
          snapshots,
          finalValue: host.params?.['value'],
          sameFinalAttachment: host.attachment === attachment,
          readyNull: attachment === null,
          disconnected: !host.isConnected,
        });
        host.remove();
        if (host.shadowRoot?.querySelector('canvas'))
          throw new Error('Event teardown leaked canvas');
      }
      return rows;
    },
    { core, dom },
  );
  for (const row of result) {
    expect(row.snapshots).toEqual([
      {
        state: row.scenario === 'fallback' ? 'fallback' : 'ready',
        sameAttachment: true,
        sameParams: true,
        value: 0.2,
        canvasAlive: true,
        contentAlive: true,
        fieldReady: row.scenario !== 'fallback',
      },
    ]);
    expect(row.sameFinalAttachment).toBe(true);
    expect(row.readyNull).toBe(row.scenario === 'disconnect');
    expect(row.disconnected).toBe(row.scenario === 'disconnect');
    expect(row.finalValue).toBe(row.scenario === 'disconnect' ? undefined : 0.6);
  }
});

test('custom element lazy epochs discard disconnected imports and reconnect with current attributes', async ({
  page,
}) => {
  await harness(page);
  const result = await page.evaluate(
    async ({ core, dom }) => {
      const { fragmentEffect } = (await import(
        core
      )) as typeof import('../../packages/core/src/index.ts');
      const { registerHGPUField } = (await import(
        dom
      )) as typeof import('../../packages/dom/src/index.ts');
      const definition = fragmentEffect({
        id: 'dom-lazy',
        title: 'Lazy',
        params: { value: { type: 'f32', default: 0.2, min: 0, max: 1 } },
        presets: { first: { value: 0.3 }, second: { value: 0.7 } },
        wgsl: 'fn effect(uv:vec2f)->vec4f{return vec4f(uv,0,1);}',
      });
      let release!: () => void,
        calls = 0;
      const gate = new Promise<void>((r) => (release = r));
      registerHGPUField({
        resolveEffect: async () => {
          calls++;
          if (calls === 1) await gate;
          return definition;
        },
      });
      const host = document.createElement(
        'hgpu-field',
      ) as import('../../packages/dom/src/index.ts').HGPUFieldElement;
      host.setAttribute('effect', 'dom-lazy');
      host.setAttribute('fallback', '');
      host.innerHTML = '<button>Still usable</button>';
      document.body.append(host);
      const first = host.ready;
      host.remove();
      release();
      await first;
      const afterDisconnect = {
        attachment: host.attachment,
        state: host.dataset['hgpuState'],
        canvases: host.shadowRoot?.querySelectorAll('canvas').length ?? 0,
      };
      host.setAttribute('preset', 'second');
      document.body.append(host);
      await host.ready;
      const originalParams = host.params;
      host.setAttribute('params', '{"value":0.6}');
      const updated = host.params?.['value'];
      const reconnect = {
        state: host.dataset['hgpuState'],
        value: updated,
        sameParams: host.params === originalParams,
        content: host.querySelector('button')!.textContent,
        calls,
      };
      host.remove();
      return {
        afterDisconnect,
        reconnect,
        remaining: host.shadowRoot!.querySelectorAll('canvas').length,
      };
    },
    { core, dom },
  );
  expect(result.afterDisconnect).toEqual({ attachment: null, state: undefined, canvases: 0 });
  expect(result.reconnect).toEqual({
    state: 'fallback',
    value: 0.6,
    sameParams: true,
    content: 'Still usable',
    calls: 2,
  });
  expect(result.remaining).toBe(0);
});

test('aborting pending GPU creation releases the eventual field without reviving shadow nodes', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await harness(page);
  const result = await page.evaluate(
    async ({ core, dom }) => {
      const { fragmentEffect } = (await import(
        core
      )) as typeof import('../../packages/core/src/index.ts');
      const { attach } = (await import(dom)) as typeof import('../../packages/dom/src/index.ts');
      const base = fragmentEffect({
        id: 'dom-pending',
        title: 'Pending',
        params: {},
        wgsl: 'fn effect(uv:vec2f)->vec4f{return vec4f(uv,0,1);}',
      });
      let enter!: () => void,
        release!: () => void,
        session!: import('../../packages/core/src/index.ts').DeviceSession;
      const entered = new Promise<void>((r) => (enter = r)),
        gate = new Promise<void>((r) => (release = r));
      const definition = {
        ...base,
        create: async (ctx: import('../../packages/core/src/index.ts').EffectContext) => {
          session = ctx.session;
          enter();
          await gate;
          return base.create(ctx);
        },
      };
      const abort = new AbortController(),
        host = document.getElementById('host')!;
      const pending = attach(host, definition, { signal: abort.signal, playing: false });
      await entered;
      abort.abort();
      const during = host.shadowRoot!.querySelectorAll('canvas').length;
      release();
      const field = await pending;
      return {
        during,
        state: field.state,
        field: field.field,
        clients: session.clients,
        surfaces: session.scheduler.surfaceCount,
        nodes: host.shadowRoot!.querySelectorAll('canvas').length,
        content: host.querySelector('button')!.textContent,
      };
    },
    { core, dom },
  );
  expect(result).toEqual({
    during: 0,
    state: 'disposed',
    field: null,
    clients: 0,
    surfaces: 0,
    nodes: 0,
    content: 'Accessible action',
  });
});

test('offscreen rendering sleeps and reduced motion retains host pointer response', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await harness(page);
  await page.evaluate(
    async ({ core, dom }) => {
      const { fragmentEffect } = (await import(
        core
      )) as typeof import('../../packages/core/src/index.ts');
      const { attach } = (await import(dom)) as typeof import('../../packages/dom/src/index.ts');
      const host = document.getElementById('host')!;
      const attachment = await attach(
        host,
        fragmentEffect({
          id: 'dom-visibility',
          title: 'Visibility',
          params: {},
          reducedMotion: { time: 0.4 },
          wgsl: 'fn effect(uv:vec2f)->vec4f{return vec4f(uv,0,1);}',
        }),
      );
      (
        window as unknown as { attachment: typeof attachment; frames: number; polls: number }
      ).attachment = attachment;
      (window as unknown as { frames: number }).frames = 0;
      attachment.field!.onRendered(() => (window as unknown as { frames: number }).frames++);
      (window as unknown as { polls: number }).polls = 0;
      attachment.field!.onBeforeFrame(() => (window as unknown as { polls: number }).polls++);
      attachment.field!.setFramePolling(true);
    },
    { core, dom },
  );
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { polls: number }).polls))
    .toBeGreaterThan(2);
  const settled = await page.evaluate(() => ({
    frames: (window as unknown as { frames: number }).frames,
    polls: (window as unknown as { polls: number }).polls,
  }));
  expect(settled.frames).toBeGreaterThanOrEqual(1);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { polls: number }).polls))
    .toBeGreaterThan(settled.polls + 2);
  expect(await page.evaluate(() => (window as unknown as { frames: number }).frames)).toBe(
    settled.frames,
  );
  const motion = await page.evaluate(() => {
    const a = (
      window as unknown as { attachment: import('../../packages/dom/src/index.ts').Attachment }
    ).attachment;
    a.host.dispatchEvent(new PointerEvent('pointermove', { clientX: 20, clientY: 20 }));
    a.host.dispatchEvent(new PointerEvent('pointermove', { clientX: 80, clientY: 60 }));
    a.host.style.transform = 'translateY(2000px)';
    return {
      playing: a.field!.playing,
      time: a.field!.frame.time,
      pointer: [...a.field!.frame.pointer],
      velocity: a.field!.frame.velocity.some((x) => x !== 0),
    };
  });
  expect(motion).toEqual({ playing: false, time: 0.4, pointer: [0.5, 0.5], velocity: true });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              attachment: import('../../packages/dom/src/index.ts').Attachment;
            }
          ).attachment.field!.visible,
      ),
    )
    .toBe(false);
  const before = await page.evaluate(() => (window as unknown as { frames: number }).frames);
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => (window as unknown as { frames: number }).frames)).toBe(before);
  await page.evaluate(() =>
    (
      window as unknown as { attachment: import('../../packages/dom/src/index.ts').Attachment }
    ).attachment.destroy(),
  );
});
